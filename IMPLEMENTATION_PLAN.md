# Hedera CI/CD Policy Mesh — Implementation Plan

## Why this matters: the token cost crisis

The "tokenmaxxing" era — corporate incentives and leaderboards rewarding raw AI
usage — is over. Uber, Meta, and Microsoft have all hit real bill shock from
unmonitored agentic workflows and are clamping down. The failure mode has three
parts: **agentic sprawl** (autonomous agents running for hours, triggering hundreds
of redundant LLM calls with no circuit breaker), **uncapped API costs** (pay-per-
token billing is a blind spot until the invoice arrives), and **verbose prompts**
(unpruned context and bloated payloads inflating every call).

The industry's response has four strategies, and this plan's six-policy design maps
onto all four directly — not as an afterthought, but as the reason the policy mesh
is shaped the way it is:

1. **"Tokenminimizing" metrics** (hard $ allowance per dev/agent, not a usage
   leaderboard) → `SpendCapPolicy` (§6) enforces `maxPerCallHbar` and
   `pipelineCapHbar` *before* a call is paid for, with every decision logged
   immutably to HCS (§8) — spend is auditable in real time, not reconciled after
   the bill.
2. **Optimize data & prompts** (caching, flattened payloads, pruning context) → the
   Context Reducer stage exists for exactly this, and `CtxSavingsPolicy` makes it
   self-gating: the stage only gets paid if it actually saves ≥20% tokens (§2 Case A,
   §6).
3. **Model routing gateways** (cheap models for routine work, frontier models
   reserved for hard problems) → the six-agent mesh's model assignment *is* a
   routing gateway — DeepSeek Flash/Pro for routine stages, Claude Opus reserved for
   the Orchestrator's actual reasoning — enforced economically via per-agent HBAR
   caps, not left to convention (§4 tech stack, policy.config.json).
4. **Open-weight models / self-hosting** → two of six stages already run on
   DeepSeek (open-weight); every agent adapter (§7) is a thin, provider-agnostic
   wrapper, so pointing any stage at a self-hosted endpoint is a one-file change
   with zero changes to the policy layer.

---

## 0. What exists today vs. what this plan builds

`hedera_ci_policy_mesh.html` is a **fully client-side simulation**. It already has the
correct UI surface area — agent cards, pipeline graph, terminal log, spend meters,
approval modal — but every number is fake:

- `coverage`, `complexity`, `ctxSave`, `hasVuln` are `Math.random()` (lines ~656-659)
- HBAR costs are computed locally from a hardcoded `AGENTS` token-rate table (line 521)
- "Payments" and "HCS audit" log lines are just `<div>`s appended to the DOM — nothing
  is signed, submitted, or written to a real topic
- There is no backend, no real agent calls, no Hedera Agent Kit usage anywhere

This plan keeps the HTML file as the **UI layer** (it is good, ship it) and builds the
real system behind it: a backend policy engine that actually invokes coding-agent APIs,
actually builds/signs Hedera transactions, actually writes to HCS, and pushes real
events to the page over a WebSocket using the **same event vocabulary the HTML already
expects** (`log()`, `setNode()`, `setConn()`, `firePacket()`, `updateMetrics()`,
`showApproval()`), so the frontend needs minimal changes.

**This revision builds directly on the Hedera Agent Kit** (not raw `@hashgraph/sdk`
calls dressed up as a "policy engine"). Agent Kit v4 ships a native Hooks & Policies
system with four lifecycle injection points — pre-execution, parameter validation,
transaction review, post-execution logging — plus an x402 plugin for HTTP
402-triggered payments. Available as `hedera-agent-kit` (JS/TS, npm) or
`hedera-agent-kit-py` (Python, LangChain-compatible). Our six pipeline policies are
implemented as Agent Kit hooks registered at those four lifecycle points, not as a
parallel home-grown framework.

---

## 1. Goals

1. Replace simulated stage outcomes with real agent calls (Claude / Codex / DeepSeek).
2. Enforce the six policies as real, blocking, server-side gates — not log lines —
   implemented as Hedera Agent Kit hooks, not custom middleware.
