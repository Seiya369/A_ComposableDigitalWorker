import type { DeliverableRevision } from '../work/types.js';

export function isDeliverableAccepted(revision?: DeliverableRevision): boolean { return !!revision && !revision.invalidatedAt && revision.review?.decision === 'accepted'; }
export function deliverableStatus(revision?: DeliverableRevision): string {
  if (!revision) return '待产出';
  if (revision.invalidatedAt) return '需重新验证';
  return revision.review?.decision === 'accepted' ? '已验收' : revision.review?.decision === 'rejected' ? '已退回' : '待验收';
}
