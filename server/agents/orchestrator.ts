import Anthropic from '@anthropic-ai/sdk';

export interface OrchestratorResult {
  plan: string;
  inputTokens: number;
  outputTokens: number;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Pre-execution: the Orchestrator's own call, dispatching the pipeline plan. */
export async function runOrchestrator(prTitle: string): Promise<OrchestratorResult> {
  const res = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content:
          `You are the orchestrator of a CI/CD agent pipeline. A PR titled "${prTitle}" ` +
          'has been submitted. In 2-3 sentences, describe the dispatch plan: QA -> ' +
          'Optimizer -> Context Reducer -> Security -> Deploy.',
      },
    ],
  });

  const plan = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

  return {
    plan,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}
