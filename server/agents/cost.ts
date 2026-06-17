import type { AgentKey } from '../kit/hooks/types.js';

/** $ per million tokens, matching the rates already embedded in hedera_ci_policy_mesh.html's AGENTS table. */
const RATE_PER_M_USD: Record<AgentKey, { input: number; output: number }> = {
  orch: { input: 25, output: 25 },
  qa: { input: 1.75, output: 14 },
  opt: { input: 1.74, output: 3.48 },
  ctx: { input: 0.14, output: 0.28 },
  sec: { input: 3, output: 15 },
  dep: { input: 0.8, output: 4 },
};

/**
 * Pre-execution stage: converts a real provider call's actual token usage into HBAR
 * cost, using the same per-model $/M rates the dashboard already advertises. This
 * runs before any policy hook sees the call.
 */
export function tokensToHbar(agentKey: AgentKey, inputTokens: number, outputTokens: number, hbarUsd: number): number {
  const rate = RATE_PER_M_USD[agentKey];
  const usd = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return usd / hbarUsd;
}
