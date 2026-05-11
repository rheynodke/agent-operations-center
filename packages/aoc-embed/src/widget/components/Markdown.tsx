// packages/aoc-embed/src/widget/components/Markdown.tsx
import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre',
  'ul', 'ol', 'li',
  'blockquote',
  'a',
  'h1', 'h2', 'h3', 'h4',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'hr', 'span', 'div',
];
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel'];

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text || '') as string;
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
    });
  }, [text]);

  return (
    <div
      className="aoc-markdown"
      style={{ fontSize: '14px', lineHeight: 1.5, wordBreak: 'break-word' }}
      ref={(el) => {
        if (!el) return;
        // Harden links — force new tab + noopener
        el.querySelectorAll('a[href]').forEach((a) => {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        });
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
