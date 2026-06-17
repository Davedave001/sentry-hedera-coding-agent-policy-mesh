import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spendCapPolicy } from './spendCap.js';
import { counterpartyAllowlistPolicy } from './counterpartyAllowlist.js';
import { qaCoverageGate } from './qaCoverageGate.js';
import { optRoiPolicy } from './optRoiPolicy.js';
import { ctxSavingsPolicy } from './ctxSavingsPolicy.js';
import { secClearancePolicy } from './secClearancePolicy.js';
import type { PolicyConfig, StageContext } from './types.js';

const cfg: PolicyConfig = JSON.parse(readFileSync(new URL('../../../policy.config.json', import.meta.url), 'utf-8'));

function ctx(overrides: Partial<StageContext>): StageContext {
  return {
    agentKey: 'qa',
    callCostHbar: 1,
    sessionSpentHbar: 0,
    outputs: {},
    ...overrides,
  };
}

describe('spendCapPolicy', () => {
  it('passes when call cost is within the per-agent cap', () => {
    const result = spendCapPolicy(ctx({ agentKey: 'qa', callCostHbar: 2.99 }), cfg);
    expect(result.pass).toBe(true);
  });

  it('blocks when call cost exceeds the per-agent cap (qa cap is 3 hbar)', () => {
    const result = spendCapPolicy(ctx({ agentKey: 'qa', callCostHbar: 3.01 }), cfg);
    expect(result.pass).toBe(false);
    expect(result.blockSpend).toBe(true);
  });

  it('blocks when cumulative session spend would exceed the pipeline cap', () => {
    const result = spendCapPolicy(ctx({ agentKey: 'ctx', callCostHbar: 0.5, sessionSpentHbar: 49.6 }), cfg);
    expect(result.pass).toBe(false);
  });
});

describe('counterpartyAllowlistPolicy', () => {
  it('passes for an allowlisted agent account', () => {
    const result = counterpartyAllowlistPolicy(ctx({ agentKey: 'dep' }), cfg);
    expect(result.pass).toBe(true);
  });

  it('blocks an unknown recipient account', () => {
    const result = counterpartyAllowlistPolicy(
      ctx({ agentKey: 'qa', outputs: { recipientAccount: '0.0.9999999' } }),
      { ...cfg, agents: { ...cfg.agents, qa: { ...cfg.agents.qa, account: '0.0.9999999' } } },
    );
    expect(result.pass).toBe(false);
  });
});

describe('qaCoverageGate', () => {
  it('blocks below threshold (80%)', () => {
    expect(qaCoverageGate(ctx({ outputs: { coverage: 79 } }), cfg).pass).toBe(false);
  });
  it('passes at or above threshold', () => {
    expect(qaCoverageGate(ctx({ outputs: { coverage: 80 } }), cfg).pass).toBe(true);
  });
});

describe('optRoiPolicy', () => {
  it('blocks below 15% complexity reduction', () => {
    expect(optRoiPolicy(ctx({ outputs: { complexityReduction: 14 } }), cfg).pass).toBe(false);
  });
  it('passes at 15% or above', () => {
    expect(optRoiPolicy(ctx({ outputs: { complexityReduction: 15 } }), cfg).pass).toBe(true);
  });
});

describe('ctxSavingsPolicy', () => {
  it('blocks below 20% token savings', () => {
    expect(ctxSavingsPolicy(ctx({ outputs: { tokensSavedPct: 19 } }), cfg).pass).toBe(false);
  });
  it('passes at 20% or above', () => {
    expect(ctxSavingsPolicy(ctx({ outputs: { tokensSavedPct: 20 } }), cfg).pass).toBe(true);
  });
});

describe('secClearancePolicy', () => {
  it('blocks on a CRITICAL vulnerability', () => {
    const result = secClearancePolicy(
      ctx({ outputs: { vulns: [{ severity: 'CRITICAL', description: 'SQL injection in auth handler' }] } }),
      cfg,
    );
    expect(result.pass).toBe(false);
  });

  it('passes when only lower-severity vulns are present', () => {
    const result = secClearancePolicy(
      ctx({ outputs: { vulns: [{ severity: 'MEDIUM', description: 'outdated dependency' }] } }),
      cfg,
    );
    expect(result.pass).toBe(true);
  });

  it('passes with no vulns', () => {
    expect(secClearancePolicy(ctx({ outputs: { vulns: [] } }), cfg).pass).toBe(true);
  });
});
