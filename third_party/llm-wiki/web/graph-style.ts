/* SPDX-License-Identifier: GPL-3.0-only
 * Adapted from nashsu/llm_wiki src/components/graph/graph-view.tsx
 * at e08cfce65aad8b76b13546a081c1a8d4422b70c3.
 */
export const TYPE_COLORS: Record<string, string> = {
  entity: '#60a5fa', concept: '#c084fc', source: '#fb923c', overview: '#facc15', synthesis: '#94a3b8',
};
export const TYPE_LABELS: Record<string, string> = { entity: '实体', concept: '概念', source: '来源', overview: '概览', synthesis: '文章' };
export const COMMUNITY_COLORS = ['#60a5fa', '#4ade80', '#fb923c', '#c084fc', '#f87171', '#2dd4bf', '#facc15', '#f472b6', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24'];
export function nodeSize(degree: number, maxDegree: number, count: number): number {
  const density = count <= 150 ? 1 : Math.max(.35, Math.sqrt(150 / count));
  return (8 + Math.sqrt(degree / Math.max(maxDegree, 1)) * 20) * density * Math.SQRT1_2 * .5;
}
export function layoutIterations(count: number): number {
  return count > 2500 ? 28 : count > 1200 ? 40 : count > 600 ? 65 : count > 250 ? 90 : 140;
}
export function layoutSeed(id: string): { x: number; y: number } {
  let a = 2166136261; let b = 709607;
  for (const c of id) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b ^ c.charCodeAt(0), 48271); }
  return { x: (a >>> 0) / 0xffffffff * 100, y: (b >>> 0) / 0xffffffff * 100 };
}
export function mixColor(a: string, b: string, ratio: number): string {
  const parts = [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - ratio) + parseInt(b.slice(offset, offset + 2), 16) * ratio));
  return `#${parts.map(p => p.toString(16).padStart(2, '0')).join('')}`;
}
