import type { StageContext, PolicyConfig } from './types.js';

export interface DeploySummary {
  agent: string;
  recipientAccount: string;
  prTitle: string;
  coverage: number;
  complexityReduction: number;
  tokensSavedPct: number;
  costHbar: number;
  costUsd: number;
}

export type ApprovalRequester = (summary: DeploySummary) => Promise<boolean>;

/**
 * Transaction-review hook, Stage 3. Unlike the other policies this one is always
 * async and always pauses — it is a code-level invariant, not a config flag, so a
 * production deploy can never go autonomous regardless of how clean the pipeline run
 * was. `requestApproval` surfaces the unsigned-tx summary to a human (here: the
 * dashboard's approval modal over WebSocket) and resolves with their decision.
 */
export async function deployHitl(
  ctx: StageContext,
  cfg: PolicyConfig,
  requestApproval: ApprovalRequester,
): Promise<{ pass: boolean; reason: string }> {
  const agentCfg = cfg.agents.dep;

  const summary: DeploySummary = {
    agent: `Deployer (${agentCfg.model})`,
    recipientAccount: agentCfg.account,
    prTitle: String(ctx.outputs.prTitle ?? ''),
    coverage: Number(ctx.outputs.coverage ?? 0),
    complexityReduction: Number(ctx.outputs.complexityReduction ?? 0),
    tokensSavedPct: Number(ctx.outputs.tokensSavedPct ?? 0),
    costHbar: ctx.callCostHbar,
    costUsd: ctx.callCostHbar * cfg.hbarUsd,
  };

  const approved = await requestApproval(summary);

  return approved
    ? { pass: true, reason: 'DeployHITL: human approved — signing deploy transaction' }
    : { pass: false, reason: 'DeployHITL: human rejected — pipeline halted, no production push' };
}
