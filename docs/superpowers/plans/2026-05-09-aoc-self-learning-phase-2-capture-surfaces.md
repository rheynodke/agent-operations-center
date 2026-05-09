# AOC Self-Learning — Phase 2 (Capture Surfaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the user-facing capture surfaces of the satisfaction pipeline. After Phase 2, users can rate any agent reply via 👍/👎 buttons in the AOC dashboard chat (floating pill, mission room, agent detail) AND react with native emojis in Telegram + Discord — all flowing into the `message_ratings` table established in Phase 1.

**Architecture:** Phase 1 already built the backend (`POST /api/feedback/message`, `POST /api/feedback/channel-reaction`, DB accessor, reflection service). Phase 2 wires the inputs:
- **Frontend:** small `<FeedbackThumbs>` React component that mounts on each assistant message in existing `ChatMessage.tsx`. Optimistic UI, last-write-wins flip, calls existing REST endpoint.
- **OpenClaw fork:** define a new `channel_reaction` plugin hook event type + runner. Telegram's existing `bot.on("message_reaction")` handler and Discord's `MessageReactionAddListener`/`RemoveListener` (both already wired in OpenClaw 2026.4.15 and authorized via `reactionNotifications` config) get one extra line each — fire the new hook with normalized payload.
- **OpenClaw extension:** a tiny new `extensions/aoc-webhook/` plugin listens to the `channel_reaction` hook and POSTs the event to AOC's `POST /api/feedback/channel-reaction` (already gated to service token).

WhatsApp is **out of scope** for Phase 2 — its adapter currently drops reactions silently and needs ~80-120 LOC of new code in `extensions/whatsapp/src/inbound/monitor.ts`. That lands in Phase 3.

**Tech Stack:** React 19 + Tailwind v4 (semantic tokens) + Zustand (state) for the dashboard; TypeScript + grammy/carbon SDKs (already in OpenClaw) for the channel adapter wiring. Existing `request<T>()` helper in `src/lib/api.ts` for REST calls with auth + scope.

**Out of scope for Phase 2** (deferred to Phase 5): real-time WebSocket events broadcasting `feedback:rating-updated`, drill-down navigation from flagged messages, audit-log integration.

---

## File Structure

**New files (Phase 2):**

| Path | Responsibility |
|---|---|
| `src/components/feedback/FeedbackThumbs.tsx` | Shared 👍/👎 button component for any messageId |
| `src/components/feedback/FeedbackThumbs.test.tsx` | Unit test (if @testing-library/react is present; otherwise a manual smoke checklist) |
| `src/stores/useFeedbackStore.ts` | Zustand store: per-session ratings cache + recordRating action |
| `/Users/rheynoapria/tools/openclaw-2026.4.15/extensions/aoc-webhook/index.ts` | OpenClaw plugin: subscribes to channel_reaction hook, POSTs to AOC |
| `/Users/rheynoapria/tools/openclaw-2026.4.15/extensions/aoc-webhook/package.json` | Plugin manifest |

**Modified files (AOC Dashboard):**

| Path | Change |
|---|---|
| `src/lib/api.ts` | Add `recordMessageRating()` + `getMessageRatings()` API client functions |
| `src/components/chat/ChatMessage.tsx` | Mount `<FeedbackThumbs>` next to assistant message header |
| `src/stores/index.ts` | Re-export `useFeedbackStore` |

**Modified files (OpenClaw fork):**

| Path | Change |
|---|---|
| `/Users/rheynoapria/tools/openclaw-2026.4.15/src/plugins/hook-types.ts` | Add `channel_reaction` event type + payload interface |
| `/Users/rheynoapria/tools/openclaw-2026.4.15/src/plugins/hooks.ts` | Add `runChannelReaction()` runner |
| `/Users/rheynoapria/tools/openclaw-2026.4.15/extensions/telegram/src/bot-handlers.runtime.ts` | Fire `channel_reaction` hook after authz |
| `/Users/rheynoapria/tools/openclaw-2026.4.15/extensions/discord/src/monitor/listeners.ts` | Same |

---

## Task 1: OpenClaw — define `channel_reaction` plugin hook type

**Files:**
- Modify: `/Users/rheynoapria/tools/openclaw-2026.4.15/src/plugins/hook-types.ts`

- [ ] **Step 1: Inspect existing hook types to match style**

