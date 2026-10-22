import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { parseUploadedDocument } from '../src/knowledge/upload-document.js';

const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relationNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const upload = (name: string, bytes: Uint8Array | string, mediaType?: string) => ({ name, ...(mediaType ? { mediaType } : {}), base64: Buffer.from(bytes).toString('base64') });

/** Small valid documents are generated locally so the fixtures contain no user material. */
function docx(body: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8(`<Relationships xmlns="${relationNamespace}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${wordNamespace}"><w:body>${body}</w:body></w:document>`),
    ...extra,
  });
}

function pdf(pages: string[], trailer = '', compressed = false): Uint8Array {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const text of pages) {
    const raw = text ? (text.match(/.{1,60}/g) ?? []).map(line => `BT /F1 12 Tf 50 750 Td (${line.replace(/[\\()]/g, '\\$&')}) Tj ET`).join('\n') : '0 0 10 10 re S';
    const stream = compressed ? deflateSync(Buffer.from(raw)).toString('latin1') : raw;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`, `<< /Length ${Buffer.byteLength(stream, 'latin1')}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n${stream}\nendstream`);
  }
  let value = '%PDF-1.7\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(value, 'latin1')); value += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(value, 'latin1');
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(value, 'latin1');
}

test('UTF-8 upload preserves BOM, line endings and every original byte', async () => {
  const bytes = Buffer.from('\uFEFF岗位资料\r\n保留否定、单位和例外。\r\n');
  const result = await parseUploadedDocument(upload('专业说明.md', bytes, 'text/markdown'));
  assert.equal(result.content, bytes.toString('utf8'));
  assert.equal(result.mediaType, 'text/markdown');
  assert.match(result.parser, /utf8/);
  assert.deepEqual(Buffer.from(result.originalFile.data, 'base64'), bytes);
  assert.equal(result.originalFile.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.originalFile.encoding, 'base64');
  assert.equal(result.originalFile.name, '专业说明.md');
});

test('common UTF-8 source and structured text files are accepted as text', async () => {
  for (const name of ['config.json', 'policy.yaml', 'report.csv', 'task.log', 'example.ts', 'README', 'worker.py']) {
    const result = await parseUploadedDocument(upload(name, '中文 and ASCII\n{}'));
    assert.equal(result.content, '中文 and ASCII\n{}');
  }
});

test('PDF upload extracts each page separately and retains the real PDF', async () => {
  const bytes = pdf(['Approved means reviewed.', 'A failed attempt is evidence, not approval.']);
  const result = await parseUploadedDocument(upload('reference.pdf', bytes, 'application/pdf'));
  assert.match(result.content, /\[PDF page 1\]\nApproved means reviewed\./);
  assert.match(result.content, /\[PDF page 2\]\nA failed attempt is evidence, not approval\./);
  assert.match(result.parser, /pdfjs-dist@/);
  assert.deepEqual(Buffer.from(result.originalFile.data, 'base64'), Buffer.from(bytes));
});

test('DOCX upload preserves paragraphs, split runs, tabs, line breaks and table text', async () => {
  const bytes = docx('<w:p><w:r><w:t>职责：</w:t></w:r><w:r><w:t>复核依据</w:t><w:tab/><w:t>再批准</w:t><w:br/><w:t>保留例外。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表内约束</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
  const result = await parseUploadedDocument(upload('岗位.docx', bytes));
  assert.match(result.content, /\[DOCX paragraph 1\]\n职责：复核依据\t再批准\n保留例外。/);
  assert.match(result.content, /\[DOCX paragraph 2\]\n表内约束/);
  assert.equal(result.mediaType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual(Buffer.from(result.originalFile.data, 'base64'), Buffer.from(bytes));
});

test('file labels cannot supply a filesystem path or an unsupported format', async () => {
  for (const name of ['../secret.txt', '/etc/secret.txt', 'C:\\secret.txt', 'nested/file.txt', 'bad\0.txt', '', 'legacy.doc', 'macro.docm', 'binary.exe']) {
    await assert.rejects(parseUploadedDocument(upload(name, 'readable text')), /文件名|格式/);
  }
  await assert.rejects(parseUploadedDocument(upload('claim.pdf', 'plain text', 'application/pdf')), /PDF|格式/);
  await assert.rejects(parseUploadedDocument(upload('claim.txt', 'plain text', 'application/pdf')), /类型|格式/);
});

test('base64 encoding must be canonical and the original cannot exceed one MiB', async () => {
  for (const base64 of ['Zg', 'Zh==', 'Zg==\n', 'data:text/plain;base64,Zg==', '!!!!', '']) {
    await assert.rejects(parseUploadedDocument({ name: 'file.txt', base64 }), /base64|空/);
  }
  await assert.rejects(parseUploadedDocument(upload('large.txt', Buffer.alloc(1_048_577, 65))), /1 MiB|大小/);
  assert.equal((await parseUploadedDocument(upload('boundary.txt', Buffer.alloc(1_048_576, 65)))).content.length, 1_048_576);
});

test('unreadable, empty and non-UTF-8 text is rejected instead of silently repaired', async () => {
  for (const bytes of [Buffer.from([0xff, 0xfe, 0x41, 0]), Buffer.from([0xc3, 0x28]), Buffer.from('x\0y'), Buffer.from(' \r\n\t'), Buffer.from('broken\uFFFDtext')]) {
    await assert.rejects(parseUploadedDocument(upload('file.txt', bytes)), /UTF-8|文本|空|可读/);
  }
});

test('scanned or blank PDFs and empty DOCX documents cannot masquerade as readable material', async () => {
  await assert.rejects(parseUploadedDocument(upload('scan.pdf', pdf(['']))), /文字|文本|OCR/);
  await assert.rejects(parseUploadedDocument(upload('empty.docx', docx('<w:p/>'))), /文字|文本|空/);
});

test('DOCX rejects DTDs, custom entities and malformed XML', async () => {
  const validBody = '<w:p><w:r><w:t>Safe paragraph</w:t></w:r></w:p>';
  const files = [
    docx(validBody, { 'word/document.xml': strToU8(`<!DOCTYPE w:document [<!ENTITY leak SYSTEM "https://example.invalid/private">]><w:document xmlns:w="${wordNamespace}"><w:body><w:p><w:r><w:t>&leak;</w:t></w:r></w:p></w:body></w:document>`) }),
    docx(validBody, { 'word/_rels/document.xml.rels': strToU8(`<!DOCTYPE Relationships SYSTEM "https://example.invalid/relations.dtd"><Relationships xmlns="${relationNamespace}"/>`) }),
    docx(validBody, { 'word/document.xml': strToU8(`<w:document xmlns:w="${wordNamespace}"><w:body><w:p>broken</w:body></w:document>`) }),
  ];
  for (const bytes of files) await assert.rejects(parseUploadedDocument(upload('unsafe.docx', bytes)), /DTD|实体|XML/);
});

test('DOCX keeps hyperlink labels without embedding or fetching external targets', async t => {
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalls++; throw new Error('External fetching is forbidden during extraction'); });
  const target = 'https://example.invalid/private-reference';
  const bytes = docx('<w:p><w:r><w:t>普通正文：先核对</w:t></w:r><w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="reference"><w:r><w:t>供应商文档</w:t></w:r></w:hyperlink><w:r><w:t>的适用版本。</w:t></w:r></w:p>', {
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${relationNamespace}"><Relationship Id="reference" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/></Relationships>`),
  });
  const result = await parseUploadedDocument(upload('linked-reference.docx', bytes));
  assert.match(result.content, /普通正文：先核对供应商文档的适用版本。/);
  assert.ok(!result.content.includes(target));
  assert.equal(fetchCalls, 0);
  assert.deepEqual(Buffer.from(result.originalFile.data, 'base64'), Buffer.from(bytes));
});

