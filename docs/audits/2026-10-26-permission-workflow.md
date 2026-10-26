# 0.29.2 权限切换后工作流误锁 / Permission-change workflow lock

日期：2026-10-26。环境：官方 DSH 0.2.1-rc.3、Node24.21.0、macOS arm64。版本及归档哈希见[本版验收](../../integration/verification-0.29.2.md)。

## 复现与根因

0.29.1 实包安装到干净官方宿主与独立临时profile。选择软件工作流，通过原生权限控件启用完全权限，不发送消息。原生发送可用、模型调用数为0，但插件API返回busy:true；等待真实轮询后，工作流菜单和顶部步骤均禁用。

官方rc.3实现链如下，均只读研究官方npm原版文件：

1. `@deepseek-ai/dsh-client-ui-permission-presets/lib/client.js` 调用 `/permission <preset>`。
2. `@deepseek-ai/dsh-permission-presets/lib/index.js` 将策略交给 `ApprovalService.setPolicy`。
3. `@deepseek-ai/dsh-user-approval/lib/index.js` 先写持久 `approval/policy` 事件，再注入来源为 `user-approval` 的用户角色通知。
4. `@deepseek-ai/dsh-agent-loop/lib/index.js` 的inject使用next-step、不唤醒Agent；通知等待下一次真实模型步骤。
5. 本插件旧 `conversationIsBusy` 把任意非空nextStep/nextTurn都视为待执行任务，因此误锁。客户端只是忠实使用API的busy字段，并非权限不足或新的授权限制。

## 修复与边界

普通原生空闲对话仅忽略nextStep中的官方用户角色权限通知。只读判断，不消费或清空队列、不修改权限、不启动模型。仍阻止运行中Agent、所有nextTurn输入、其他或未知nextStep输入以及共享流程的真实执行任务。

运行时持有的旧独立员工根会话继续使用严格空队列保护，因为官方dispose会取消并清空inbox。不得为恢复按钮而丢失这类会话的通知、附件或用户输入；实际策略虽已持久记录，待消费的模型上下文仍应保留。

建议继续按官方生产者来源区分通知与真实工作，不解析英文通知正文、不广泛放行其他通知、不清队列或假造idle。未来升级宿主时重新核对注入语义、来源及处置生命周期。

## 已执行的修复计划与复测

1. 保留0.29.1红测试：原生发送可用、workflowBusy/pickerDisabled/stepDisabled均为true、自动模型调用0。
2. 新增只读活动判断，普通原生会话和运行时持有会话分别保留适当队列保护。
3. API和活动判断覆盖真实用户输入、未知来源、混合队列、运行中及权限通知。真实官方ApprovalService测试确保保留会话拒绝交接而不丢通知、策略和持久事件。
4. 同一0.29.2实包绿测试：通过原生控件切换权限，菜单和步骤均可操作、草稿保留、无自动模型调用；下一次真实员工请求仍包含原始权限通知。运行中锁定和原验收闭环保持通过。
5. 类型检查/构建通过；729项全量测试中728通过、0失败、1项可选私有工作区测试跳过。30项官方原生UI、15项实际安装/卸载/重装/清理全部通过；27,607个官方程序文件前后哈希相同。

实际本地profile只通过官方CLI安装插件，不修改宿主源码或程序文件。用户在核验期间主动启动的原生任务照常执行，不为演示解锁而取消或改写任务。原生持久会话清理接口缺失的既有预发布保留项不变；Windows、其他架构及真实供应商质量不在本次离线验收范围。

## English

The official permission picker queues a non-waking `user-approval` notice for the next model step. Version0.29.1 incorrectly classified every queued notice as work. Version0.29.2 ignores only that exact producer in the non-waking lane of ordinary idle native sessions. Active turns, real/unknown queued input and retained capabilities remain protected. Notices and policy are preserved, with no automatic model calls.

An actual official-host UI red/green regression verifies selectable controls, preserved drafts and notice delivery on the next real owner request. Full suite:728passed, zero failures, one optional skip;30native UI and15exact-archive lifecycle checks pass. No host source or installation program was changed.
