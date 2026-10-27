import test from 'node:test';
import assert from 'node:assert/strict';
import { isClosedDatabaseClient } from '../database-failure.mjs';

test('closed pg client errors without SQLSTATE are recoverable connection failures', () => {
  for (const message of ['Connection terminated unexpectedly','Connection terminated','Client has encountered a connection error and is not queryable','Client was closed and is not queryable']) {
    assert.equal(isClosedDatabaseClient(new Error(message)),true);
  }
});
test('authentication, permission, corrupt data and arbitrary errors never become connection failures', () => {
  for (const error of [new Error('authentication failed'),new Error('encrypted_state_unreadable'),new Error('query error'),{code:'28P01',message:'Connection terminated'},null]) {
    assert.equal(isClosedDatabaseClient(error),false);
  }
});
