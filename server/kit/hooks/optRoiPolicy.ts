import { type PolicyHook, type StageContext, type PolicyConfig, pass, block } from './types.js';

/**
 * Parameter-validation hook, Stage 2. The Optimizer only gets paid if its projected
 * complexity reduction clears the ROI threshold — an expensive refactor that moves
 * nothing is blocked here before the payment is built.
 */
export const optRoiPolicy: PolicyHook = (ctx: StageContext, cfg: PolicyConfig) => {
  const complexityReduction = Number(ctx.outputs.complexityReduction ?? 0);

  if (complexityReduction < cfg.optRoiThreshold) {
    return block(
      `OptROIPolicy: projected complexity reduction ${complexityReduction}% < ` +
        `${cfg.optRoiThreshold}% threshold — optimization spend not justified`,
    );
  }

  return pass(`OptROIPolicy: ${complexityReduction}% >= ${cfg.optRoiThreshold}% threshold`);
};
