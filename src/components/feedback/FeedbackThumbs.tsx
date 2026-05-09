import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useFeedbackStore } from '@/stores/useFeedbackStore';
import { cn } from '@/lib/utils';

interface Props {
  messageId: string;
  sessionId: string;
  agentId: string;
  /** When true, render the small reason input on first 👎 click. */
  collectReason?: boolean;
  className?: string;
}

export function FeedbackThumbs({
  messageId, sessionId, agentId, collectReason = true, className,
}: Props) {
  const current = useFeedbackStore((s) => s.getDashboardRating(messageId));
  const recordRating = useFeedbackStore((s) => s.recordRating);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (rating: 'positive' | 'negative', reason?: string) => {
    setSubmitting(true);
    try {
      await recordRating({ messageId, sessionId, agentId, rating, reason });
    } catch (err) {
      // Optimistic update already reverted by the store; surface to console.
      console.error('[FeedbackThumbs] failed to record rating:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const onUp = () => {
    setReasonOpen(false);
    void submit('positive');
  };
  const onDown = () => {
    if (collectReason && current !== 'negative') {
      setReasonOpen(true);
      return;
    }
    void submit('negative');
  };
  const onSubmitReason = () => {
    setReasonOpen(false);
    const r = reasonText.trim().slice(0, 200);
    setReasonText('');
    void submit('negative', r || undefined);
  };

  return (
    <div className={cn('inline-flex items-center gap-0.5 text-muted-foreground', className)}>
      <button
        type="button"
        onClick={onUp}
        disabled={submitting}
        aria-label="Mark this reply as good"
        title="Mark as good"
        className={cn(
          'rounded p-1 hover:bg-foreground/10 hover:text-foreground transition-colors',
          current === 'positive' && 'text-green-600 bg-green-500/10 hover:bg-green-500/15',
          submitting && 'opacity-50',
        )}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={submitting}
        aria-label="Mark this reply as wrong or unhelpful"
        title="Mark as wrong"
        className={cn(
          'rounded p-1 hover:bg-foreground/10 hover:text-foreground transition-colors',
          current === 'negative' && 'text-red-600 bg-red-500/10 hover:bg-red-500/15',
          submitting && 'opacity-50',
        )}
      >
        <ThumbsDown className="size-3.5" />
      </button>
      {reasonOpen && (
        <div className="ml-2 flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            placeholder="Why? (optional)"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value.slice(0, 200))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitReason();
              if (e.key === 'Escape') { setReasonOpen(false); setReasonText(''); }
            }}
            className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground/90 outline-none focus:border-foreground/30 w-48"
          />
          <button
            type="button"
            onClick={onSubmitReason}
            className="text-xs px-2 py-1 rounded bg-foreground/10 hover:bg-foreground/15 text-foreground"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
