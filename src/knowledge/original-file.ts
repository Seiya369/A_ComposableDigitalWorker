import { createHash } from 'node:crypto';
import type { KnowledgeOriginalFile } from './types.js';
import { KNOWLEDGE_UPLOAD_MAX_BYTES } from './upload-limits.js';

/** Original bytes are bounded and integrity checked at storage and read boundaries. */
export function validateOriginalFile(value: unknown): asserts value is KnowledgeOriginalFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid uploaded original file');
  const file = value as Record<string, unknown>;
  if (Object.keys(file).some(key => !['name', 'mediaType', 'encoding', 'data', 'sha256'].includes(key)) ||
    typeof file.name !== 'string' || !file.name.trim() || file.name.length > 240 || /[/\\\x00-\x1f]/.test(file.name) ||
    typeof file.mediaType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.mediaType) ||
    file.encoding !== 'base64' || typeof file.data !== 'string' || !file.data || file.data.length > Math.ceil(KNOWLEDGE_UPLOAD_MAX_BYTES / 3) * 4 ||
    typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid uploaded original file');
  const bytes = Buffer.from(file.data, 'base64');
  if (bytes.length > KNOWLEDGE_UPLOAD_MAX_BYTES || bytes.toString('base64') !== file.data || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Uploaded original file is corrupt or too large');
}

export function originalFileMetadata(file: KnowledgeOriginalFile) {
  return { name: file.name, mediaType: file.mediaType, sha256: file.sha256, bytes: Buffer.from(file.data, 'base64').length };
}
