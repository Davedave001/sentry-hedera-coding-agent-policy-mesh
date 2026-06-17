import Anthropic from '@anthropic-ai/sdk';

export interface Vulnerability {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
}

export interface SecurityResult {
  vulns: Vulnerability[];
  inputTokens: number;
  outputTokens: number;
}

/** Pre-execution: Claude Sonnet 4.6 reviews the change for vulnerabilities. */
export async function runSecurityScanner(prTitle: string): Promise<SecurityResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content:
          `Review the change "${prTitle}" for security vulnerabilities. Respond with a ` +
          'JSON array of objects, each {"severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", ' +
          '"description": string}. If you find nothing, respond with [].',
      },
    ],
  });

  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let vulns: Vulnerability[] = [];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    vulns = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    vulns = [];
  }

  return {
    vulns,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

/**
 * Case B (see IMPLEMENTATION_PLAN.md §2): a second, independent purchase the
 * Security Scanner makes against a real CVE/vulnerability-intelligence feed before
 * issuing clearance — gated by its own SpendCap + AllowlistPolicy entry under
 * `policy.config.json`'s `secondaryPurchases.cveFeed`. We don't ship a hardcoded
 * provider URL here: set `CVE_FEED_URL` to wire in a real x402-speaking feed (or a
 * 402-wrapping proxy in front of a normal CVE API) before this is called from the
 * pipeline.
 */
export async function fetchCveIntel(query: string): Promise<{ findings: unknown }> {
  const url = process.env.CVE_FEED_URL;
  if (!url) {
    throw new Error('CVE_FEED_URL is not configured — Case B purchase has no provider to call yet');
  }
  const res = await fetch(`${url}?q=${encodeURIComponent(query)}`);
  if (res.status === 402) {
    throw new Error('CVE feed returned 402 — payment must be settled via purchaseCall() before retrying');
  }
  return { findings: await res.json() };
}
