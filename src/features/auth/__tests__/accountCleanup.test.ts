import { registerAccountCleanup, cleanupOutgoingAccount } from '../accountCleanup';

test('cleanup calls only registered handlers with the outgoing account ID', async () => {
  const handler = jest.fn().mockResolvedValue(undefined);
  const unregister = registerAccountCleanup(handler);
  try {
    await cleanupOutgoingAccount('account-a');
    expect(handler).toHaveBeenCalledWith('account-a');
    expect(handler).not.toHaveBeenCalledWith('account-b');
  } finally { unregister(); }
  handler.mockClear();
  await cleanupOutgoingAccount('account-b');
  expect(handler).not.toHaveBeenCalled();
});

test('null outgoing accounts do not trigger cleanup', async () => {
  const handler = jest.fn();
  const unregister = registerAccountCleanup(handler);
  try { await cleanupOutgoingAccount(null); expect(handler).not.toHaveBeenCalled(); }
  finally { unregister(); }
});
