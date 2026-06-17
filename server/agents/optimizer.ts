import OpenAI from 'openai';

export interface OptimizerResult {
  complexityReduction: number;
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

function parsePercent(text: string): number {
  const match = text.match(/(\d{1,3})\s*%/);
  return match ? Math.min(100, Math.max(0, Number(match[1]))) : 0;
}

/** Pre-execution: Optimizer proposes a refactor and estimates its complexity reduction. */
export async function runOptimizer(prTitle: string): Promise<OptimizerResult> {
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  });
  const res = await client.chat.completions.create({
    model: 'deepseek-v4-pro',
    messages: [
      {
        role: 'user',
        content:
          `Propose a refactor for the change "${prTitle}" that reduces cyclomatic ` +
          'complexity. Respond with the projected percentage reduction followed by ' +
          'one sentence describing the refactor.',
      },
    ],
  });

  const text = res.choices[0]?.message?.content ?? '';

  return {
    complexityReduction: parsePercent(text),
    summary: text,
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}
