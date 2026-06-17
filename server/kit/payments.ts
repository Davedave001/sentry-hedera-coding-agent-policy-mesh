import type { Client } from '@hashgraph/sdk';
import { coreAccountPlugin, coreAccountPluginToolNames, type Context } from 'hedera-agent-kit';

export interface PayHbarResult {
  bytes?: Uint8Array;
  transactionId?: string;
  status?: string;
  humanMessage?: string;
}

/**
 * Looks up the real `transfer_hbar_tool` from the Kit's core account plugin and
 * invokes it directly — this is the transaction-review stage of our lifecycle: the
 * actual HBAR transfer gets built, and (depending on `context.mode`) either signed
 * and submitted, or returned as unsigned bytes for human review (DeployHITL).
 */
export async function payHbar(
  client: Client,
  context: Context,
  toAccountId: string,
  amountHbar: number,
  memo: string,
): Promise<PayHbarResult> {
  const tools = coreAccountPlugin.tools(context);
  const transferTool = tools.find((t) => t.method === coreAccountPluginToolNames.TRANSFER_HBAR_TOOL);
  if (!transferTool) throw new Error('transfer_hbar_tool not found in coreAccountPlugin');

  const result = await transferTool.execute(client, context, {
    transfers: [{ accountId: toAccountId, amount: amountHbar }],
    transactionMemo: memo,
  });

  if ('bytes' in result) {
    return { bytes: result.bytes };
  }

  return {
    transactionId: result.raw?.transactionId,
    status: result.raw?.status?.toString?.() ?? String(result.raw?.status),
    humanMessage: result.humanMessage,
  };
}
