import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHederaClient, buildContext, AgentMode } from '../server/kit/agentKit.js';
import { spendCapPolicy } from '../server/kit/hooks/spendCap.js';
import { counterpartyAllowlistPolicy } from '../server/kit/hooks/counterpartyAllowlist.js';
import { purchaseCall } from '../server/kit/x402.js';
import type { AgentKey, PolicyConfig, StageContext } from '../server/kit/hooks/types.js';

/**
 * Exposes the policy mesh itself (not the dashboard) as an MCP server, so a coding
 * agent running inside Claude Code / Cursor / Codex can call check_spend_cap and
 * request_payment directly — getting an allow/block decision and a real HBAR
 * receipt — without a human watching hedera_ci_policy_mesh.html. Reuses the exact
 * hook code from server/kit/hooks, per IMPLEMENTATION_PLAN.md §10.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const cfg: PolicyConfig = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'policy.config.json'), 'utf-8'));

const AGENT_KEYS = Object.keys(cfg.agents) as AgentKey[];

const client = createHederaClient();
const context = buildContext(AgentMode.AUTONOMOUS);

/** In-process session total — same role as PipelineState.spent in server/pipeline.ts, scoped to this MCP server's lifetime. */
let sessionSpentHbar = 0;

const server = new McpServer({ name: 'hedera-policy-mesh', version: '0.1.0' });

server.registerTool(
  'check_spend_cap',
  {
    title: 'Check spend cap',
    description:
      'Evaluate SpendCap + CounterpartyAllowlist for a prospective agent call without paying. ' +
      'Use this before committing to an expensive call to see whether it would be authorized.',
    inputSchema: {
      agentKey: z.enum(AGENT_KEYS as [AgentKey, ...AgentKey[]]),
      callCostHbar: z.number().positive(),
    },
  },
  async ({ agentKey, callCostHbar }) => {
    const stageCtx: StageContext = { agentKey, callCostHbar, sessionSpentHbar, outputs: {} };
    const spendResult = spendCapPolicy(stageCtx, cfg);
    const allowResult = counterpartyAllowlistPolicy(stageCtx, cfg);
    const pass = spendResult.pass && allowResult.pass;
    const reason = !spendResult.pass ? spendResult.reason : allowResult.reason;
    return { content: [{ type: 'text', text: JSON.stringify({ pass, reason }) }] };
  },
);

server.registerTool(
  'request_payment',
  {
    title: 'Request payment',
    description:
      'Evaluate policy and, on pass, actually sign and submit an HBAR payment via the Hedera ' +
      'Agent Kit, writing an HCS audit record either way. This moves real testnet/mainnet HBAR.',
    inputSchema: {
      agentKey: z.enum(AGENT_KEYS as [AgentKey, ...AgentKey[]]),
      callCostHbar: z.number().positive(),
    },
  },
  async ({ agentKey, callCostHbar }) => {
    const stageCtx: StageContext = { agentKey, callCostHbar, sessionSpentHbar, outputs: {} };
    const result = await purchaseCall(client, context, stageCtx, cfg);
    if (result.paid) sessionSpentHbar += result.costHbar;
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'get_audit_trail',
  {
    title: 'Get audit trail',
    description: 'Fetch the most recent HCS audit messages for this pipeline\'s configured topic from the public Hedera mirror node.',
    inputSchema: {
      limit: z.number().int().positive().max(100).default(25),
    },
  },
  async ({ limit }) => {
    const topicId = process.env.HEDERA_AUDIT_TOPIC_ID;
    if (!topicId) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'HEDERA_AUDIT_TOPIC_ID not configured' }) }] };
    }
    const network = process.env.HEDERA_NETWORK ?? 'testnet';
    const mirrorBase =
      network === 'mainnet' ? 'https://mainnet-public.mirrornode.hedera.com' : 'https://testnet.mirrornode.hedera.com';
    const res = await fetch(`${mirrorBase}/api/v1/topics/${topicId}/messages?limit=${limit}&order=desc`);
    const body = (await res.json()) as { messages?: { message: string; consensus_timestamp: string }[] };
    const messages = (body.messages ?? []).map((m) => ({
      consensusTimestamp: m.consensus_timestamp,
      record: JSON.parse(Buffer.from(m.message, 'base64').toString('utf-8')),
    }));
    return { content: [{ type: 'text', text: JSON.stringify(messages) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
