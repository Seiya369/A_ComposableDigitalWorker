import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlankModules } from '../src/domain/seed.js';
import { selectProjectTool } from '../src/ui/CapabilitySelector.js';
import { nativeToolEntitlement } from '../src/domain/capability-catalog.js';

test('a new person can explicitly configure project delegation without expanding its collaboration rules', () => {
  const initial = createBlankModules();
  const selected = selectProjectTool(initial, 'worker_delegate', true);
  assert(selected.capabilities.tools.some(tool => tool.id === 'worker_delegate'));
  assert(selected.permissions.allowedTools.includes('worker_delegate'));
  assert.equal(selected.collaboration.canDelegate, false);
  assert.deepEqual(initial.capabilities.tools, []);
  assert.deepEqual(initial.permissions.allowedTools, []);
  assert.deepEqual(selectProjectTool(selected, 'worker_delegate', false).permissions.allowedTools, []);
});

test('project create-only tools do not authorize native overwrites and unknown tools cannot be granted', () => {
  const selected = selectProjectTool(createBlankModules(), 'worker_write_artifact', true);
  assert.equal(nativeToolEntitlement('write', selected), false);
  assert.equal(nativeToolEntitlement('edit', selected), false);
  assert.throws(() => selectProjectTool(selected, 'bash', true), /不存在/);
});
