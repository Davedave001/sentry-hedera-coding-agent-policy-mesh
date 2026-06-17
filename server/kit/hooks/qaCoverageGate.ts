import { type PolicyHook, type StageContext, type PolicyConfig, pass, block } from './types.js';

/**
 * Parameter-validation hook, Stage 2. Reads the QA agent's own output rather than its
 * cost — blocks Optimizer + Context Reducer spend if coverage is too low to justify
 * paying for further optimization.
 */
export const qaCoverageGate: PolicyHook = (ctx: StageContext, cfg: PolicyConfig) => {
  const coverage = Number(ctx.outputs.coverage ?? 0);

  if (coverage < cfg.qaCoverageThreshold) {
    return block(
      `QACoverageGate: coverage ${coverage}% < ${cfg.qaCoverageThreshold}% threshold — ` +
        `Optimizer and CtxReducer spend blocked`,
    );
  }

  return pass(`QACoverageGate: coverage ${coverage}% >= ${cfg.qaCoverageThreshold}%`);
};
