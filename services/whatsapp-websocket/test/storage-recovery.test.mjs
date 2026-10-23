import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HostedReader } from '../host.mjs';
import { PostgresStore } from '../store.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeResource(start) {
  const reader = new EventEmitter();
  let snapshot = { state: 'stopped', groups: [], processed: 0 };
  let active = false;
  reader.snapshot = () => structuredClone(snapshot);
  reader.start = async () => {
    if (active) return;
    active = true;
    await start(state => {
      snapshot = { ...snapshot, state };
      reader.emit('status', reader.snapshot());
    });
  };
  reader.stop = async () => {
    active = false;
    snapshot = { ...snapshot, state: 'stopped' };
    reader.emit('status', reader.snapshot());
  };
  return { reader, shutdown: () => reader.stop() };
}

test('transient PostgreSQL outage is retried with one reader and recovers without owner action', async () => {
  let factories = 0;
  const host = new HostedReader(async () => {
    factories++;
    return fakeResource(async report => report(factories === 1 ? 'database_unavailable' : 'reading'));
  }, { retryDelays: [10, 20] });

  await host.start();
  assert.equal(host.snapshot().state, 'database_unavailable');
  assert.equal(host.snapshot().recoveryAttempt, 1);
  assert.ok(host.snapshot().recoveryScheduledAt);
  assert.ok(host.snapshot().retryAt);
  await delay(60);
  assert.equal(factories, 2);
  assert.equal(host.snapshot().state, 'reading');
  assert.ok(host.snapshot().recoveryLastAttemptAt);
  await host.stop();
});

test('voluntary stop cancels pending retries and repeated starts do not create duplicate readers', async () => {
  let factories = 0;
  const host = new HostedReader(async () => {
    factories++;
    return fakeResource(async report => report('database_unavailable'));
  }, { retryDelays: [40] });

  await Promise.all([host.start(), host.start()]);
  assert.equal(factories, 1);
  await host.stop();
  await delay(80);
  assert.equal(factories, 1);
  assert.equal(host.snapshot().state, 'stopped');
});

test('only transient connection errors are converted to retryable storage failures', async () => {
  const key = Buffer.alloc(32).toString('base64');
  const transient = new PostgresStore({
    async query() { throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }); },
  }, key);
  await assert.rejects(transient.acquire(), error => error.message === 'database_unavailable');

  const permanent = new PostgresStore({
    async query() { throw Object.assign(new Error('authentication failed'), { code: '28P01' }); },
  }, key);
  await assert.rejects(permanent.acquire(), error => error.code === '28P01');
});

test('invalid key, unreadable auth and revoked sessions do not enter the retry loop', async () => {
  for (const code of ['invalid_encryption_key', 'encrypted_state_unreadable']) {
    let factories = 0;
    const host = new HostedReader(async () => {
      factories++;
      throw new Error(code);
    }, { retryDelays: [5] });
    await host.start();
    await delay(20);
    assert.equal(factories, 1);
    assert.equal(host.snapshot().state, 'startup_failed');
    assert.equal(host.snapshot().startupCode, code);
    await host.stop();
  }

  let factories = 0;
  const revoked = new HostedReader(async () => {
    factories++;
    return fakeResource(async report => report('relink_required'));
  }, { retryDelays: [5] });
  await revoked.start();
  await delay(20);
  assert.equal(factories, 1);
  assert.equal(revoked.snapshot().state, 'relink_required');
  await revoked.stop();
});

test('deployment lock contention recovers automatically without overlapping readers', async () => {
 let factories=0; let running=0; let shutdowns=0;
 const host=new HostedReader(async()=>{factories++;const resource=fakeResource(async report=>{if(factories<3)throw new Error('reader_already_running'); running++;assert.equal(running,1);report('reading');});const close=resource.shutdown;resource.shutdown=async()=>{shutdowns++;await close();};return resource;},{retryDelays:[10]});
 try{await host.start();assert.equal(host.snapshot().startupCode,'reader_already_running');assert.ok(host.snapshot().retryAt);for(let i=0;i<50&&host.snapshot().state!=='reading';i++)await delay(10);assert.equal(host.snapshot().state,'reading');assert.equal(factories,3);assert.equal(shutdowns,2);}finally{await host.shutdown();}
});
test('owner stop cancels lock-contention retry',async()=>{let attempts=0;const host=new HostedReader(async()=>{attempts++;throw new Error('reader_already_running');},{retryDelays:[20]});await host.start();await host.stop();await delay(50);assert.equal(attempts,1);assert.equal(host.snapshot().state,'stopped');await host.shutdown();});
