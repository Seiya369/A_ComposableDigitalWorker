/** Explicit maintenance of plugin-owned state; never runs at ordinary startup. */
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { WorkforceStore } from '../domain/store.js';
import { validateState } from '../domain/validation.js';
import { applySoftwareDefaultsUpgrade, planSoftwareDefaultsUpgrade } from '../domain/software-defaults-upgrade.js';

const args = process.argv.slice(2);
const options = new Map<string, string | boolean>();
for (let index = 0; index < args.length; index++) {
  const arg = args[index]!;
  if (arg === '--dry-run' || arg === '--host-stopped') options.set(arg, true);
  else if (arg === '--state' && args[index + 1] && !args[index + 1]!.startsWith('--')) options.set(arg, args[++index]!);
  else throw new Error('用法：node lib/upgrade-software-defaults.js --state /absolute/plugin/state.json --dry-run | --host-stopped');
}
if (typeof options.get('--state') !== 'string') throw new Error('必须明确指定本插件 state.json 路径。');
const file = resolve(options.get('--state') as string); await access(file);
const original = await readFile(file, 'utf8'); const state = JSON.parse(original); validateState(state);
const plan = planSoftwareDefaultsUpgrade(state, new Date().toISOString());
const changed = plan.templateUpdates.length || plan.teamUpdate || plan.workflowUpdate || plan.removeWorkflowIds.length;
console.log(JSON.stringify({ statePath: file, templates: plan.templateUpdates.map(item => item.id), team: plan.teamUpdate?.id,
  workflow: plan.workflowUpdate?.id, removedWorkflows: plan.removeWorkflowIds, skipped: plan.skipped, changed: !!changed }, null, 2));
if (!options.has('--dry-run') && changed) {
  if (!options.has('--host-stopped')) throw new Error('先退出使用该状态的 Desktop / Web 宿主，再传 --host-stopped。可先用 --dry-run 检查更新范围。');
  const backup = `${file}.before-defaults-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(backup, original, { flag: 'wx', mode: 0o600 });
  try {
    await writeFile(`${backup}.owner.json`, JSON.stringify({ schemaVersion: 1, plugin: 'dsh-plugin-composable-workforce', kind: 'software-defaults-backup',
      statePath: file, backupName: basename(backup), sha256: createHash('sha256').update(original).digest('hex') }), { flag: 'wx', mode: 0o600 });
  } catch (error) { await unlink(backup); throw error; }
  console.log(JSON.stringify({ backupCreated: backup }));
  const store = await WorkforceStore.open(file);
  if (store.revision !== state.revision) throw new Error('状态已变化，取消更新；请重新检查。');
  await store.transaction(candidate => applySoftwareDefaultsUpgrade(candidate, plan), { expectedRevision: state.revision });
  console.log(JSON.stringify({ updated: true, backup, revision: store.revision }));
}
