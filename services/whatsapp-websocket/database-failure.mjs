// pg emits these without a SQLSTATE after its dedicated connection has died.
const CLOSED_CLIENT_MESSAGES = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
]);

export function isClosedDatabaseClient(error) {
  return !error?.code && CLOSED_CLIENT_MESSAGES.has(error?.message);
}
