# 员工岗位 AI 智填验收（2026-10-24）

本记录绑定 `dsh-plugin-composable-workforce@0.9.0` 的最终物理归档。四处知识操作文字与图谱统计文字同色，模型配置移到岗位定义之前，岗位角色右侧增加使用员工当前配置模型的“AI智填”。

## 交付归档

| 交付项 | 内容 |
| --- | --- |
| 插件包 | [dsh-plugin-composable-workforce-0.9.0.tgz](../artifacts/dsh-plugin-composable-workforce-0.9.0.tgz) |
| SHA-256 | `c80c20899bfff0c921b6ab1d9d80a88a5edf8713bb2b41dcd20c4257c78b5025` |
| 校验文件 | [归档 SHA-256](../artifacts/dsh-plugin-composable-workforce-0.9.0.tgz.sha256) |
| 大小／文件数 | 908,330 字节／291 个文件 |
| 验证环境 | 官方 DSH `0.2.1-alpha.2`，Node `24.21.0`，独立临时 profile |
| 安装、卸载、完整清理与许可 | [安装说明](README.md)、[许可声明](../LICENSES.md)、[第三方声明](THIRD_PARTY_NOTICES.md) |

## 最终行为

- 页签顺序为“模型配置、岗位定义、能力组合、认知记忆”；默认仍打开岗位定义。AI智填与岗位角色输入框右边线对齐，三处正文输入框保持等高。
- 点击后，以当前草稿中的员工名字和模型配置生成岗位角色、工作职责、工作规范与边界。显式选择包含 provider、model、reasoningEffort；继承时使用原生模型目录的当前 default，缺失时提示错误，不回退到任意其他模型。未保存的新员工及未保存的模型选择均可使用。
- 每次有效点击只调用一次模型，结果只写入三个职责草稿字段。填写后可编辑，点击“保存配置”才持久化；生成本身不创建员工工作单、会话、记忆或知识更新。
- 填写中阻止重复点击；修改名字、模型或职责，切换员工、还原、保存或关闭组件均取消原请求，并拦截迟到结果。错误保留原内容，可重试；姓名为空或模型不完整时不发送生成请求。
- “上传资料”和三处“开启自动归档”文字在深色为 `rgb(173, 176, 182)`，浅色为 `rgb(105, 117, 133)`，分别与同主题图谱统计文字逐一相等。标题和开关状态保留原样。

## 官方扩展与资源生命周期

模型目录来自官方 `ctx.sessionController.modelCatalog()`；生成通过官方 `ctx.llm.stream()`，沿用已经声明的服务注入及 `0.2.1-alpha.2` peer 依赖。`POST /digital-workers/api/employee-role-draft` 是本插件路由，复用已有认证、同源校验和 Cordis 清理，不是给宿主新增接口。官方源码、安装包类型依据及限制见 [公开接点核对](../artifacts/employee-role-ai-validation/public-api-review.md)。

服务最多两个并发请求，总时限 120 秒覆盖目录与模型调用，调用方断开或插件卸载均中断请求。取消后底层调用尚未结束时继续占用名额，防止忽略取消的供应商产生无限并发。卸载清理计时器及请求，无新增持久目录或后台任务。输出只接受完整停止的严格三字段 JSON，限制请求、响应、字段长度及输出 token；供应商异常经原生 LLM Runtime 转为 `finish.reason.kind=error` 时返回安全 503，不回传供应商错误原文。

## 验证结果

