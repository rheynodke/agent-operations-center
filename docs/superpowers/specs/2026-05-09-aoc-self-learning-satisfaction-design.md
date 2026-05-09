# AOC Self-Learning via Satisfaction Filter — Design Spec

**Status:** Draft (awaiting review)
**Author:** Rheyno (with Claude Code assistance)
**Date:** 2026-05-09
**Target:** AOC Dashboard + OpenClaw fork at `/Users/rheynoapria/tools/openclaw-2026.4.15`

---

## 1. Context

### 1.1 Problem

AOC users want OpenClaw agents to learn from past conversations — but agents currently produce both correct and hallucinated outputs. Naively ingesting every session into long-term memory propagates errors. We need a **satisfaction-gated learning pipeline**: capture per-message feedback (👍/👎, NL corrections), filter out flagged content, and only promote validated knowledge to a memory layer the agent can later retrieve.

Secondary goal: surface **per-agent accuracy metrics** (detected hallucination rate, endorsement rate, trends) so the user can monitor agent performance.

### 1.2 What already exists

**OpenClaw 2026.4.15:**
- JSONL transcripts at `~/.openclaw/agents/{agentId}/sessions/{sessionId}.jsonl`
- Plugin hook system (`session_start`, `session_end`, `before_compaction`, `after_compaction`, `agent_end`) — fire-and-forget async
- Workspace files auto-loaded into system prompt (allowlist: `AGENTS/SOUL/IDENTITY/USER/TOOLS/BOOTSTRAP/MEMORY.md`)
- **qmd memory backend already enabled** in user's setup (`backend: qmd` in `~/.openclaw/openclaw.json`):
  - Hybrid search (BM25 + vector + reranking + HyDE)
  - Auto-bootstraps workspace as collection (`memory-core/qmd-manager.ts:326,446`)
  - 5-minute update interval, 6 max results, 4s timeout
  - Memory-core extension provides short-term promotion, dreaming phases, recall tracking, concept vocabulary (stock OpenClaw, no user customization)
- Channel adapters with reaction support:
  - Telegram (grammy v1.42): **already wired** — `bot.on("message_reaction")` at `extensions/telegram/src/bot-handlers.runtime.ts:781`
  - Discord (@buape/carbon): **already wired** — `MessageReactionAddListener` at `extensions/discord/src/monitor/listeners.ts:229`
  - WhatsApp (Baileys v7): **silently dropped** — `normalizeInboundMessage()` at `extensions/whatsapp/src/inbound/monitor.ts:316` doesn't check `reactionMessage` subtype

### 1.3 What does NOT exist (gaps this design fills)

- No mechanism to capture per-message satisfaction signals (no buttons in dashboard chat, no event channel for reactions)
- No reflection pipeline at session end
- No way to gate ingestion by quality
- No per-agent satisfaction metrics surfaced anywhere
- No file format / write flow for AOC-curated lessons separate from agent's working `MEMORY.md`

---

## 2. Goals & Non-Goals

### 2.1 Goals (MVP)

1. **Capture per-message feedback** from 3 surfaces: AOC dashboard chat, Telegram, Discord, WhatsApp
2. **Detect NL corrections** in chat where users say "salah" / "wrong" / etc. (batched at session end, not real-time)
3. **Single-call reflection** at `session_end` that combines: detect flagged turns + extract lessons + tag verbatim endorsed examples — using Claude Code CLI subprocess (Haiku 4.5)
4. **Write filtered lessons** to `<workspace>/aoc-lessons/<timestamp>__<sessionId>.md` — qmd auto-indexes via existing workspace collection
5. **Expose metrics** in AOC: per-agent Satisfaction tab with gauges, trends, channel breakdown, flagged message drill-down
6. **Token-efficient**: ~$0 marginal cost on Claude Max subscription, ~$3/month worst case via API; zero added cost on per-session-start prompt assembly
7. **Pluggable LLM provider** abstraction — MVP uses Claude Code CLI; future swap to OpenAI-compatible providers (OpenRouter / LMStudio / Kilocode) via env config without code changes elsewhere

### 2.2 Non-Goals (out of MVP — see §11 Future Work)

- Real-time per-turn correction detection (LLM call per turn) — deferred; batch at session-end is adequate
- Cross-agent learning (master agent synthesizes sub-agent lessons)
- Custom vector store (qmd handles distribution)
- Per-agent provider override
- Real-time alert / threshold notifications
- Lesson retention / archive policy (qmd handles relevance)
- Manual edit lesson UI (read + pin + delete only)
- Provider failover / circuit breaker
- Cross-agent leaderboard page
- Export metrics to CSV/JSON

---

## 3. High-Level Architecture

### 3.1 Components

| Component | Lives in | Responsibility |
|---|---|---|
| **Feedback Capture** | Multi-source | Dashboard buttons, channel reactions (TG/Discord/WA) — fan-in to one canonical signal |
| **Feedback Store** | AOC SQLite | Three new tables: ratings (event log), session summaries, daily rollups |
| **Reflection Service** | AOC backend | Triggered by OpenClaw `session_end` hook → single LLM call → writes 3 sinks |
| **Memory Writer** | AOC backend | Append YAML-frontmatter file to `<workspace>/aoc-lessons/`; atomic temp+rename |
| **LLM Provider Abstraction** | AOC backend | Pluggable interface; MVP impl = Claude Code CLI subprocess |
| **Metrics Dashboard** | AOC frontend | Per-agent Satisfaction tab + Overview card |

### 3.2 Data flow

