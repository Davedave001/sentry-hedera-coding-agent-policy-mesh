import type { Client } from '@hashgraph/sdk';
import type { Context } from 'hedera-agent-kit';
import { purchaseCall } from './kit/x402.js';
import { qaCoverageGate } from './kit/hooks/qaCoverageGate.js';
import { secClearancePolicy } from './kit/hooks/secClearancePolicy.js';
import { optRoiPolicy } from './kit/hooks/optRoiPolicy.js';
import { ctxSavingsPolicy } from './kit/hooks/ctxSavingsPolicy.js';
import { deployHitl, type ApprovalRequester } from './kit/hooks/deployHitl.js';
import { submitAuditRecord } from './kit/hcs.js';
import { tokensToHbar } from './agents/cost.js';
import { runOrchestrator } from './agents/orchestrator.js';
import { runQaEvaluator } from './agents/qaEvaluator.js';
import { runOptimizer } from './agents/optimizer.js';
import { runCtxReducer } from './agents/ctxReducer.js';
import { runSecurityScanner } from './agents/securityScanner.js';
import { runDeployer } from './agents/deployer.js';
import type { AgentKey, PolicyConfig, StageContext } from './kit/hooks/types.js';
import type { EventSink } from './events.js';

export interface PipelineState {
  spent: Record<AgentKey, number>;
  calls: number;
  blocked: number;
  tokensSaved: number;
  runs: number;
}

export function createPipelineState(): PipelineState {
  return {
    spent: { orch: 0, qa: 0, opt: 0, ctx: 0, sec: 0, dep: 0 },
    calls: 0,
    blocked: 0,
    tokensSaved: 0,
    runs: 0,
  };
}

function sessionSpent(state: PipelineState): number {
  return Object.values(state.spent).reduce((a, b) => a + b, 0);
}

function emitMetrics(state: PipelineState, emit: EventSink): void {
  emit({ type: 'metrics', spent: state.spent, calls: state.calls, blocked: state.blocked, tokensSaved: state.tokensSaved, runs: state.runs });
}

interface RunDeps {
  client: Client;
  context: Context;
  cfg: PolicyConfig;
  state: PipelineState;
  emit: EventSink;
  requestApproval: ApprovalRequester;
}

/**
 * Headless, end-to-end run of the six-stage pipeline. Mirrors the lifecycle in
 * hedera_ci_policy_mesh.html's runPipeline() but every coverage/complexity/savings/
 * vuln number comes from a real agent adapter call (server/agents/*), and every
 * payment/audit decision goes through the real Hedera Agent Kit tools via
 * purchaseCall() (server/kit/x402.ts). Emits the same event vocabulary the existing
 * dashboard already expects, per IMPLEMENTATION_PLAN.md §9.
 */
