/** Exact paths, * (one segment), and ** (recursive) are the only supported permission patterns. */
export function matchesPath(path: string, pattern: string): boolean {
  const clean = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean || clean.startsWith('/') || clean.split('/').includes('..')) return false;
  const escaped = clean.split(/(\*\*\/|\*\*|\*)/).map(part => part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${escaped}$`).test(path);
}