3. Settle real HBAR (testnet first) per agent call via the Hedera Agent Kit's x402
   plugin.
4. Write an immutable audit record to HCS for every policy decision and payment.
5. Drive `hedera_ci_policy_mesh.html` from a live backend instead of `Math.random()`.
6. Package the policy engine as an MCP server so Claude Code / Cursor / Codex can call
   it directly, not just watch it run in a dashboard.

Non-goals for v1: mainnet deployment, multi-tenant auth, billing reconciliation UI.

---

## 2. Practical use cases — agents purchasing real services/APIs

The whole point of this system: agents shouldn't hold an unrestricted API key, they
should pay per call, gated by policy, in the same execution path that makes the call.
Three concrete cases built on the same Hedera Agent Kit hook chain:

**Case A — Coding-agent LLM calls (the pipeline already in the dashboard).**
The QA Evaluator, Optimizer, Context Reducer, Security Scanner, and Deployer each
purchase one real LLM API call per pipeline stage (Codex, DeepSeek V4 Pro/Flash,
Claude Sonnet/Haiku respectively). The Agent Kit's pre-execution hook computes the
call's HBAR cost from real token-rate tables, the parameter-validation hook checks it
against `SpendingLimitPolicy`, and only on pass does the transaction-review hook build
and submit the x402 payment before the LLM call is actually dispatched. This is the
existing dashboard flow, now backed by real hooks instead of `Math.random()`.

**Case B — Security Scanner purchasing a real CVE/vulnerability-database lookup.**
Beyond the LLM call itself, the Security Scanner agent calls a paid third-party
vulnerability-intelligence API (e.g. a CVE feed billed per query) before it can issue
a clearance token. This is a second, independent x402 purchase nested inside Stage 4
— `AllowlistPolicy` restricts payment to the feed's registered Hedera account, and
`SpendingLimitPolicy` caps per-query cost, so a scanner can't be tricked into paying an
arbitrary endpoint. Demonstrates the policy layer gating a *non-LLM* paid API, not just
model providers.

**Case C — Optimizer purchasing a benchmark-as-a-service run.**
Before the Optimizer agent claims a complexity reduction, it pays a hosted
benchmarking API (e.g. a SWE-bench-style harness) to actually verify the claim,
gated by `OptROIPolicy` reading the benchmark's *own* output rather than the
Optimizer's self-reported numbers. This is the pattern that generalizes past
coding agents: any agent that needs to purchase ground truth before its own payment
is authorized.

All three cases share one execution path: **pre-execution hook → parameter-validation
hook (policy check) → transaction-review hook (build + sign x402 payment) →
post-execution hook (HCS audit write)**. The dashboard surfaces each of those four
hook firings as a distinct log line/tag (`S1·SPEND`, `S2·...`, `S3·...`, `S4·HCS`) so
the policy layer is visible in the interface at the exact moment it executes, not as a
buried backend log.

---

## 3. Architecture

```
┌─────────────────────────┐        WebSocket (events)       ┌──────────────────────┐
│ hedera_ci_policy_mesh    │◄────────────────────────────────│  Policy Mesh Server   │
│ .html  (unchanged UI)    │── POST /run {prTitle} ──────────►│  (Node/TS)            │
└─────────────────────────┘                                   │                       │
                                                                │  ┌─────────────────┐ │
                                                                │  │ Orchestrator     │ │
                                                                │  └────────┬─────────┘ │
                                                                │           ▼           │
                                                                │  ┌─────────────────┐ │
                                                                │  │ Hedera Agent Kit │ │  <- 6 policies on
                                                                │  │ Hooks & Policies │ │  4 lifecycle stages
                                                                │  └────────┬─────────┘ │
                                                                │           ▼           │
                                                                │  ┌─────────────────┐ │
                                                                │  │ Agent Adapters   │ │  Claude / Codex /
                                                                │  │ (QA/Opt/Ctx/Sec/ │ │  DeepSeek HTTP APIs
                                                                │  │  Deploy)         │ │
                                                                │  └────────┬─────────┘ │
                                                                │           ▼           │
                                                                │  ┌─────────────────┐ │
                                                                │  │ x402 plugin      │ │  HBAR/USDC pay +
                                                                │  │ + HCS submit     │ │  audit write
                                                                │  └─────────────────┘ │
                                                                └──────────────────────┘
```

