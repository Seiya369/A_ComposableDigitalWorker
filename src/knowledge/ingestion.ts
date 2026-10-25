import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { inflateRawSync } from 'node:zlib';
import { normalizeKnowledgeCategory, type KnowledgeSourceCategory, type KnowledgeUploadFile } from './library-api.js';
import type { KnowledgeInput } from './types.js';

export const KNOWLEDGE_UPLOAD_LIMITS = { maxFileBytes: 6_291_456, maxUploadBytes: 12_582_912, maxFiles: 8, maxReadingBytes: 2_000_000, parseTimeoutMs: 30_000 } as const;
export const KNOWLEDGE_UPLOAD_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.csv', '.yaml', '.yml', '.log', '.pdf', '.docx'] as const;
export interface PreparedKnowledgeUpload { name: string; bytes: Buffer; content: string; category: KnowledgeSourceCategory; hash: string; extraction?: KnowledgeInput['extraction'] }

/** Validate the entire batch before any originals are stored or parsers are started. */
export function prepareKnowledgeUploads(files: unknown): PreparedKnowledgeUpload[] {
  if (!Array.isArray(files) || files.length > KNOWLEDGE_UPLOAD_LIMITS.maxFiles) throw new Error(`一次最多投喂 ${KNOWLEDGE_UPLOAD_LIMITS.maxFiles} 份资料`);
  let total = 0;
  return files.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资料文件格式无效');
    const file = value as KnowledgeUploadFile;
    if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 240 || /[\\/\0\r\n]/.test(file.name)) throw new Error('资料文件名无效');
    const extension = extname(file.name).toLowerCase();
    if (!(KNOWLEDGE_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) throw new Error(`暂不支持此文件格式：${file.name}。支持 PDF、DOCX、UTF-8 文本、Markdown、JSON、CSV、YAML 和日志。`);
    if ((typeof file.content === 'string') === (typeof file.base64 === 'string')) throw new Error('每份资料必须仅提供 content 或 base64');
    if ((extension === '.pdf' || extension === '.docx') && typeof file.base64 !== 'string') throw new Error('PDF 与 DOCX 必须以 base64 提供原始文件');
    let bytes: Buffer;
    if (typeof file.base64 === 'string') {
      if (file.base64.length > Math.ceil(KNOWLEDGE_UPLOAD_LIMITS.maxFileBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error('资料 base64 编码无效或超过大小上限');
      bytes = Buffer.from(file.base64, 'base64');
    } else bytes = Buffer.from(file.content!, 'utf8');
    if (!bytes.length || bytes.length > KNOWLEDGE_UPLOAD_LIMITS.maxFileBytes) throw new Error(`单份资料必须为 1 至 ${KNOWLEDGE_UPLOAD_LIMITS.maxFileBytes} 字节`);
    total += bytes.length;
    if (total > KNOWLEDGE_UPLOAD_LIMITS.maxUploadBytes) throw new Error('本次投喂资料总大小超过 12 MiB 上限');
    let content = '';
    if (extension !== '.pdf' && extension !== '.docx') {
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error(`资料必须是有效的 UTF-8 文本：${file.name}`); }
      if (content.includes('\0')) throw new Error(`资料包含二进制 NUL 字节，请先导出为文本：${file.name}`);
      if (Buffer.byteLength(content) > KNOWLEDGE_UPLOAD_LIMITS.maxReadingBytes) throw new Error('资料阅读文本超过 2 MB 上限，请按章节拆分');
    }
    const category = normalizeKnowledgeCategory(file.category);
    return { name: file.name, bytes, content, category, hash: createHash('sha256').update(bytes).digest('hex') };
  });
}

