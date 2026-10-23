import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyWhatsAppStartupFailure, resolveChromiumExecutable } from './chromium-executable.js';

test('resolves the system Chromium executable from PATH', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chromium-path-test-'));
  try {
    const executable = path.join(root, 'chromium');
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n');
    await fs.chmod(executable, 0o755);
    assert.equal(resolveChromiumExecutable({ PATH: root }), executable);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('reports a missing system browser explicitly without falling back to the bundled browser', () => {
  assert.throws(
    () => resolveChromiumExecutable({ PATH: '' }),
    error => error.code === 'WA_CHROMIUM_NOT_FOUND'
  );
});

test('startup diagnostics classify browser failures and never return raw error text', () => {
  assert.equal(
    classifyWhatsAppStartupFailure(new Error('libgbm.so.1 missing; private-token-value')),
    'CHROMIUM_MISSING_LIBRARY'
  );
  assert.equal(
    classifyWhatsAppStartupFailure(new Error('arbitrary private-token-value')),
    'WHATSAPP_START_FAILED'
  );
  assert.equal(
    classifyWhatsAppStartupFailure(new Error('Timed out waiting for DevTools endpoint'), 'launching_chromium'),
    'CHROMIUM_LAUNCH_TIMEOUT'
  );
  assert.equal(
    classifyWhatsAppStartupFailure(new Error('The browser is already running for /tmp/private-profile'), 'launching_chromium'),
    'CHROMIUM_PROFILE_LOCKED'
  );
});