Single process for v1 (no need for microservices at this scale): one server hosts
both the HTTP/WS endpoint the HTML talks to, and the Hedera Agent Kit instance running
the pipeline.

---

## 4. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Build tool | **Hedera Agent Kit** — JS/TS (`hedera-agent-kit` on npm) **or** Python (`hedera-agent-kit-py`) | this is the explicit requirement: build on the Kit's native Hooks & Policies + x402 plugin, not raw `@hashgraph/sdk` calls reinvented as a policy layer |
| Language choice | Default to **JS/TS** (Node 20) since the dashboard/WS backend is already Node-shaped; pick **Python** instead if the team wants LangChain-based agent orchestration — Agent Kit's plugin architecture is equivalent in both | only matters for which adapter code you write; the hook/policy model is identical |
| Hooks & Policies | Agent Kit's 4 lifecycle stages: pre-execution, parameter validation, transaction review, post-execution logging | this *is* the policy engine — our 6 policies are hooks registered at these stages, see §6 |
| Payments | Agent Kit's **x402 plugin** | HTTP 402 challenge → policy check → sign → resubmit, same pattern AWS AgentCore Payments uses on Base/USDC, here on Hedera with HBAR or USDC |
| Transport to UI | `ws` (plain WebSocket) | HTML has no framework; raw events are simplest |
| Agent APIs | Anthropic SDK, OpenAI SDK, DeepSeek (OpenAI-compatible) HTTP | one thin adapter per provider, called from inside Agent Kit's transaction-review hook |
| Config | `.env` + `policy.config.json` | caps/thresholds editable without redeploying |
| Persistence (v1) | none required; HCS topic *is* the audit log | avoid a DB until there's a real multi-run query need |

---

## 5. Repo structure

```
/server
  index.ts                  # HTTP + WS API only — /health, /run, /approve, WS push;
                              # the dashboard HTML is served by a separate frontend
                              # container (Dockerfile.frontend), not from here
  pipeline.ts                # 6-stage orchestration (mirrors runPipeline() in HTML)
  kit/
    agentKit.ts               # HederaAgentKit instance (testnet), plugin registration
    hooks/
      spendCap.ts              # pre-execution + parameter-validation hook
      qaCoverageGate.ts        # parameter-validation hook
      optRoiPolicy.ts          # parameter-validation hook
      ctxSavingsPolicy.ts      # parameter-validation hook
      secClearancePolicy.ts    # parameter-validation hook
      deployHitl.ts            # transaction-review hook (resolves via WS approval)
    x402.ts                    # x402 plugin config: facilitator, accepted assets (HBAR/USDC)
    hcs.ts                      # post-execution-logging hook -> submitAuditRecord(topicId, payload)
  agents/
    orchestrator.ts            # Claude Opus 4.8 call
    qaEvaluator.ts              # Codex call, returns {coverage}
    optimizer.ts                 # DeepSeek V4 Pro call, returns {complexityReduction}
    ctxReducer.ts                # DeepSeek V4 Flash call, returns {tokensSavedPct}
    securityScanner.ts           # Claude Sonnet 4.6 call + CVE-feed x402 purchase, returns {vulns}
    deployer.ts                   # Claude Haiku 4.5, builds deploy payload
  config/
    policy.config.json         # caps, thresholds, allowlisted account IDs
  events.ts                   # typed WS event contract shared with frontend
policy.config.json
hedera_ci_policy_mesh.html    # existing UI, edited only at the bottom <script> hook-in
.env.example
package.json                  # or pyproject.toml + requirements.txt if Python
tsconfig.json
IMPLEMENTATION_PLAN.md
```

*(Python equivalent: same shape under `/server`, with `kit/agent_kit.py` instantiating
`hedera_agent_kit_py`'s toolkit and hooks registered as decorated functions per its
plugin API — the lifecycle stages and policy logic are identical, only syntax differs.)*