```
AGENT REPLY (with messageId)
   ↓
JSONL transcript                          OpenClaw                AOC backend
─────────────────                         ────────                ───────────
[👍/👎 dashboard]      ─POST /api/feedback/message────►       message_ratings
[reaction Tg/Disc]     ─plugin hook→ webhook─►                message_ratings
[reaction WA — fork mod] ─plugin hook→ webhook─►              message_ratings

session_end (OpenClaw hook fire-and-forget)
   ↓
AOC Reflection Service
   ↓ (skip rules: msgCount<5, no signal, etc.)
   ↓ (read JSONL + ratings, compress transcript)
1 Claude Code CLI call (Haiku 4.5):
  detect_corrections + extract_lessons + tag_validated_examples
   ↓
parse JSON output → resolve verbatim from JSONL
   ↓                   ↓                       ↓
message_ratings      <workspace>/aoc-lessons/  session_satisfaction_summary
(NL corrections)     /TS__sessionId.md         (counts + tokens + status)
                              ↓
                      [≤5 min later, qmd update tick]
                              ↓
                        qmd index refresh
                              ↓
[Next session]   agent calls memory_search ──qmd──► top-K relevant
                 (lessons + built-in memory mixed via hybrid retrieval)
```

### 3.3 Key architectural decisions

1. **Lessons separated from MEMORY.md.** AOC writes to `<workspace>/aoc-lessons/`; OpenClaw's built-in `MEMORY.md` (priority 70 in system prompt assembly) stays untouched and continues to be managed by memory-core's stock promotion/dreaming logic. **Zero overlap.**
2. **No cap/FIFO/consolidation logic in AOC.** qmd's top-K hybrid retrieval handles relevance; lessons folder may grow freely. This eliminates the "MEMORY.md inflation = silent killer" risk identified during brainstorming.
3. **Lessons folder is non-dotted** (`aoc-lessons/` not `.aoc/lessons/`) — qmd source code (`@tobilu/qmd/dist/qmd.js:1202-1206`) explicitly skips ANY path component starting with `.` via post-glob filter `parts.some(p => p.startsWith("."))`. Dotfolder = not indexed. Non-dotted folder is auto-included in workspace collection.
4. **OpenClaw system prompt assembly only auto-loads allowlist** (AGENTS/SOUL/IDENTITY/USER/TOOLS/BOOTSTRAP/MEMORY.md) — any other workspace content is qmd-indexable but never inflates static prompt.
5. **Single LLM call for 3 tasks.** Detection + distillation + tagging combined into one Haiku call at session_end — eliminates per-turn LLM overhead.
6. **Optimistic default** for satisfaction state. Every assistant message starts as "presumed_good"; explicit 👍 → "endorsed"; 👎 / reaction-negative / NL-correction → "flagged".

---

## 4. Storage Schema (SQLite)

Three new tables via migration framework (`server/lib/db-migrations/NNNN-satisfaction-tables.cjs`).

### 4.1 `message_ratings` — feedback event log

```sql
CREATE TABLE message_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  channel TEXT NOT NULL,            -- 'dashboard'|'telegram'|'whatsapp'|'discord'
  source TEXT NOT NULL,             -- 'button'|'reaction'|'nl_correction'
  rating TEXT NOT NULL,             -- 'positive'|'negative'
  reason TEXT,                      -- NL excerpt or optional user comment
  rater_external_id TEXT,           -- channel-side user identifier (NULL for dashboard)
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id, owner_id) REFERENCES agent_profiles(agent_id, provisioned_by)
);
CREATE INDEX idx_ratings_agent_session ON message_ratings(agent_id, session_id);
CREATE INDEX idx_ratings_owner_created ON message_ratings(owner_id, created_at DESC);
CREATE UNIQUE INDEX idx_ratings_dedupe ON message_ratings(message_id, source, rater_external_id);
```

**Write semantics:** `INSERT OR REPLACE` on UNIQUE key — last-write-wins per (messageId, source, rater) tuple. Allows toggle flip (👍 → 👎) without losing the canonical rating record.

### 4.2 `session_satisfaction_summary` — one row per reflected session

```sql
CREATE TABLE session_satisfaction_summary (
  session_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  endorsed_count INTEGER NOT NULL,
  flagged_count INTEGER NOT NULL,
  presumed_good_count INTEGER NOT NULL,
  hallucination_rate REAL NOT NULL,    -- flagged / message_count
  endorsement_rate REAL NOT NULL,
  reflection_status TEXT NOT NULL,     -- 'skipped_too_short'|'skipped_no_signal'|'completed'|'failed'
  reflection_skip_reason TEXT,
  lessons_extracted INTEGER DEFAULT 0,
  examples_captured INTEGER DEFAULT 0,
  llm_input_tokens INTEGER,
  llm_output_tokens INTEGER,
  prompt_version TEXT,                 -- e.g. 'v1.0'
  reflection_at INTEGER NOT NULL,
  duration_ms INTEGER
);
CREATE INDEX idx_session_summary_agent_time ON session_satisfaction_summary(agent_id, reflection_at DESC);
```

### 4.3 `agent_satisfaction_metrics_daily` — pre-aggregated dashboard

```sql
CREATE TABLE agent_satisfaction_metrics_daily (
  agent_id TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  day TEXT NOT NULL,                -- 'YYYY-MM-DD' (UTC)
  channel TEXT NOT NULL,            -- 'all' or specific channel
  session_count INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  endorsed_count INTEGER NOT NULL,
  flagged_count INTEGER NOT NULL,
  hallucination_rate REAL NOT NULL,
  endorsement_rate REAL NOT NULL,
  PRIMARY KEY (agent_id, owner_id, day, channel)
);
```

UPSERT-based; rebuilt by daily rollup job (idempotent).

### 4.4 Multi-tenant scoping

