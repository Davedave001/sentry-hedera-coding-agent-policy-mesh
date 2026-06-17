import { type PolicyHook, type StageContext, type PolicyConfig, pass, block } from './types.js';

/**
 * Parameter-validation hook, Stage 2. The Context Reducer is an ROI-gated
 * micropayment: if token savings don't clear the threshold, the call isn't worth its
 * own cost, so the payment — and the call itself — is skipped.
 */
export const ctxSavingsPolicy: PolicyHook = (ctx: StageContext, cfg: PolicyConfig) => {
  const tokensSavedPct = Number(ctx.outputs.tokensSavedPct ?? 0);

  if (tokensSavedPct < cfg.ctxSavingsThreshold) {
    return block(
      `CtxSavingsPolicy: projected token savings ${tokensSavedPct}% < ` +
        `${cfg.ctxSavingsThreshold}% threshold — not cost-effective`,
    );
  }

  return pass(`CtxSavingsPolicy: ${tokensSavedPct}% >= ${cfg.ctxSavingsThreshold}% threshold`);
};
