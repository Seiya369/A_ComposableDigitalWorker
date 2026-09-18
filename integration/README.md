# Harness 插件接入

版本 0.2.0 是独立 npm 插件，包含 Cordis Host 和 Client 两个入口，通过 Harness 的 profile、插槽和服务接口接入。插件与宿主分开构建和分发；运行时仍在 Harness 的宿主进程与页面内执行，并非独立进程或安全沙箱。

## 兼容边界

已验证基线为 DeepSeek Harness **0.1.1-rc.2**，提交 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，加上本目录的 [工作区扩展补丁](harness-workspace-slots.patch)。这两个插槽是本项目添加的通用宿主接口，尚不能视为上游发行版自带的能力。原版 0.1.1-rc.2 需要先应用补丁并完整重建；安装数字员工插件本身不会修改宿主源码。

在目标 Harness 源码目录运行（将补丁路径替换为实际绝对路径）：

```sh
git apply --check /path/to/harness-workspace-slots.patch
git apply /path/to/harness-workspace-slots.patch
pnpm run build
```

然后在插件目录核对宿主的公开构建产物：

```sh
node integration/check-host.mjs /path/to/deepseek-harness/apps/cli/package.json
```

检查器要求已验证版本且公开工作区 Client 产物包含两个插槽。该检查不能代替宿主完整构建和升级回归。未来升级 Harness 时，先在独立环境验证接口和安装生命周期，再更新版本范围；不能只修改版本号跳过核对。

## 从源码仓库恢复

在准备存放两个项目的父目录执行以下命令，要求 Node.js 22.19+ 或 24+ 和 pnpm。两个目录应尚不存在；已有宿主目录时保留其修改，并按上面的兼容边界准备独立检出。

```sh
git clone https://github.com/Seiya369/A_ComposableDigitalWorker.git
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout --detach b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
git apply --check ../A_ComposableDigitalWorker/integration/harness-workspace-slots.patch
git apply ../A_ComposableDigitalWorker/integration/harness-workspace-slots.patch
pnpm install --frozen-lockfile
pnpm run build
cd ../A_ComposableDigitalWorker
npm ci --legacy-peer-deps
npm run setup
node integration/check-host.mjs ../deepseek-harness/apps/cli/package.json
npm run typecheck
npm test
npm run build
npm start
```

插件仓库为私有仓库，需要具有仓库读取权限的 GitHub 账号。`npm ci` 使用已提交的锁文件；`--legacy-peer-deps` 避免安装另一份宿主运行时，随后 `npm run setup` 链接已经构建的宿主依赖。macOS 可将最后的 `npm start` 换为 `npm run service:start`。首次启动会生成本机 profile 和初始员工数据；实际模型凭据仍由 Harness 设置管理。

## 接口分工

| 所有者 | 接口 | 数字员工用途 |
| --- | --- | --- |
| 原生工作区 | `sidebar.workspaces.header.action` | 全局模板库图标 |
| 原生工作区 | `sidebar.workspaces.menu.action` | 项目菜单“配置团队”或“查看团队 / 取消团队”，接收 `workspaceId` 和 `onClose` |
| 原生外壳 | `shell.overlay`、`sidebar.footer.action` | 编辑弹窗与窄栏入口 |
| 原生对话 | `conversation.input.left`、`conversation.input.dock`、`inputTriggers` | 项目配置入口、交付状态和 `@` 员工选择 |
| 原生宿主服务 | Agent、模型、技能、工具、Workspace、WebServer | 实际执行、资源与请求承载 |
| 数字员工插件 | 七模块、模板、项目实例、组织关系、记忆、权限与交付记录 | 自身业务和独立持久化 |

工作区插槽使用已有 `ctx.slots.inject()` / `register()` 生命周期。多个贡献按 `order` 排列，卸载移除本插件贡献，属主重新挂载后可恢复注册。菜单只向真实 Workspace 传递身份；菜单项先关闭原生菜单，再打开该项目的实例配置。插件不导入工作区内部 React 组件、不复制宿主 store，也不禁用原生 `ui-workspace`。

## 安装与卸载

先停止目标 Harness。`DSH_HOME` 必须指向你希望管理的那一套宿主数据目录；未指定时 Harness 使用自己的默认目录。

```sh
# 安装已经构建好的归档。Host peers 由 Harness 提供，避免安装第二份宿主运行时。
dsh plugin --profile web add /absolute/path/dsh-plugin-composable-workforce-0.2.0.tgz --config.auto-install-peers=false --config.strict-peer-dependencies=false --ignore-scripts

# 卸载同一个 profile 中的插件。
dsh plugin --profile web remove dsh-plugin-composable-workforce --config.auto-install-peers=false
```

安装、卸载或升级后重启 Harness，并刷新已打开的页面。当前交付的是可安装、可卸载的插件包，不承诺运行中的 npm 包更换可以无刷新热切换。插槽内部的注册与销毁仍受 Cordis 生命周期管理。

本项目的本地演示 profile 在 `.local/harness/profiles/web`。相应快捷命令使用同一目录，不会误操作默认 `~/.dsh`：

```sh
npm run service:stop
npm run plugin:uninstall
npm run service:start

# 重新安装（可在 -- 后传另一个安装包的绝对路径）。
npm run service:stop
npm run plugin:install
npm run service:start
```

启动脚本只在 profile 第一次创建时初始化，之后保留 profile、其他插件和安装/卸载状态。已有 profile 中针对 `composable-workforce` 的配置可以保留，以便重装恢复；宿主在插件缺席时会跳过该配置并输出一条未匹配提示。希望去掉该提示时，可备份并移除这个配置项；不要删除员工数据文件。

## 数据保留和升级

员工数据不放在 npm 包或 `node_modules` 中。显式配置 `statePath` 时使用该路径；本地演示继续使用 `.local/workforce.json`。0.2.0 的默认路径为 `$DSH_HOME/composable-workforce/state.json`，未设置 `DSH_HOME` 时为 `~/.dsh/composable-workforce/state.json`。多个 profile 若需要独立数据，应分别配置 `statePath`。

从 0.1.0 升级时：原有显式 `statePath` 无需改动；若以前只设置了非默认 `DSH_HOME`、没有设置 `statePath`，旧版本仍把数据存在 `~/.dsh/composable-workforce/state.json`，应把 `statePath` 指回原文件或备份后迁移到新默认路径。不要让新旧两个服务同时写同一数据文件。

卸载不会删除模板、项目实例、权限、记忆或交付记录，也不删除项目文件夹。重新安装并使用相同 `statePath` 可以恢复原实例。升级前备份该文件；未完成的工作按已有恢复规则保留为失败记录，不自动重复执行可能产生副作用的操作。

## 验证

`npm run test:lifecycle` 使用真实 `.tgz` 和 `dsh plugin add/remove`，在临时 `DSH_HOME` 内验证安装、项目实例与记忆写入、卸载、纯宿主启动、重装及数据逐字节一致。不会向模型发送请求；退出后清理临时环境。`WORKFORCE_LIFECYCLE_UI=1 npm run test:lifecycle` 会在三个阶段停留，便于通过真实浏览器验收，终端输入 `next` 继续。

宿主扩展的组装测试覆盖多插件排序、正确工作区身份、菜单关闭、卸载清理及属主重挂载。验收结果见 [本次验证记录](verification.md)。
