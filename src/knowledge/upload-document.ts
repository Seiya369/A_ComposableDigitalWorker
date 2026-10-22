import { createHash } from 'node:crypto';
import { dirname, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { Inflate } from 'fflate';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import type { KnowledgeUploadFile, KnowledgeUploadedDocument } from './types.js';
import { KNOWLEDGE_UPLOAD_MAX_BYTES } from './upload-limits.js';

export type UploadedDocumentFile = KnowledgeUploadFile;
export type ParsedUploadedDocument = KnowledgeUploadedDocument;

const MiB = 1_048_576;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WORD = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const textExtensions = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.log', '.xml', '.html', '.htm', '.css', '.scss', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.sh', '.bash', '.zsh', '.sql', '.toml', '.ini', '.cfg', '.conf', '.c', '.h', '.cpp', '.hpp', '.java', '.go', '.rs', '.rb', '.php', '.r', '.swift', '.kt', '.vue', '.svelte']);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function utf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('文件必须为有效 UTF-8 文本'); }
}
function readable(content: string): string {
  check(Buffer.byteLength(content) <= MiB, '提取文本超过 1 MiB 大小限制');
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uFFFD]/u.test(content), '文件包含不可读或损坏的文本');
  check(/[\p{L}\p{N}\p{P}\p{S}]/u.test(content), '文件为空或没有可读取的文字');
  return content;
}
function xml(source: Uint8Array, open: (tag: SaxesTagNS) => void, close?: (tag: SaxesTagNS) => void, text?: (value: string) => void): void {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new Error('DOCX 不允许 DTD 或自定义实体'); });
  parser.on('processinginstruction', () => { throw new Error('DOCX 不允许 XML 处理指令'); });
  parser.on('error', () => { throw new Error('DOCX XML 无效或包含未支持的实体'); });
  parser.on('opentag', open);
  if (close) parser.on('closetag', close);
  if (text) { parser.on('text', text); parser.on('cdata', text); }
  parser.write(utf8(source)).close();
}

interface ZipEntry { name: string; offset: number; size: number; originalSize: number; compression: number; crc: number }
/** Read ZIP metadata before expanding anything; no archive entry is ever written to disk. */
function zipEntries(bytes: Buffer): ZipEntry[] {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  check(end >= 0 && end + 22 <= bytes.length && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length, 'DOCX ZIP 目录无效');
  check(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0, '不支持分卷 DOCX ZIP');
  const count = bytes.readUInt16LE(end + 10);
  check(count > 0 && count <= 256 && bytes.readUInt16LE(end + 8) === count, 'DOCX ZIP 文件数量超过上限');
  const central = bytes.readUInt32LE(end + 16);
  check(central + bytes.readUInt32LE(end + 12) === end, 'DOCX ZIP 目录大小无效');
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let position = central, total = 0;
  for (let i = 0; i < count; i++) {
    check(position + 46 <= end && bytes.readUInt32LE(position) === 0x02014b50, 'DOCX ZIP 目录项无效');
    const flags = bytes.readUInt16LE(position + 8), compression = bytes.readUInt16LE(position + 10);
    check(!(flags & (1 | 64)) && (compression === 0 || compression === 8), '不支持加密或此压缩方式的 DOCX ZIP');
    const size = bytes.readUInt32LE(position + 20), originalSize = bytes.readUInt32LE(position + 24);
    const nameLength = bytes.readUInt16LE(position + 28), extraLength = bytes.readUInt16LE(position + 30), commentLength = bytes.readUInt16LE(position + 32);
    const next = position + 46 + nameLength + extraLength + commentLength;
    check(next <= end && bytes.readUInt16LE(position + 34) === 0, 'DOCX ZIP 目录项越界');
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength), name = utf8(nameBytes);
    check(name.length > 0 && name.length <= 255 && !/[\\\u0000]/u.test(name) && !name.startsWith('/') && !/^[a-z]:/i.test(name) && !name.split('/').includes('..'), 'DOCX ZIP 路径无效');
    check(!names.has(name), 'DOCX ZIP 包含重复文件'); names.add(name);
    total += originalSize;
    check(originalSize <= 4 * MiB && total <= 8 * MiB && size <= bytes.length, 'DOCX ZIP 解压大小超过上限');
    const local = bytes.readUInt32LE(position + 42);
    check(local + 30 <= central && bytes.readUInt32LE(local) === 0x04034b50, 'DOCX ZIP 文件头无效');
    check(bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === compression, 'DOCX ZIP 文件头与目录不一致');
    const localNameLength = bytes.readUInt16LE(local + 26), localExtraLength = bytes.readUInt16LE(local + 28);
    const offset = local + 30 + localNameLength + localExtraLength;
    check(offset + size <= central && bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes), 'DOCX ZIP 文件路径或大小不一致');
    entries.push({ name, offset, size, originalSize, compression, crc: bytes.readUInt32LE(position + 16) });
    position = next;
  }
  check(position === end, 'DOCX ZIP 目录含有未识别内容');
  const regions = entries.map(entry => [entry.offset, entry.offset + entry.size]).sort((a, b) => a[0]! - b[0]!);
  for (let i = 1; i < regions.length; i++) check(regions[i]![0]! >= regions[i - 1]![1]!, 'DOCX ZIP 文件区域重叠');
  return entries;
}

