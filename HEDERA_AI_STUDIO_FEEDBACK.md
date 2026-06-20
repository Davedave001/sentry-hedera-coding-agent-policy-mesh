# Feedback: Hedera AI Studio / Agent Kit — from building a CI/CD policy mesh on it

Context: built a six-agent CI/CD pipeline (this repo) where each agent pays for its
own LLM call via HBAR, gated by spend/outcome policies, using `hedera-agent-kit`
(npm) as the foundation. The issues below are things that cost real debugging time
or required reverse-engineering, not stylistic nitpicks.

## 1. "Hooks & Policies" and the x402 plugin aren't in the published package yet

Hedera's own blog posts and docs describe Agent Kit v4 shipping a native **Hooks &
Policies** system (four lifecycle stages: pre-execution, parameter validation,
transaction review, post-execution logging) and an **x402 plugin** for HTTP
402-triggered payments. As of this build, `hedera-agent-kit@3.8.2` on npm exposes
neither under those names — `npm view hedera-agent-kit dist-tags` shows `latest:
3.8.2`, and grepping the bundled `.d.mts` for `Plugin`, `Configuration`, `Context`
turns up none of the announced API surface. What's actually there: `Plugin`/`Tool`
primitives, `Configuration`, `Context` with `AgentMode.AUTONOMOUS |
RETURN_BYTES`, and core plugins (`coreAccountPlugin`, `coreConsensusPlugin`, etc.).

This is a real, buildable, well-designed foundation — but a developer following
the blog posts and the [Hooks and Policies docs page](https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera/hedera-ai-agent-kit/hooks-and-polices)
will write code against an API that doesn't exist yet at the published version, with
no clear signal of the gap. **Ask: either gate the docs/blog content behind a
"coming in vX" label tied to an actual npm version, or ship a prerelease tag
(`next`/`v4-beta`) so the discrepancy is visible from `npm view` directly.**

## 2. Marketing major version doesn't match npm semver major

Blog posts call this "Agent Kit V4." The npm package has never left `3.x`
(`npm view hedera-agent-kit versions` tops out at `3.8.2`). A developer can't tell
from the registry alone whether they have "v4" features or not — the only way to
find out is to grep the bundled type definitions, which is what this build had to
do. **Ask: align the marketing version with the npm major, or document the mapping
explicitly somewhere discoverable from npm (README, or a `// v4-equivalent: 3.8+`
note).**

## 3. `@hashgraph/sdk` is a regular dependency, not a peer dependency

`hedera-agent-kit` bundles `@hashgraph/sdk` pinned to an exact version (`2.80.0` at
build time) as a normal `dependency`. A consuming project that also depends on
`@hashgraph/sdk` (even with a compatible `^2.80.0` range) can get two separately
resolved copies in `node_modules`, and TypeScript then refuses to accept one
package's `Client` instance as the other's `Client` type — two structurally
identical classes from different module instances aren't assignable. This produced:

```
error TS2345: Argument of type '...NodeClient'... is not assignable to
parameter of type '...hedera-agent-kit/node_modules/@hashgraph/sdk...NodeClient'.
Types have separate declarations of a private property '_setNetworkFromName'.
```

The only fix was pinning the consuming project's `@hashgraph/sdk` to the *exact*
version the kit bundles, to force npm to dedupe. **Ask: declare `@hashgraph/sdk` (and
likely `@hiero-ledger/cryptography`) as `peerDependencies` with a version range,
the standard fix for exactly this class of dual-instance problem.**

## 4. `AgentMode.RETURN_BYTES` is the real mechanism for human-in-the-loop approval, but isn't documented as such

For a "surface unsigned transaction bytes for human review before signing" flow —
exactly the compliance pattern Hedera's own AgentCore/x402 messaging emphasizes —
the actual mechanism is `Context.mode = AgentMode.RETURN_BYTES`, which makes any
tool's `execute()` return `{ bytes }` instead of signing/submitting. This is a
genuinely valuable, well-built feature. It was found by reading
`dist/esm/index.d.mts` directly, not from any docs page connecting "human approval
gate" or "HITL" to `AgentMode`. **Ask: a docs page or example titled around the use
case ("human-in-the-loop approval"), not just the enum.**

## 5. No runnable example for registering a custom policy/hook end-to-end

The Hooks and Policies docs page describes the four lifecycle stages conceptually,
but at the time of writing there's no example showing a custom policy registered
and wired into a real tool call, start to finish. This build ended up composing the
equivalent from `Plugin`/`Tool`/`Context` primitives instead (see
`server/kit/x402.ts`, `server/kit/hooks/*.ts` in this repo for what that looks
like in practice) — which works, but means every team doing this independently
reinvents the same composition.

## 6. Python parity is unclear from outside

The Python SDK (`hashgraph/hedera-agent-kit-py`) is announced and real, but
checking whether it has the same Hooks & Policies / x402 capability as the JS
package required separate digging — there's no single comparison page. For a team
choosing between JS and Python before writing code (as this build's plan
explicitly considered, see `IMPLEMENTATION_PLAN.md` §4), that choice is currently
made blind on capability parity.

## What worked well (for balance)

Once the real API surface was found, it composed cleanly: `Plugin.tools(context)`
returning typed `Tool[]`, each with a predictable `method`/`execute(client,
context, params)` shape, made it straightforward to look up `transfer_hbar_tool`
and `submit_topic_message_tool` by name and wrap them in policy checks without
fighting the SDK. The core primitives are well-designed — the gap is entirely
between what's announced/documented and what's discoverable/published at a given
npm version, not the underlying capability.