export async function runPipeline(prTitle: string, deps: RunDeps): Promise<boolean> {
  const { client, context, cfg, state, emit, requestApproval } = deps;
  state.runs++;

  for (let i = 0; i < 6; i++) emit({ type: 'node', i, state: '' });
  for (let i = 0; i < 5; i++) emit({ type: 'conn', i, state: '' });

  // ── STAGE 0: ORCHESTRATOR ──
  emit({ type: 'node', i: 0, state: 'run' });
  const orch = await runOrchestrator(prTitle);
  const orchCtx: StageContext = {
    agentKey: 'orch',
    callCostHbar: tokensToHbar('orch', orch.inputTokens, orch.outputTokens, cfg.hbarUsd),
    sessionSpentHbar: sessionSpent(state),
    outputs: { prTitle },
  };
  emit({ type: 'log', agentKey: 'orch', tagClass: 't-hook', tagText: 'S1·SPEND', msg: `SpendCap check — call cost: ${orchCtx.callCostHbar.toFixed(2)} ℏ` });

  const orchPurchase = await purchaseCall(client, context, orchCtx, cfg);
  if (!orchPurchase.paid) {
    emit({ type: 'log', agentKey: 'orch', tagClass: 't-block', tagText: 'BLOCKED', msg: orchPurchase.blockedReason ?? 'blocked' });
    state.blocked++;
    emit({ type: 'node', i: 0, state: 'fail' });
    emitMetrics(state, emit);
    return false;
  }
  state.spent.orch += orchPurchase.costHbar;
  state.calls++;
  emit({ type: 'cost', i: 0, text: `${orchPurchase.costHbar.toFixed(2)} ℏ` });
  emit({ type: 'packet', i: 0 });
  emit({ type: 'log', agentKey: 'orch', tagClass: 't-hook', tagText: 'PLAN', msg: orch.plan });
  emit({ type: 'node', i: 0, state: 'done' });
  emit({ type: 'conn', i: 0, state: 'live' });
  emitMetrics(state, emit);

  // ── STAGE 1: QA EVALUATOR ──
  emit({ type: 'conn', i: 0, state: 'done' });
  emit({ type: 'node', i: 1, state: 'run' });
  const qa = await runQaEvaluator(prTitle);
  const qaCtx: StageContext = {
    agentKey: 'qa',
    callCostHbar: tokensToHbar('qa', qa.inputTokens, qa.outputTokens, cfg.hbarUsd),
    sessionSpentHbar: sessionSpent(state),
    outputs: { coverage: qa.coverage },
  };
  const qaPurchase = await purchaseCall(client, context, qaCtx, cfg);
  if (!qaPurchase.paid) {
    emit({ type: 'log', agentKey: 'qa', tagClass: 't-block', tagText: 'BLOCKED', msg: qaPurchase.blockedReason ?? 'blocked' });
    state.blocked++;
    emit({ type: 'node', i: 1, state: 'fail' });
    emitMetrics(state, emit);
    return false;
  }
  state.spent.qa += qaPurchase.costHbar;
  state.calls++;
  emit({ type: 'cost', i: 1, text: `${qaPurchase.costHbar.toFixed(2)} ℏ` });
  emit({ type: 'packet', i: 1 });
  emit({ type: 'log', agentKey: 'qa', tagClass: 't-eval', tagText: 'EVAL', msg: `coverage result: ${qa.coverage}%` });

  const coverageGate = qaCoverageGate(qaCtx, cfg);
  if (!coverageGate.pass) {
    await submitAuditRecord(client, context, {
      stage: 'qaCoverageGate',
      agentKey: 'qa',
      decision: 'block',
      reason: coverageGate.reason,
      timestamp: new Date().toISOString(),
    });
    emit({ type: 'log', agentKey: 'qa', tagClass: 't-block', tagText: 'BLOCKED', msg: coverageGate.reason });
    state.blocked++;
    emit({ type: 'node', i: 1, state: 'fail' });
    emitMetrics(state, emit);
    return false;
  }
  emit({ type: 'log', agentKey: 'qa', tagClass: 't-pass', tagText: 'GATE✓', msg: coverageGate.reason });
  emit({ type: 'node', i: 1, state: 'done' });
  emit({ type: 'conn', i: 1, state: 'live' });
  emitMetrics(state, emit);

  // ── STAGE 2: CODE OPTIMIZER ──
  emit({ type: 'conn', i: 1, state: 'done' });
  emit({ type: 'node', i: 2, state: 'run' });
  const opt = await runOptimizer(prTitle);
  const optCtx: StageContext = {
    agentKey: 'opt',
    callCostHbar: tokensToHbar('opt', opt.inputTokens, opt.outputTokens, cfg.hbarUsd),
    sessionSpentHbar: sessionSpent(state),
    outputs: { complexityReduction: opt.complexityReduction },
  };
  const optPurchase = await purchaseCall(client, context, optCtx, cfg, [optRoiPolicy]);
  if (!optPurchase.paid) {
    const hardFail = optPurchase.failedHook === 'spendCapPolicy' || optPurchase.failedHook === 'counterpartyAllowlistPolicy';
    emit({ type: 'log', agentKey: 'opt', tagClass: 't-block', tagText: 'BLOCKED', msg: optPurchase.blockedReason ?? 'blocked' });
    state.blocked++;
    emit({ type: 'node', i: 2, state: 'fail' });
    emit({ type: 'conn', i: 2, state: 'done' });
    emitMetrics(state, emit);
    if (hardFail) return false;
  } else {
    state.spent.opt += optPurchase.costHbar;
    state.calls++;
    emit({ type: 'cost', i: 2, text: `${optPurchase.costHbar.toFixed(2)} ℏ` });
    emit({ type: 'packet', i: 2 });
    emit({ type: 'log', agentKey: 'opt', tagClass: 't-opt', tagText: 'RESULT', msg: `complexity reduced by ${opt.complexityReduction}%` });
    emit({ type: 'node', i: 2, state: 'done' });
    emit({ type: 'conn', i: 2, state: 'done' });
    emitMetrics(state, emit);
  }

  // ── STAGE 3: CONTEXT REDUCER ──
  emit({ type: 'node', i: 3, state: 'run' });
  const ctxr = await runCtxReducer(prTitle);
  const ctxCtx: StageContext = {
    agentKey: 'ctx',
    callCostHbar: tokensToHbar('ctx', ctxr.inputTokens, ctxr.outputTokens, cfg.hbarUsd),
    sessionSpentHbar: sessionSpent(state),
    outputs: { tokensSavedPct: ctxr.tokensSavedPct },
  };
  const ctxPurchase = await purchaseCall(client, context, ctxCtx, cfg, [ctxSavingsPolicy]);
  if (!ctxPurchase.paid) {
    const hardFail = ctxPurchase.failedHook === 'spendCapPolicy' || ctxPurchase.failedHook === 'counterpartyAllowlistPolicy';
    emit({ type: 'log', agentKey: 'ctx', tagClass: 't-block', tagText: 'BLOCKED', msg: ctxPurchase.blockedReason ?? 'blocked' });
    state.blocked++;
    emit({ type: 'node', i: 3, state: 'fail' });
    emit({ type: 'conn', i: 3, state: 'done' });
    emitMetrics(state, emit);
    if (hardFail) return false;
  } else {
    state.spent.ctx += ctxPurchase.costHbar;
    state.calls++;
    const tokensSaved = Math.floor(ctxr.tokensSavedPct * 0.8);
    state.tokensSaved += tokensSaved;
    emit({ type: 'cost', i: 3, text: `${ctxPurchase.costHbar.toFixed(2)} ℏ` });
    emit({ type: 'packet', i: 3 });
    emit({ type: 'log', agentKey: 'ctx', tagClass: 't-ctx', tagText: 'RESULT', msg: `context reduced by ${ctxr.tokensSavedPct}% — ${tokensSaved}K tokens saved` });
    emit({ type: 'node', i: 3, state: 'done' });
    emit({ type: 'conn', i: 3, state: 'done' });
    emitMetrics(state, emit);
  }

  // ── STAGE 4: SECURITY SCANNER ──
  emit({ type: 'node', i: 4, state: 'run' });
  const sec = await runSecurityScanner(prTitle);
  const secCtx: StageContext = {
    agentKey: 'sec',
    callCostHbar: tokensToHbar('sec', sec.inputTokens, sec.outputTokens, cfg.hbarUsd),
    sessionSpentHbar: sessionSpent(state),
    outputs: { vulns: sec.vulns },
  };
  const secPurchase = await purchaseCall(client, context, secCtx, cfg);
  if (!secPurchase.paid) {
    emit({ type: 'log', agentKey: 'sec', tagClass: 't-block', tagText: 'BLOCKED', msg: secPurchase.blockedReason ?? 'blocked' });
    state.blocked++;
    emit({ type: 'node', i: 4, state: 'fail' });
    emitMetrics(state, emit);
    return false;
  }
  state.spent.sec += secPurchase.costHbar;
  state.calls++;
  emit({ type: 'cost', i: 4, text: `${secPurchase.costHbar.toFixed(2)} ℏ` });
  emit({ type: 'packet', i: 4 });

  const clearance = secClearancePolicy(secCtx, cfg);
  if (!clearance.pass) {
    await submitAuditRecord(client, context, {
      stage: 'secClearancePolicy',
      agentKey: 'sec',
      decision: 'block',
      reason: clearance.reason,
      timestamp: new Date().toISOString(),
    });
    emit({ type: 'log', agentKey: 'sec', tagClass: 't-block', tagText: 'CRITICAL', msg: clearance.reason });
    state.blocked++;
    emit({ type: 'node', i: 4, state: 'fail' });
    emitMetrics(state, emit);
    return false;
  }
  emit({ type: 'log', agentKey: 'sec', tagClass: 't-pass', tagText: 'CLEAR', msg: clearance.reason });
  emit({ type: 'node', i: 4, state: 'done' });
  emit({ type: 'conn', i: 4, state: 'live' });
  emitMetrics(state, emit);

  // ── STAGE 5: DEPLOYER (always HITL) ──
  emit({ type: 'conn', i: 4, state: 'done' });
  emit({ type: 'node', i: 5, state: 'run' });
  const dep = await runDeployer(prTitle);
  const depCtx: StageContext = {
    agentKey: 'dep',
    callCostHbar: tokensToHbar('dep', dep.inputTokens, dep.outputTokens, cfg.hbarUsd),
    sessionSpentHbar: sessionSpent(state),
    outputs: {
      prTitle,
      coverage: qa.coverage,
      complexityReduction: opt.complexityReduction,
      tokensSavedPct: ctxr.tokensSavedPct,
    },
  };

  const hitl = await deployHitl(depCtx, cfg, requestApproval);
  if (!hitl.pass) {
    await submitAuditRecord(client, context, {
      stage: 'deployHitl',
      agentKey: 'dep',
      decision: 'block',
      reason: hitl.reason,
      timestamp: new Date().toISOString(),
    });
    emit({ type: 'log', agentKey: 'dep', tagClass: 't-block', tagText: 'REJECTED', msg: hitl.reason });
    state.blocked++;
    emit({ type: 'node', i: 5, state: 'fail' });
    emitMetrics(state, emit);
    return false;
  }

  const depPurchase = await purchaseCall(client, context, depCtx, cfg);
  if (!depPurchase.paid) {
    emit({ type: 'log', agentKey: 'dep', tagClass: 't-block', tagText: 'BLOCKED', msg: depPurchase.blockedReason ?? 'blocked' });
    state.blocked++;
    emit({ type: 'node', i: 5, state: 'fail' });
    emitMetrics(state, emit);
    return false;
  }
  state.spent.dep += depPurchase.costHbar;
  state.calls++;
  emit({ type: 'cost', i: 5, text: `${depPurchase.costHbar.toFixed(2)} ℏ` });
  emit({ type: 'log', agentKey: 'dep', tagClass: 't-pass', tagText: 'DEPLOYED', msg: `Production deploy complete. TxID: ${depPurchase.txId ?? 'n/a'}` });
  emit({ type: 'node', i: 5, state: 'done' });
  emitMetrics(state, emit);

  return true;
}
