export class WorkforceError extends Error {
  constructor(public readonly code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'STORE_BUSY' | 'INVALID_STATE', message: string) {
    super(message); this.name = 'WorkforceError';
  }
}
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new WorkforceError('VALIDATION', message);
}
export function textField(value: unknown, label: string, allowEmpty = false): asserts value is string {
  invariant(typeof value === 'string' && (allowEmpty || value.trim().length > 0), `${label} 必须为${allowEmpty ? '' : '非空'}字符串`);
}
