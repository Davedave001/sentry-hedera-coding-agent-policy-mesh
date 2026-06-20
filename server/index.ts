import 'dotenv/config';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createHederaClient, buildContext, AgentMode } from './kit/agentKit.js';
import { runPipeline, createPipelineState } from './pipeline.js';
import type { EventSink, PipelineEvent } from './events.js';
import type { PolicyConfig } from './kit/hooks/types.js';
import type { DeploySummary } from './kit/hooks/deployHitl.js';

// Resolved from cwd, not __dirname: __dirname differs by one directory level
// between `tsx server/index.ts` (dev) and `node dist/server/index.js` (Docker CMD),
// since tsc's outDir mirrors the source tree under dist/. Both entrypoints are
// expected to be launched from the project root.
const PROJECT_ROOT = process.cwd();
const PORT = Number(process.env.PORT ?? 8787);
/** Origin of the standalone frontend container in the split deployment (see Dockerfile.frontend). */
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'https://sentry-coding-policy-agent.agentikiq.com';

const cfg: PolicyConfig = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'policy.config.json'), 'utf-8'));
const client = createHederaClient();
const state = createPipelineState();

let running = false;
const pendingApprovals = new Map<string, (approved: boolean) => void>();

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    // This API container doesn't serve the dashboard — that's Dockerfile.frontend's
    // job. A previous version tried to read hedera_ci_policy_mesh.html here for
    // dev/monolith convenience, but that file isn't copied into this image, so any
    // request to '/' (a bot, an uptime check, a misconfigured link) threw ENOENT
    // inside this async handler — Node treats a synchronous throw in an async
    // listener as an unhandled rejection and kills the whole process, taking down
    // every in-flight request, not just the offending one. Keep this route to a
    // plain JSON response with no filesystem access.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', running }));
    return;
  }

  if (req.method === 'POST' && req.url === '/run') {
    if (running) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'a pipeline run is already in progress' }));
      return;
    }

    const body = await readJsonBody<{ prTitle?: string }>(req);
    const prTitle = body.prTitle?.trim();
    if (!prTitle) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'prTitle is required' }));
      return;
    }

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true }));

    running = true;
    broadcast({ type: 'status', status: 'running' });
    runPipeline(prTitle, {
      client,
      context: buildContext(AgentMode.AUTONOMOUS),
      cfg,
      state,
      emit: broadcast,
      requestApproval: (summary) => requestApprovalOverWs(summary),
    })
      .then((success) => broadcast({ type: 'status', status: success ? 'passed' : 'failed' }))
      .catch((err) => {
        console.error('Pipeline run failed:', err);
        broadcast({ type: 'status', status: 'failed' });
      })
      .finally(() => {
        running = false;
      });
    return;
  }

  if (req.method === 'POST' && req.url === '/approve') {
    const body = await readJsonBody<{ runId?: string; approved?: boolean }>(req);
    const resolver = body.runId ? pendingApprovals.get(body.runId) : undefined;
    if (!resolver) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no pending approval for that runId' }));
      return;
    }
    pendingApprovals.delete(body.runId!);
    resolver(Boolean(body.approved));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end();
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    // Any route handler throwing (sync or async) lands here instead of becoming an
    // unhandled rejection that kills the whole process — see the comment above for
    // exactly that failure mode.
    console.error('Unhandled request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal server error' }));
    } else {
      res.end();
    }
  });
});

const wss = new WebSocketServer({ server });
const sockets = new Set<WebSocket>();

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
});

const broadcast: EventSink = (event: PipelineEvent) => {
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
};

function requestApprovalOverWs(summary: DeploySummary): Promise<boolean> {
  const runId = randomUUID();
  return new Promise((resolve) => {
    pendingApprovals.set(runId, resolve);
    broadcast({
      type: 'approval',
      runId,
      title: '🚀 Deploy approval — Stage 3 HITL',
      p: 'All CI gates passed. Review pipeline summary and approve to push to production.',
      summary,
    });
  });
}

function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`Policy mesh server listening on http://localhost:${PORT}`);
});
