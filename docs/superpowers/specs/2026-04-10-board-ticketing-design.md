# Board Ticketing System — Design Spec
**Date:** 2026-04-10  
**Status:** Approved  

## Overview

Evolve the existing read-only BoardPage into a full-featured general-purpose ticketing system. SQLite becomes the single source of truth (replacing dev-progress markdown parsing). Agents can update ticket status via a shared script (`update_task.sh`) that is auto-installed for all agents — new and existing.

**Scope:** Standalone task tracker. Not tied to ADLC projects (project-centric / pipeline feature is separate).

**UI richness:** Medium — create/edit, drag-and-drop, filter/search, activity log, agent work session replay.

---

## Section 1: Data Model & Backend

### SQLite Schema (additions to `server/lib/db.cjs`)

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'backlog',   -- backlog|todo|in_progress|done
  priority      TEXT NOT NULL DEFAULT 'medium',    -- low|medium|high|urgent
  agent_id      TEXT,                              -- nullable = unassigned
  session_id    TEXT,                              -- linked agent session
  tags          TEXT,                              -- JSON array string e.g. '["auth","frontend"]'
  cost          REAL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS task_activity (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   -- status_change|assignment|comment|cost_update
  from_value  TEXT,
  to_value    TEXT,
  actor       TEXT NOT NULL,   -- "user" | agentId
  note        TEXT,
  created_at  TEXT NOT NULL
);
```

### API Endpoints (additions to `server/index.cjs`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/tasks` | List all tasks. Query params: `agentId`, `status`, `priority`, `tag`, `q` (search) |
| `POST` | `/api/tasks` | Create new ticket |
| `PATCH` | `/api/tasks/:id` | Update ticket (status, priority, agentId, note, sessionId, etc.) — auto-writes activity log |
| `DELETE` | `/api/tasks/:id` | Hard delete ticket |
| `GET` | `/api/tasks/:id/activity` | Get activity log for a ticket |

`PATCH /api/tasks/:id` always writes a `task_activity` row. The `actor` field is determined as follows:
- Request body contains `agentId` → `actor = agentId` (agent-originated update via script)
- No `agentId` in body → `actor = "user"` (user-originated update via UI)

The `update_task.sh` script always includes the agent's ID in the request body.

When `status` transitions to `done`, backend auto-sets `completed_at`.

### WebSocket Broadcast

After any `POST`, `PATCH`, or `DELETE` on tasks: broadcast `tasks:updated` with full task array to all connected clients — same pattern as existing task broadcasting.

### Dev-Progress Parsing Removal

- Remove `parseDevProgress()` from `server/lib/sessions/opencode.cjs` (or wherever it lives)
- Remove `GET /api/tasks` handler that reads from markdown files
- Replace with SQLite-backed handler above

---

## Section 2: UI

### Component Structure

```
src/components/board/
  KanbanBoard.tsx         — generic reusable kanban container
  KanbanColumn.tsx        — single column with dnd-kit drop zone
  TaskCard.tsx            — card UI (migrated + enhanced from BoardPage)
  TaskCreateModal.tsx     — create + edit ticket modal
  TaskDetailDrawer.tsx    — slide-in drawer: Overview | Agent Work | Activity tabs
  TaskFilterBar.tsx       — search input + filter pills (agent, priority, tag)
```

`KanbanBoard` accepts generic `columns` and `items` config — reusable for future Pipeline/Workflow feature which will also use Kanban view.

### BoardPage Header

```
[Board]                              [+ New Ticket]
🔍 Search...   Agent▾   Priority▾   Tag▾
```

### TaskCard

```
┌─────────────────────────────────┐
│ 🤖 Tadaki              [urgent] │
│ Implement login page            │
│ Add OAuth + session management  │
│ ─────────────────────────────── │
│ #auth #frontend    $0.00   ···  │
└─────────────────────────────────┘
```

- Priority-colored left border (urgent=red, high=orange, medium=primary, low=muted)
- 3-dot menu: Edit / Delete / View Activity
- Entire card is draggable

### TaskDetailDrawer

Slides in from the right. Three tabs:

**Overview tab** — editable fields: title, description, status, priority, agent assignment, tags, cost.

**Agent Work tab** — session replay when `session_id` is present:
- Thinking blocks (collapsible)
- Tool calls with result toggles (show/hide)
- Final assistant response highlighted as "✅ Final Result"
- Reuses `gatewayMessagesToGroups()` from `useChatStore.ts` and existing session message rendering components
- Empty state when no session linked: *"Agent belum mulai bekerja pada ticket ini."*