Run: `grep -n 'PluginHook' /Users/rheynoapria/tools/openclaw-2026.4.15/src/plugins/hook-types.ts | head -20`
Read the section around line 55-394 (existing event interfaces). Confirm pattern: each event has its own typed interface and registration entry in the master hook map.

- [ ] **Step 2: Add the new event interface**

Append (or insert near the other `*Event` definitions) the following to `hook-types.ts`:

```typescript
/**
 * Fired when a user reacts to a message (👍/👎/etc) in any external channel.
 * Used by the AOC self-learning satisfaction pipeline to capture explicit
 * positive/negative feedback signals without requiring a dashboard UI.
 *
 * Payload is normalized across channels (Telegram message_reaction, Discord
 * MessageReactionAdd/Remove, future WhatsApp reactionMessage).
 */
export interface PluginHookChannelReactionEvent {
  channel: 'telegram' | 'whatsapp' | 'discord';
  action: 'added' | 'removed';
  emoji: string;                   // raw emoji (e.g. '👍', '👎', or unicode 'thumbs_up')
  rating?: 'positive' | 'negative' | null;  // pre-classified by adapter; null for ambiguous
  messageId: string;               // OpenClaw-side message id of the bot reply being reacted to
  sessionId: string;               // session the message belongs to
  agentId: string;                 // which agent owns the session
  ownerId?: number | null;         // multi-tenant: AOC userId, derived from session config
  raterExternalId: string;         // channel-side user id (TG user_id, Discord user_id, etc.)
  reactedAt: number;               // unix ms
  source: 'reaction';              // discriminator for downstream sinks
}
```

- [ ] **Step 3: Register the hook in the master map**

Find the union/map type that lists all hook events (look for `session_start`, `session_end`, `agent_end`). Add `channel_reaction: PluginHookChannelReactionEvent` to it.

- [ ] **Step 4: Type-check**

Run: `cd /Users/rheynoapria/tools/openclaw-2026.4.15 && npx tsc --noEmit 2>&1 | head -30`
Expected: no new type errors introduced. Existing OpenClaw type errors (if any) are out of scope.

- [ ] **Step 5: Commit**

```bash
cd /Users/rheynoapria/tools/openclaw-2026.4.15
git add src/plugins/hook-types.ts
git commit -m "feat(plugins): add channel_reaction event type for satisfaction capture"
```

---

## Task 2: OpenClaw — add `runChannelReaction()` runner

**Files:**
- Modify: `/Users/rheynoapria/tools/openclaw-2026.4.15/src/plugins/hooks.ts`

- [ ] **Step 1: Inspect `runSessionEnd()` and copy the pattern**

Run: `grep -n 'runSessionEnd\|runVoidHook\|runAgentEnd' /Users/rheynoapria/tools/openclaw-2026.4.15/src/plugins/hooks.ts | head -10`
Read the existing `runSessionEnd()` (lines 958-974). It uses `runVoidHook()` for parallel fire-and-forget execution with error swallowing.

- [ ] **Step 2: Append the new runner**

After the existing `runSessionEnd` (or near other `run*` functions), add:

