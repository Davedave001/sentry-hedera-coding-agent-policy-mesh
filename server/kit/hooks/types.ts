export type AgentKey = 'orch' | 'qa' | 'opt' | 'ctx' | 'sec' | 'dep';

export interface StageContext {
  agentKey: AgentKey;
  callCostHbar: number;
  sessionSpentHbar: number;
  outputs: Record<string, unknown>;
}

export interface PolicyResult {
  pass: boolean;
  reason: string;
  blockSpend: boolean;
}

export interface AgentPolicyConfig {
  maxPerCallHbar: number;
  model: string;
  account: string;
}

export interface PolicyConfig {
  pipelineCapHbar: number;
  hbarUsd: number;
  qaCoverageThreshold: number;
  optRoiThreshold: number;
  ctxSavingsThreshold: number;
  agents: Record<AgentKey, AgentPolicyConfig>;
  secondaryPurchases: Record<string, { maxPerCallHbar: number; account: string }>;
  allowlistedAccounts: string[];
}

export type PolicyHook = (ctx: StageContext, cfg: PolicyConfig) => PolicyResult;

export function pass(reason: string): PolicyResult {
  return { pass: true, reason, blockSpend: false };
}

export function block(reason: string): PolicyResult {
  return { pass: false, reason, blockSpend: true };
}
