import type { DeploySummary } from './kit/hooks/deployHitl.js';

export type PipelineEvent =
  | { type: 'log'; agentKey: string; tagClass: string; tagText: string; msg: string }
  | { type: 'node'; i: number; state: '' | 'run' | 'done' | 'fail' | 'active' }
  | { type: 'conn'; i: number; state: '' | 'live' | 'done' }
  | { type: 'cost'; i: number; text: string }
  | { type: 'packet'; i: number }
  | {
      type: 'metrics';
      spent: Record<string, number>;
      calls: number;
      blocked: number;
      tokensSaved: number;
      runs: number;
    }
  | { type: 'approval'; runId: string; title: string; p: string; summary: DeploySummary }
  | { type: 'status'; status: 'running' | 'passed' | 'failed' };

export type EventSink = (event: PipelineEvent) => void;
