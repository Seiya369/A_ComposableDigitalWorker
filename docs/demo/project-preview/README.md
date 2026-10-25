# 【演示】软件工程项目预览

本目录是自写的软件工程专业资料和界面示例，不是项目已经完成的成果，也不是测试证据。全部模拟交付、退回、验收和确定事项均带有“演示”标记；模拟验收人是“演示验收（模拟）”。不得据此声称用户实际验收、代码已经实现或测试通过。

资料覆盖产品、体验、架构、开发、测试和运维，供当前项目的独立“【演示】软件工程·界面演示”工作流使用。原真实工作流、默认选择、其他对话、既有交付和原知识文件保持原样。演示图谱来自人工整理的下列原文与精确行引用，不调用模型，不向外部上传。

按现有项目知识规则，同项目的显式已确认记忆也会进入团队知识空间。脚本原样引用这些已有记录的 ID、正文、来源和版本，不改原记录；阅读页单独标注“既有项目记忆引用”。只有六篇演示资料生成演示概念和关系，不从原记忆推断新关系，不把原记忆改写成演示事实。完整来源指纹包含两类来源，避免重启后因遗漏原有显式输入而触发再次编纂。

## 资料目录

- `01-product-baseline.md`：目标、范围、需求基线和验收标准。
- `02-architecture-contract.md`：官方扩展、组织委派、并发和接口契约。
- `03-experience-guidelines.md`：状态表达、知识阅读和交互一致性。
- `04-test-plan.md`：计划中的用例、缺陷记录和回归方式；没有执行结果。
- `05-release-handover.md`：候选发布清单、归档校验和恢复计划。
- `06-delivery-preview.md`：明确模拟的交付档案、事项声明和待复核内容。

## 一次性准备方式

默认只读计划：

```sh
node --import tsx scripts/seed-project-preview.ts --state /absolute/plugin-state.json --project PROJECT_ID --session OFFICIALLY_CREATED_DEMO_SESSION_ID
```

只有服务已停止、目标端口拒绝连接、当前 revision 与检查值一致时，才允许追加独立演示数据：

```sh
node --import tsx scripts/seed-project-preview.ts --state /absolute/plugin-state.json --project PROJECT_ID --session OFFICIALLY_CREATED_DEMO_SESSION_ID --expected-revision REVISION --service-port 3081 --apply
```

脚本只改本插件自有状态及新的演示知识空间，不直接写 Harness SQLite。专用对话必须先通过 Harness 官方入口创建；脚本仅保存该对话的插件工作流覆盖。执行前由操作者保留 state 与知识根备份；脚本不会自动停启服务或修改宿主配置。

知识先写入未挂载的确定性演示空间，再通过带 CAS 的一次事务挂载到项目。若事务冲突，原状态不变；已暂存的演示空间保留供相同命令重试，不覆盖原库。相同文档重复执行不增加员工、工作单、知识版本或 revision。演示知识关闭三类自动归档，保存候选快照及 `modelCalls: 0`；这只影响演示空间，不更改用户原有归档规则。

演示实例前三步模拟完成，其中架构步骤保留模拟退回初稿、模拟验收修订稿及三条模拟确定事项。当前第四步提交测试计划候选文档，所有用例均为未执行，当前步骤不显示已验收确定事项。其余步骤仍是待开始。删除演示数据应按 ID 清单单独处理，不删除原项目、对话或用户资料。