---

## 6. Policy engine — concrete contracts

Each policy hook gets the same shape so they compose like the HTML's stage list
(`SpendCap·S1 → QACoverageGate·S2 → OptROIPolicy·S2 → CtxSavingsPolicy·S2 →
SecClearancePolicy·S3 → DeployHITL·S3 → AuditHCS·S4`), and each one maps onto exactly
one of the Agent Kit's four lifecycle stages:

| Agent Kit lifecycle stage | Our policy(ies) registered there |
|---|---|
| **pre-execution** | computes `callCostHbar` from real token usage before anything else runs |
| **parameter validation** | `SpendCapPolicy`, `QACoverageGate`, `OptROIPolicy`, `CtxSavingsPolicy`, `SecClearancePolicy` — these read `StageContext.outputs` / cost and return pass/block |
| **transaction review** | `DeployHITL` — pauses the built-but-unsigned tx for human sign-off; on pass, the x402 payment is signed and submitted here for every other stage too |
| **post-execution logging** | `AuditHCS` — writes the decision + receipt to HCS, always runs regardless of pass/block |

```ts
interface StageContext {
  agentKey: 'orch'|'qa'|'opt'|'ctx'|'sec'|'dep';
  callCostHbar: number;
  sessionSpentHbar: number;
  outputs: Record<string, unknown>;   // e.g. {coverage: 87}
}

interface PolicyResult {
  pass: boolean;
  reason: string;
  blockSpend: boolean;   // if false but pass=false, log-only warning
}

type PolicyHook = (ctx: StageContext, cfg: PolicyConfig) => PolicyResult;
```

Hooks to implement, mapped 1:1 to what's already in the HTML log lines:

1. **SpendCapPolicy** (parameter validation) — `callCostHbar > cfg.agents[agentKey].maxPerCall` → block. Also checks `sessionSpentHbar + callCostHbar > cfg.pipelineCap`.
2. **QACoverageGate** (parameter validation) — `outputs.coverage < cfg.qaCoverageThreshold (80)` → block Optimizer + CtxReducer spend.
3. **OptROIPolicy** (parameter validation) — `outputs.complexityReduction < cfg.optRoiThreshold (15)` → skip Optimizer payment, pipeline continues.
4. **CtxSavingsPolicy** (parameter validation) — `outputs.tokensSavedPct < cfg.ctxSavingsThreshold (20)` → skip Ctx Reducer payment, pipeline continues.
5. **SecClearancePolicy** (parameter validation) — `outputs.vulns.some(v => v.severity === 'CRITICAL')` → hard block Deployer.
6. **DeployHITL** (transaction review) — always pauses; resolved by a human clicking Approve/Reject in the existing modal, round-tripped over WS (see §8).

`policy.config.json` holds the numbers so thresholds aren't buried in code:

```json
{
  "pipelineCapHbar": 50,
  "hbarUsd": 0.06,
  "qaCoverageThreshold": 80,
  "optRoiThreshold": 15,
  "ctxSavingsThreshold": 20,
  "agents": {
    "orch": { "maxPerCall": 8,   "account": "0.0.4567890" },
    "qa":   { "maxPerCall": 3,   "account": "0.0.QA_PROVIDER" },
    "opt":  { "maxPerCall": 2,   "account": "0.0.5012987" },
    "ctx":  { "maxPerCall": 0.8, "account": "0.0.5012987" },
    "sec":  { "maxPerCall": 4,   "account": "0.0.4567890" },
    "dep":  { "maxPerCall": 1.5, "account": "0.0.8891100" }
  },
  "allowlistedAccounts": ["0.0.4567890", "0.0.5012987", "0.0.8891100"]
}
```

`CounterpartyAllowlist` is implicit here: any `account` not in `allowlistedAccounts`
fails closed before a transfer is built.

---

## 7. Agent adapters — real calls, real cost

