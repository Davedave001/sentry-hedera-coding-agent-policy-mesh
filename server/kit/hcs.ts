import type { Client } from '@hashgraph/sdk';
import { coreConsensusPlugin, coreConsensusPluginToolNames, type Context } from 'hedera-agent-kit';
import type { AgentKey } from './hooks/types.js';

export interface AuditRecord {
  stage: string;
  agentKey: AgentKey | 'pipeline';
  decision: 'pass' | 'block' | 'pay';
  reason: string;
  costHbar?: number;
  txId?: string;
  timestamp: string;
}

/**
 * Post-execution-logging stage of the lifecycle. Writes one HCS message per policy
 * decision/payment via the Kit's real `submit_topic_message_tool` — HCS topics are
 * append-only by construction, so this is what makes the "immutable audit trail"
 * claim literal rather than aspirational.
 */
export async function submitAuditRecord(client: Client, context: Context, record: AuditRecord): Promise<void> {
  const topicId = process.env.HEDERA_AUDIT_TOPIC_ID;
  if (!topicId) throw new Error('Missing required env var: HEDERA_AUDIT_TOPIC_ID');

  const tools = coreConsensusPlugin.tools(context);
  const submitTool = tools.find((t) => t.method === coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL);
  if (!submitTool) throw new Error('submit_topic_message_tool not found in coreConsensusPlugin');

  await submitTool.execute(client, context, {
    topicId,
    message: JSON.stringify(record),
  });
}
