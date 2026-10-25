# DSH 0.2.1-rc.3 与 Desktop 兼容审计 / Compatibility audit

日期：2026-10-26。插件：0.28.0。验收归档、SHA-256 与结果见[版本记录](../../integration/verification-0.28.0.md)。

## 官方版本与边界

核查 npm registry 和 [GitHub 官方发行标签](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3)：最新 GitHub 标签与 npm `next` 是 `0.2.1-rc.3`，npm `latest` 仍是 `0.2.1-rc.2`。本次明确选择 rc.3；它仍是官方预发布版本。标签提交为 `1f81c047fc48fa190a683e469daa699857e9afe8`。以官方 npm 包的公开类型、运行产物及该标签的官方 Desktop 源码核查接口；未修改宿主源码、构建物、内置插件或依赖。

从[官方文档站](https://deepseek-harness.github.io/deepseek-harness/)提供的下载入口取得 macOS arm64 DMG，实际应用和内置命令均为 `0.2.1-rc.3`。`codesign --verify --deep --strict` 通过，`spctl` 确认 Notarized Developer ID。Windows 和其他架构未实机验收。

## 问题、根因与修复

| 问题 | 根因与证据 | 修复和验证 |
| --- | --- | --- |
| 旧包声明只支持 alpha.2，不能直接宣称兼容最新版本 | `engines.dsh`、39 项 peer、启动预检和 SDK 基线锁定旧版 | 迁移到官方 rc.3；公开 UI 插槽、原生会话、Agent、工具、技能与模型目录编译及真实宿主验收通过。保留精确版本限制，不使用版本豁免。 |
| Desktop 可读但写入会被拒绝 | [官方 forwardWebRequest](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/apps/desktop/src/web-document.ts) 移除 Origin，插件原先把缺失 Origin 的 POST 一律拒绝 | 客户端增加显式自定义写请求头。服务端先经过官方 `connection.admit()`，仍校验 Host、提供的 Origin 和 Fetch Metadata；没有 Origin 时必须携带该头。API 不授予 CORS 预检。回归验证保存、401、跨站和 rebinding；真实 Desktop 保存成功。 |
| npm CLI 无法管理 Desktop profile | 新版将 `desktop` 保留给 Electron 及其自带命令 | 安装/移除/清理脚本新增 `--dsh-command`，使用已安装应用公开命令，不读写 app.asar 内部文件。安装、卸载、重装与清理实测通过。 |
| 会话交接测试无法载入 JSONL 插件 | 新官方包由 default export 改为 Cordis 模块的具名导出 | 测试改用公开模块命名空间；实际持久化、句柄释放、原生会话恢复等回归通过。生产插件没有依赖这个已移除的默认导出。 |
| 新版界面语言测试找不到设置按钮 | 设置入口迁入账号菜单 | 测试通过真实账号菜单进入设置；29 项 Web 验收含中英、明暗主题与窄宽窗口通过。 |

官方运行时初次安装曾因禁用 peer 自动安装缺少新版 `dsh-scope` 等服务，不能把这种不完整 SDK 的错误归咎于业务代码。补齐官方声明的 peer 后再进行最终测试；不向宿主添加自制服务。

## 逐步修复与复测

1. 安装独立、未修改的官方 rc.3 运行时和官方签名 Desktop；切换插件开发 SDK。
2. 先复现 Desktop Origin 与旧测试接入问题，再修复插件与测试；保留宿主鉴权和跨站防护。
3. 在官方临时 Web profile、实际 `.tgz` 中验证安装、数据持久化、普通卸载、原生功能、重装、专属清理。
4. 在真实 macOS Desktop `dsh-app://app` 中验证同包安装、默认库、保存、移除入口、重装保留配置和专属清理。
5. 用旧 alpha.2 官方运行时和 0.27.0 实包装入自定义岗位，再使用 rc.3 官方 CLI 升级到 0.28.0；持久状态在包升级期间字节不变，新宿主启动后自定义名称与职责、库对象数量保持，不启动任务。
6. 最终归档生成后重新执行 Web 生命周期、Web 界面、版本升级及 Desktop 验收；记录绑定最终哈希。上传 GitHub 后下载同一包核验，再安装到本地新状态。

结果：698 项自动化测试，697 通过、0 失败、1 项可选私有工作区测试跳过；15 项 Web 生命周期与29 项原生 Web 界面检查通过。Web 离线模型适配器用于可复现业务执行，不代表实际供应商的质量或费用测试；Desktop 实测为安装、界面、保存和生命周期，未在真实供应商上执行业务推理。

## 性能

在 macOS arm64、Node 24.21.0 上使用仓库 `scripts/performance-audit.ts` 合成负载。并行功能测试期间的测量受到资源争用，另在这些测试完成后采样；下表取后者，不与受争用结果混用。

| 负载 | P95 |
| --- | ---: |
| 1,000 员工、8.9 MB 状态快照（30 样本） | 13.23 ms |
| 同状态持久化事务（12 样本） | 85.82 ms |
| 1,000 文档有界知识包（20 样本） | 0.54 ms |
| 5,000 节点 / 10,000 边布局（20 样本） | 8.84 ms |
| 实包鉴权状态 API、72,497 bytes、顺序30请求 | 2.35 ms |
| 同 API 并发8、80请求 | 8.51 ms |

未观察到本次小范围迁移带来的明显回退，但这些数据不是生产容量、真实模型延迟、帧率或长期稳定性保证。全量 JSON 事务仍随历史增长，建议后续以长期运行数据评估分页、日志分层和增量持久化；不要只用扩大超时掩盖增长。

## 未满足项与建议

- rc.3 的公开 `SessionPersistence` 仍只有 create/open/flush/stat/list，没有持久会话删除能力。插件运行能力、专属配置与文件清理通过；员工专属原生会话历史不能通过官方接口全部移除。继续保持 **prerelease / 带保留项候选**，不能宣称完全无保留合规。下一步需上游提供按归属删除 API，增加真实员工执行后的清理验收。
- 官方 npm 验证树 `npm audit --omit=dev` 返回 196 项依赖节点告警（186 high、10 moderate），去重为 6 份独立公告，分布在 `@modelcontextprotocol/client`、`fflate`、`undici`、`zod`；其中 `fflate` 位于官方 LibreOffice 依赖树。节点数量不是独立漏洞数量，也不等于已验证可利用。本插件未新增生产依赖，不替换或强制修复宿主依赖。建议跟踪官方修订版本，再按同样流程复测；不能把功能验收称为安全审计无漏洞。
- 上述公告：[MCP 跨域重定向](https://github.com/advisories/GHSA-6prh-2h8m-c8cw)、[ZIP64 解析](https://github.com/advisories/GHSA-px8p-9vwx-vf98)、[EventSource](https://github.com/advisories/GHSA-4qv8-2p9j-2685)、[SRI](https://github.com/advisories/GHSA-f72v-6w45-q472)、[内容编码](https://github.com/advisories/GHSA-xjj6-f33q-929c)、[Zod 集合验证](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。需按实际使用路径评估影响，不能盲目执行 `audit fix --force`。
- 兼容范围仅含本次实测版本；Windows Desktop、其他架构、其他 DSH 版本与真实供应商长任务是后续验证范围。

## English

Version 0.28.0 targets the official DSH 0.2.1-rc.3 prerelease, the newest GitHub tag and npm `next` as checked on 2026-10-26. npm `latest` remains rc.2. The official signed/notarized macOS arm64 Desktop app uses the same plugin bundle and a separate Electron-owned profile.

The migration fixes origin-less authenticated Desktop writes without bypassing native admission, Host/Origin/Fetch Metadata checks, or browser CORS protections. Lifecycle tooling invokes Desktop's own public command. Test imports and native Settings navigation follow the new public upstream interfaces.

Validation covers 697 passing automated tests (one optional test skipped), 15 real-archive Web lifecycle checks, 29 native Web workflow checks, a real alpha.2/0.27.0 → rc.3/0.28.0 upgrade preserving custom definitions, and real Desktop installation, saving, removal, restoration and plugin-owned cleanup. Host program hashes remain unchanged. Synthetic performance results above do not establish production/model quality or capacity.

Native persistent-session deletion remains unsupported, so the release retains its documented cleanup exception. Upstream dependency audit reports six distinct advisories propagated across 196 nodes; no exploitability assessment or blanket security clearance is claimed. Official host dependencies are not patched. Windows, other architectures and real-provider endurance tests remain unverified.