Each adapter does three things: call the provider, parse a structured result, return
actual token counts (not the HTML's fabricated `inputK`/`outputK`).

```ts
// agents/qaEvaluator.ts
export async function runQaEvaluator(diff: string): Promise<{
  coverage: number; inputTokens: number; outputTokens: number;
}> {
  const res = await openai.responses.create({
    model: 'gpt-5.3-codex',
    input: buildQaPrompt(diff),
  });
  return {
    coverage: parseCoverage(res.output_text),
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}
```

Cost conversion uses real per-provider rates (already gathered in the prior turn:
Claude Sonnet 4.6 $3/$15 per M tokens, Codex $1.75/$14, DeepSeek Flash $0.14/$0.28,
DeepSeek Pro $0.30/$0.50) divided by live HBAR/USD price, not the static `HBAR_USD`
constant — pull spot price from a Hedera-friendly price feed (e.g. CoinGecko) on
server start and refresh every few minutes.

---

## 8. Hedera integration (via Agent Kit's x402 plugin)

- **Network**: testnet for build-out; mainnet is a config flip once policy thresholds
  are validated against real traffic.
- **Payment flow (x402)**, the standard 4-step HTTP exchange the Agent Kit's plugin
  implements, used identically for Case A/B/C in §2:
  1. Agent adapter makes the initial request to the provider (LLM API, CVE feed,
     benchmark service).
  2. Provider responds `402 Payment Required` with payment requirements (amount,
     asset, recipient account).
  3. Our parameter-validation hooks (§6) evaluate that requirement against
     `SpendingLimitPolicy` and `AllowlistPolicy` *before* anything is signed. Only on
     pass does the transaction-review hook sign the payment (HBAR or USDC transfer)
     with the pipeline's operator key via the x402 facilitator.
  4. The original request is retried with the `X-PAYMENT` header attached; the
     provider returns the actual result (completion, CVE data, benchmark score).
- **HCS audit**: one topic per pipeline run (or one long-lived topic with `runId` in
  the message). The post-execution-logging hook fires on every stage — pass, block,
  and payment — writing one `TopicMessageSubmitTransaction` with a JSON payload:
  `{stage, agentKey, decision, reason, costHbar, txId, timestamp}`. This is what makes
  the "AuditHCS·S4" log line in the HTML real instead of decorative.
- **Approval gate (DeployHITL)**: the transaction-review hook builds the deploy
  transaction but does **not** sign/submit. It sends the unsigned tx bytes (or a
  summary, matching the existing modal body) to the frontend over WS; the human's
  Approve/Reject click round-trips back, and only then does the hook sign+submit.

---

## 9. Wiring the existing HTML to live data

The HTML's `runPipeline()` (lines 640-843) currently does everything in-browser with
`sleep()` between fake stages. Replace it with a thin WS client that:

1. On "Run CI/CD" click, `POST /run {prTitle}` instead of running the local function.
2. Opens/reuses a WebSocket; for each server-sent event, call the **same** existing
   helper functions already defined in the file — they don't need to change:
   - `{type:'log', agentKey, tagClass, tagText, msg}` → `log(...)`
   - `{type:'node', i, state}` → `setNode(i, state)`
   - `{type:'conn', i, state}` → `setConn(i, state)`
   - `{type:'cost', i, text}` → `setNodeCost(i, text)`
   - `{type:'packet', i}` → `firePacket(i)`
   - `{type:'metrics', spent, calls, blocked, tokensSaved, runs}` → merge into `state`, call `updateMetrics()`
   - `{type:'approval', title, p, bodyHTML}` → `showApproval(...)`, and on resolution `POST /approve {runId, approved}`
3. Remove only the body of `runPipeline()`'s simulation logic (the `Math.random()`
   scenario block and the `sleep()`-paced fake stage code) — keep every DOM-manipulation
   helper untouched. This is a ~60-line surgical edit, not a rewrite.

This keeps the visual design, animations, and layout exactly as already built and
reviewed, while making every number on screen real.

---

## 10. MCP packaging (for Claude Code / Cursor / Codex)

Expose the policy engine itself as an MCP server (separate from the dashboard) so an
IDE agent can call `policy_mesh.request_payment({agentKey, taskDescription})` directly
and get back an allow/block decision + receipt, without a human watching a dashboard:

