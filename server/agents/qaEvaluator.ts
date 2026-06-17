import OpenAI from 'openai';

export interface QaResult {
  coverage: number;
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

function parseCoverage(text: string): number {
  const match = text.match(/(\d{1,3})\s*%/);
  const value = match ? Number(match[1]) : 0;
  return Math.min(100, Math.max(0, value));
}

/** Pre-execution: QA agent reviews the PR and reports a coverage percentage. */
export async function runQaEvaluator(prTitle: string): Promise<QaResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.responses.create({
    model: 'gpt-5.3-codex',
    input:
      `Review the change described as "${prTitle}". Estimate test coverage for the ` +
      'affected code as a single percentage. Respond with the percentage followed by ' +
      'one sentence of justification.',
  });

  const text = res.output_text ?? '';

  return {
    coverage: parseCoverage(text),
    summary: text,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  };
}