function docxText(bytes: Buffer): string {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of zipEntries(bytes)) {
    let size = 0, checksum = 0;
    const chunks: Uint8Array[] = [];
    const keep = entry.name === 'word/document.xml' || entry.name === '[Content_Types].xml' || entry.name.endsWith('.rels');
    const receive = (chunk: Uint8Array) => {
      size += chunk.length; total += chunk.length;
      check(size <= 4 * MiB && total <= 8 * MiB && size <= entry.originalSize, 'DOCX ZIP 实际解压大小超过上限');
      checksum = crc32(chunk, checksum);
      if (keep) chunks.push(chunk.slice());
    };
    const compressed = bytes.subarray(entry.offset, entry.offset + entry.size);
    if (entry.compression === 0) receive(compressed);
    else {
      const inflater = new Inflate(receive);
      // Small compressed chunks bound transient expansion before the actual-size guard runs.
      if (!compressed.length) inflater.push(new Uint8Array(), true);
      for (let i = 0; i < compressed.length; i += 256) inflater.push(compressed.subarray(i, i + 256), i + 256 >= compressed.length);
    }
    check(size === entry.originalSize && checksum === entry.crc, 'DOCX ZIP 数据大小或校验不一致');
    if (keep) files.set(entry.name, Buffer.concat(chunks));
  }
  const document = files.get('word/document.xml'), contentTypes = files.get('[Content_Types].xml');
  check(document && contentTypes && files.has('_rels/.rels'), 'DOCX ZIP 缺少主文档或类型声明');
  let validType = false;
  xml(contentTypes, tag => {
    if (tag.uri === CONTENT_TYPES && tag.local === 'Override' && tag.attributes.PartName?.value === '/word/document.xml') {
      validType = tag.attributes.ContentType?.value === `${DOCX}.main+xml`;
    }
  });
  check(validType, 'DOCX 主文档类型无效，不支持宏或旧 Word 格式');
  // Validate relationship XML, but never resolve targets. Hyperlink labels remain ordinary w:t text.
  for (const [name, value] of files) if (name.endsWith('.rels')) xml(value, () => {});
  let depth = 0, bodyDepth = 0, paragraphDepth = 0, paragraphNumber = 0, textDepth = 0, ignored = 0, hasDocument = false;
  let paragraph = '', content = '', byteCount = 0;
  const append = (text: string) => { byteCount += Buffer.byteLength(text); check(byteCount <= MiB, '提取文本超过 1 MiB 大小限制'); paragraph += text; };
  xml(document, tag => {
    depth++;
    if (depth === 1) { hasDocument = WORD.has(tag.uri) && tag.local === 'document'; check(hasDocument, 'DOCX XML 根节点无效'); }
    if (!WORD.has(tag.uri)) return;
    if (tag.local === 'body') bodyDepth = depth;
    if (!bodyDepth) return;
    if (tag.local === 'del' || tag.local === 'moveFrom') ignored++;
    if (ignored) return;
    if (tag.local === 'p') { check(!paragraphDepth, 'DOCX 不支持嵌套段落'); paragraphDepth = depth; paragraphNumber++; paragraph = ''; }
    if (!paragraphDepth) return;
    if (tag.local === 't') textDepth = depth;
    if (tag.local === 'tab') append('\t');
    if (tag.local === 'br' || tag.local === 'cr') append('\n');
  }, tag => {
    if (WORD.has(tag.uri)) {
      if (depth === textDepth) textDepth = 0;
      if (depth === paragraphDepth) { if (paragraph.trim()) content += `[DOCX paragraph ${paragraphNumber}]\n${paragraph}\n\n`; paragraphDepth = 0; }
      if ((tag.local === 'del' || tag.local === 'moveFrom') && ignored) ignored--;
      if (depth === bodyDepth) bodyDepth = 0;
    }
    depth--;
  }, text => { if (textDepth && !ignored) append(text); });
  check(hasDocument, 'DOCX XML 缺少文档根节点');
  return readable(content.trimEnd());
}