/** Reject encrypted, ZIP64 and excessive expansion before the DOCX parser inflates XML. */
function checkDocxArchive(bytes: Buffer): void {
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index--) {
    if (bytes.readUInt32LE(index) === 0x06054b50 && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) { end = index; break; }
  }
  if (end < 0) throw new Error('DOCX 不是有效的 ZIP 文档；加密文档暂不支持');
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (!count || count > 2048 || offset + size > end || size === 0xffffffff || offset === 0xffffffff || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw new Error('DOCX 归档大小、分卷或条目数不受支持');
  let cursor = offset; let expanded = 0; let document = false;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > offset + size || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('DOCX 归档索引损坏');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const length = 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if (cursor + length > offset + size || (flags & 1) || ![0, 8].includes(method) || uncompressed > 8_000_000) throw new Error('DOCX 含加密、过大或不支持的压缩条目');
    const local = bytes.readUInt32LE(cursor + 42);
    if (local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('DOCX 文件条目损坏');
    const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (data + compressed > offset) throw new Error('DOCX 压缩条目范围无效');
    try {
      const actualLength = method === 0 ? compressed : inflateRawSync(bytes.subarray(data, data + compressed), { maxOutputLength: 8_000_000 }).byteLength;
      if (actualLength !== uncompressed) throw new Error('DOCX 解压大小与索引不一致');
    } catch { throw new Error('DOCX 压缩条目损坏或解压超过上限'); }
    expanded += uncompressed;
    if (expanded > 32_000_000) throw new Error('DOCX 解压文本超过处理上限');
    if (bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8') === 'word/document.xml') document = true;
    cursor += length;
  }
  if (!document) throw new Error('DOCX 缺少主文档正文');
}

const PARSER_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const bytes = Buffer.from(workerData.bytes);
  if (workerData.format === 'pdf') {
    const { PDFParse } = require(workerData.modulePath);
    const parser = new PDFParse({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false });
    try {
      const info = await parser.getInfo();
      if (info.total > 300) throw new Error('PDF 超过 300 页处理上限，请按章节拆分');
      const result = await parser.getText();
      const pages = result.pages || [];
      if (!pages.some(page => page.text && page.text.trim())) throw new Error('PDF 没有可提取文字；扫描件需要先 OCR，本插件不会伪造识别结果');
      const text = pages.map(page => '[PDF page ' + page.num + ']\n' + page.text).join('\n\n');
      if (Buffer.byteLength(text) > workerData.maxReadingBytes) throw new Error('PDF 阅读文本超过 2 MB 上限，请按章节拆分');
      parentPort.postMessage({ text, pageCount: info.total, warnings: [] });
    } finally { await parser.destroy(); }
  } else {
    const mammoth = require(workerData.modulePath);
    const result = await mammoth.extractRawText({ buffer: bytes });
    if (!result.value.trim()) throw new Error('DOCX 没有可提取正文；图片文字需要先 OCR');
    if (Buffer.byteLength(result.value) > workerData.maxReadingBytes) throw new Error('DOCX 阅读文本超过 2 MB 上限，请按章节拆分');
    parentPort.postMessage({ text: result.value, warnings: result.messages.map(message => message.type + ': ' + String(message.message).slice(0, 400)).slice(0, 20) });
  }
})().catch(error => parentPort.postMessage({ error: error && error.message ? error.message : String(error) }));
`;

/** Isolated bounded parsing owns no sessions, tools or project writes. Workers always terminate. */
export async function extractKnowledgeUpload(file: PreparedKnowledgeUpload, signal?: AbortSignal): Promise<PreparedKnowledgeUpload> {
  signal?.throwIfAborted();
  const extension = extname(file.name).toLowerCase();
  if (extension !== '.pdf' && extension !== '.docx') return file;
  if (extension === '.pdf' && !file.bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('PDF 文件头无效');
  if (extension === '.docx') checkDocxArchive(file.bytes);
  const format = extension === '.pdf' ? 'pdf' : 'docx';
  const parser = format === 'pdf' ? 'pdf-parse@2.4.5' : 'mammoth@1.13.0';
  let modulePath: string;
  try { modulePath = createRequire(import.meta.url).resolve(format === 'pdf' ? 'pdf-parse' : 'mammoth'); }
  catch { throw new Error(`${format.toUpperCase()} 解析器未安装，请检查插件依赖`); }
  const worker = new Worker(PARSER_WORKER, { eval: true, workerData: { format, modulePath, bytes: file.bytes, maxReadingBytes: KNOWLEDGE_UPLOAD_LIMITS.maxReadingBytes }, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const result = await new Promise<{ text: string; warnings: string[]; pageCount?: number }>((resolve, reject) => {
      abort = () => reject(signal?.reason ?? new Error('文档解析已取消'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      timer = setTimeout(() => reject(new Error(`${format.toUpperCase()} 解析超过 30 秒上限，已停止`)), KNOWLEDGE_UPLOAD_LIMITS.parseTimeoutMs);
      worker.once('message', value => value.error ? reject(new Error(`${format.toUpperCase()} 解析失败：${value.error}`)) : resolve(value));
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error(`${format.toUpperCase()} 解析进程提前结束 (${code})`)));
    });
    if (typeof result.text !== 'string' || !result.text.trim() || Buffer.byteLength(result.text) > KNOWLEDGE_UPLOAD_LIMITS.maxReadingBytes) throw new Error('文档未返回有效的有界正文');
    return { ...file, content: result.text, extraction: { format, parser, warnings: result.warnings, ...(result.pageCount === undefined ? {} : { pageCount: result.pageCount }) } };
  } finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); await worker.terminate(); }
}