test('DOCX rejects unsafe archive paths, excessive file counts and decompression expansion', async () => {
  const body = '<w:p><w:r><w:t>Safe text</w:t></w:r></w:p>';
  const entries = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`word/unused-${i}.xml`, strToU8('<x/>')]));
  for (const bytes of [docx(body, { '../escape.xml': strToU8('<x/>') }), docx(body, entries), docx(body, { 'word/document.xml': strToU8(`<w:document xmlns:w="${wordNamespace}"><w:body>${' '.repeat(4_194_305)}</w:body></w:document>`) })]) {
    await assert.rejects(parseUploadedDocument(upload('unsafe.docx', bytes)), /ZIP|解压|路径|数量|大小/);
  }
});

test('compressed documents cannot bypass the extracted-text limit and PDFs have a page limit', async () => {
  await assert.rejects(parseUploadedDocument(upload('expanded.docx', docx(`<w:p><w:r><w:t>${'资料'.repeat(175_000)}</w:t></w:r></w:p>`))), /1 MiB|文本.*大小/);
  await assert.rejects(parseUploadedDocument(upload('expanded.pdf', pdf(['evidence '.repeat(120_000)], '', true))), /1 MiB|文本.*大小/);
  await assert.rejects(parseUploadedDocument(upload('many-pages.pdf', pdf(Array.from({ length: 201 }, () => 'Evidence.')))), /200|页数/);
});

