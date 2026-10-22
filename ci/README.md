# 可复现检查与官方原版宿主

根 `package-lock.json` 覆盖插件开发、真实官方运行 peer 和单测所需的明确开发依赖。普通 `npm ci --ignore-scripts` 可完整还原，不再链接本机源码。Cordis 精确选择 `4.0.5`，与普通官方 `@deepseek-ai/dsh@0.2.1-alpha.2` 安装一致；声明调整必须与本次归档的完整原版验证绑定，旧归档不代替新候选验收。

```sh
npm ci --ignore-scripts
npm run setup
npm run check:scripts
npm run typecheck
npm run typecheck:checks
KNOWLEDGE_CONTEXT_REPORT_DIR="$PWD/artifacts/ci/small-context" KNOWLEDGE_LARGE_REPORT_DIR="$PWD/artifacts/ci/large-context" npm test
npm run build
npm run package:check
```

`setup` 默认只校验项目自己的公开发布依赖：全部版本必须精确匹配，公开类型入口必须存在且位于包内，包不能回落到祖先源码链接。它拒绝符号链接形式的共享 `node_modules`。设置 `DSH_INSTALLATION_MANIFEST` 时校验真正的官方 CLI；设置 `DSH_DEVELOPMENT_MANIFEST` 时校验独立开发 fixture，二者互斥。外部链接只写项目自己的目录，保留归属记录，不能覆盖非自有实体；常规 npm 开发无需外部链接。`--verify-only` 只报告解析结果，不创建链接或归属文件。

`official-host/package.json` 和 lock 是另一份官方 stock 安装的完整冻结声明，用于识别插件自己的开发依赖掩盖缺包的情况。它不加入任何第三方插件、版本 override 或源码补丁。原版程序目录在安装后保持不可修改，profile 全部由生命周期测试临时创建并销毁。macOS 运行 npm 时使用 `pwd -P` 所示的真实目录，避免 `/tmp` 别名影响 lock 路径。

```sh
npm ci --prefix ci/tools --ignore-scripts
export PATH="$PWD/ci/tools/node_modules/.bin:$PATH"
test "$(pnpm --version)" = "10.34.7"
npm audit --prefix ci/tools --json --audit-level=high
cd ci/official-host
npm ci --ignore-scripts
cd ../..
DSH_INSTALLATION_MANIFEST="$PWD/ci/official-host/node_modules/@deepseek-ai/dsh/package.json" node scripts/link-harness.mjs --verify-only
DSH_INSTALLATION_MANIFEST="$PWD/ci/official-host/node_modules/@deepseek-ai/dsh/package.json" WORKFORCE_LIFECYCLE_REPORT_DIR="$PWD/artifacts/ci/lifecycle" npm run test:lifecycle -- artifacts/ci/package/dsh-plugin-composable-workforce-0.4.0.tgz
```

官方 CLI 的插件安装依赖 PATH 中的 pnpm。`ci/tools/package.json` 和独立 lock 仅固定生命周期验证使用的 `pnpm@10.34.7`；普通 `npm ci --prefix ci/tools --ignore-scripts` 还原后，CI 通过 `GITHUB_PATH` 提供可执行文件，并在生命周期测试前依次校验版本、审计独立工具。工具审计保存为 `lifecycle-tools-audit.json`，高危/严重项阻止后续生命周期测试。此工具不加入插件运行依赖、官方宿主声明或交付归档。首次远端运行 `39736166654` 在完整单测、构建和打包通过后因缺少 pnpm 退出 127；首次补齐的 `10.33.0` 随后审计发现高危项，现固定到审计建议的补丁版本并保留此前失败与审计记录，重新执行全部门禁。

归档门两次运行真实 `npm pack`，比较压缩包 SHA-256；拒绝测试、源码、host patch、node_modules、本机数据、凭据形式文件及 source map，逐个比较归档文件与实际保存源文件。压缩包预算为 1 MiB，超出应审查并明确调整，不自动忽略。最终目录含 `.tgz`、`SHA256SUMS` 和 `report.json`。

生命周期会将该归档复制到其临时 profile 旁的短路径，比较复制前后 SHA；原报告仍绑定输入归档，暂存来源保留到清理完成。这样处理官方 pnpm 的长路径限制，保持依赖检查和宿主程序不变。

GitHub Actions 对所有 PR、main push 和手动运行生效，固定官方 action 完整 SHA，Node `22.19.0`、`24.21.0` 两个 Ubuntu 24.04 job 各自执行完整门禁。权限仅 `contents: read`，不读生产模型凭据，不自动发布、合并或部署。缓存仅包管理器缓存，包含插件、官方宿主及 CI 工具三份 lock；证据保存 14 天。测试报告路径与历史验证资料隔离。

安全审计使用 `npm audit --json --audit-level=high`，插件根、官方宿主及独立 CI 工具分别保存完整 JSON；工具审计在官方生命周期前执行。高危/严重项使 gate 失败，不自动运行 `audit fix`。中低危仍出现在报告中；上游依赖不能通过修改已安装宿主来修复。远端 gate 通过与分支保护是否可用是两件事；当前仓库保护配置不由本工作流更改。

这里的自动检查不代替规格要求的浏览器配置往返、独立代码审查与人工语义核验。最终发布记录必须绑定同一候选提交、归档哈希和原版宿主生命周期结果。
