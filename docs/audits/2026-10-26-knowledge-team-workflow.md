# 0.29.0 知识、组织与工作流验收 / Knowledge, organization and workflow

日期：2026-10-26。官方宿主：DSH 0.2.1-rc.3；Web 与签名 macOS arm64 Desktop 共用同一插件归档。归档和哈希见[版本验收记录](../../integration/verification-0.29.0.md)。

## 最终团队与职责

- 产品负责人：第1级，统筹范围、优先级、跨专业取舍、用户验收和发布决定。
- 技术负责人/架构师、UX/UI设计师、测试负责人、运维负责人：第2级，分别直属产品负责人，独立对技术、体验、质量和运行交付负责。
- 仅开发人员为第3级，向技术负责人/架构师汇报，负责实现、缺陷修复和开发验证。

汇报关系不授予工具权限，也不允许任何负责人把失败验证改写为通过；原生 DSH 权限、沙箱和审批继续生效。

## 软件工程主流程

移除新安装中的独立“缺陷修复”流程。新功能与缺陷修复进入同一闭环；11步保留原有10个步骤ID，新增 `deployment`。

| 步骤 | 负责人 | 交接重点 |
| --- | --- | --- |
| 1 需求澄清与验收基线 | 产品负责人 | 范围、非目标、可验证标准、缺陷影响与风险 |
| 2 交互与体验设计 | UX/UI设计师 | 正常/失败状态、适配、可访问性；无界面时给出不适用理由 |
| 3 技术方案与根因分析 | 技术负责人/架构师 | 真实现状、契约、恢复、工作包；缺陷需验证根因 |
| 4 测试计划与回归基线 | 测试负责人 | 风险矩阵、测试条件、性能负载与回归基线 |
| 5 增量实现与缺陷修复 | 开发人员 | 最小实现或修复、有意义回归、真实检查记录 |
| 6 独立代码与契约审查 | 技术负责人/架构师 | 绑定具体实现的审查结论与返工要求 |
| 7 独立功能、性能与体验复测 | 测试负责人 | 实际验证与同条件性能比较，保留失败和未验证项 |
| 8 候选版本与运行就绪 | 运维负责人 | 实际制品、校验和、兼容与生命周期演练；此阶段不对外发布 |
| 9 用户验收与发布决定 | 产品负责人 | 对照交付及证据记录用户决定，不自动扩大权限 |
| 10 授权发布与运行核验 | 运维负责人 | 当前授权范围内执行、核验运行并保留恢复证据 |
| 11 工程复盘与知识交接 | 技术负责人/架构师 | 汇总各专业意见、根因、改进及候选知识，由产品统筹后续 |

每步均有输入、产物、验收条件和返工目标。设计/技术/测试计划/候选制品的问题可在本阶段修正；审查、复测或验收发现的实现缺陷返回实现；运行发布失败返回运行就绪。范围改变时显式重新确认基线。

部署不属于任务范围时记录不适用依据并交接制品；属于范围但未获授权时保持待办，不声称完成。有明确现行授权可沿用，不要求无意义的重复确认。

## 问题根因与修复

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 四个分类卡片超出图谱右边缘 | 四列都设了208px固定最小宽度，窄容器必须横向溢出 | 同行四等分 `minmax(0,1fr)`，取消横向撑宽，按容器宽度压缩辅助文案；保留开关语义和键盘操作 |
| 初始专业知识图谱为空 | 启动只归档A，通用B/C等待整理事件，岗位专业方法没有首发图谱 | 随包提供有明确概念和关系的专业参考定义；精确匹配后本地生成B/C并持久保存，不调用模型，不捏造项目事实 |
| 组织图裁切、需要横向滚动 | 原图使用固定画布，没有按窗口计算完整边界和缩放 | 计算完整子树布局，按容器最大比例适配；滚轮以指针为中心缩放，支持拖动、按钮、键盘及适配重置 |
| 返工线和文字堆叠 | 多条返工边共用同一行和外侧通道 | 响应式顺序图，每条返工边使用独立轨道；标签避开顺序线和返工端口，卡片显示负责人和返工目标 |
| 更新可能覆盖使用者配置 | 库定义与已采用实例有独立身份及历史 | 显式更新工具匹配旧原始默认，先备份再单次版本校验事务；只同步未执行且未定制的采用实例，保留员工ID、模块、记忆、会话选择和项目 |
| 新备份可能在完整卸载后残留 | 旧清理器只识别主状态和知识目录 | 备份附归属、状态路径与哈希标记；完整清理验证后移除备份及标记，保留未知/用户备份并保护其他profile引用 |

初始图谱的原文、概念、关系和引用都在插件包中。6个岗位及团队共享库各有9个概念、10条明确关系；它们是专业参考，不能冒充已执行任务、用户项目事实或已确认记忆。新增用户资料仍走正常增量整理，已发布B/C不被初始种子覆盖。

补充回归覆盖两个边界：合法的大型自定义A资料不能因B单项上限导致插件启动失败；多个实例竞争初始发布时保留CAS防覆盖，正常跳过过期发布，不使插件激活失败。

## 验收证据与限制

- 全量723项：722通过、0失败、1项可选私有工作区测试跳过；类型检查与构建通过。
- 最终实包：15项官方Web生命周期检查、29项原生对话工作流检查、8项本次界面/图谱检查通过。
- 实测1512/1024/768宽度的四卡等宽与左右对齐；四位二级负责人、唯一三级开发人员；完整组织图和滚轮/适配；11步负责人、返工及部署阶段顺序。
- 7个专业图谱经真实官方宿主读取，重启后身份、版本、来源版本及360个权威知识/阅读文件哈希不变。可重建的投影缓存单独处理，不把缓存改写误报为知识丢失。
- 真实旧官方alpha.2/插件0.27.0升级到rc.3/0.29.0保留定制岗位；归档内显式更新工具、专业图谱生成及带归属备份的完整清理通过。实际Desktop状态副本也验证保留原6员工及项目数据。
- macOS Desktop实机确认四卡与知识图谱、正确层级、滚轮92%→154%及适配回92%、11步负责人；官方自带命令可清理生成知识，程序哈希不变。
- 官方Web全部27,607个程序文件前后哈希相同；签名Desktop全部6,437个程序文件前后哈希相同。没有修改宿主源码、构建物或内置依赖。

测试业务执行使用离线适配器，没有把模拟结果冒充真实供应商质量或实际生产部署。Windows、其他架构和生产性能容量未验收。官方仍无原生持久会话删除API，因此延续已有的会话清理保留项，版本保持预发布候选；详见[上一版本兼容审计](2026-10-26-dsh-desktop.md)。

## English

The final hierarchy has the product owner at level1; architecture, design, QA and operations leads at level2 reporting directly to product; only the developer is level3 under architecture. Eleven source-backed stages separate candidate readiness, user acceptance/release decision, and authorized deployment/operational verification. Independent professional conclusions cannot be silently waived.

The shared Web/Desktop plugin fixes the four-card overflow, persists grounded professional reference graphs, fits and zooms the full organization chart, and separates rework routes. Explicit upgrades back up plugin-owned state and preserve custom or executed adoptions. Marked upgrade backups participate in ownership-checked complete cleanup; unknown/user backups and other profiles are protected.

Verification:723 automated checks (722passed, zero failures, one optional skip),15archive lifecycle checks,29native workflow UI checks,8requested UI/persistence checks, real cross-version/explicit upgrades, and real macOS Desktop verification.360authoritative knowledge/reading files remain byte-identical across restart. Official host program hashes remain unchanged. Provider quality, actual business deployment and other platforms remain unverified; the upstream native-session deletion exception remains documented.