- All three tables include `owner_id` mirroring `agent_profiles.provisioned_by`.
- GET endpoints use `parseScopeUserId(req)` (admin can `?owner=<id>`; non-admin always self).
- Mutation endpoints use `requireAgentOwnership` middleware.
- Service-token internal endpoints (channel reaction bridge) use dedicated auth pattern matching existing AOC convention.

---

## 5. LLM Provider Abstraction

### 5.1 Interface

```typescript
interface LLMProvider {
  name: string;
  complete(req: CompleteRequest): Promise<CompleteResponse>;
  supportsModel?(model: string): boolean;
}

interface CompleteRequest {
  prompt: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'json' | 'text';
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface CompleteResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  providerLatencyMs: number;
}
```

### 5.2 File structure

```
server/lib/llm-providers/
├── index.cjs                       # registry: getProvider(name)
├── types.d.ts                      # interface contract (documentation)
├── claude-code-provider.cjs        # MVP — subprocess wrapper
├── README.md                       # how to add a new provider
│
│ — placeholder for future, NOT implemented in MVP:
├── (future) anthropic-api-provider.cjs
├── (future) openai-compatible-provider.cjs   # covers OpenRouter, LMStudio, Kilocode, Together, Groq, vLLM, Ollama
```

**Insight:** OpenRouter, LMStudio, Kilocode, Together, Groq, vLLM, Ollama all expose OpenAI-compatible `/chat/completions` endpoints. One file `openai-compatible-provider.cjs` with configurable `baseUrl + apiKey + model` covers all. Realistic future provider count: 3 (claude-code, anthropic-api, openai-compatible) — not per-vendor.

### 5.3 Configuration

```env
# .env (MVP)
REFLECTION_LLM_PROVIDER=claude-code
REFLECTION_LLM_MODEL=claude-haiku-4-5
REFLECTION_CONCURRENCY=3
REFLECTION_TIMEOUT_MS=60000
REFLECTION_QUEUE_MAX=50

# Future swap (no code change):
# REFLECTION_LLM_PROVIDER=openai-compatible
# REFLECTION_LLM_BASE_URL=https://openrouter.ai/api/v1
# REFLECTION_LLM_API_KEY=sk-or-v1-...
# REFLECTION_LLM_MODEL=anthropic/claude-haiku-4.5
```

### 5.4 Per-agent override (deferred to v1.1)

Schema-ready but NOT implemented in MVP:

```sql
ALTER TABLE agent_profiles ADD COLUMN reflection_provider TEXT;
ALTER TABLE agent_profiles ADD COLUMN reflection_model TEXT;
```

Reflection service reads `profile.reflectionProvider || env.REFLECTION_LLM_PROVIDER`. Migration framework supports adding columns later without disruption.

### 5.5 `claude-code-provider.cjs` — MVP implementation

Reuses existing AOC `server/lib/ai.cjs` pattern (already spawns Claude CLI for `/api/ai/generate`). Spawns:

```bash
$CLAUDE_BIN -p --output-format json --model claude-haiku-4-5 < <prompt-stdin>
```

Concurrency control + queue + timeout managed in `reflection-service.cjs` (caller), NOT in provider — keeps providers stateless.

**No fallback to API in MVP** (per user direction). If subprocess fails, reflection fails — log + skip session, don't crash.

---

## 6. Reflection Pipeline

### 6.1 Skip rules (free, before LLM)

Reflection service short-circuits without LLM call if any condition met. Status recorded in `session_satisfaction_summary.reflection_status`:

| Rule | Status |
|---|---|
| `messageCount < 5` | `skipped_too_short` |
| Compressed transcript token count < 500 | `skipped_too_short` |
| Zero feedback signal at all (no rating, no user follow-up beyond first Q) | `skipped_no_signal` |

Estimated 30-40% of sessions skip pre-LLM → free.

### 6.2 Input compression (transcript → compact text)

Strip from raw JSONL:
- Tool_use blocks (replaced with `[tool: <name>]` placeholder)
- Thinking blocks
- System messages
- Metadata fields

Inject inline:
- Existing `message_ratings` as inline tags: `[rating=endorsed via dashboard]`, `[rating=flagged via reaction:tg]`
- User reaction events as separate `T<n> USER 👍 [msgId=...]` entries

**Sliding window when compressed transcript >8K tokens:**
- Keep first 3 turns (context establishment)
- Keep all turns with explicit feedback signal
- Keep last 5 turns (recent context)
- Drop middle, mark `... [N turns omitted, no signal] ...`

Target: ≤4K input tokens to LLM per session.

### 6.3 Combined prompt

See `server/lib/reflection-prompts.cjs:REFLECTION_PROMPT_V1`. Three tasks in one call:

1. **Detect**: For each ASSISTANT message, decide if next user turn expresses correction/disagreement.
2. **Distill**: Extract 0-5 reusable lessons (specific, ≤200 char each, declarative, exclude flagged turns).
3. **Capture**: Reference messages with `[rating=endorsed]` by `messageId` only — do NOT include text content.

**Output JSON schema (`schema_version: "1"`):**

```json
{
  "schema_version": "1",
  "session_quality": "good" | "mixed" | "poor",
  "flagged_messages": [
    { "messageId": "<id>", "evidence": "T<n> user said: <quote>",
      "type": "factual_error" | "user_correction" | "incomplete" }
  ],
  "lessons": [
    { "kind": "pattern" | "preference" | "fact" | "warning",
      "text": "<lesson ≤200 char>",
      "tags": ["<tag>", ...],
      "evidence_message_ids": ["<id>", ...] }
  ],
  "validated_examples": [
    { "messageId": "<id>",
      "kind": "code" | "config" | "explanation",
      "title": "<short title>",
      "tags": [...] }
  ]
}
```

