import { type PolicyHook, type StageContext, type PolicyConfig, pass, block } from './types.js';

/**
 * Parameter-validation hook. Resolves the recipient Hedera account for this stage's
 * payment and rejects anything not on the allowlist, before a transaction is built.
 */
export const counterpartyAllowlistPolicy: PolicyHook = (ctx: StageContext, cfg: PolicyConfig) => {
  const account = cfg.agents[ctx.agentKey]?.account ?? (ctx.outputs.recipientAccount as string | undefined);

  if (!account || !cfg.allowlistedAccounts.includes(account)) {
    return block(`AllowlistPolicy: recipient account "${account}" is not allowlisted`);
  }

  return pass(`AllowlistPolicy: recipient ${account} is allowlisted`);
};