test('DOCX ZIP sizes and CRCs are checked against the actual expanded data', async () => {
  const original = Buffer.from(docx('<w:p><w:r><w:t>Original evidence.</w:t></w:r></w:p>'));
  const central = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const wrongSize = Buffer.from(original);
  wrongSize.writeUInt32LE(1, central + 24);
  await assert.rejects(parseUploadedDocument(upload('size.docx', wrongSize)), /ZIP.*大小/);
  const wrongChecksum = Buffer.from(original);
  wrongChecksum.writeUInt32LE(0, central + 16);
  await assert.rejects(parseUploadedDocument(upload('checksum.docx', wrongChecksum)), /ZIP.*校验/);
});

// Synthetic blank pages encrypted with pypdf 6.1.3, including an empty user password.
test('encrypted PDFs are rejected even if their user password is empty', async () => {
  const documents = ["JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGNkOWY4YmRkYmI+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAxCi9SIDIKL0xlbmd0aCA0MAovUCA0Mjk0OTY3MjkyCi9GaWx0ZXIgL1N0YW5kYXJkCi9PIDxiODA4ZWVjMWFmNGY1MDVkMjM2NTA0ZjYwOTdlMmNiOTNjYWI5NGVhOGI2MmVkN2FjZjYxNjI1OTNkZjkyZGJlPgovVSA8NDE1NDA5ZDE1NWU5MDgzMDQxZjFmNjk0NzBkODAxMTFkZjc4ZWU0NTlmN2M5MWFmZTNkMDlkNjlmMDEwOWYyNz4KPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDU5IDAwMDAwIG4gCjAwMDAwMDAxMTggMDAwMDAgbiAKMDAwMDAwMDE2NyAwMDAwMCBuIAowMDAwMDAwMjYxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgovSUQgWyA8MzUzOTYzMzIzMDYyNjI2MTY1NjMzODMyNjUzMTYyMzU2MzM2MzM2MzYxNjI2NTY2MzU2MTY2NjE2NTY2MzEzMT4gPDM1Mzk2MzMyMzA2MjYyNjE2NTYzMzgzMjY1MzE2MjM1NjMzNjMzNjM2MTYyNjU2NjM1NjE2NjYxNjU2NjMxMzE+IF0KL0VuY3J5cHQgNSAwIFIKPj4Kc3RhcnR4cmVmCjQ3NQolJUVPRgo=", "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDZiODRmYWUxYjA+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAxCi9SIDIKL0xlbmd0aCA0MAovUCA0Mjk0OTY3MjkyCi9GaWx0ZXIgL1N0YW5kYXJkCi9PIDxmNmRlZDhlYjk0NDhiZjMxMzcwNDM5ZDM4MWViNWZkNTNhM2FkYTAyMTU3ZjU5YmI4NDZkODVmMWE2NTA0NWNjPgovVSA8OGE0MGE4NTZiY2I2MDkxMGIwZjdmZTBmN2Q2MzY3OTc0MzdhYzFjZTYzMzZkMWM4ZDJiZDc4MDQzYzg1NGI1Mz4KPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDU5IDAwMDAwIG4gCjAwMDAwMDAxMTggMDAwMDAgbiAKMDAwMDAwMDE2NyAwMDAwMCBuIAowMDAwMDAwMjYxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgovSUQgWyA8MzUzOTYzMzIzMDYyNjI2MTY1NjMzODMyNjUzMTYyMzU2MzM2MzM2MzYxNjI2NTY2MzU2MTY2NjE2NTY2MzEzMT4gPDM1Mzk2MzMyMzA2MjYyNjE2NTYzMzgzMjY1MzE2MjM1NjMzNjMzNjM2MTYyNjU2NjM1NjE2NjYxNjU2NjMxMzE+IF0KL0VuY3J5cHQgNSAwIFIKPj4Kc3RhcnR4cmVmCjQ3NQolJUVPRgo="];
  for (const base64 of documents) await assert.rejects(parseUploadedDocument({ name: 'encrypted.pdf', base64 }), /加密 PDF/);
});
