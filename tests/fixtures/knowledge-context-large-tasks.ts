import type { ContextDocument, ContextLayer } from '../../src/knowledge/context.js';

/** Entirely synthetic operational records. No user files, sessions or credentials. */
export interface LargeTaskRead { id: string; version: number; layer: ContextLayer; repeat?: boolean }
export interface LargeTaskPhase { id: string; instruction: string; reads: LargeTaskRead[]; requiredDocs: string[] }
export interface LargeTaskGold {
  id: string; version: number; fragment: string;
  /** Independently authored checkpoints, not output produced by the retrieval implementation. */
  explanation: string;
}
export interface LargeKnowledgeTask {
  id: string; label: string; question: string; routeLabel: 'authored-route'; documents: ContextDocument[];
  phases: LargeTaskPhase[]; gold: LargeTaskGold[]; expectedAnswer: Record<string, unknown>;
  noiseIds: string[]; rowCount: number; integrityRequirement: string;
}
const docKey = (doc: Pick<ContextDocument, 'id' | 'version'>) => `${doc.id}@${doc.version}`;
const checkpoints = [0, 15, 31, 47] as const;
function raw(id: string, title: string, rows: string[], version = 1, verified = true): ContextDocument {
  return { layer: 'A', id, version, library: 'team', title,
    content: [`# ${title}`, ...rows].join('\n'), verified, provenance: `synthetic-large://${id}/v${version}` };
}
function overview(documents: ContextDocument[], text: string): ContextDocument[] {
  const sources = documents.filter(doc => doc.layer === 'A');
  const b: ContextDocument = { layer: 'B', id: 'route-index', version: 1, library: 'team', title: '任务路由与证据状态',
    content: `${text}\n${sources.map(doc => `${docKey(doc)} | ${doc.title} | verified=${doc.verified} | ${doc.content.split('\n').length} lines`).join('\n')}`,
    citations: sources.map(doc => ({ sourceId: doc.id, sourceVersion: doc.version, startLine: 1, endLine: doc.content.split('\n').length })) };
  return [{ layer: 'C', id: 'task-map', version: 1, library: 'team', title: '大型任务目录', content: text, entryIds: [b.id] }, b, ...documents];
}
function authoredPhase(id: string, instruction: string, reads: ContextDocument[], required = reads): LargeTaskPhase {
  return { id, instruction, reads: reads.map(doc => ({ id: doc.id, version: doc.version, layer: doc.layer })), requiredDocs: required.map(docKey) };
}
function taskBase(id: string, label: string, question: string, docs: ContextDocument[], phases: LargeTaskPhase[], gold: LargeTaskGold[], expectedAnswer: Record<string, unknown>): LargeKnowledgeTask {
  return { id, label, question, routeLabel: 'authored-route', documents: overview(docs, `${label}。必须回读原始记录，目录不能替代事实。${question}`), phases, gold, expectedAnswer,
    noiseIds: [], rowCount: typeof expectedAnswer.records === 'number' ? expectedAnswer.records : docs.reduce((sum, doc) => sum + doc.content.split('\n').length - 1, 0),
    integrityRequirement: 'Every business row in a current required document is necessary; complete-range coverage is measured separately from the independent answer checkpoints. Unmarked non-gold text is not classified as noise.' };
}
const goldAt = (doc: ContextDocument, row: number, fragment: string, explanation: string): LargeTaskGold => {
  if (!doc.content.split('\n')[row + 1]?.includes(fragment)) throw new Error(`Authored checkpoint drift: ${docKey(doc)} row ${row}`);
  return { id: doc.id, version: doc.version, fragment, explanation };
};
function chineseAudit(): LargeKnowledgeTask {
  const docs = Array.from({ length: 10 }, (_, page) => raw(`payment-rules-${page + 1}`, `支付规则分片 ${page + 1}`, Array.from({ length: 48 }, (_, row) => {
    const n = page * 48 + row + 1;
    return `接口 PAY-${String(n).padStart(4, '0')}；商户区域=${['华北', '华东', '华南', '西部'][row % 4]}；适用账本=${1000 + n}；每笔上限=${18000 + n * 7} 分；日累计上限=${60000 + n * 11} 分；回执等待=${12 + row % 5} 秒；自动重试最多 3 次，间隔为 2 秒、8 秒、30 秒，必须复用 Idempotency-Key；${row % 12 === 0 ? '退款不得自动重试，先查询最终状态；本人授权也不向经理授予退款执行权。' : '仅在未确认扣款且状态查询返回 pending 时重试，查询返回 settled 后不得继续。'}校验表达式=amount_cents <= ${18000 + n * 7} && ledger_id === ${1000 + n}；撤销授权立即失效，不能用历史成功请求覆盖当前拒绝。`;
  })));
  docs[0]!.content += '\n精确命令 PAY-0001：retry({ delaysMs: [2000, 8000, 30000], key: originalKey, allowRefund: false })';
  const gold = [
    goldAt(docs[0]!, 0, '每笔上限=18007 分', 'first exact amount'), goldAt(docs[2]!, 15, '适用账本=1112', 'middle ledger identity'),
    goldAt(docs[4]!, 31, '日累计上限=62464 分', 'distributed exact total'), goldAt(docs[7]!, 47, '校验表达式=amount_cents <= 20688 && ledger_id === 1384', 'late exact code'),
    goldAt(docs[9]!, 0, '本人授权也不向经理授予退款执行权。', 'negative exception in last shard'),
    { id: docs[0]!.id, version: 1, fragment: 'retry({ delaysMs: [2000, 8000, 30000], key: originalKey, allowRefund: false })', explanation: 'command must be quoted without mutation' },
  ];
  return taskBase('large-zh-contract-audit', '中文精确数值、代码与否定例外', '核对全部 480 条支付规则，给出退款禁重试记录数。逐字抄录 PAY-0001 命令，报告 PAY-0001、PAY-0112、PAY-0224、PAY-0384 的精确金额/账本检查，并说明最后分片的授权例外。所有结论附源版本及行号；每阶段当前明细须完整保留。', docs,
    [authoredPhase('north', '审计前五分片；全部当前明细仍为必要证据。', docs.slice(0, 5)), authoredPhase('south', '审计后五分片；前阶段可收拢，但保留回读身份。', docs.slice(5)), authoredPhase('cross-check', '返回原始命令和跨分片控制点核对，不可凭前轮记忆。', [docs[0]!, docs[2]!, docs[4]!, docs[7]!, docs[9]!])], gold,
    { records: 480, refundNoRetryRecords: 40, command: 'retry({ delaysMs: [2000, 8000, 30000], key: originalKey, allowRefund: false })', managerRefundPermission: false });
}
function versionConflict(): LargeKnowledgeTask {
  const docs: ContextDocument[] = [];
  for (let page = 0; page < 6; page++) for (const version of [1, 2]) docs.push(raw(`service-policy-${page + 1}`, `服务策略分片 ${page + 1} ${version === 1 ? '历史已废止' : '现行批准'}`, Array.from({ length: 48 }, (_, row) => {
    const n = page * 48 + row + 1;
    return `SERVICE-${String(n).padStart(4, '0')} | approval=${version === 1 ? 'REVOKED 2026-09-03' : 'APPROVED 2026-10-18'} | source_revision=${version} | production timeout=${version === 1 ? 90 : 12 + row % 3}s | retry_limit=${version === 1 ? 5 : 2} | owner=team-${page + 1} | queue=lane-${row % 6} | request_ceiling=${800 + n} | circuit_window=60s | ${row % 12 === 0 ? 'EXCEPTION streaming-export is excluded; use its approved dedicated runbook; do not inherit ordinary retries.' : 'Applies only to ordinary non-streaming requests; a timeout does not prove rollback and the receipt ledger must be checked first.'} | replacement=${version === 1 ? 'superseded by revision 2; later file timestamps do not restore validity' : 'supersedes revision 1 for this same service identity; cross-region staging overrides are forbidden'} | audit_evidence=approval-${n}-signed; signatures and scope must be checked together before making a current recommendation.`;
  }), version));
  const current = docs.filter(doc => doc.version === 2);
  const gold = [goldAt(docs[0]!, 0, 'timeout=90s | retry_limit=5', 'historical value remains visible as historical'), goldAt(current[0]!, 0, 'timeout=12s | retry_limit=2', 'current approved rule'),
    goldAt(current[2]!, 15, 'SERVICE-0112', 'middle current identity'), goldAt(current[4]!, 31, 'approval=APPROVED 2026-10-18', 'late authoritative status'), goldAt(current[5]!, 36, 'EXCEPTION streaming-export is excluded', 'exception survives reconciliation')];
  return taskBase('large-version-conflict', '多源版本冲突与适用范围', '逐项核对 288 个服务的新旧两版策略，现行清单不得混入90秒/5次旧值。报告服务数量、流式导出例外数及SERVICE-0001/0112/0224/0277的现行规则；说明为何文件更新时间不能覆盖批准状态。必须保留两版引用以说明冲突。', docs,
    [authoredPhase('compare-one', '比较前半服务新旧两版，两个版本均为必要证据。', docs.slice(0, 6)), authoredPhase('compare-two', '比较后半服务新旧两版。', docs.slice(6)), authoredPhase('current', '终核全部现行批准页；旧版可回读。', current)], gold, { services: 288, streamingExceptions: 24, currentRevision: 2, historicalTimeoutSeconds: 90, currentRetryLimit: 2 });
}
function reflectionBoundary(): LargeKnowledgeTask {
  const verified = Array.from({ length: 6 }, (_, page) => raw(`verified-incident-${page + 1}`, `已核验事故观测 ${page + 1}`, Array.from({ length: 48 }, (_, row) => {
    const n = page * 48 + row + 1;
    return `OBS-${String(n).padStart(4, '0')} | sensor=probe-${n} | measured_at=2026-10-20T${String(row % 24).padStart(2, '0')}:15:00Z | requests=${10000 + n * 13} | failures=${row % 7} | p95_ms=${140 + row * 3} | release=r${page + 1}.17 | verified=true | causal_status=not established | ${row % 12 === 0 ? 'Witness reproduced a receipt delay under controlled load; this is an observation, not proof that increasing concurrency is safe.' : 'No controlled concurrency intervention was performed; latency and queue depth are correlated observations only.'} | recovery=operator drained lane-${row % 4}, preserved receipt ledger, and compared checksums before reopening writes | scope=single-region canary, cannot generalize to all production regions | original_timestamp_and_measurement_must_be_cited=true.`;
  })));
  const candidates = verified.map((doc, page) => ({ ...raw(`reflection-${page + 1}`, `员工反思候选 ${page + 1}（未采纳）`, Array.from({ length: 48 }, (_, row) =>
    `CAND-${page * 48 + row + 1} | candidate=true | verified=false | proposal=raise concurrent workers to ${640 + row * 16}; lower retry delay to ${row % 4 + 1}ms | claimed_benefit=estimated only, no production trial | references=OBS-${String(page * 48 + row + 1).padStart(4, '0')} | adoption=NOT APPROVED | reviewer_requested=causal experiment and rollback demonstration | author explicitly distinguishes a reflection from a confirmed policy | possible_counterexample=receipt delay may increase duplicate charge risk; no authority to override signed retry or access rules | evidence_boundary=proposal text can be cited as a proposal, never reported as measured throughput or current deployment configuration.`), 1, false), layer: 'B' as const, citations: [{ sourceId: doc.id, sourceVersion: 1, startLine: 1, endLine: 49 }] }));
  const docs = verified.flatMap((doc, i) => [doc, candidates[i]!]);
  const gold = [goldAt(verified[0]!, 0, 'requests=10013 | failures=0 | p95_ms=140', 'observed exact values'), goldAt(verified[2]!, 15, 'causal_status=not established', 'middle no causal claim'),
    goldAt(candidates[3]!, 31, 'adoption=NOT APPROVED', 'late candidate status'), goldAt(verified[5]!, 47, 'scope=single-region canary', 'last observation limited scope'), goldAt(candidates[5]!, 47, 'never reported as measured throughput or current deployment configuration.', 'reflection cannot become fact')];
  return taskBase('large-reflection-boundary', '反思与已核验事实边界', '审计全部288条观测及对应反思，统计获得批准的并发变更数量与有因果实验的观测数量。报告OBS-0001和OBS-0288的实测值；判断能否将未采纳反思写为生产事实。逐阶段读取所有记录且保留核验状态、引用、否定范围。', docs,
    [authoredPhase('incident-one', '审核前半观测与相应候选。', docs.slice(0, 6)), authoredPhase('incident-two', '审核后半观测与相应候选。', docs.slice(6)), authoredPhase('verify-again', '回读首末事实与中部候选核验结论。', [verified[0]!, candidates[3]!, verified[5]!, candidates[5]!])], gold,
    { observations: 288, candidates: 288, approvedConcurrencyChanges: 0, controlledConcurrencyExperiments: 0, reflectionIsFact: false, firstP95Ms: 140, lastP95Ms: 281 });
}
function relationshipGraph(): LargeKnowledgeTask {
  const docs = Array.from({ length: 12 }, (_, page) => raw(`dependency-graph-${page + 1}`, `发布依赖图分片 ${page + 1}`, Array.from({ length: 48 }, (_, row) => {
    const n = page * 48 + row; const from = `N${String(n).padStart(4, '0')}`; const to = `N${String((n + 1) % 576).padStart(4, '0')}`;
    return `EDGE-${String(n).padStart(4, '0')} | ${from} -> ${to} | relation=requires-success | condition=receipt checksum accepted before consumer starts | owner=release-cell-${page + 1} | artifact=manifest-${n}.json | retry_scope=edge-local, not a new graph edge | cancellation=propagates only after durable failure acknowledgement | timeout_ms=${12000 + row * 17} | source_of_truth=approved dependency manifest | ${row === 47 ? 'Cross-page edge: target belongs to the next shard (final shard closes the ring); do not drop this relation at pagination.' : 'Internal edge: node identity includes all four digits; do not merge nodes merely because their labels share a prefix.'} | audit=retain direction, predicate and version; a relation table must remain complete to establish reachability or a strongly connected component.`;
  })));
  const gold = [goldAt(docs[0]!, 0, 'N0000 -> N0001', 'first directed edge'), goldAt(docs[0]!, 47, 'N0047 -> N0048', 'first cross-page boundary'), goldAt(docs[5]!, 47, 'N0287 -> N0288', 'middle boundary'), goldAt(docs[8]!, 31, 'N0415 -> N0416', 'late internal edge'), goldAt(docs[11]!, 47, 'N0575 -> N0000', 'ring closure')];
  return taskBase('large-complete-relationship-graph', '完整关系图与跨页边', '完整读取576条有向依赖关系后判断强连通分量数量、N0000能否到达N0575、删除EDGE-0575后能否从N0575回到N0000；逐字给出所有分片末尾的12条跨页边。不能用头尾少数样本证明全图完整。可分阶段核对，但最后应声明完整性条件及缺失。', docs,
    [authoredPhase('graph-one', '读取并核对前四分片所有边。', docs.slice(0, 4)), authoredPhase('graph-two', '核对中四分片及前阶段边界连接。', docs.slice(4, 8)), authoredPhase('graph-three', '核对末四分片并回读闭环的首分片。', [...docs.slice(8), docs[0]!])], gold,
    { nodes: 576, edges: 576, stronglyConnectedComponents: 1, reachesLast: true, reachesStartWithoutClosingEdge: false, closingEdge: 'N0575 -> N0000' });
}
function crossPageTable(): LargeKnowledgeTask {
  const docs = Array.from({ length: 10 }, (_, page) => raw(`reconciliation-${page + 1}`, `跨页清算表 ${page + 1}`, Array.from({ length: 48 }, (_, row) => {
    const n = page * 48 + row + 1;
    return `ROW-${String(n).padStart(4, '0')} | invoice=INV-${n} | original_currency=CNY | gross_fen=10000 | fee_fen=${row % 12 === 0 ? 0 : 125} | net_fen=${row % 12 === 0 ? 10000 : 9875} | exception=${row % 12 === 0 ? 'fee-waived-approved' : 'none'} | beneficiary=merchant-${page + 1} | settlement_day=2026-10-${String(10 + page).padStart(2, '0')} | receipt=RCPT-${100000 + n} | tax_basis=net_fen, not gross_fen | join_key=invoice plus receipt, duplicate invoice numbers in another currency must not be combined | state=settled-and-reconciled | ${row === 47 ? 'Page carry: continue at the following numbered ROW; a page subtotal is not the complete ledger total.' : 'Row is part of the exact total; do not replace this record with a topical excerpt when computing reconciliation.'} | reversals require their own approved record; no implicit negative rows are present.`;
  })));
  const gold = [goldAt(docs[0]!, 0, 'fee_fen=0 | net_fen=10000', 'first exception'), goldAt(docs[3]!, 15, 'ROW-0160', 'middle identity'), goldAt(docs[5]!, 47, 'Page carry: continue', 'middle continuation'), goldAt(docs[9]!, 47, 'receipt=RCPT-100480', 'last receipt')];
  return taskBase('large-cross-page-table', '跨页完整表与精确清算', '完整核算480行清算表，给出gross/fee/net的分单位总数、免手续费行数、首末receipt、每页行数。读取必须涵盖所有行，不能用检索摘要代替完整表；所有页尾续接和金额单位需保真。最终核对时回读第一、中间、最后页。', docs,
    [authoredPhase('ledger-one', '核算前五页全部行。', docs.slice(0, 5)), authoredPhase('ledger-two', '核算后五页全部行。', docs.slice(5)), authoredPhase('ledger-return', '最终交叉核对原始首中末页。', [docs[0]!, docs[4]!, docs[5]!, docs[9]!])], gold,
    { rows: 480, rowsPerPage: 48, grossFen: 4800000, feeFen: 55000, netFen: 4745000, waivedRows: 40, firstReceipt: 'RCPT-100001', lastReceipt: 'RCPT-100480' });
}
function multiRound(): LargeKnowledgeTask {
  const docs = Array.from({ length: 12 }, (_, page) => raw(`phase-evidence-${page + 1}`, `多轮迁移证据分片 ${page + 1}`, Array.from({ length: 48 }, (_, row) => {
    const n = page * 48 + row + 1;
    return `MIG-${String(n).padStart(4, '0')} | shard=${page + 1} | object=ledger_${n} | source_schema=v7 | target_schema=v8 | before_checksum=sha256:synthetic-before-${n}-b7 | after_checksum=sha256:synthetic-after-${n}-c8 | row_count=${1000000 + n * 17} | approved_command=ALTER TABLE ledger_${n} ADD COLUMN receipt_state TEXT DEFAULT 'unknown'; | rollback=DROP COLUMN receipt_state only before first v8 write | lock_timeout_ms=${3000 + row * 19} | ${row % 12 === 0 ? 'EXCEPTION: archived objects are read-only; require maintenance approval before any DDL.' : 'Window is restricted to the staged maintenance lane; production automatic retries of schema changes are forbidden.'} | audit_order=record exact checksum, execute approved command, compare row count, then reopen writes | reuse of a cached summary does not establish the exact original command or its source line.`;
  })));
  const gold = [goldAt(docs[0]!, 0, 'row_count=1000017', 'initial measurement must be recovered'), goldAt(docs[3]!, 15, "ALTER TABLE ledger_160 ADD COLUMN receipt_state TEXT DEFAULT 'unknown';", 'middle exact DDL'), goldAt(docs[7]!, 31, 'after_checksum=sha256:synthetic-after-368-c8', 'later checksum'), goldAt(docs[11]!, 47, 'row_count=1009792', 'last measurement'), goldAt(docs[0]!, 0, 'archived objects are read-only', 'early negative exception returned after many rounds')];
  const phases = [authoredPhase('migrate-one', '记录前四页的完整命令和限制。', docs.slice(0, 4)), authoredPhase('migrate-two', '推进第二组，早期证据可收拢但不可失去版本身份。', docs.slice(4, 8)), authoredPhase('migrate-three', '推进第三组，累计读取应跨过64K。', docs.slice(8)), authoredPhase('migrate-return', '再次从来源回读第一、第四、第八、末页；不能将曾经见过当仍在场。', [docs[0]!, docs[3]!, docs[7]!, docs[11]!])];
  phases[3]!.reads = phases[3]!.reads.map(read => ({ ...read, repeat: true }));
  return taskBase('large-multiround-reread', '长多轮证据回读与引用保真', '核对576条迁移指令与限制，最后精确引用MIG-0001/0160/0368/0576的行数、DDL、校验和与只读例外。经历中间两个迁移阶段后必须重新读原始页并保留来源版本与行列范围。报告是否还缺少任何当前必需页。', docs, phases, gold,
    { objects: 576, firstRows: 1000017, lastRows: 1009792, command160: "ALTER TABLE ledger_160 ADD COLUMN receipt_state TEXT DEFAULT 'unknown';", archivedDDLWithoutApproval: false });
}
function mandatoryEvidence(): LargeKnowledgeTask {
  const docs = Array.from({ length: 7 }, (_, page) => raw(`mandatory-contract-${page + 1}`, `同阶段必需合同分片 ${page + 1}`, Array.from({ length: 48 }, (_, row) => {
    const n = page * 48 + row + 1;
    return `CLAUSE-${String(n).padStart(4, '0')} | approval=SIGNED-CURRENT | tenant=synthetic-tenant-${page + 1} | resource=account-${n} | request_quota=${20000 + n * 7} | burst_quota=${120 + row} | deadline_hours=${24 + row % 4} | required_fields=account_id, approval_id, receipt_id, source_revision | authorization=two distinct reviewers must approve before execution | exception=${row % 12 === 0 ? 'expired approval remains invalid even when both reviewers previously signed' : 'emergency review can shorten scheduling but cannot remove either signature'} | exact_guard=(quota <= ${20000 + n * 7}) && signatures.size === 2 && !approval.revoked | dependency=all clauses are part of one same-phase acceptance certificate; omitted rows make the certificate incomplete | preservation=retain every row with its exact version and coordinates; a 32K operating target does not authorize dropping necessary contract evidence.`;
  })));
  const gold = [goldAt(docs[0]!, 0, 'request_quota=20007', 'start necessary contract'), goldAt(docs[2]!, 15, 'burst_quota=135', 'middle necessary contract'), goldAt(docs[4]!, 31, 'quota <= 21568', 'late exact guard'), goldAt(docs[6]!, 47, 'CLAUSE-0336', 'end necessary contract'), goldAt(docs[6]!, 36, 'expired approval remains invalid', 'last-page negative exception')];
  return taskBase('large-required-over32', '当前必需证据超过32K', '为同一阶段336条已签合同出具完整验收证书。所有合同页同时必需；若超过32K日常目标，应使用48K软触发至64K硬限之间的空间而非丢页。统计条款与过期授权例外数，精确报告CLAUSE-0001/0112/0224/0336检查。若无法完整容纳，必须声明阶段移交和缺页，不可声称证书通过。', docs,
    [authoredPhase('certificate', '同阶段全部合同页必须保持活跃，不能将先读的必要证据强压到32K。', docs)], gold,
    { clauses: 336, expiredApprovalExceptions: 28, allCurrentPagesRequired: true, dropEvidenceToMeet32K: false });
}
function hardLimit(): LargeKnowledgeTask {
  const docs = Array.from({ length: 11 }, (_, page) => raw(`atomic-review-${page + 1}`, `原子验收证据分片 ${page + 1}`, Array.from({ length: 48 }, (_, row) => {
    const n = page * 48 + row + 1;
    return `ATOMIC-${String(n).padStart(4, '0')} | release=R2026.10.22 | artifact=package-${n}.tgz | checksum=sha256:synthetic-package-${n}-d7e9 | install_profile=temporary-isolated-${page + 1} | installed_files=${80 + row} | uninstall_files=${80 + row} | retained_user_documents=YES | host_file_hashes_before=match-after | compatibility=official-unmodified-release-only | acceptance_dependency=all 528 records form one atomic certificate; no record can be deferred or replaced by another page subtotal | exception=${row % 12 === 0 ? 'missing complete cleanup proof blocks acceptance even if install and restart passed' : 'uninstall must stop subscriptions timers styles background jobs and remove only plugin-owned data'} | required_proof=archive hash, install outcome, core behavior, ordinary uninstall, reinstall, full cleanup, native host smoke and unchanged host binaries | status=synthetic-budget-fixture.`;
  })));
  const gold = [goldAt(docs[0]!, 0, 'checksum=sha256:synthetic-package-1-d7e9', 'first atomic proof'), goldAt(docs[3]!, 15, 'installed_files=95 | uninstall_files=95', 'middle exact file accounting'), goldAt(docs[7]!, 31, 'host_file_hashes_before=match-after', 'host integrity'), goldAt(docs[10]!, 47, 'ATOMIC-0528', 'last atomic record'), goldAt(docs[10]!, 36, 'missing complete cleanup proof blocks acceptance', 'late blocking exception')];
  return taskBase('large-hard64-handoff', '超过64K的原子任务与明确移交', '对全部528条同阶段原子证据作完整验收。所有页同时必需，不能裁掉早期记录再声称验收通过。超过所选候选硬限时必须保留当前状态、列明未接纳版本并请求阶段拆分/更大预算；比较96K候选是否可完整容纳。结论只能适用于本合成试验，不等同于插件正式验收。', docs,
    [authoredPhase('atomic-certificate', '全部原始证据同时必需；硬限拒绝后不得伪造完整结果。', docs)], gold,
    { records: 528, allPagesAtomic: true, silentlyDropRequiredEvidence: false, realPluginComplianceProven: false });
}

export const largeKnowledgeTasks: LargeKnowledgeTask[] = [chineseAudit(), versionConflict(), reflectionBoundary(), relationshipGraph(), crossPageTable(), multiRound(), mandatoryEvidence(), hardLimit()];
export const largeTaskDocumentKey = docKey;
export const largeTaskCheckpointRows = checkpoints;
