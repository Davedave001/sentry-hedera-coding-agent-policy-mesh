import type { Client } from '@hashgraph/sdk';
import type { Context } from 'hedera-agent-kit';
import { spendCapPolicy } from './hooks/spendCap.js';
import { counterpartyAllowlistPolicy } from './hooks/counterpartyAllowlist.js';
import type { PolicyConfig, PolicyHook, StageContext } from './hooks/types.js';
import { payHbar } from './payments.js';
import { submitAuditRecord } from './hcs.js';

export interface PurchaseResult {
  paid: boolean;
  blockedReason?: string;
  /** Name of the hook that blocked payment, e.g. 'spendCapPolicy' or 'optRoiPolicy'.
   *  Callers use this to tell a hard cap violation (halt the pipeline) apart from a
   *  soft outcome-based skip (continue without this stage's payment). */
  failedHook?: string;
  txId?: string;
  costHbar: number;
}

/**
 * The application-level x402 exchange: (1) the agent adapter already made its
 * "request" and knows the provider's cost — that's `ctx.callCostHbar`; (2) here we
 * evaluate that cost against policy as if it were a 402 payment requirement;
 * (3) on pass, we sign and submit the HBAR transfer via the Kit's real
 * `transfer_hbar_tool`; (4) the caller proceeds with (or discards) the already-
 * fetched provider result depending on whether payment succeeded. The published
 * `hedera-agent-kit` doesn't yet ship a dedicated x402 plugin (see agentKit.ts), so
 * this function is our thin protocol glue — but the actual signing/submission goes
 * through the Kit's own tool, not a hand-rolled transaction.
 *
 * `outcomeHooks` are the stage-specific policies (QACoverageGate, OptROIPolicy,
 * CtxSavingsPolicy, SecClearancePolicy) layered on top of the two that always run:
 * SpendCap and CounterpartyAllowlist.
 */
export async function purchaseCall(
  client: Client,
  context: Context,
  stageCtx: StageContext,
  cfg: PolicyConfig,
  outcomeHooks: PolicyHook[] = [],
): Promise<PurchaseResult> {
  const hooks: PolicyHook[] = [spendCapPolicy, counterpartyAllowlistPolicy, ...outcomeHooks];

  for (const hook of hooks) {
    const result = hook(stageCtx, cfg);
    if (!result.pass) {
      await submitAuditRecord(client, context, {
        stage: hook.name,
        agentKey: stageCtx.agentKey,
        decision: 'block',
        reason: result.reason,
        costHbar: stageCtx.callCostHbar,
        timestamp: new Date().toISOString(),
      });
      return { paid: false, blockedReason: result.reason, failedHook: hook.name, costHbar: stageCtx.callCostHbar };
    }
  }

  const agentCfg = cfg.agents[stageCtx.agentKey];
  const memo = `policy-mesh:${stageCtx.agentKey}:${Date.now()}`;
  const payment = await payHbar(client, context, agentCfg.account, stageCtx.callCostHbar, memo);

  await submitAuditRecord(client, context, {
    stage: 'payment',
    agentKey: stageCtx.agentKey,
    decision: 'pay',
    reason: `Paid ${agentCfg.account} for ${stageCtx.agentKey} call`,
    costHbar: stageCtx.callCostHbar,
    txId: payment.transactionId,
    timestamp: new Date().toISOString(),
  });

  return { paid: true, txId: payment.transactionId, costHbar: stageCtx.callCostHbar };
}
