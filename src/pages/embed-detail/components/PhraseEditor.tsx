// src/pages/embed-detail/components/PhraseEditor.tsx
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const MAX = 5;
const MAX_LEN = 80;
const DEFAULTS = [
  'Agent sedang mengetik',
  'Agent sedang menyiapkan jawaban',
  'Agent sedang berpikir',
  'Sebentar lagi...',
];

interface Props {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}

export default function PhraseEditor({ value, onChange }: Props) {
  const using = value ?? DEFAULTS;
  const isCustom = value !== null;

  function update(i: number, text: string) {
    const next = [...using];
    next[i] = text.slice(0, MAX_LEN);
    onChange(next);
  }
  function remove(i: number) {
    const next = using.filter((_, idx) => idx !== i);
    onChange(next.length === 0 ? null : next);
  }
  function add() {
    if (using.length >= MAX) return;
    onChange([...using, '']);
  }
  function reset() { onChange(null); }
  function startCustom() { onChange([...DEFAULTS]); }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Typing indicator phrases</span>
        {isCustom
          ? <Button variant="ghost" size="sm" onClick={reset}>Reset to defaults</Button>
          : <Button variant="outline" size="sm" onClick={startCustom}>Customize</Button>}
      </div>
      {!isCustom && (
        <p className="text-xs text-muted-foreground">Using defaults — phrases rotate every 2.5s.</p>
      )}
      {isCustom && (
        <>
          {using.map((phrase, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input value={phrase}
                     onChange={(e) => update(i, e.target.value)}
                     maxLength={MAX_LEN}
                     placeholder={`Phrase ${i + 1}`} />
              <span className="text-xs text-muted-foreground w-12 shrink-0">{phrase.length}/{MAX_LEN}</span>
              <Button variant="ghost" size="sm" onClick={() => remove(i)} aria-label="Remove">×</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={add} disabled={using.length >= MAX}>
            + Add ({using.length}/{MAX})
          </Button>
        </>
      )}
    </div>
  );
}