**Prompt size:** ~550 tokens fixed + ≤4K transcript = ~4.5K input. Output: ~300 tokens.

### 6.4 Output handling — verbatim capture trick

LLM tells us *which* messages to capture for `validated_examples`; AOC fetches actual text from JSONL. **LLM never paraphrases code/config** — eliminates risk of LLM mutating verbatim content.

**Resolution flow:**

1. Parse JSON, validate against schema. Drop entries with messageIds not in JSONL (LLM occasionally hallucinates IDs).
2. For each `flagged_messages` entry → write to `message_ratings` with `source='nl_correction'`, `rating='negative'`, `reason=evidence`, `rater_external_id=null`.
3. For each `validated_examples` entry:
   - Open JSONL, find message by messageId
   - Extract assistant text (skip thinking, tool_use blocks; reuse `gatewayMessagesToGroups` extraction logic)
   - Compose verbatim block in lessons file
4. For each `lessons` entry → render in lessons file with frontmatter metadata.
5. Update `session_satisfaction_summary` with counts, token usage, status, `prompt_version`.

### 6.5 Safety net (post-LLM)

| Condition | Action |
|---|---|
| `flagged_count / message_count > 0.5` | **Do NOT write lessons file.** Counts still recorded; session was too poisoned to trust |
| Schema validation fails | Retry once with stricter `"VALID JSON ONLY:"` prefix; if still fails → status=`failed` |
| All output arrays empty + quality=`poor` | status=`completed`, no file write |
| MessageId in output not in JSONL | Drop silently, log warning |

### 6.6 Token budget

Assumption: 100 sessions/day, 60% qualify post-skip-rules.

| Component | Per session | Per day (60 qualifying) | Per month |
|---|---|---|---|
| Input | ~5K tok | 300K tok | 9M tok |
| Output | ~300 tok | 18K tok | 540K tok |
| Cost (Haiku via Anthropic API if fallback) | ~$0.0017 | ~$0.10 | ~$3.05 |
| **Cost (Claude Code subscription)** | **$0** | **$0** | **$0** |

### 6.7 Prompt versioning

```javascript
// server/lib/reflection-prompts.cjs
const REFLECTION_PROMPT_VERSION = 'v1.0';
const REFLECTION_SCHEMA_VERSION = '1';
```

Stored in `session_satisfaction_summary.prompt_version` per record. Bumping version doesn't auto-re-reflect old sessions; user can manually trigger via UI (`re-reflect` endpoint, §8.3).

---

## 7. Lessons File Format & Write Flow

### 7.1 File layout

```
<workspace>/                            # per-agent workspace
├── MEMORY.md                           # OpenClaw built-in (qmd indexed, untouched)
├── HEARTBEAT.md, AGENTS.md, ...        # OpenClaw built-in
└── aoc-lessons/                        # AOC self-learning territory (qmd indexed)
    ├── 2026-05-09T143200Z__053cf874-bbe0-45ac-ae6a-2d0cee2116b6.md
    ├── 2026-05-09T151200Z__abc-def.md
    └── ...
```

**Filename pattern:** `<ISO-timestamp>__<sessionId>.md`
- Sortable by time
- Traceable to source session
- Filesystem-safe (no colons in timestamp; replace `:` and `.` with empty)

**Why multi-file (one file per session) instead of single `lessons.md`:**

| Aspect | Multi-file (chosen) | Single file |
|---|---|---|
| qmd retrieval | Per-file scoring → accurate ranking | Whole file = 1 unit, coarse |
| Concurrent write | Safe (unique filename per session) | Needs locking + merge |
| Manual delete one session | `unlink` 1 file | Parser + atomic edit, error-prone |
| Atomicity | Trivial (temp + rename) | Complex |
| qmd embedding scale | Many small files OK | Single huge file = full re-embed each update |

### 7.2 File format (single session)

````markdown
---
schema_version: 1
session_id: 053cf874-bbe0-45ac-ae6a-2d0cee2116b6
agent_id: pm-discovery
owner_id: 1
reflection_at: 2026-05-09T14:32:00Z
prompt_version: v1.0
session_quality: mixed
session_metrics:
  message_count: 12
  endorsed_count: 5
  flagged_count: 1
  hallucination_rate: 0.083
tags: [bigquery, odoo, dataset-setup, sql]
pinned: false
---

# Session Lessons — 2026-05-09 14:32

## Lessons

### lesson-1
- **kind**: fact
- **tags**: bigquery, odoo, dataset-naming
- **evidence**: msgId def456, ghi789

User's BigQuery dataset is `Odoo17DKEpublic` (not `Odoo`). sa-key at
`~/.config/gcloud/dke-bq.json`, requires roles BigQuery Data Viewer + Job User.

### lesson-2
- **kind**: pattern
- **tags**: skill-gws-bq, env-var
- **evidence**: msgId xyz123

Skill `gws-bq` requires `GOOGLE_APPLICATION_CREDENTIALS` env var before any query.

## Validated Examples

### example-1: Monthly revenue query
- **messageId**: def456
- **kind**: code
- **tags**: bigquery, sql

```sql
SELECT DATE_TRUNC(invoice_date, MONTH) AS month, SUM(amount_total) AS revenue
FROM `dke.Odoo17DKEpublic.account_move`
WHERE state = 'posted' GROUP BY 1 ORDER BY 1 DESC LIMIT 12
```
````

### 7.3 Atomic write