async function pdfText(bytes: Buffer): Promise<{ content: string; parser: string }> {
  check(bytes.subarray(0, 5).toString('ascii') === '%PDF-', 'PDF 文件格式无效');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), useWorkerFetch: false, useSystemFonts: false,
    disableFontFace: true, useWasm: false, enableXfa: false, stopAtErrors: true, verbosity: 0,
    cMapUrl: join(root, 'cmaps') + sep, cMapPacked: true, standardFontDataUrl: join(root, 'standard_fonts') + sep,
  });
  try {
    const document = await task.promise;
    const { info } = await document.getMetadata();
    check((info as { EncryptFilterName?: unknown }).EncryptFilterName == null, '不支持加密 PDF，请提供未加密原件');
    check(document.numPages > 0 && document.numPages <= 200, 'PDF 页数超过 200 页上限');
    let content = '', byteCount = 0, hasText = false;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const reader = page.streamTextContent({ disableNormalization: true }).getReader();
      let text = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const item of value.items) if ('str' in item) {
            const piece = item.str + (item.hasEOL ? '\n' : ' ');
            byteCount += Buffer.byteLength(piece);
            check(byteCount <= MiB, '提取文本超过 1 MiB 大小限制');
            text += piece;
            if (/[\p{L}\p{N}\p{P}\p{S}]/u.test(item.str)) hasText = true;
          }
        }
      } finally { void reader.cancel(new Error('PDF text extraction finished')).catch(() => undefined); reader.releaseLock(); page.cleanup(); }
      content += `[PDF page ${pageNumber}]\n${text.trim()}\n\n`;
    }
    check(hasText, 'PDF 没有可读取文字；扫描资料需要先提供 OCR 文本');
    return { content: readable(content.trimEnd()), parser: `pdfjs-dist@${pdfjs.version}/text-v1` };
  } catch (error) {
    if ((error as Error).name === 'PasswordException') throw new Error('不支持加密 PDF，请提供未加密原件');
    throw error;
  } finally { await task.destroy(); }
}

/** Human-selected bytes only: no paths, URLs, filesystem extraction or source instructions are executed. */
export async function parseUploadedDocument(file: UploadedDocumentFile): Promise<ParsedUploadedDocument> {
  check(file && typeof file === 'object', '上传文件无效');
  check(typeof file.name === 'string' && file.name.trim().length > 0 && Buffer.byteLength(file.name) <= 240 && !/[\\/\u0000-\u001f\u007f]/u.test(file.name) && !/^[a-z]:/i.test(file.name) && file.name !== '.' && file.name !== '..', '文件名无效，不能包含路径');
  check(typeof file.base64 === 'string' && file.base64.length > 0 && file.base64.length <= 4 * Math.ceil(KNOWLEDGE_UPLOAD_MAX_BYTES / 3), '原件为空或超过 1 MiB 大小限制');
  check(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64), '文件必须使用规范 base64 编码');
  const bytes = Buffer.from(file.base64, 'base64');
  check(bytes.length > 0 && bytes.length <= KNOWLEDGE_UPLOAD_MAX_BYTES, '原件为空或超过 1 MiB 大小限制');
  check(bytes.toString('base64') === file.base64, '文件必须使用规范 base64 编码');
  const extension = extname(file.name).toLowerCase();
  const kind = extension === '.pdf' ? 'pdf' : extension === '.docx' ? 'docx' : textExtensions.has(extension) || ['readme', 'license', 'makefile', 'dockerfile', '.gitignore', '.editorconfig'].includes(file.name.toLowerCase()) ? 'text' : undefined;
  check(kind, '不支持此文件格式；请上传 PDF、DOCX 或 UTF-8 文本');
  check(file.mediaType === undefined || typeof file.mediaType === 'string' && file.mediaType.length <= 160, '文件媒体类型无效');
  const declared = file.mediaType?.split(';')[0]?.trim().toLowerCase();
  const type = kind === 'pdf' ? 'application/pdf' : kind === 'docx' ? DOCX : extension === '.md' || extension === '.markdown' ? 'text/markdown' : extension === '.csv' ? 'text/csv' : extension === '.json' ? 'application/json' : 'text/plain';
  const textType = declared?.startsWith('text/') || ['application/json', 'application/ld+json', 'application/xml', 'application/yaml', 'application/x-yaml', 'application/javascript', 'application/sql'].includes(declared ?? '');
  check(!declared || declared === 'application/octet-stream' || (kind === 'text' ? textType : declared === type), '文件媒体类型与格式不符');
  const parsed = kind === 'pdf' ? await pdfText(bytes) : { content: kind === 'docx' ? docxText(bytes) : readable(utf8(bytes)), parser: kind === 'docx' ? 'docx/fflate@0.8.3+saxes@6.0.0/paragraphs-v1' : 'utf8/v1' };
  return { name: file.name, mediaType: type, ...parsed, originalFile: { name: file.name, mediaType: type, encoding: 'base64', data: file.base64, sha256: createHash('sha256').update(bytes).digest('hex') } };
}
