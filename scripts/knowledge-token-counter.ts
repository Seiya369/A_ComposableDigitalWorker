import { get_encoding } from 'tiktoken';
import type { ContextCounter } from '../src/knowledge/context.js';

/** Evaluation-only: this encoding is not asserted to match an employee's model. */
export const REFERENCE_TOKEN_COUNT_MODE = 'tiktoken:o200k_base:reference';
export const TOKEN_COUNTER_METADATA = Object.freeze({
  implementation: 'tiktoken-wasm', version: '1.0.22', encoding: 'o200k_base',
  modelCompatibility: 'reference-only', exactForEncoding: true, targetModelExact: false,
  countedScope: 'complete serialized knowledge envelope',
});

const encoding = get_encoding('o200k_base');
const cache = new Map<string, { count: number; bytes: number }>();
let cachedBytes = 0;
const maxCacheBytes = 16 * 1024 * 1024;

export const referenceTokenCounter: ContextCounter = serialized => {
  const previous = cache.get(serialized);
  if (previous) return previous.count;
  // Source text that resembles special tokens is ordinary untrusted text.
  const count = encoding.encode(serialized, [], []).length;
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= maxCacheBytes) {
    while (cache.size >= 128 || cachedBytes + bytes > maxCacheBytes) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cachedBytes -= cache.get(oldest)!.bytes;
      cache.delete(oldest);
    }
    cache.set(serialized, { count, bytes });
    cachedBytes += bytes;
  }
  return count;
};
