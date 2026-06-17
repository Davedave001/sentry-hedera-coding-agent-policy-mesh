import Anthropic from '@anthropic-ai/sdk';

export interface DeployerResult {
  deployNotes: string;
  inputTokens: number;
  outputTokens: number;
}

/** Pre-execution: Claude Haiku 4.5 drafts deploy notes; the actual push waits on DeployHITL. */
export async function runDeployer(prTitle: string): Promise<DeployerResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Write a one-paragraph production deploy note for the change "${prTitle}".`,
      },
    ],
  });

  const deployNotes = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

  return {
    deployNotes,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}
