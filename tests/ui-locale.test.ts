import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { chineseMessages, createWorkforceI18n, englishMessages, registerWorkforceLocales, translateUiText, workforceLocale, WORKFORCE_LOCALE_NAMESPACE } from '../src/ui/i18n.js';

test('both UI dictionaries have identical nonempty keys and preserve all placeholders', () => {
  assert.deepEqual(Object.keys(chineseMessages).sort(), Object.keys(englishMessages).sort());
  assert.ok(Object.keys(englishMessages).length > 400);
  for (const [key, english] of Object.entries(englishMessages)) {
    assert.ok(english.trim(), key);
    assert.ok(!/\p{Script=Han}/u.test(english), `English UI contains untranslated text: ${key}`);
    const tokens = (value: string) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
    assert.deepEqual(tokens(english), tokens(key), key);
  }
});

test('Chinese UI stays unchanged and English interpolates names without translating user content', () => {
  assert.equal(translateUiText('交给{name}的任务…', 'zh', { name: '团队' }), '交给团队的任务…');
  assert.equal(translateUiText('交给{name}的任务…', 'en', { name: '团队' }), 'Task for 团队…');
  assert.equal(translateUiText('我的工作流：模型配置', 'en'), '我的工作流：模型配置');
  assert.equal(translateUiText('constructor', 'en'), 'constructor');
  assert.equal(translateUiText('自定义错误步骤', 'en'), '自定义错误步骤');
  assert.equal(translateUiText('（模型返回的原始错误）', 'en'), '（模型返回的原始错误）');
  assert.equal(translateUiText('<script>{unknown}</script>', 'en'), '<script>{unknown}</script>');
});

test('server errors created in Chinese translate at render time while preserving embedded identities', () => {
  assert.equal(translateUiText('“我的员工”已更新，请刷新后重新选择工作流', 'en'), '“我的员工” has changed. Refresh and select the workflow again.');
  assert.equal(translateUiText('请求失败 (409)', 'en'), 'Request failed (409)');
  assert.equal(translateUiText('资料必须是有效的 UTF-8 文本：专业资料.txt', 'en'), 'The document must contain valid UTF-8 text: 专业资料.txt');
});

test('the DSH active locale and registered fallback chain are the only language authority', () => {
  const locales = [{ id: 'zh', label: '中文', fallback: 'en' }, { id: 'en', label: 'English' }, { id: 'x-example', label: 'Example', fallback: 'zh' }];
  assert.equal(workforceLocale({ active: 'zh', locales }), 'zh');
  assert.equal(workforceLocale({ active: 'en', locales }), 'en');
  assert.equal(workforceLocale({ active: 'x-example', locales }), 'zh');
  assert.equal(workforceLocale({ active: 'missing', locales }), 'en');
  assert.equal(workforceLocale({ active: 'a', locales: [{ id: 'a', label: 'a', fallback: 'b' }, { id: 'b', label: 'b', fallback: 'a' }] }), 'en');
});

test('official dictionary registration owns and releases both languages without changing any preference', () => {
  const registered: Array<{ namespace: string; locale: string; dictionary: Record<string, string> }> = [];
  const released: string[] = [];
  const runtime = { register(namespace: string, locale: string, dictionary: Record<string, string>) { registered.push({ namespace, locale, dictionary }); return () => { released.push(locale); }; } };
  const dispose = registerWorkforceLocales(runtime as Parameters<typeof registerWorkforceLocales>[0]);
  assert.equal(registered.length, 2);
  assert.ok(registered.every(entry => entry.namespace === WORKFORCE_LOCALE_NAMESPACE));
  assert.deepEqual(registered.map(entry => entry.locale), ['zh', 'en']);
  dispose(); dispose(); assert.deepEqual(released, ['en', 'zh']);
  let cleaned = false;
  assert.throws(() => registerWorkforceLocales({ register(_ns: string, locale: string) { if (locale === 'en') throw new Error('occupied'); return () => { cleaned = true; }; } } as Parameters<typeof registerWorkforceLocales>[0]), /occupied/);
  assert.equal(cleaned, true);
});

test('bound consumers read live host language without stale translation state', () => {
  let active = 'zh';
  const runtime = {
    bind(namespace: string) { assert.equal(namespace, WORKFORCE_LOCALE_NAMESPACE); return (message: string, values?: Record<string, string | number>) => translateUiText(message, active as 'zh' | 'en', values); },
    getSnapshot() { return { active, revision: 0, locales: [{ id: 'zh', label: '中文', fallback: 'en' }, { id: 'en', label: 'English' }] }; },
  };
  const i18n = createWorkforceI18n(runtime as Parameters<typeof createWorkforceI18n>[0]);
  assert.equal(i18n.t('工作流'), '工作流');
  const storedError = new Error('工作流进度已更新，请刷新后重试');
  active = 'en'; assert.equal(i18n.t('工作流'), englishMessages['工作流']);
  assert.equal(i18n.errorMessage(storedError), 'Workflow progress has changed. Refresh and try again.');
  active = 'zh'; assert.equal(i18n.errorMessage(storedError), storedError.message);
});

test('all static UI translation calls have English entries and native DOM attributes contain no hardcoded Chinese', async () => {
  const files = (await readdir(new URL('../src/ui/', import.meta.url))).filter(name => /\.(tsx|ts)$/.test(name));
  const issues: string[] = [];
  for (const name of files) {
    const source = await readFile(new URL(`../src/ui/${name}`, import.meta.url), 'utf8');
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function walk(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (!Object.hasOwn(englishMessages, key)) issues.push(`${name}: missing translation ${key}`);
      }
      if (ts.isJsxText(node) && /\p{Script=Han}/u.test(node.text)) issues.push(`${name}: untranslated JSX ${node.text.trim()}`);
      if (ts.isJsxAttribute(node) && ['aria-label', 'aria-description', 'title', 'placeholder'].includes(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer) && /\p{Script=Han}/u.test(node.initializer.text)) issues.push(`${name}: untranslated attribute ${node.initializer.text}`);
      ts.forEachChild(node, walk);
    }
    walk(ast);
  }
  assert.deepEqual(issues, []);
});
