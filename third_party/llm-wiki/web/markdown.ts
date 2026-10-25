/* SPDX-License-Identifier: GPL-3.0-only */
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { WikiPage } from './protocol.js';

export function resolveWikiPage(value: string, pages: readonly WikiPage[]): WikiPage | undefined {
  const slug = value.trim().split('#')[0].replace(/\\/g, '/').replace(/\.md$/i, '');
  const exact = pages.find(page => [page.id, page.path.replace(/\.md$/i, ''), page.title, ...(page.aliases ?? [])].includes(slug));
  if (exact) return exact;
  const folded = slug.toLocaleLowerCase();
  const matches = pages.filter(page => [page.id, page.path.replace(/\.md$/i, ''), page.path.split('/').pop()?.replace(/\.md$/i, '') ?? '', page.title, ...(page.aliases ?? [])]
    .some(alias => alias.toLocaleLowerCase() === folded));
  return matches.length === 1 ? matches[0] : undefined;
}

function linkWikis(content: string, pages: readonly WikiPage[]): string {
  let fence: string | undefined;
  return content.split('\n').map(line => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark) { if (!fence) fence = mark[0]; else if (fence === mark[0]) fence = undefined; return line; }
    if (fence) return line;
    return line.split(/(`+[^`]*`+)/g).map((part, index) => index % 2 ? part : part.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, slug: string, alias?: string) => {
      const page = resolveWikiPage(slug, pages); const label = (alias ?? page?.title ?? slug).replace(/[\[\]\\]/g, '\\$&');
      return page ? `[${label}](#wiki:${encodeURIComponent(page.id)})` : label;
    })).join('');
  }).join('\n');
}

/** All source text, including generated Markdown, is untrusted. No raw HTML capability crosses the frame boundary. */
export function safeMarkdown(content: string, pages: readonly WikiPage[]): string {
  return DOMPurify.sanitize(marked.parse(linkWikis(content, pages), { async: false, gfm: true }), {
    ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'strong', 'em', 'del', 'code', 'pre', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title'], ALLOWED_URI_REGEXP: /^(?:https?:|#)/i,
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, SANITIZE_NAMED_PROPS: true,
  });
}
