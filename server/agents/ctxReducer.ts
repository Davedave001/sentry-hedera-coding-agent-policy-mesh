import OpenAI from 'openai';

export interface CtxReducerResult {
  tokensSavedPct: number;
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
});

function parsePercent(text: string): number {
  const match = text.match(/(\d{1,3})\s*%/);
  return match ? Math.min(100, Math.max(0, Number(match[1]))) : 0;
}

/** Pre-execution: Context Reducer strips dead context and projects token savings. */
export async function runCtxReducer(prTitle: string): Promise<CtxReducerResult> {
  const res = await client.chat.completions.create({
    model: 'deepseek-v4-flash',
    messages: [
      {
        role: 'user',
        content:
          `For the change "${prTitle}", identify context that downstream agent calls ` +
          'no longer need. Respond with the projected token-savings percentage ' +
          'followed by one sentence of justification.',
      },
    ],
  });

  const text = res.choices[0]?.message?.content ?? '';

  return {
    tokensSavedPct: parsePercent(text),
    summary: text,
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}
