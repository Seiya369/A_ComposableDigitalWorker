import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmployeeConversationBlocks } from '../src/client/employee-conversation-blocks.js';

type Block = { reason: string };
function fixture(active: () => boolean = () => true) {
  const stores = new Map<string, { value: Block | undefined; listeners: Set<() => void> }>();
  const entry = (id: string) => { let value = stores.get(id); if (!value) { value = { value: undefined, listeners: new Set() }; stores.set(id, value); } return value; };
  const port = {
    set(id: string, value: Block | undefined) { const target = entry(id); target.value = value; for (const listener of [...target.listeners]) listener(); },
    storeFor(id: string) { const target = entry(id); return { getSnapshot: () => target.value, subscribe(listener: () => void) { target.listeners.add(listener); return () => { target.listeners.delete(listener); }; } }; },
  };
  const guard = createEmployeeConversationBlocks(port, () => '员工工作单执行或交接中，请稍候…', active);
  return { guard, port, read: (id: string) => entry(id).value, stores };
}

test('an employee delivery is blocked synchronously before navigation without locking its source Chat', () => {
  const f = fixture();
  f.guard.hold('delivery');
  const navigate = () => { assert.match(f.read('delivery')?.reason ?? '', /交接中/); assert.equal(f.read('source-chat'), undefined); };
  navigate();
  f.guard.observe('delivery', true); assert.ok(f.read('delivery'));
  f.guard.observe('delivery', undefined); assert.ok(f.read('delivery'), 'an unknown or failed handoff cannot unlock the old worker');
  f.guard.observe('delivery', false); assert.equal(f.read('delivery'), undefined);
  f.guard.dispose();
});

test('existing standalone work-order history is seeded without binding unrelated sessions or workflow children', () => {
  const f = fixture();
  f.guard.seed([
    { sessionId: 'completed-delivery', status: 'awaiting-review' },
    { sessionId: 'active-delivery', status: 'running' },
    { sessionId: 'child', parentRunId: 'parent', status: 'succeeded' },
    { sessionId: 'workflow', workflow: {} as never, status: 'succeeded' },
    { sessionId: 'task', workTaskId: 'task-id', status: 'failed' },
  ]);
  assert.ok(f.read('completed-delivery')); assert.ok(f.read('active-delivery'));
  for (const id of ['child', 'workflow', 'task', 'ordinary-chat']) assert.equal(f.read(id), undefined);
  f.guard.observe('completed-delivery', false); assert.equal(f.read('completed-delivery'), undefined, 'a historical native session is released once Host reports no employee owner');
  f.guard.dispose();
});

test('employee handoff never overwrites or clears another plugin composer block', () => {
  const f = fixture(), other = { reason: '另一个插件正在操作' };
  f.port.set('delivery', other); f.guard.hold('delivery'); assert.equal(f.read('delivery'), other);
  f.port.set('delivery', undefined); assert.match(f.read('delivery')?.reason ?? '', /交接中/, 'our pending handoff remains blocked when another owner clears its reason');
  f.port.set('delivery', other); f.guard.observe('delivery', false); assert.equal(f.read('delivery'), other);
  f.guard.hold('another-delivery'); f.guard.dispose();
  assert.equal(f.read('another-delivery'), undefined); assert.equal(f.read('delivery'), other);
  f.port.set('delivery', undefined); assert.equal(f.read('delivery'), undefined, 'disposed subscriptions cannot reinstate a block');
  f.guard.hold('ignored'); f.guard.observe('ignored', true); assert.equal(f.read('ignored'), undefined);
});

test('unloading during asynchronous history restore cannot reinstall composer blocks', async () => {
  const f = fixture(); let resolve!: (runs: Array<{ sessionId: string; status: 'succeeded' }>) => void;
  const snapshot = new Promise<Array<{ sessionId: string; status: 'succeeded' }>>(done => { resolve = done; });
  const restoring = f.guard.restore(() => snapshot);
  f.guard.dispose(); resolve([{ sessionId: 'historical-delivery', status: 'succeeded' }]);
  assert.equal(await restoring, false); assert.equal(f.read('historical-delivery'), undefined);
  const g = fixture(); let reject!: (error: Error) => void;
  const failed = g.guard.restore(() => new Promise((_, fail) => { reject = fail; }));
  g.guard.dispose(); reject(new Error('snapshot request cancelled'));
  assert.equal(await failed, false);
});

test('a disposed Cordis fiber cannot seed history even before its delayed effect cleanup runs', async () => {
  let active = true; const f = fixture(() => active);
  let resolve!: (runs: Array<{ sessionId: string; status: 'succeeded' }>) => void;
  const pending = f.guard.restore(() => new Promise(done => { resolve = done; }));
  active = false; resolve([{ sessionId: 'historical-delivery', status: 'succeeded' }]);
  assert.equal(await pending, false); assert.equal(f.read('historical-delivery'), undefined);
  f.guard.hold('late'); f.guard.observe('late', true); assert.equal(f.read('late'), undefined);
  f.guard.dispose();
});