```typescript
export async function runChannelReaction(
  event: PluginHookChannelReactionEvent,
  ctx: PluginHookSessionContext,
): Promise<void> {
  await runVoidHook('channel_reaction', event, ctx);
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/rheynoapria/tools/openclaw-2026.4.15 && npx tsc --noEmit 2>&1 | head -30`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/rheynoapria/tools/openclaw-2026.4.15
git add src/plugins/hooks.ts
git commit -m "feat(plugins): add runChannelReaction() runner"
```

---

## Task 3: OpenClaw — wire Telegram adapter to fire hook

**Files:**
- Modify: `/Users/rheynoapria/tools/openclaw-2026.4.15/extensions/telegram/src/bot-handlers.runtime.ts`

- [ ] **Step 1: Locate existing reaction handler**

Run: `grep -n 'message_reaction\|enqueueSystemEvent\|reactionNotifications' /Users/rheynoapria/tools/openclaw-2026.4.15/extensions/telegram/src/bot-handlers.runtime.ts | head -10`
You'll find `bot.on("message_reaction", ...)` around line 781 with `old_reaction`/`new_reaction` extraction and `authorizeTelegramEventSender` + `telegramDeps.enqueueSystemEvent()` calls.

- [ ] **Step 2: Read the surrounding code**

Read lines 780-905 to understand:
- How `authorize` decision is reached
- How `sessionKey` is computed
- Where `enqueueSystemEvent` is called (line ~898-901)
- What variables hold `messageId`, `agentId`, `userId`, `chat info`, etc.

- [ ] **Step 3: Add the hook fire next to `enqueueSystemEvent`**

Just after the existing `telegramDeps.enqueueSystemEvent(...)` call inside the loop that processes added reactions, add:

```typescript
// Fire channel_reaction hook for satisfaction pipeline (Phase 2 of AOC self-learning).
// Only fires for added reactions (not removed) — removal semantics are noisy and
// the AOC sink handles "flip" via INSERT OR REPLACE on (message_id, source, rater).
if (telegramDeps.runChannelReaction) {
  const rating = (emoji === '👍' || emoji === '👍') ? 'positive'
              : (emoji === '👎' || emoji === '👎') ? 'negative'
              : null;
  void telegramDeps.runChannelReaction({
    channel: 'telegram',
    action: 'added',
    emoji,
    rating,
    messageId: targetMessageId,   // resolved earlier in the handler
    sessionId,
    agentId,
    ownerId: telegramDeps.resolveOwnerId?.(agentId, sessionId) ?? null,
    raterExternalId: String(senderId),
    reactedAt: Date.now(),
    source: 'reaction',
  }, ctx);
}
```

(The exact variable names — `emoji`, `targetMessageId`, `sessionId`, `agentId`, `senderId`, `ctx` — depend on the local scope. Match what's already in the handler. If a variable doesn't exist by that name, find its equivalent and use that.)

- [ ] **Step 4: Add `runChannelReaction` to the dependencies interface**

Find the `TelegramDeps` interface (likely in the same file or a sibling). Add an optional field:

```typescript
runChannelReaction?: (
  event: PluginHookChannelReactionEvent,
  ctx: PluginHookSessionContext,
) => Promise<void>;
resolveOwnerId?: (agentId: string, sessionId: string) => number | null;
```

- [ ] **Step 5: Wire the dep in the bootstrap site**

Find where `TelegramDeps` is constructed (probably during gateway init). Pass `runChannelReaction: runChannelReaction` (imported from `src/plugins/hooks.ts`) and `resolveOwnerId` from the existing config resolver. If the resolver doesn't exist yet, leave `resolveOwnerId` undefined — the AOC webhook plugin can derive ownerId server-side from sessionId.

- [ ] **Step 6: Type-check + manual sanity**

Run: `cd /Users/rheynoapria/tools/openclaw-2026.4.15 && npx tsc --noEmit -p extensions/telegram 2>&1 | head -20`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/rheynoapria/tools/openclaw-2026.4.15
git add extensions/telegram/
git commit -m "feat(telegram): fire channel_reaction hook for satisfaction capture"
```

---

## Task 4: OpenClaw — wire Discord adapter to fire hook

**Files:**
- Modify: `/Users/rheynoapria/tools/openclaw-2026.4.15/extensions/discord/src/monitor/listeners.ts`

- [ ] **Step 1: Inspect existing reaction listeners**

Run: `grep -n 'MessageReaction\|enqueueSystemEvent\|reactionNotifications' /Users/rheynoapria/tools/openclaw-2026.4.15/extensions/discord/src/monitor/listeners.ts | head -15`
You'll find `DiscordReactionListener` (line 229) and `DiscordReactionRemoveListener` (line 247), both calling `handleDiscordReactionEvent()`.

- [ ] **Step 2: Read `handleDiscordReactionEvent`**

Read the function body. Find where `enqueueSystemEvent` is invoked (around line 527-530). Note the variables in scope: `emoji`, `targetMessageId`, `sessionId`, `agentId`, `userId`, `action`.

- [ ] **Step 3: Add hook fire**

Just after the existing `enqueueSystemEvent(...)` call, add:

```typescript
// Fire channel_reaction hook for satisfaction pipeline (Phase 2 AOC self-learning).
// Both 'added' and 'removed' actions are forwarded so AOC can decide what to do.
if (discordDeps.runChannelReaction && action === 'added') {
  const rating = (emoji === '👍' || emoji === '👍') ? 'positive'
              : (emoji === '👎' || emoji === '👎') ? 'negative'
              : null;
  void discordDeps.runChannelReaction({
    channel: 'discord',
    action,
    emoji,
    rating,
    messageId: targetMessageId,
    sessionId,
    agentId,
    ownerId: discordDeps.resolveOwnerId?.(agentId, sessionId) ?? null,
    raterExternalId: String(userId),
    reactedAt: Date.now(),
    source: 'reaction',
  }, ctx);
}
```