**Activity tab** — chronological audit trail:
- Status changes (from → to)
- Agent assignments
- User notes/comments
- Cost updates

### Drag & Drop

Library: **dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`)

Flow: drag card to new column → optimistic store update → `PATCH /api/tasks/:id` with new status → on API failure, rollback to previous status in store.

---

## Section 3: Agent Script & Provisioning

### Shared Script: `~/.openclaw/scripts/update_task.sh`

```bash
#!/usr/bin/env bash
# update_task — Report task progress to AOC Board
# Usage: update_task <taskId> <status> [note] [sessionId]
#
# status: in_progress | done | blocked | todo

set -euo pipefail

TASK_ID="${1:?taskId required}"
STATUS="${2:?status required}"
NOTE="${3:-}"
SESSION_ID="${4:-}"

AOC_URL="${AOC_URL:-http://localhost:18800}"
AOC_TOKEN="${AOC_TOKEN:?AOC_TOKEN env var not set}"
AGENT_ID="${AOC_AGENT_ID:-}"   # set during provisioning, identifies actor in activity log

curl -sf -X PATCH "$AOC_URL/api/tasks/$TASK_ID" \
  -H "Authorization: Bearer $AOC_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"$STATUS\",
    \"note\": \"$NOTE\",
    \"sessionId\": \"$SESSION_ID\",
    \"agentId\": \"$AGENT_ID\"
  }"
```

Stored as a shared script with metadata in `~/.openclaw/scripts/.tools.json`.

### TOOLS.md Injection Block

When enabled for an agent via `toggleAgentCustomTool()`:

```markdown
<!-- custom-tool: update_task -->
## update_task

Report your progress on a task to the operations dashboard.

**When to use:** When you start working on an assigned task, when blocked, or when complete.

**Usage:**
```bash
~/.openclaw/scripts/update_task.sh <taskId> <status> [note] [sessionId]
```

**Status values:** `in_progress` | `done` | `blocked` | `todo`

**Examples:**
```bash
update_task.sh "abc123" "in_progress" "Starting OAuth implementation" "$SESSION_ID"
update_task.sh "abc123" "done" "OAuth complete, PR created" "$SESSION_ID"
update_task.sh "abc123" "blocked" "Waiting for API credentials"
```
<!-- /custom-tool: update_task -->
```

### New Agent Provisioning (`server/lib/agents/provision.cjs`)

At the end of `provisionAgent()`:

```javascript
await ensureUpdateTaskScript()           // idempotent — creates shared script if missing
await toggleAgentCustomTool(agentId, 'update_task', true)  // injects block into TOOLS.md
```

### Existing Agent Sync

**Auto-sync on server startup** — called in `server/index.cjs` after DB initialization completes (non-blocking, fire-and-forget):

```javascript
// server/index.cjs — after db.init()
syncTaskScriptForAllAgents().catch(err => console.warn('[task-sync]', err.message))

async function syncTaskScriptForAllAgents() {
  await ensureUpdateTaskScript()
  const agents = await getAllAgents()
  for (const agent of agents) {
    const tools = await listAgentCustomTools(agent.id)
    const enabled = [...tools.agent, ...tools.shared].some(
      t => t.name === 'update_task' && t.enabled
    )
    if (!enabled) {
      await toggleAgentCustomTool(agent.id, 'update_task', true)
    }
  }
}
```

**Manual trigger** — "Sync Task Script" button in Agent Detail Page → Skills & Tools → Custom Tools tab. Useful for individual agents without requiring server restart.

### `AOC_TOKEN` for Agents

Each agent needs `AOC_TOKEN` env var to authenticate against the API. Options:
- Set in agent workspace `.env` file during provisioning
- Or set in `openclaw.json` agent entry under `env`

Provisioning wizard should prompt for this or auto-populate from the dashboard's own token.

---

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Storage | SQLite (`aoc.db`) | Consistent with existing dashboard-specific data pattern |
| Dev-progress parsing | Remove entirely | Single source of truth, no dual-system complexity |
| Agent update mechanism | API call via script | Explicit, auditable, debuggable |
| Drag-and-drop library | dnd-kit | Accessible, no peer deps, battle-tested |
| KanbanBoard | Extracted as reusable component | Pipeline/Workflow feature will also use Kanban view |
| Session replay | Reuse existing `gatewayMessagesToGroups()` | Avoid duplicating session rendering logic |
| Existing agent sync | Server startup + manual button | No agent restart required, opt-in per agent too |
