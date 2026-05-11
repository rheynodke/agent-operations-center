import { useState } from 'react';

export default function SnippetCodeBlock({ title, code, language }: { title: string; code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <button onClick={copy} className="text-xs text-primary">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
        <code className={`language-${language || ''}`}>{code}</code>
      </pre>
    </div>
  );
}