(Adjust variable names to match local scope.)

- [ ] **Step 4: Add to `DiscordDeps` interface**

Same as Telegram — append `runChannelReaction` + `resolveOwnerId` as optional fields.

- [ ] **Step 5: Wire in bootstrap site**

Same as Telegram — pass the imported runner.

- [ ] **Step 6: Type-check**

Run: `cd /Users/rheynoapria/tools/openclaw-2026.4.15 && npx tsc --noEmit -p extensions/discord 2>&1 | head -20`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/rheynoapria/tools/openclaw-2026.4.15
git add extensions/discord/
git commit -m "feat(discord): fire channel_reaction hook for satisfaction capture"
```

---

## Task 5: OpenClaw — create AOC webhook plugin

**Files (all NEW):**
- `/Users/rheynoapria/tools/openclaw-2026.4.15/extensions/aoc-webhook/index.ts`
- `/Users/rheynoapria/tools/openclaw-2026.4.15/extensions/aoc-webhook/package.json`

This is a tiny extension that subscribes to `channel_reaction` and POSTs to AOC. It's the bridge that makes the new hook actually do something for satisfaction capture.

- [ ] **Step 1: Inspect another minimal extension as a reference**

Run: `ls /Users/rheynoapria/tools/openclaw-2026.4.15/extensions/active-memory/` — this is similar in size and shape (subscribes to plugin events, doesn't do much else). Read its `index.ts` to match the registration pattern.

- [ ] **Step 2: Write the plugin**

Create `extensions/aoc-webhook/package.json`:

```json
{
  "name": "@openclaw/aoc-webhook",
  "version": "0.1.0",
  "description": "Webhook bridge: forwards channel_reaction events to AOC dashboard for the satisfaction pipeline.",
  "main": "index.ts",
  "private": true
}
```

Create `extensions/aoc-webhook/index.ts`:

```typescript
import type { PluginRegistry } from '../../src/plugins/types';
import type { PluginHookChannelReactionEvent } from '../../src/plugins/hook-types';

const AOC_BASE_URL = process.env.AOC_BASE_URL || 'http://localhost:18800';
const AOC_SERVICE_TOKEN = process.env.AOC_SERVICE_TOKEN || '';

/**
 * AOC Webhook plugin.
 *
 * Forwards `channel_reaction` events from Telegram + Discord (and later
 * WhatsApp) to AOC's POST /api/feedback/channel-reaction endpoint.
 *
 * Auth: requires AOC_SERVICE_TOKEN — a service-role JWT or DASHBOARD_TOKEN
 * that AOC's authMiddleware accepts. The endpoint enforces role=agent|admin.
 *
 * Failure mode: best-effort, fire-and-forget. Network errors are logged but
 * do NOT block the rest of the channel adapter pipeline. Event loss during
 * AOC downtime is acceptable for Phase 2 (Phase 5 may add a pending-reactions
 * queue if reliability becomes an issue).
 */
