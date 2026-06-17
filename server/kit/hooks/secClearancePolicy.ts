import { type PolicyHook, type StageContext, type PolicyConfig, pass, block } from './types.js';

interface Vulnerability {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
}

/**
 * Parameter-validation hook, Stage 3. A CRITICAL vulnerability is a hard block on the
 * Deployer's payment — the clearance token the Deployer needs to proceed is the
 * direct output of this hook passing.
 */
export const secClearancePolicy: PolicyHook = (ctx: StageContext, _cfg: PolicyConfig) => {
  const vulns = (ctx.outputs.vulns ?? []) as Vulnerability[];
  const critical = vulns.find((v) => v.severity === 'CRITICAL');

  if (critical) {
    return block(`SecClearancePolicy: CRITICAL vulnerability detected — ${critical.description}. Deploy spend blocked.`);
  }

  return pass('SecClearancePolicy: no CRITICAL vulnerabilities — clearance issued');
};