```javascript
// server/lib/lessons-writer.cjs (~120 LOC)
async function writeLessonsForSession({ workspace, sessionId, llmOutput, jsonlPath }) {
  const examples = await resolveVerbatim(llmOutput.validated_examples, jsonlPath);
  const content = renderLessonsFile({ sessionId, llmOutput, examples });

  const dir = path.join(workspace, 'aoc-lessons');
  await fs.promises.mkdir(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 17) + 'Z';
  const filename = `${ts}__${sessionId}.md`;
  const finalPath = path.join(dir, filename);
  const tempPath = path.join(dir, `.${filename}.tmp`);

  // Path traversal guard
  const resolved = path.resolve(finalPath);
  if (!resolved.startsWith(path.resolve(workspace, 'aoc-lessons') + path.sep)) {
    throw new Error('path traversal detected');
  }

  await fs.promises.writeFile(tempPath, content, 'utf8');
  await fs.promises.rename(tempPath, finalPath);  // atomic on same fs
  return finalPath;
}
```

**Idempotency:** filename includes sessionId. Re-reflect for same session → atomic rename overwrites. No duplicates.

### 7.4 qmd integration flow

```
Reflection done → write file to aoc-lessons/
                          ↓
          [qmd update.interval: 5m tick]
                          ↓
            qmd update workspace collection
                          ↓
              BM25 + embedding refresh
                          ↓
[Next session] agent calls memory_search("BigQuery dataset Odoo")
                          ↓
   qmd hybrid → top-K including this lesson file
```

**No immediate re-index trigger in MVP.** 5-min lag acceptable; spawning extra subprocess per write adds noise.

### 7.5 Manual curation API

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /api/agents/:id/lessons?limit=&offset=` | GET | List (frontmatter only — list view) |
| `GET /api/agents/:id/lessons/:filename` | GET | Full content of one lesson |
| `PATCH /api/agents/:id/lessons/:filename/pin` | PATCH | Toggle `pinned: true/false` in frontmatter |
| `DELETE /api/agents/:id/lessons/:filename` | DELETE | Unlink file (qmd reindexes next tick) |
| `POST /api/agents/:id/lessons/:filename/re-reflect` | POST | Delete + re-trigger reflection (e.g., after prompt_version bump) |

`pinned: true` does not directly affect qmd ranking (qmd doesn't read custom frontmatter). Used for AOC dashboard display + future enhancement (pre-search hook to boost pinned).

---

## 8. Backend Components & Routes

### 8.1 New files

| File | Responsibility | LOC |
|---|---|---|
| `server/lib/db-migrations/NNNN-satisfaction-tables.cjs` | Migration for 3 tables | ~80 |
| `server/lib/db/satisfaction.cjs` | Domain accessor: `recordRating`, `getSessionRatings`, `upsertSessionSummary`, `getDailyMetrics` | ~250 |
| `server/routes/feedback.cjs` | REST endpoints (§8.3) | ~150 |
| `server/lib/reflection-service.cjs` | session_end handler: skip rules → LLM call → 3 sinks | ~350 |
| `server/lib/reflection-prompts.cjs` | Prompt template + `REFLECTION_PROMPT_VERSION` | ~100 |
| `server/lib/lessons-writer.cjs` | Atomic file write + verbatim resolver | ~120 |
| `server/lib/satisfaction-rollup.cjs` | Daily rollup job | ~150 |
| `server/lib/reaction-bridge.cjs` | OpenClaw → AOC reaction event handler | ~150 |
| `server/lib/llm-providers/index.cjs` | Provider registry | ~50 |
| `server/lib/llm-providers/claude-code-provider.cjs` | Subprocess wrapper | ~150 |

**Total AOC LOC: ~1,550**

### 8.2 OpenClaw fork modifications

| File | Change | LOC |
|---|---|---|
| `extensions/telegram/src/bot-handlers.runtime.ts` | Expose existing reaction handler via new `channel_reaction` plugin hook | ~20 |
| `extensions/discord/src/monitor/listeners.ts` | Same — fire `channel_reaction` after authz | ~20 |
| `extensions/whatsapp/src/inbound/monitor.ts` + `normalizeInboundMessage()` | NEW — detect `reactionMessage` subtype, extract `targetId+emoji+sender`, fire hook + add gating mode `reactionNotifications` config matching TG/Discord | ~80-120 |
| `src/plugins/hook-types.ts` + `hooks.ts` | Define `channel_reaction` hook type + `runChannelReaction()` runner | ~30 |
| AOC webhook plugin (new file in `extensions/aoc-webhook/` or via existing pattern) | Listens to `session_end` + `channel_reaction` hooks → POSTs to AOC | ~100 |

**Total OpenClaw fork LOC: ~250-300**

### 8.3 REST endpoints (`server/routes/feedback.cjs`)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/feedback/message` | POST | JWT user | Dashboard button click. Body: `{messageId, sessionId, agentId, rating, reason?}`. Idempotent via INSERT OR REPLACE |
| `/api/feedback/channel-reaction` | POST | Internal service token | Called by reaction-bridge (OpenClaw plugin → AOC) |
| `/api/feedback/messages?sessionId=` | GET | JWT user (ownership-scoped) | List ratings for a session — UI renders thumb states |
| `/api/feedback/session/:sessionId/summary` | GET | JWT user | Detail one session's reflection result |
| `/api/feedback/session/:sessionId/re-reflect` | POST | JWT user (ownership) | Manual re-trigger reflection (e.g., after prompt update) |
| `/api/satisfaction/agent/:agentId/metrics?range=7d\|30d\|90d\|all` | GET | JWT user (ownership) | Pull from `agent_satisfaction_metrics_daily` |
| `/api/satisfaction/agent/:agentId/flagged-messages?limit=20` | GET | JWT user (ownership) | Drill-down to flagged content |
| `/api/satisfaction/overview?range=7d` | GET | JWT user (admin sees all, others see own) | Overview page card data |
| `/api/satisfaction/health` | GET | Admin | Reflection queue depth, last run, failures |