export function register(registry: PluginRegistry): void {
  if (!AOC_SERVICE_TOKEN) {
    console.warn('[aoc-webhook] AOC_SERVICE_TOKEN not set; satisfaction capture from external channels will not work');
    return;
  }

  registry.on('channel_reaction', async (event: PluginHookChannelReactionEvent /*, ctx*/) => {
    if (!event.rating) return;  // skip emojis we couldn't classify
    if (event.action !== 'added') return;  // only capture additions; AOC handles flip via INSERT OR REPLACE

    try {
      const res = await fetch(`${AOC_BASE_URL}/api/feedback/channel-reaction`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${AOC_SERVICE_TOKEN}`,
        },
        body: JSON.stringify({
          messageId: event.messageId,
          sessionId: event.sessionId,
          agentId: event.agentId,
          ownerId: event.ownerId,  // server falls back to sessionId-derived owner if null
          channel: event.channel,
          rating: event.rating,
          raterExternalId: event.raterExternalId,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[aoc-webhook] POST /feedback/channel-reaction returned ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[aoc-webhook] POST /feedback/channel-reaction failed: ${msg}`);
    }
  });
}
```

- [ ] **Step 3: Register the plugin in OpenClaw config**

Find where extensions are loaded (likely `~/.openclaw/openclaw.json`'s `plugins` field or a similar config). Add `@openclaw/aoc-webhook` to the loaded plugins list.

If unsure of the loader path, run: `grep -rn 'aoc-master\|active-memory' /Users/rheynoapria/.openclaw/openclaw.json` to see how existing plugins are referenced. Match that pattern.

- [ ] **Step 4: Set env vars**

Add to user's environment (or `~/.openclaw/.aoc_env`):

```bash
export AOC_BASE_URL=http://localhost:18800
export AOC_SERVICE_TOKEN="<service-jwt-or-DASHBOARD_TOKEN>"
```

The token can be: (a) a service-role JWT (use a future endpoint to mint one, or generate with the existing JWT signer pinning `role: 'agent'`); or (b) the legacy `DASHBOARD_TOKEN` env var which AOC's `authMiddleware` already accepts as full-bypass.

For Phase 2 dev/testing, `DASHBOARD_TOKEN` is acceptable. Mark this in the README so it's clear the token must be rotated to a least-privilege service token before production.

- [ ] **Step 5: Type-check + manual sanity**

Run: `cd /Users/rheynoapria/tools/openclaw-2026.4.15 && npx tsc --noEmit -p extensions/aoc-webhook 2>&1 | head -10`
Expected: no errors (the plugin is small + plain).

- [ ] **Step 6: Commit**

```bash
cd /Users/rheynoapria/tools/openclaw-2026.4.15
git add extensions/aoc-webhook/
git commit -m "feat(aoc-webhook): forward channel_reaction events to AOC for satisfaction capture"
```

---

## Task 6: AOC Dashboard — API client functions

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Find a good insertion point**

Open `src/lib/api.ts`. Find a section with related single-resource functions (e.g., `getAgent`, `updateAgent`). Append the new functions near the bottom or in a thematic section labeled `// ── feedback / satisfaction ──`.

- [ ] **Step 2: Add types**

Add (or append to an existing types import block at the top of the file):

```typescript
export interface MessageRating {
  id: number;
  messageId: string;
  sessionId: string;
  agentId: string;
  ownerId: number;
  channel: 'dashboard' | 'telegram' | 'whatsapp' | 'discord' | 'reflection';
  source: 'button' | 'reaction' | 'nl_correction';
  rating: 'positive' | 'negative';
  reason: string | null;
  raterExternalId: string;
  createdAt: number;
}
```

- [ ] **Step 3: Add API functions**

Append:

```typescript
// ── feedback / satisfaction ──────────────────────────────────────────────

export async function recordMessageRating(input: {
  messageId: string;
  sessionId: string;
  agentId: string;
  rating: 'positive' | 'negative';
  reason?: string;
}): Promise<{ ok: true }> {
  return await request('/feedback/message', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getMessageRatings(params: {
  sessionId?: string;
  agentId?: string;
}): Promise<{ ratings: MessageRating[] }> {
  const query = new URLSearchParams();
  if (params.sessionId) query.set('sessionId', params.sessionId);
  if (params.agentId) query.set('agentId', params.agentId);
  return await request(`/feedback/messages?${query.toString()}`);
}
```

(`request` is the existing helper from `src/lib/api.ts` lines 27-50.)

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npm run build 2>&1 | tail -30`
Expected: passes (or only existing unrelated errors).

- [ ] **Step 5: Commit**

```bash
cd /Users/rheynoapria/tools/agent-operations-center/aoc-dashboard
git add src/lib/api.ts
git commit -m "feat(api): add recordMessageRating + getMessageRatings client functions"
```

---

## Task 7: AOC Dashboard — feedback Zustand store

**Files (NEW):**
- `src/stores/useFeedbackStore.ts`

- [ ] **Step 1: Inspect another small store for shape**

Run: `ls src/stores/` — pick a small one like `useThemeStore.ts` or `useViewAsStore.ts` and read it for style.

- [ ] **Step 2: Implement the store**

Create `src/stores/useFeedbackStore.ts`:

```typescript
import { create } from 'zustand';
import * as api from '@/lib/api';
import type { MessageRating } from '@/lib/api';