| 验证 | 结果与证据 |
| --- | --- |
| 构建与类型检查 | `npm run build`、`npm run typecheck` 通过；[构建日志](../artifacts/employee-role-ai-validation/build.log)、[类型日志](../artifacts/employee-role-ai-validation/typecheck.log) |
| 全量单元测试 | **477／477**；文件并发为 4；[结果](../artifacts/employee-role-ai-validation/unit-result.json)、[日志](../artifacts/employee-role-ai-validation/unit.log) |
| 最终实包浏览器 | **52／52**，保留原有 43 项图谱／能力／归档检查；[结果](../artifacts/employee-role-ai-validation/employee-settings-result.json)、[归档绑定](../artifacts/employee-role-ai-validation/ui-archive-binding.json)、[日志](../artifacts/employee-role-ai-validation/ui-e2e.log) |
| AI 填写与保存 | 三字段一次填入；未保存的显式模型与 high 思考强度正确传入；原生 default 继承正确；保存前完整快照不变，显式保存后持久化 |
| 错误与隔离 | 原生供应商失败返回安全 503，原字段不变且可重试；空姓名／缺失模型不调用；双击仅一次；名字、模型、职责及员工切换均触发真实请求中断并隔离迟到结果 |
| 布局与颜色 | 桌面、窄屏、矮屏按钮右齐且三框等高；深浅主题四处操作文字与图谱统计精确同色 |
| 官方安装生命周期 | **13／13**，安装、使用、普通卸载、重装、完整清理、原生宿主恢复通过；12 个知识文件普通卸载与重装前后逐字节一致；[报告](../artifacts/lifecycle-0.9.0/report.json)、[日志](../artifacts/employee-role-ai-validation/lifecycle.log) |
| 官方程序未变 | 前后 **28,401** 个程序文件的完整联合 SHA-256 均为 `401e9ede24e8fd0e73b8708f78de471b77a4e475b772c3d03b5cda65cd28f003` |
| 归档白名单 | **291 个文件**与当前源码／构建逐字节一致，无宿主补丁、node_modules、用户数据、凭据或测试夹具；[核对结果](../artifacts/employee-role-ai-package-inventory.json) |

## 实际 3081 验证

在未保存的新员工草稿中输入“测试负责人”，通过继承的原生模型 `deepseek-official / deepseek-flash / high` 实际调用一次。岗位角色、工作职责、工作规范与边界全部填入，长度分别为 46、250、296 字符；按钮与输入框右边线一致。测试后还原草稿并返回原架构师，没有保存测试员工。

升级前后完整员工状态、知识快照、原始资料、归档策略、Wiki 图与阅读页面均一致；除派生 Wiki 缓存和写锁外 **51 个知识文件逐字节一致**。原架构师仍为 **v3、15 个概念、10 条关系、22 篇阅读页面**。实际四处操作文字均为目标深色灰值。

证据：[完整性结果](../artifacts/employee-role-ai-validation/live-upgrade-integrity.json)、[CUA 结果](../artifacts/employee-role-ai-validation/live-cua-result.json)、[实际 AI 填写截图](../artifacts/employee-role-ai-validation/live-ai-filled.png)、[还原后原岗位截图](../artifacts/employee-role-ai-validation/live-role-editor.png)、[实际灰色操作截图](../artifacts/employee-role-ai-validation/live-muted-actions.png)。

## 迭代与验证限制

首轮无限文件并发的全量单测中，既有的跨团队知识引擎测试超过其原有 5 秒时限；未修改测试时限或知识引擎，控制文件并发为 4 后完整 477 项通过。保留 [首轮日志](../artifacts/employee-role-ai-validation/first-high-load-unit.log)。

实包 UI 迭代曾发现原生错误结束原因分类和上传文字被旧全局 `!important` 覆盖，均在产品中修正并重新打包、完整重测。其余夹具目录、选择器、切换后的草稿还原、iframe 主题消息同步问题修正于测试；精确颜色、请求路由与迟到隔离断言保留。过程见 [迭代记录](../artifacts/employee-role-ai-validation/test-iterations.md)。最终浅色知识截图捕获到 Sigma 适配动画暂时隐藏边／标签的一帧，颜色断言和结构／交互均通过；深色最终截图及实际页面图谱正常。

实包 UI 和完整卸载均在隔离 profile 中执行，临时宿主、浏览器、共享 Wiki 子进程和目录已清理。当前 3081 演示升级与真实模型调用作为额外验证，未代替官方干净 profile 的验收。所有正式报告绑定本记录最终归档哈希；验收后未重打包，未修改官方宿主文件。