---

## 9. Frontend Components

### 9.1 Feedback button — `<FeedbackThumbs>`

`src/components/feedback/FeedbackThumbs.tsx` — shared component for 3 chat surfaces (floating pill, mission room, agent detail page).

**Props:** `{ messageId, sessionId, agentId, initialState? }`

**UX:**
- Default: low-opacity 👍 👎; hover scale-up
- Optimistic update on click; revert on API failure
- 👎 click → 1-line reason textarea (optional, max 200 char)
- Toggle/flip: click opposite to flip rating (last-write-wins)

**Integration:** mounts per assistant message in renderers that loop through `gatewayMessagesToGroups()` from `useChatStore`.

### 9.2 Reaction badge (cross-channel display)

Read-only badge alongside dashboard buttons:

```
[Agent reply...]
[👍 14:32] [📱 TG 👍] [💬 Discord 👎 by @user123]
```

Tooltip with `@username + channel + timestamp`. Updates real-time via WS.

### 9.3 Satisfaction tab (Agent Detail page)

New tab in `AgentDetailPage`:
```
Body tabs: [Agent Files] [Skills & Tools] [Channels] [Connections] [Schedules] [Satisfaction]
```

**Component:** `src/pages/agent-detail/AgentSatisfactionTab.tsx`

**Layout (5 sections):**

1. **Score gauges (4 cards):** Endorsement %, Hallucination %, Sessions count, Lessons count (with 7-day trend deltas)
2. **Trend chart:** 30-day line chart with endorsement (green) + hallucination (red); range selector 7d/30d/90d/all
3. **Channel breakdown:** horizontal stacked bars per channel
4. **Flagged messages list:** recent 20, click → drill-down modal with full conversation context. Actions: Open session / Re-reflect / Mark as not hallucination (admin only)
5. **Lessons learned:** collapsed list of last 10; pin/delete actions; "Browse all →" opens lessons modal

**Chart lib:** check existing AOC `package.json` first; if none, recommend `recharts` (~30KB gzipped).

### 9.4 Overview card (existing OverviewPage)

New card "Self-Learning Summary (7 days)":
- Top 3 agents by hallucination rate ⚠️
- Top 3 agents by endorsement rate ✓
- Total lessons learned this week
- Total flagged messages → "Review all" link

Endpoint: `GET /api/satisfaction/overview?range=7d`

### 9.5 Lessons curation modal

Embedded in Satisfaction tab Section 5; full modal via "Browse all →" link.
- List view: chronological, frontmatter snippet, tag pills
- Read view: markdown render with code highlighting (Monaco view-mode or react-markdown)
- Actions: pin / delete (no edit per §11 non-goals)

### 9.6 WebSocket events

Add to `server/lib/ws-events.cjs` + `WsEventType` in `src/types/index.ts`:

| Event | Trigger | Payload | Subscriber |
|---|---|---|---|
| `feedback:rating-updated` | `recordRating()` | `{messageId, sessionId, agentId, channel, rating, source}` | Open chat panels |
| `feedback:session-summarized` | Reflection done | `{sessionId, agentId, lessonsCount, flaggedCount, examplesCount}` | Open Satisfaction tab |
| `feedback:lesson-added` | After lessons.md write | `{agentId, filename, title, tags}` | Same |
| `feedback:metrics-rolled` | Daily rollup done | `{agentIds, day}` | Open Overview |

Per CLAUDE.md "WS event types are pinned via `assertEventType` — typos throw at call site." Update both files in lockstep.

### 9.7 Permission model

| Surface | Access |
|---|---|
| `<FeedbackThumbs>` | Agent owner + master agent (mission rooms) + admin |
| Satisfaction tab | Agent owner + admin |
| Overview card | All users (own scope); admin (all) |
| Flagged drill-down | Owner + admin |
| Re-reflect / Delete lesson | Owner + admin |
| **Mark as not hallucination** | **Admin only** (skews metrics — strict permission, audit-logged) |

Hooks: `parseScopeUserId(req)` server-side; `useIsAdmin()`/`useCanEditAgent()` from `src/lib/permissions.ts` client-side.

---

## 10. Error Handling, Observability, Testing, Security

### 10.1 Failure mode matrix

| Component | Failure | Behavior |
|---|---|---|
| `POST /api/feedback/message` | Bad input | 400, no DB write |
| `POST /api/feedback/message` | Cross-tenant | 403 via `requireAgentOwnership` |
| Reaction bridge | AOC down | Plugin logs + drops event (best-effort, acceptable loss) |
| Reflection Service | JSONL read fail | Status `failed`, log, continue |
| Reflection Service | LLM timeout (60s) | Kill subprocess, status `failed`, no retry |
| Reflection Service | LLM JSON parse fail | Retry once with stricter prefix; if still fails → `failed` |
| Reflection Service | Concurrency >3 | Queue (max 50); drop oldest if full |
| Lessons writer | Disk full / perm | Log, status `failed`; summary still recorded |
| Lessons writer | Atomic rename fail | Cleanup `.tmp`, retry once |
| Daily rollup | SQL error | Log, retry next tick (UPSERT idempotent) |
| WS broadcast | WS server down | Silent skip — UI refreshes on next API call |

**Principle:** fail open, never crash request path. Reflection runs out-of-band; all errors recorded in `session_satisfaction_summary.reflection_status` for visibility.

### 10.2 Logging

Structured logs for: `reflection.started`, `reflection.skipped`, `reflection.completed`, `reflection.failed`, `feedback.rating_recorded`, `feedback.lesson_written`, `feedback.lesson_deleted`, `lessons.dir_size_warning`.