type RatingMap = Record<string, MessageRating>;  // keyed by messageId

interface FeedbackState {
  /** Cache of ratings, keyed by messageId. Loaded per-session via loadForSession. */
  ratings: RatingMap;
  /** Sessions whose ratings have been hydrated. Avoid re-fetching. */
  loadedSessions: Set<string>;
  /** In-flight fetches, to deduplicate concurrent requests. */
  loadingSessions: Set<string>;

  loadForSession: (sessionId: string) => Promise<void>;
  recordRating: (input: {
    messageId: string;
    sessionId: string;
    agentId: string;
    rating: 'positive' | 'negative';
    reason?: string;
  }) => Promise<void>;
  /** Get the dashboard rating (source='button') for a messageId, if any. */
  getDashboardRating: (messageId: string) => 'positive' | 'negative' | null;
  /** All ratings for a messageId across sources/channels. */
  getAllRatings: (messageId: string) => MessageRating[];
  reset: () => void;
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  ratings: {},
  loadedSessions: new Set(),
  loadingSessions: new Set(),

  loadForSession: async (sessionId) => {
    const { loadedSessions, loadingSessions } = get();
    if (loadedSessions.has(sessionId) || loadingSessions.has(sessionId)) return;
    set({ loadingSessions: new Set([...loadingSessions, sessionId]) });
    try {
      const { ratings } = await api.getMessageRatings({ sessionId });
      set((s) => {
        const next: RatingMap = { ...s.ratings };
        // Index by messageId. If multiple ratings for same message (e.g.
        // dashboard button + reaction), the dashboard one wins for the toggle
        // state — channels are read-only badges. Keep both via a list view too.
        for (const r of ratings) next[r.messageId] = r;
        const newLoaded = new Set(s.loadedSessions); newLoaded.add(sessionId);
        const newLoading = new Set(s.loadingSessions); newLoading.delete(sessionId);
        return { ratings: next, loadedSessions: newLoaded, loadingSessions: newLoading };
      });
    } catch (e) {
      // Don't block UI — leave session marked as loaded so we don't retry
      // forever. Caller can call reset() if they want to force reload.
      const newLoading = new Set(get().loadingSessions); newLoading.delete(sessionId);
      set({ loadingSessions: newLoading });
      console.warn(`[useFeedbackStore] loadForSession(${sessionId}) failed:`, e);
    }
  },

  recordRating: async (input) => {
    // Optimistic update — synthesize a placeholder MessageRating and
    // commit it to local state immediately. If the server call fails,
    // revert by removing the entry.
    const prev = get().ratings[input.messageId];
    const optimistic: MessageRating = {
      id: -1,
      messageId: input.messageId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      ownerId: -1,
      channel: 'dashboard',
      source: 'button',
      rating: input.rating,
      reason: input.reason ?? null,
      raterExternalId: '',
      createdAt: Date.now(),
    };
    set((s) => ({ ratings: { ...s.ratings, [input.messageId]: optimistic } }));
    try {
      await api.recordMessageRating(input);
    } catch (e) {
      // Revert on failure
      set((s) => {
        const next = { ...s.ratings };
        if (prev) next[input.messageId] = prev; else delete next[input.messageId];
        return { ratings: next };
      });
      throw e;
    }
  },

  getDashboardRating: (messageId) => {
    const r = get().ratings[messageId];
    if (!r || r.source !== 'button') return null;
    return r.rating;
  },

  getAllRatings: (messageId) => {
    // For Phase 2 we only cache one rating per messageId; channel reactions
    // would need a separate fetch path or richer caching. Wired in Phase 5.
    const r = get().ratings[messageId];
    return r ? [r] : [];
  },

  reset: () => set({ ratings: {}, loadedSessions: new Set(), loadingSessions: new Set() }),
}));
```

- [ ] **Step 3: Re-export from `src/stores/index.ts`**

Open `src/stores/index.ts`. Add:

```typescript
export { useFeedbackStore } from './useFeedbackStore';
```

(Match the existing export style — likely just `export ... from`.)

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npm run build 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add src/stores/useFeedbackStore.ts src/stores/index.ts
git commit -m "feat(stores): add useFeedbackStore for per-session rating cache"
```

---

## Task 8: AOC Dashboard — `<FeedbackThumbs>` component

**Files (NEW):**
- `src/components/feedback/FeedbackThumbs.tsx`