```
/mcp-server
  index.ts        # MCP server entrypoint, wraps server/pipeline.ts stage logic
  tools.ts         # exposes: checkSpendCap, requestPayment, getAuditTrail
```

Install path mirrors what's already documented for the Hedera Agent Kit MCP server —
`claude mcp add hedera-policy --command=npx --args=-y,@yourscope/policy-mesh-mcp` for
Claude Code, `.cursor/mcp.json` entry for Cursor. This reuses the hook code from
`/server/kit/hooks`, it's not a separate implementation.

---

## 11. Build phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 1. Scaffolding | Agent Kit project (JS or Python), `.env`, Hedera testnet account + topic created, `policy.config.json` | — |
| 2. Policy hooks | All 6 hooks registered at Agent Kit lifecycle stages, unit-tested against synthetic `StageContext`s | Phase 1 |
| 3. Agent adapters | Real calls to Claude/Codex/DeepSeek, parsed structured outputs | Phase 1 |
| 4. x402 + HCS wiring | x402 plugin configured against testnet facilitator; HCS audit hook submitting receipts | Phase 1 |
| 5. Case B/C purchases | CVE-feed and benchmark-service x402 purchases wired into Security Scanner / Optimizer adapters | 2, 4 |
| 6. Pipeline orchestration | end-to-end run stringing 2-5 together, headless (no UI) | 2, 3, 4, 5 |
| 7. WS event layer | `events.ts` contract + server push | 6 |
| 8. Frontend wiring | Edit HTML's `runPipeline()` per §9, manual test in browser | 7 |
| 9. MCP packaging | `/mcp-server`, tested from Claude Code | 2, 4 |
| 10. Hardening | Real spot HBAR/USD price feed, error handling for provider timeouts, reconnect logic for WS | 8 |

Suggested order: 1 → 2 → 4 (these three are independent, can parallelize) → 3 → 5 →
6 → 7 → 8 → 9 → 10.

---

## 12. Testing strategy

- **Policy hooks**: pure functions, unit test every threshold boundary (coverage=79
  vs 80, complexity=14 vs 15, etc.) — these are the differentiating logic, test them
  hardest.
- **Hedera client**: integration tests against testnet using a funded test account;
  assert receipt status `SUCCESS` and that HCS message round-trips via mirror node query.
- **Pipeline**: one end-to-end test per HTML preset scenario (race-condition fix →
  expect pass-through; force a low-coverage stub response → expect QA block).
- **Frontend**: manual browser pass per `/verify`-style check — confirm the WS-driven
  log lines, node states, and approval modal behave identically to the current
  simulation, since that's the acceptance bar.

---

## 13. Security & compliance notes

- Operator private key lives only in server env, never reaches the browser.
- Allowlist check happens **before** any transaction is constructed, not just before
  signing — a blocked counterparty should never produce a signable tx.
- DeployHITL must not be bypassable by config; treat it as a code-level invariant, not
  a policy.config.json flag, since it's the one human-safety gate in the system.
- All HCS audit writes are append-only by construction (HCS has no edit/delete) —
  this is the actual "immutable audit trail" claim, make sure no part of the system
  tries to fake it with a mutable log file instead.

---

## 14. Open questions to resolve before Phase 1

- JS or Python build — default recommendation is JS/TS (matches the Node WS backend),
  switch to Python only if the team already standardizes agent orchestration on
  LangChain.
- Mainnet vs. testnet HBAR for the actual coding-agent payments — testnet recommended
  until thresholds are tuned against real provider costs.
- Real per-provider treasury account IDs aren't established yet (the HTML's
  `0.0.4567890` etc. are placeholders) — need real or simulated counterparty accounts
  for the allowlist to mean anything in a demo vs. production context.
- Which real third-party API backs Case B (CVE feed) and Case C (benchmark service) —
  needs a provider that actually speaks x402, or a thin 402-wrapping proxy in front of
  a normal REST API for the demo.
- HBAR/USD price feed source and refresh cadence.