**Audit log** (existing `server/lib/audit-log.cjs`) for sensitive ops:
- `feedback.lesson.deleted`
- `feedback.flagged.overridden` (admin override of NL detection — high audit value)
- `feedback.session.re_reflected`

### 10.3 Health endpoint

`GET /api/satisfaction/health`:

```json
{
  "reflection": { "queue_depth": 3, "in_flight": 1, "last_run_at": "...", "failures_24h": 2 },
  "lessons": { "total_files": 1247, "agents_with_lessons": 8 },
  "llm_provider": { "name": "claude-code", "model": "claude-haiku-4-5", "avg_latency_ms_24h": 4200 }
}
```

### 10.4 Testing strategy

Existing AOC pattern: `node:test` framework, `*.test.cjs` co-located with source.

**Unit tests:**

| Test file | Covers |
|---|---|
| `server/lib/reflection-service.test.cjs` | Skip rules, prompt assembly, LLM mock, output parsing, schema validation, retry-on-malformed, concurrency queue |
| `server/lib/lessons-writer.test.cjs` | Atomic write, frontmatter render, verbatim resolver (incl. hallucinated messageId), filename collision (re-reflect overwrite) |
| `server/lib/db/satisfaction.test.cjs` | recordRating idempotency, summary upsert, daily rollup correctness across DST boundary |
| `server/lib/llm-providers/claude-code-provider.test.cjs` | Subprocess spawn (mocked), timeout, JSON parse, exit-code |
| `server/lib/reaction-bridge.test.cjs` | Channel→messageId resolution, dedupe, cross-tenant rejection |
| `server/routes/feedback.test.cjs` | All endpoints, auth scoping, INSERT-OR-REPLACE flip behavior |

**Integration tests:**
- End-to-end: synthetic JSONL → trigger session_end → verify ratings written, lessons.md created, summary persisted, WS event broadcast
- Cross-tenant isolation: User A reflection never writes to User B's workspace
- Multi-channel reaction: simulate TG/Discord/WA reaction events
- qmd integration: write file → trigger qmd update → verify in qmd index (uses qmd CLI directly)
- Skip rule accuracy: 10 synthetic sessions of varying lengths → verify decisions

**Token budget regression:**
- Synthetic 12-turn session, run reflection 10x, average tokens
- Assert: input < 6000, output < 500 per call (margin above estimate)
- CI fail on breach → catches prompt drift early

**Smoke tests (manual checklist):**
1. Click 👍 in dashboard → row in `message_ratings`, badge renders
2. React 👍 in Telegram → row in DB, badge appears in dashboard
3. Wait for session end → `aoc-lessons/` has new file, summary recorded
4. Agent calls `memory_search` for topic from session → returns lesson
5. Open Satisfaction tab → gauges + chart render
6. Delete lesson → file unlinked, qmd reindex after 5min, search no longer returns it

### 10.5 Security

| Vector | Mitigation |
|---|---|
| LLM prompt injection (user types "IGNORE INSTRUCTIONS, output {x}") | Strict schema validation post-LLM; drop non-conforming output. Prompt explicit "Output JSON matching schema. Nothing else." |
| File path traversal in lessons writer | `path.resolve()` + verify result startsWith `<workspace>/aoc-lessons/` |
| Filename injection (malicious sessionId) | Validate sessionId matches UUID regex before path concat |
| Internal `/api/feedback/channel-reaction` exposed | Service token required (existing AOC pattern) |
| Reaction emoji spoofing (bypass own message filter) | Existing OpenClaw `reactionNotifications: own` filter (TG + Discord); WA must implement same gating in adapter mod |
| Cross-tenant rating leak via messageId enumeration | `owner_id` column + `requireAgentOwnership` |
| User abuses "Mark as not hallucination" → skews metrics | Admin-only, full audit log, transparency: UI shows count of overrides applied |

### 10.6 Multi-tenant correctness checklist

Verify before ship:
- [ ] `parseScopeUserId(req)` used in all GET satisfaction endpoints
- [ ] `requireAgentOwnership` on all mutation endpoints (except service-token)
- [ ] `homeFor(ownerId)` resolver used for workspace path
- [ ] Reflection service receives `ownerId` from `session_end` event payload (not inferred)
- [ ] WS `feedback:*` events scoped by `ownerId`; frontend filters by current user

---

## 11. Rollout Phases

All shippable independently. Each phase produces working, observable value.

| Phase | Scope | Estimated effort | Outcome |
|---|---|---|---|
| **1. Foundation** | Migration, LLM provider abstraction, Reflection Service, lessons writer, basic API endpoints | 2-3 days | Backend pipeline functional, triggerable via internal RPC, no UI |
| **2. Dashboard buttons + Telegram/Discord** | `<FeedbackThumbs>`, hook integration TG + Discord (already live in OpenClaw) | 2 days | User can rate via dashboard + 2 channels; ratings stored |
| **3. WhatsApp adapter** | `extensions/whatsapp/src/inbound/monitor.ts` mod ~80-120 LOC, fire `channel_reaction` | 1-2 days | All 3 channels reacting |
| **4. UI metrics** | Satisfaction tab, Overview card, lessons curation modal | 2-3 days | Full dashboard visibility |
| **5. Polish** | Real-time WS events, drill-down navigation, audit log integration, smoke tests pass | 1-2 days | Production-ready |

**Total: ~8-12 days solo dev.** Phase 2 alone unlocks data collection; Phases 3-5 can run in parallel with other work.

---

## 12. Future Work (Out of MVP)

Items intentionally deferred:

