import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildLlmWiki } from './build-llm-wiki.mjs';
import { checkVersionAlignment } from './check-version-alignment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await checkVersionAlignment(root);
await mkdir(resolve(root, 'lib'), { recursive: true });
await buildLlmWiki(root);
await build({entryPoints: [resolve(root, 'src/harness/host.ts')], outfile: resolve(root, 'lib/index.js'), bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', sourcemap: true});
await build({entryPoints: [resolve(root, 'src/tools/upgrade-software-defaults.ts')], outfile: resolve(root, 'lib/upgrade-software-defaults.js'), bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22'});
const client = await build({
  entryPoints: [resolve(root, 'src/client/index.tsx')], outfile: resolve(root, 'lib/client.js'),
  bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
  loader: { '.css': 'css', '.module.css': 'local-css' }, write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = client.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = client.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
const style = `const sheet=document.createElement('style');sheet.dataset.plugin='composable-workforce';sheet.textContent=${JSON.stringify(css)};document.head.appendChild(sheet);`;
await writeFile(resolve(root, 'lib/client.js'), `window.__ModuleLoader__.load({id:'dsh-plugin-composable-workforce',factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${style}\n${js}\nreturn module.exports;}});\n`);
// Removed UI modules must not survive in the distributable declaration tree.
await rm(resolve(root,'lib/types'),{recursive:true,force:true});
const tsc=spawnSync(resolve(root,'node_modules/.bin/tsc'),['--emitDeclarationOnly'],{cwd:root,stdio:'inherit'});
if(tsc.status!==0)process.exit(tsc.status||1);
console.log('Built independent host and client plugin faces.');
