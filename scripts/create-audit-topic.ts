import 'dotenv/config';
import { TopicCreateTransaction } from '@hashgraph/sdk';
import { createHederaClient } from '../server/kit/agentKit.js';

/**
 * One-time setup: creates the HCS topic that server/kit/hcs.ts writes every policy
 * decision/payment to. Run this once per environment (testnet vs mainnet each need
 * their own topic) and put the printed ID in HEDERA_AUDIT_TOPIC_ID.
 *
 * Requires HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY already set (e.g. from
 * https://portal.hedera.com/ for testnet) — this script only creates the topic, it
 * doesn't create the account itself.
 */
async function main(): Promise<void> {
  const client = createHederaClient();

  const tx = await new TopicCreateTransaction().setTopicMemo('hedera-ci-policy-mesh audit log').execute(client);
  const receipt = await tx.getReceipt(client);

  if (!receipt.topicId) throw new Error('Topic creation succeeded but no topicId was returned');

  console.log(`HEDERA_AUDIT_TOPIC_ID=${receipt.topicId.toString()}`);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
