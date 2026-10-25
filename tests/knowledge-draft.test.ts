import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlankModules } from '../src/domain/seed.js';
import { mergeKnowledgeSourceRemoval } from '../src/ui/knowledge-draft.js';

test('persisted material removal keeps unsaved role edits and newly added source declarations', () => {
  const previous = createBlankModules();
  previous.knowledge.sources = [{ id: 'old', title: 'Old', kind: 'text', value: 'Old source' }, { id: 'keep', title: 'Keep', kind: 'text', value: 'Kept' }];
  const saved = structuredClone(previous); saved.knowledge.sources.splice(0, 1);
  const draft = structuredClone(previous);
  draft.responsibilities.mission = 'Unsaved mission';
  draft.knowledge.projectMemory = false;
  draft.knowledge.sources.push({ id: 'new', title: 'New', kind: 'text', value: 'Unsaved new source' });
  const merged = mergeKnowledgeSourceRemoval(draft, previous, saved);
  assert.deepEqual(merged.knowledge.sources.map(source => source.id), ['keep', 'new']);
  assert.equal(merged.responsibilities.mission, 'Unsaved mission');
  assert.equal(merged.knowledge.projectMemory, false);
  assert.equal(draft.knowledge.sources.length, 3);
  assert.equal(previous.knowledge.sources.length, 2);
});
