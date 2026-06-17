import { Client, PrivateKey } from '@hashgraph/sdk';
import { AgentMode, type Context } from 'hedera-agent-kit';

/**
 * NOTE ON VERSIONING: the published `hedera-agent-kit` package (v3.8.x on npm, as
 * installed here) does not yet expose a literally-named "Hooks & Policies" API or an
 * x402 plugin — those are newer/announced capabilities ahead of what's released.
 * What it *does* expose, and what we build on instead: `Plugin`/`Tool` primitives,
 * a `Context` with `AgentMode.AUTONOMOUS | RETURN_BYTES`, and core plugins
 * (`coreAccountPlugin` for HBAR transfers, `coreConsensusPlugin` for HCS). Our six
 * policies (server/kit/hooks/*) wrap those tool calls with the same pre-execution /
 * parameter-validation / transaction-review / post-execution-logging lifecycle the
 * Hooks & Policies system describes — see server/kit/x402.ts for where they compose.
 * `RETURN_BYTES` mode is the real mechanism behind DeployHITL: it returns unsigned
 * transaction bytes instead of auto-executing, which is what "surfacing unsigned tx
 * bytes for human review" actually means at the SDK level.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function createHederaClient(): Client {
  const network = process.env.HEDERA_NETWORK ?? 'testnet';
  const operatorId = requireEnv('HEDERA_OPERATOR_ID');
  const operatorKey = PrivateKey.fromString(requireEnv('HEDERA_OPERATOR_KEY'));

  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(operatorId, operatorKey);
  return client;
}

export function buildContext(mode: AgentMode = AgentMode.AUTONOMOUS): Context {
  return {
    accountId: process.env.HEDERA_OPERATOR_ID,
    mode,
  };
}

export { AgentMode };
