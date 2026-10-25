/** No account-scoped caches or notifications exist yet. Phase 4 registers its own cleanup. */
export type AccountCleanup = (outgoingUserId: string) => Promise<void> | void;
const handlers = new Set<AccountCleanup>();

export function registerAccountCleanup(handler: AccountCleanup): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

export async function cleanupOutgoingAccount(userId: string | null): Promise<void> {
  if (!userId) return;
  // Only the outgoing account is supplied to handlers; no global notification purge.
  for (const handler of handlers) await handler(userId);
}