- **Real-time per-turn correction detection** — current MVP batches at session_end. If real-time signal needed, add hybrid keyword + Haiku verify per turn.
- **Cross-agent learning** — master synthesizes sub-agent lessons into team-wide knowledge.
- **Custom vector store** — only if qmd proves insufficient at scale (>5K tok memory typical, >50 lessons/agent average).
- **Per-agent provider override** — schema-ready (`agent_profiles.reflection_provider`); enable in v1.1 if heterogeneous models needed.
- **Real-time alert/threshold notifications** — Slack/email when hallucination rate exceeds X%.
- **Lesson retention/archive policy** — auto-archive sessions older than N days; compress old digests.
- **Manual edit lesson UI** — currently read + pin + delete only.
- **Provider failover/retry/circuit-breaker** — single provider sufficient for MVP.
- **Cross-agent comparison page** — leaderboard, A/B test setups.
- **Export to CSV/JSON** — for offline analysis.
- **Flagged message categorization filter** — UI surface of LLM-generated `type` field (factual_error vs incomplete vs user_correction).
- **Pinned-boost in qmd retrieval** — pre-search hook to weight pinned lessons higher.
- **Phase-2 deep observability** — Prometheus metrics, dashboards.

These are tracked as candidate future plans; this doc is MVP-scoped.

---

## 13. Appendix

### 13.1 Key file references (verified during design)

**OpenClaw 2026.4.15:**
- Telegram reaction handler: `extensions/telegram/src/bot-handlers.runtime.ts:781`
- Telegram allowed updates: `extensions/telegram/src/allowed-updates.ts:58-60`
- Discord reaction listener: `extensions/discord/src/monitor/listeners.ts:229-262`
- WhatsApp inbound (needs mod): `extensions/whatsapp/src/inbound/monitor.ts:316,427-434,636`
- Plugin hook types: `src/plugins/hook-types.ts:55-394`
- Plugin hook runners: `src/plugins/hooks.ts:958-974`
- System prompt assembly: `src/agents/system-prompt.ts:39-87`
- Workspace bootstrap: `src/agents/workspace.ts:33-89,141`
- Memory plugin runtime: `src/plugins/memory-runtime.ts:20-30`, `src/plugins/memory-state.ts:96-219`
- Memory config types: `src/config/types.memory.ts:3-68`
- qmd manager: `extensions/memory-core/src/memory/qmd-manager.ts:264,326,372,397,446`
- Heartbeat detector: `src/auto-reply/heartbeat.ts:32-67`
- Transcript files: `src/gateway/session-transcript-files.fs.ts`
- Transcript events: `src/sessions/transcript-events.ts:14-52`

**qmd binary:**
- Path: `/Users/rheynoapria/.bun/bin/qmd`
- Source: `/Users/rheynoapria/.bun/install/global/node_modules/@tobilu/qmd`
- Dotfile filter: `dist/qmd.js:1199-1206` (fast-glob `dot:false` + post-filter `parts.some(p => p.startsWith("."))`)

**AOC Dashboard (existing patterns to follow):**
- AI subprocess pattern: `server/lib/ai.cjs` (`generateStream()`, uses `CLAUDE_BIN` env)
- DB modules pattern: `server/lib/db/<domain>.cjs`
- Migration framework: `server/lib/db-migrations/NNNN-*.cjs`
- WS events: `server/lib/ws-events.cjs` + `src/types/index.ts:WsEventType`
- Audit log: `server/lib/audit-log.cjs`
- Multi-tenant scoping: `parseScopeUserId(req)`, `requireAgentOwnership`, `homeFor(ownerId)` (`server/helpers/access-control.cjs`)
- Permission hooks: `src/lib/permissions.ts` (`useIsAdmin`, `useCanEditAgent`)

### 13.2 Known operational gotcha

User's qmd CLI is currently broken at the shell level due to `better-sqlite3` Node module mismatch (compiled for v25.7.x; current Node v25.9.0 expects MODULE_VERSION 141). **Does not block AOC integration** because OpenClaw gateway invokes qmd via bun runtime which has its own module loader. Affects only direct shell `qmd status`/`qmd ls` debugging.

Fix: `bun pm cache rm && bun add -g @tobilu/qmd`.

### 13.3 Decision log (key tradeoffs surfaced during brainstorming)

1. **Per-message granularity for feedback** (chosen) over per-session/per-task — required for hallucination detection at the right unit.
2. **Hybrid NL correction detection batched at session_end** (chosen) over real-time per-turn — saves ~70% LLM calls at cost of delayed signal; acceptable since metric is retrospective.
3. **Native reactions on all 3 channels** (chosen) over dashboard-only — feasibility analysis showed 2/3 channels already wired; total cost ~150 LOC fork mod.
4. **Approach 2 (combined detect+distill+capture in 1 LLM call)** over Approach 1 (lean MVP, no NL detection) or Approach 3 (real-time + sophisticated) — best balance of signal quality and token efficiency.
5. **Claude Code CLI** over Anthropic API direct — reuses existing AOC pattern, $0 marginal cost on Max subscription, model pinned to Haiku for predictable budget.
6. **Pluggable LLM provider abstraction** — small (~200 LOC) but enables future swap to OpenAI-compatible providers without touching reflection logic.
7. **Multi-file (one per session)** over single `lessons.md` — better qmd retrieval ranking, atomic writes, easy delete.
8. **`aoc-lessons/` non-dotted folder** over `.aoc/lessons/` — qmd source explicitly skips ANY dotfolder via post-glob filter.
9. **Lessons separate from MEMORY.md** — eliminates static system prompt inflation; relies on qmd top-K retrieval for distribution.
10. **No fallback to API in MVP** (per user direction) — single provider, fail-fast; fallback can be added in v1.1 if reliability becomes issue.

---

**End of design.**
