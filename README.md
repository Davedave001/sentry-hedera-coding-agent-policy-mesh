# Hedera CI/CD Policy Mesh

A six-agent CI/CD pipeline where every coding agent pays for its own LLM call with a
Hedera HBAR micropayment, gated by spend caps and outcome-based policies enforced
*before* the payment — not audited after the bill arrives.

## The token cost crisis

The "tokenmaxxing" era — corporate incentives and leaderboards that rewarded raw AI
usage — is over. It has turned into a token cost crisis. Uber, Meta, and Microsoft
have all hit bill shock from unmonitored agentic workflows and are now clamping down.

The core problem has three parts:

- **Agentic sprawl** — autonomous coding agents run for hours, reading entire
  repositories and triggering hundreds of redundant LLM calls with no circuit breaker.
- **Uncapped API costs** — pay-per-token architectures are a financial blind spot;
  a handful of long sessions or abandoned experiments can rack up thousands of
  dollars before anyone notices.
- **Polite, verbose prompts** — conversational filler, bloated JSON payloads, and
  unpruned chat history quietly balloon the cost of every single call.

The industry's emerging fix has four parts, and this repo is a working
implementation of all four:

| Industry strategy | How the Policy Mesh implements it |
|---|---|
| **"Tokenminimizing" metrics** — track $ spent against a hard allowance, not raw token usage | [`policy.config.json`](policy.config.json)'s `maxPerCallHbar` per agent and `pipelineCapHbar` session cap are enforced *before* any call is paid for, by [`spendCapPolicy`](server/kit/hooks/spendCap.ts) — not reconciled after the invoice. Every decision is written immutably to Hedera Consensus Service ([`hcs.ts`](server/kit/hcs.ts)), so spend is auditable in real time, not discovered at month-end. |
| **Optimize data & prompts** — caching, flattened payloads, pruning context | The Context Reducer is a dedicated pipeline stage ([`ctxReducer.ts`](server/agents/ctxReducer.ts)) whose entire job is stripping dead context before it reaches expensive downstream calls — and it's economically self-gating: [`CtxSavingsPolicy`](server/kit/hooks/ctxSavingsPolicy.ts) only pays for the stage if it actually saves ≥20% tokens. The cost-control mechanism is itself cost-controlled. |
| **Model routing gateways** — cheap models for routine tasks, frontier models reserved for hard problems | The six-agent mesh *is* a routing gateway: DeepSeek V4 Flash (cheapest) reduces context, DeepSeek V4 Pro optimizes code, GPT-5.3-Codex runs QA, Claude Sonnet does security review, Claude Haiku drafts deploy notes — Claude Opus is reserved for the Orchestrator's actual planning step. Routing is enforced economically via per-agent HBAR caps, not left to convention. |
| **Open-weight models / self-hosting** | Two of six stages already run on DeepSeek (open-weight). Every agent adapter ([`server/agents/*.ts`](server/agents)) is a thin, provider-agnostic wrapper — pointing any stage at a self-hosted open-weight endpoint is a one-file change, with zero changes to the policy layer. |

## Architecture

```
PR submitted → Orchestrator (Claude Opus) → QA (Codex) → Optimizer (DeepSeek Pro)
            → Context Reducer (DeepSeek Flash) → Security (Claude Sonnet)
            → Deployer (Claude Haiku, human-approval-gated)
```

Six policy hooks run on every stage: `SpendCap`, `CounterpartyAllowlist`,
`QACoverageGate`, `OptROIPolicy`, `CtxSavingsPolicy`, `SecClearancePolicy`, and a
`DeployHITL` gate that always pauses for human sign-off before production. Every
pass/block/payment decision is written to HCS. Full design rationale, the Hedera
Agent Kit integration details, and the build phases are in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Repo layout

- `hedera_ci_policy_mesh.html` — the live dashboard (single static file)
- `server/` — the API: policy hooks, agent adapters, Hedera Agent Kit wiring, pipeline orchestration
- `mcp-server/` — exposes the policy mesh itself as an MCP server for Claude Code / Cursor / Codex
- `scripts/create-audit-topic.ts` — one-time HCS topic setup
- `Dockerfile.api` / `Dockerfile.frontend` — split-container deployment (see below)

## Running it

**Local dev** (single process, same-origin dashboard + API):
```
npm install
cp .env.example .env   # fill in real Hedera + provider credentials
npm run create-topic   # one-time: creates the HCS audit topic
npm run dev
```

**Production** — two containers, e.g. on Coolify: `Dockerfile.frontend` serves the
dashboard, `Dockerfile.api` runs the API, connected via the `API_ORIGIN` /
`FRONTEND_ORIGIN` environment variables. See
[IMPLEMENTATION_PLAN.md §8–9](IMPLEMENTATION_PLAN.md) for the Hedera integration and
frontend-wiring details, and `docker-compose.yml` for a local two-container test
before deploying.