- [ ] **Step 1: Implement the component**

Create the directory and file:

```bash
mkdir -p src/components/feedback
```

Create `src/components/feedback/FeedbackThumbs.tsx`:

```tsx
import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useFeedbackStore } from '@/stores/useFeedbackStore';
import { cn } from '@/lib/utils';

interface Props {
  messageId: string;
  sessionId: string;
  agentId: string;
  /** When true, render the small reason textarea on first 👎 click. */
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
      // Optimistic update already reverted by the store; surface error to console.
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
```

- [ ] **Step 2: Verify TypeScript + Tailwind compile**

Run: `npm run build 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/feedback/
git commit -m "feat(feedback): add <FeedbackThumbs> component"
```

---

## Task 9: AOC Dashboard — integrate `<FeedbackThumbs>` into `ChatMessage`

**Files:**
- Modify: `src/components/chat/ChatMessage.tsx`

- [ ] **Step 1: Read current `ChatMessage.tsx`**

Read the file end-to-end. Identify:
- Where the assistant message is rendered (look for the assistant block, likely a function `AssistantMessage` or a conditional inside the main component)
- Where the timestamp / role label is shown — that's where the thumbs should sit

- [ ] **Step 2: Add prop for sessionId / agentId**

The component currently receives `group: ChatMessageGroup`. Confirm whether sessionId + agentId are already on the group; if not, add to props:

```typescript
interface Props {
  group: ChatMessageGroup;
  agentName?: string;
  agentAvatarPresetId?: string | null;
  agentEmoji?: string;
  isLast?: boolean;
  sessionId?: string;
  agentId?: string;  // pass-through from chat container
}
```

- [ ] **Step 3: Mount `<FeedbackThumbs>` in the assistant render**

Inside the assistant message render path, near the timestamp (or at the bottom of the message body), add:

```tsx
{group.id && sessionId && agentId && (
  <FeedbackThumbs
    messageId={group.id}
    sessionId={sessionId}
    agentId={agentId}
    className="mt-1 opacity-60 hover:opacity-100 transition-opacity"
  />
)}
```

