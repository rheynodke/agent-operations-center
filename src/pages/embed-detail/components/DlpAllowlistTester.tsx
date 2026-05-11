import { useState } from 'react';
import type { Embed } from '@/types/embed';
import { embedApi } from '@/lib/embed-api';
import { Button } from '@/components/ui/button';

interface Match { type: string; text: string; start: number; end: number; }
interface Result { matches: Match[]; redacted: string; warnings: string[]; }

interface Props {
  embed: Embed;
  allowlistDraft: string[];   // current unsaved allowlist patterns (caller passes parsed lines)
}

export default function DlpAllowlistTester({ embed, allowlistDraft }: Props) {
  const [text, setText] = useState('Email me at customer@example.com or call +62 812 3456 7890');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await embedApi.dlpTest(embed.id, text, allowlistDraft);
      setResult(r);
    } catch (e: any) {
      setError(e.message || 'Test failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
                maxLength={10000}
                className="w-full p-2 border border-border rounded bg-background text-sm font-mono" />
      <div className="flex items-center gap-2">
        <Button onClick={run} disabled={loading}>{loading ? 'Testing…' : 'Test against allowlist'}</Button>
        <span className="text-xs text-muted-foreground">{text.length}/10000</span>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      {result && (
        <div className="space-y-2 mt-3">
          {result.warnings.length > 0 && (
            <div className="text-xs text-amber-600">
              {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          <div>
            <div className="text-xs font-medium mb-1">Matches: {result.matches.length}</div>
            {result.matches.length === 0
              ? <div className="text-xs text-muted-foreground">Nothing flagged.</div>
              : <ul className="text-xs space-y-1">
                  {result.matches.map((m, i) => (
                    <li key={i}>
                      <code className="bg-muted px-1 rounded">{m.type}</code>{' '}
                      "{m.text}" <span className="text-muted-foreground">({m.start}–{m.end})</span>
                    </li>
                  ))}
                </ul>}
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Redacted output</div>
            <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{result.redacted}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
