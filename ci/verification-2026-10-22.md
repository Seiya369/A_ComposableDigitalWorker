# 开发依赖与质量门验证

本记录是任务 05 的开发环境证据，2026-10-22（Asia/Shanghai）。最终产品候选仍由集成任务重新归档、审查和验收。

- 根普通 npm install/ci 成功，168 个当前平台包；不使用 legacy、force 或源码链接。227 项 lock 记录无本机外部 key。Cordis 精确 `4.0.5`。
- 官方 stock 普通安装 561 包；独立锁 632 项，无本机外部 key。该目录只用于原版测试，未修改程序文件。
- setup 的官方包解析、幂等、普通 npm 校验、祖先回落、包/声明逃逸、共享目录、非自有实体、版本及只读验证均有失败→通过记录；最新 10 项通过。归档门另有 3 项真实 npm pack 测试通过。
- 03 前集成快照加本任务当时的测试：309/309，通过日志 `artifacts/employee-knowledge-classification-2026-10-22/ci/tests.log`；后增的两个边界测试单独通过。不将这一数字冒充最终集成回归。
- 全测试/脚本 strict 门发现并修复原有夹具类型债务，保持运行断言；03 的编纂请求契约随其依赖合入后再检查。
- 03 前归档 SHA-256 `6d33901f8e0c01e9d73a4edcfcd1e0c265033f37935d93cc78d56dae8405df3c`，240746 字节、97 文件，重复打包一致、全部文件逐字节比对通过。
- 此归档用官方 CLI **正常 add/remove** 完成安装、使用、普通卸载、原生启动、重装及 purge；没有关闭 peer 自动安装或 strict 检查。31 项生产 peer 精确匹配，真实 manifest 路径均位于独立 stock 边界，Cordis 为 `4.0.5`。
- 原版程序及依赖 28780 文件，前后 SHA-256 均为 `4884c5114baef30852d2985e267a86e4a1553b6d5f6a41e6fe0185370880b7f3`。记录见 `artifacts/employee-knowledge-classification-2026-10-22/ci/lifecycle-normal/report.json`。
- 插件审计 0 漏洞；官方 stock 审计 12 中危、0 高危/严重，`audit-level=high` 退出 0。完整 JSON 保留，未运行 audit fix 或修改宿主。
- 本机 Node `24.21.0`。工作流的 Ubuntu/Node `22.19.0`、`24.21.0` 远端执行尚未发生；不声称 CI 或最终产品验收已通过。

原始 TDD、类型、构建、归档、stock 与审计输出保存在上述独立 ci 目录；未覆盖历史归档报告。安装路径、测试资料均为临时或插件专有目录，未触碰用户当前 profile、会话或真实员工资料。
