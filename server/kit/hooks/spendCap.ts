import { type PolicyHook, type StageContext, type PolicyConfig, pass, block } from './types.js';

/**
 * Parameter-validation hook. Runs before any transaction is built for any agent call.
 * Two checks: per-agent per-call cap, and cumulative pipeline session cap.
 */
export const spendCapPolicy: PolicyHook = (ctx: StageContext, cfg: PolicyConfig) => {
  const agentCfg = cfg.agents[ctx.agentKey];

  if (ctx.callCostHbar > agentCfg.maxPerCallHbar) {
    return block(
      `SpendCap: ${ctx.agentKey} call cost ${ctx.callCostHbar.toFixed(2)} ℏ exceeds ` +
        `per-call cap ${agentCfg.maxPerCallHbar} ℏ`,
    );
  }

  if (ctx.sessionSpentHbar + ctx.callCostHbar > cfg.pipelineCapHbar) {
    return block(
      `SpendCap: pipeline session would reach ${(ctx.sessionSpentHbar + ctx.callCostHbar).toFixed(2)} ℏ, ` +
        `exceeding pipeline cap ${cfg.pipelineCapHbar} ℏ`,
    );
  }

  return pass(`SpendCap: ${ctx.callCostHbar.toFixed(2)} ℏ within ${agentCfg.maxPerCallHbar} ℏ cap`);
};