(Use whatever id field the group exposes — if it's `group.messageId` or `group.lastMessageId`, use that. Check `ChatMessageGroup` type definition in `src/stores/useChatStore.ts`.)

- [ ] **Step 4: Add the import**

At the top of `ChatMessage.tsx`:

```typescript
import { FeedbackThumbs } from '@/components/feedback/FeedbackThumbs';
```

- [ ] **Step 5: Build and visually verify**

Run: `npm run build 2>&1 | tail -10` — type-check.
Then start dev server: `npm run dev` and navigate to a chat surface (floating pill, mission room, or agent detail). Confirm thumbs appear on assistant messages.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ChatMessage.tsx
git commit -m "feat(chat): mount <FeedbackThumbs> on assistant messages"
```

---

## Task 10: AOC Dashboard — wire chat surfaces to load ratings

**Files:**
- Modify: floating pill chat container (find via `grep -rn 'gatewayMessagesToGroups\|<ChatMessage' src/components/chat/ src/components/floating-pill/ 2>/dev/null | head -10`)
- Modify: mission room chat container (similar grep against `src/components/mission-rooms/`)
- Modify: agent detail chat (in `src/pages/agent-detail/` or `src/pages/AgentDetailPage.tsx`)

Each of these surfaces renders a list of `ChatMessageGroup` and needs to:
1. Pass `sessionId` + `agentId` to `<ChatMessage>` (Task 9 added these props)
2. Trigger `useFeedbackStore.loadForSession(sessionId)` on mount + when `sessionId` changes

- [ ] **Step 1: Floating pill — add load + props**

Find the component that renders chat messages. Add at the top:

```typescript
import { useFeedbackStore } from '@/stores';
// ...
const loadForSession = useFeedbackStore((s) => s.loadForSession);
useEffect(() => {
  if (sessionId) void loadForSession(sessionId);
}, [sessionId, loadForSession]);
```

And in the JSX, pass props to `<ChatMessage>`:

```tsx
<ChatMessage group={group} sessionId={sessionId} agentId={agentId} {...otherProps} />
```

- [ ] **Step 2: Mission room — same pattern**

Repeat for the mission room chat renderer.

- [ ] **Step 3: Agent detail page — same pattern**

Repeat for the agent detail page chat preview.

- [ ] **Step 4: Build + visual smoke**

`npm run build && npm run dev` — open each surface and confirm the thumbs render and clicking 👍 sticks (refresh page to verify it persisted).

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat(chat): load ratings + pass sessionId/agentId on all 3 chat surfaces"
```

---

## Task 11: End-to-end smoke test (manual checklist)

This task does NOT add automated tests — it's a verification checklist before declaring Phase 2 done.

**Setup:**

```bash
# Terminal 1: AOC backend + frontend
cd /Users/rheynoapria/tools/agent-operations-center/aoc-dashboard
npm run dev

# Terminal 2: ensure OpenClaw gateway is running with the new aoc-webhook plugin
# (requires AOC_BASE_URL + AOC_SERVICE_TOKEN env vars set in ~/.openclaw/.aoc_env)
```

**Smoke checklist:**

- [ ] **Dashboard click 👍** — open floating pill chat with an agent. Click 👍 on an assistant message. Confirm:
  - Button highlights green immediately (optimistic)
  - Refreshing the page keeps the green state (persisted)
  - `sqlite3 data/aoc.db "SELECT * FROM message_ratings ORDER BY id DESC LIMIT 1;"` shows a row with `source=button, channel=dashboard, rating=positive`

- [ ] **Dashboard click 👎 with reason** — click 👎 on another message. Confirm:
  - Reason input pops up
  - Type "test reason" + Enter → button highlights red, input closes
  - DB row has `rating=negative, reason='test reason'`

- [ ] **Dashboard flip 👍 → 👎** — on a message that's currently 👍, click 👎. Confirm:
  - Reason input pops up (because flipping to negative is a new action)
  - Submit → previous row is REPLACED (still 1 row in DB for that messageId+source+rater), now negative

- [ ] **Telegram reaction → AOC DB** (requires bot configured + `AOC_SERVICE_TOKEN` set):
  - User in Telegram replies-react 👍 to a bot message
  - Within ~1 second, check: `sqlite3 data/aoc.db "SELECT * FROM message_ratings WHERE channel='telegram' ORDER BY id DESC LIMIT 1;"`
  - Row should show `source=reaction, channel=telegram, rating=positive, rater_external_id=<TG user id>`
  - In dashboard, the corresponding message should still show `<FeedbackThumbs>` neutral state (Phase 2 doesn't display channel reactions yet — that's Phase 5)

- [ ] **Discord reaction → AOC DB** (same pattern, channel=discord)

- [ ] **Server logs clean** — tail the AOC server log during all of the above. Confirm no stack traces, no 500s. The aoc-webhook plugin should log success quietly (or warn on token misconfig — fix env if so).

- [ ] **Commit verification (manual)**

```bash
cd /Users/rheynoapria/tools/agent-operations-center/aoc-dashboard
git log --oneline | head -10
```

You should see the Phase 2 commit chain (api → store → component → chat integration) plus the OpenClaw fork commits in the parallel repo.

---

## Phase 2 verification checklist

- [ ] Dashboard 👍/👎 buttons render on assistant messages in all 3 chat surfaces
- [ ] Clicking persists to `message_ratings` table with `source=button, channel=dashboard`
- [ ] Flip semantics work (👍 → 👎 = 1 row, replaced, not 2)
- [ ] Optimistic UI reverts on API failure (test by stopping server mid-click)
- [ ] Telegram reaction (👍 / 👎) → AOC DB row appears within seconds
- [ ] Discord reaction (👍 / 👎) → AOC DB row appears within seconds
- [ ] No regressions in existing Phase 1 unit tests: `node --test server/lib/db/satisfaction.test.cjs server/lib/satisfaction.smoke.test.cjs server/routes/feedback.test.cjs` → all green
- [ ] WhatsApp **explicitly does nothing** — that's expected and lands in Phase 3

---

## Hand-off notes for Phase 3

Phase 3 = WhatsApp adapter mod. The hook + AOC plumbing from Phase 2 are ready; Phase 3 just adds the WA-specific extraction. Spec §10.2 estimate is ~80-120 LOC inside `extensions/whatsapp/src/inbound/monitor.ts:316,427-434` to detect `reactionMessage` in `normalizeInboundMessage()` and fire `runChannelReaction()` with the same payload shape.

**End of Phase 2 plan.**
