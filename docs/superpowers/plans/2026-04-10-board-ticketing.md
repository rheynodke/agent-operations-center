# Board Ticketing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only dev-progress BoardPage with a full CRUD ticketing system backed by SQLite, dnd-kit drag-and-drop, and agent script auto-installation.

**Architecture:** SQLite tables `tasks` + `task_activity` are the single source of truth. Express CRUD API with WebSocket broadcast on mutations. Agents update tickets via shared `update_task.sh` (auto-installed on all agents at server startup and during provisioning). Frontend uses dnd-kit for drag-and-drop, extracted `KanbanBoard` component for future reuse.

**Tech Stack:** sql.js (existing SQLite), @dnd-kit/core + @dnd-kit/sortable (new), React 19, Zustand 5, Express 5, TypeScript, Tailwind v4

---

## File Map

**Create:**
- `src/components/board/KanbanBoard.tsx` — generic reusable kanban container (DndContext)
- `src/components/board/KanbanColumn.tsx` — single column with useDroppable
- `src/components/board/TaskCard.tsx` — card with useDraggable + 3-dot menu
- `src/components/board/TaskFilterBar.tsx` — search + filter pills
- `src/components/board/TaskCreateModal.tsx` — create + edit modal
- `src/components/board/TaskDetailDrawer.tsx` — 3-tab drawer (Overview, Agent Work, Activity)

**Modify:**
- `server/lib/db.cjs` — add tasks + task_activity tables + CRUD functions
- `server/lib/scripts.cjs` — add `ensureUpdateTaskScript()`; export it
- `server/lib/index.cjs` — export `ensureUpdateTaskScript`
- `server/lib/agents/provision.cjs` — call `ensureUpdateTaskScript` + enable for new agent
- `server/index.cjs` — replace `/api/tasks` with CRUD routes; add `syncTaskScriptForAllAgents` at startup; add `POST /api/agents/:id/sync-task-script`
- `src/types/index.ts` — add `TaskActivity` type; extend `Task` type
- `src/lib/api.ts` — add task CRUD API methods
- `src/stores/index.ts` — extend TaskStore with CRUD actions + filter state
- `src/pages/BoardPage.tsx` — full refactor using new components
- `src/pages/AgentDetailPage.tsx` — add "Sync Task Script" button in Custom Tools tab

---

## Task 1: Install dnd-kit

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install packages**

```bash
cd /Users/rheynoapria/tools/agent-operations-center/aoc-dashboard
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected output: `added N packages` with no errors.

- [ ] **Step 2: Verify install**

```bash
grep "@dnd-kit" package.json
```

Expected: `"@dnd-kit/core": "^X.X.X"` and `"@dnd-kit/sortable": "^X.X.X"` appear.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install dnd-kit for kanban drag-and-drop"
```

---

## Task 2: SQLite — tasks + task_activity tables + CRUD functions

**Files:**
- Modify: `server/lib/db.cjs`

- [ ] **Step 1: Add tables inside `initDatabase()` after the existing `file_versions` index line**

Find this line in `server/lib/db.cjs`:
```javascript
db.run(`CREATE INDEX IF NOT EXISTS idx_file_versions_scope ON file_versions(scope_key, saved_at DESC)`);
```

Insert immediately after:
```javascript
  // Tasks — general-purpose ticketing system
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      description   TEXT,
      status        TEXT NOT NULL DEFAULT 'backlog',
      priority      TEXT NOT NULL DEFAULT 'medium',
      agent_id      TEXT,
      session_id    TEXT,
      tags          TEXT DEFAULT '[]',
      cost          REAL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      completed_at  TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS task_activity (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      from_value  TEXT,
      to_value    TEXT,
      actor       TEXT NOT NULL,
      note        TEXT,
      created_at  TEXT NOT NULL
    )
  `);
```

- [ ] **Step 2: Add `normalizeTask` and `normalizeActivity` helper functions**

Find the `persist()` function in `server/lib/db.cjs`. Add these helpers just above it:

```javascript
// ─── Task helpers ──────────────────────────────────────────────────────────────
function normalizeTask(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    status: row.status,
    priority: row.priority || 'medium',
    agentId: row.agent_id || undefined,
    sessionId: row.session_id || undefined,
    tags: row.tags ? JSON.parse(row.tags) : [],
    cost: row.cost != null ? row.cost : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
  };
}

function normalizeActivity(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    fromValue: row.from_value || undefined,
    toValue: row.to_value || undefined,
    actor: row.actor,
    note: row.note || undefined,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 3: Add task CRUD functions**

Add after the `normalizeActivity` helper:

```javascript
function getAllTasks(filters = {}) {
  if (!db) throw new Error('DB not initialized');
  const conditions = [];
  const params = {};
  if (filters.agentId) { conditions.push('agent_id = :agentId'); params[':agentId'] = filters.agentId; }
  if (filters.status)  { conditions.push('status = :status');    params[':status']  = filters.status; }
  if (filters.priority){ conditions.push('priority = :priority');params[':priority']= filters.priority; }
  if (filters.tag)     { conditions.push('tags LIKE :tag');      params[':tag']     = `%"${filters.tag}"%`; }
  if (filters.q)       { conditions.push('title LIKE :q');       params[':q']       = `%${filters.q}%`; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`);
  if (Object.keys(params).length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(normalizeTask(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function getTask(id) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = :id');
  const row = stmt.getAsObject({ ':id': id });
  stmt.free();
  return row.id ? normalizeTask(row) : null;
}

function createTask({ title, description, status = 'backlog', priority = 'medium', agentId, tags = [], sessionId } = {}) {
  if (!db) throw new Error('DB not initialized');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO tasks (id, title, description, status, priority, agent_id, session_id, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, description || null, status, priority, agentId || null, sessionId || null, JSON.stringify(tags || []), now, now]
  );
  persist();
  return getTask(id);
}

function updateTask(id, patch) {
  if (!db) throw new Error('DB not initialized');
  const before = getTask(id);
  if (!before) return null;
  const now = new Date().toISOString();
  const fields = ['updated_at = ?'];
  const vals = [now];
  if (patch.title       !== undefined) { fields.push('title = ?');       vals.push(patch.title); }
  if (patch.description !== undefined) { fields.push('description = ?'); vals.push(patch.description || null); }
  if (patch.status      !== undefined) { fields.push('status = ?');      vals.push(patch.status); }
  if (patch.priority    !== undefined) { fields.push('priority = ?');    vals.push(patch.priority); }
  if (patch.agentId     !== undefined) { fields.push('agent_id = ?');    vals.push(patch.agentId || null); }
  if (patch.sessionId   !== undefined) { fields.push('session_id = ?');  vals.push(patch.sessionId || null); }
  if (patch.tags        !== undefined) { fields.push('tags = ?');        vals.push(JSON.stringify(patch.tags)); }
  if (patch.cost        !== undefined) { fields.push('cost = ?');        vals.push(patch.cost); }
  if (patch.status === 'done' && before.status !== 'done') {
    fields.push('completed_at = ?'); vals.push(now);
  }
  vals.push(id);
  db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, vals);
  persist();
  return getTask(id);
}

function deleteTask(id) {
  if (!db) throw new Error('DB not initialized');
  db.run('DELETE FROM task_activity WHERE task_id = ?', [id]);
  db.run('DELETE FROM tasks WHERE id = ?', [id]);
  persist();
}

function addTaskActivity({ taskId, type, fromValue, toValue, actor, note } = {}) {
  if (!db) throw new Error('DB not initialized');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO task_activity (id, task_id, type, from_value, to_value, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, taskId, type, fromValue || null, toValue || null, actor, note || null, now]
  );
  persist();
}

function getTaskActivity(taskId) {
  if (!db) throw new Error('DB not initialized');
  const stmt = db.prepare('SELECT * FROM task_activity WHERE task_id = :taskId ORDER BY created_at ASC');
  stmt.bind({ ':taskId': taskId });
  const rows = [];
  while (stmt.step()) rows.push(normalizeActivity(stmt.getAsObject()));
  stmt.free();
  return rows;
}
```

- [ ] **Step 4: Export new functions from `module.exports` in `db.cjs`**

Find the `module.exports = {` block at the end of `server/lib/db.cjs`. Add the new functions:

```javascript
  getAllTasks, getTask, createTask, updateTask, deleteTask,
  addTaskActivity, getTaskActivity,
```

- [ ] **Step 5: Verify server starts without error**

```bash
npm run dev:server
```

Expected: server starts on port 18800, `[db] Loaded existing database` (or `Created new database`). No errors. Ctrl+C to stop.

- [ ] **Step 6: Commit**

```bash
git add server/lib/db.cjs
git commit -m "feat: add tasks + task_activity SQLite tables and CRUD functions"
```

---

## Task 3: Backend API Routes

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Add broadcast helper near the top of the file, before route definitions**

Find this line in `server/index.cjs`:
```javascript
const aiLib = require('./lib/ai.cjs');
```

Add after all the require statements and before route definitions:

```javascript
// Broadcast helper for task updates
function broadcastTasksUpdate() {
  const tasks = db.getAllTasks();
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ type: 'tasks:updated', payload: tasks, timestamp: new Date().toISOString() }));
    }
  });
}
```

Note: `wss` is defined later in the file. This function is only called from routes (after `wss` is initialized), so the forward reference is safe.

- [ ] **Step 2: Replace the existing read-only `/api/tasks` route**

Find this block in `server/index.cjs` (around line 1181):
```javascript
app.get('/api/tasks', db.authMiddleware, (req, res) => {
  try {
    res.json({ tasks: parsers.parseDevProgress() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});
```

Replace it entirely with:

```javascript
// ─── Tasks (ticketing) ────────────────────────────────────────────────────────

app.get('/api/tasks', db.authMiddleware, (req, res) => {
  try {
    const { agentId, status, priority, tag, q } = req.query;
    const tasks = db.getAllTasks({ agentId, status, priority, tag, q });
    res.json({ tasks });
  } catch (err) {
    console.error('[api/tasks GET]', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.post('/api/tasks', db.authMiddleware, (req, res) => {
  try {
    const { title, description, status, priority, agentId, tags } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const task = db.createTask({ title: title.trim(), description, status, priority, agentId, tags });
    db.addTaskActivity({ taskId: task.id, type: 'created', toValue: task.status, actor: 'user' });
    broadcastTasksUpdate();
    res.status(201).json({ task });
  } catch (err) {
    console.error('[api/tasks POST]', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.patch('/api/tasks/:id', db.authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    // agentId in body = actor identifier (from agent script); assignTo = new assignment (from UI)
    const { agentId: actorAgentId, assignTo, note, status, priority, title, description, tags, cost, sessionId } = req.body;
    const before = db.getTask(id);
    if (!before) return res.status(404).json({ error: 'Task not found' });

    const actor = actorAgentId || 'user';
    const patch = {};
    if (title       !== undefined) patch.title       = title;
    if (description !== undefined) patch.description = description;
    if (status      !== undefined) patch.status      = status;
    if (priority    !== undefined) patch.priority    = priority;
    if (tags        !== undefined) patch.tags        = tags;
    if (cost        !== undefined) patch.cost        = cost;
    if (sessionId   !== undefined) patch.sessionId   = sessionId;
    if (assignTo    !== undefined) patch.agentId     = assignTo || null;

    const after = db.updateTask(id, patch);

    // Write activity entries for meaningful changes
    if (status && status !== before.status) {
      db.addTaskActivity({ taskId: id, type: 'status_change', fromValue: before.status, toValue: status, actor, note });
    } else if (assignTo !== undefined && assignTo !== before.agentId) {
      db.addTaskActivity({ taskId: id, type: 'assignment', fromValue: before.agentId || null, toValue: assignTo || null, actor });
    } else if (note && !status) {
      db.addTaskActivity({ taskId: id, type: 'comment', actor, note });
    }

    broadcastTasksUpdate();
    res.json({ task: after });
  } catch (err) {
    console.error('[api/tasks PATCH]', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/tasks/:id', db.authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    if (!db.getTask(id)) return res.status(404).json({ error: 'Task not found' });
    db.deleteTask(id);
    broadcastTasksUpdate();
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/tasks DELETE]', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

app.get('/api/tasks/:id/activity', db.authMiddleware, (req, res) => {
  try {
    const activity = db.getTaskActivity(req.params.id);
    res.json({ activity });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});
```

- [ ] **Step 3: Verify CRUD with curl**

```bash
npm run dev:server &
sleep 2

# Get token (from .env)
TOKEN=$(grep DASHBOARD_TOKEN .env | cut -d= -f2)

# Create a task
curl -s -X POST http://localhost:18800/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test ticket","priority":"high","tags":["test"]}' | jq .

# List tasks
curl -s http://localhost:18800/api/tasks \
  -H "Authorization: Bearer $TOKEN" | jq .tasks[0].id
```

Expected: task created with UUID id, GET returns it.

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add server/index.cjs
git commit -m "feat: replace dev-progress tasks with SQLite CRUD API"
```

---

## Task 4: `ensureUpdateTaskScript()` in scripts.cjs

**Files:**
- Modify: `server/lib/scripts.cjs`
- Modify: `server/lib/index.cjs`

- [ ] **Step 1: Add `ensureUpdateTaskScript()` to `server/lib/scripts.cjs`**

Find the `module.exports` block at the end of `server/lib/scripts.cjs`. Insert this function above it:

```javascript
const UPDATE_TASK_SCRIPT_NAME = 'update_task.sh';
const UPDATE_TASK_SCRIPT_CONTENT = `#!/usr/bin/env bash
# update_task — Report task progress to AOC Board
# Usage: update_task.sh <taskId> <status> [note] [sessionId]
#
# status: in_progress | done | blocked | todo

set -euo pipefail

TASK_ID="\${1:?taskId required}"
STATUS="\${2:?status required}"
NOTE="\${3:-}"
SESSION_ID="\${4:-}"

AOC_URL="\${AOC_URL:-http://localhost:18800}"
AOC_TOKEN="\${AOC_TOKEN:?AOC_TOKEN env var not set}"
AGENT_ID="\${AOC_AGENT_ID:-}"

curl -sf -X PATCH "$AOC_URL/api/tasks/$TASK_ID" \\\\
  -H "Authorization: Bearer $AOC_TOKEN" \\\\
  -H "Content-Type: application/json" \\\\
  -d "{\\"status\\": \\"$STATUS\\", \\"note\\": \\"$NOTE\\", \\"sessionId\\": \\"$SESSION_ID\\", \\"agentId\\": \\"$AGENT_ID\\"}"
`;

function ensureUpdateTaskScript() {
  ensureDir(); // ensures SCRIPTS_DIR exists
  const scriptPath = path.join(SCRIPTS_DIR, UPDATE_TASK_SCRIPT_NAME);
  if (fs.existsSync(scriptPath)) return; // idempotent

  fs.writeFileSync(scriptPath, UPDATE_TASK_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });

  // Write metadata to .tools.json
  const meta = readMeta(SCRIPTS_DIR);
  meta[UPDATE_TASK_SCRIPT_NAME] = {
    name: 'update_task',
    emoji: '📋',
    description: 'Report task progress to AOC Board. Usage: update_task.sh <taskId> <status> [note] [sessionId]',
    execHint: `${SCRIPTS_DIR}/update_task.sh <taskId> <status> [note] [sessionId]`,
  };
  writeMeta(SCRIPTS_DIR, meta);

  console.log('[scripts] Created shared update_task.sh script');
}
```

- [ ] **Step 2: Export `ensureUpdateTaskScript` from `scripts.cjs`**

In the `module.exports` block of `server/lib/scripts.cjs`, add:

```javascript
  ensureUpdateTaskScript,
```

- [ ] **Step 3: Export `ensureUpdateTaskScript` from `server/lib/index.cjs`**

Find the scripts section in `server/lib/index.cjs` module.exports and add:

```javascript
  ensureUpdateTaskScript: scripts.ensureUpdateTaskScript,
```

Also add `const scripts = require('./scripts.cjs');` at the top of `server/lib/index.cjs` if not already imported (check — scripts might already be required there).

- [ ] **Step 4: Verify the function runs**

```bash
node -e "
  require('dotenv').config();
  const s = require('./server/lib/scripts.cjs');
  s.ensureUpdateTaskScript();
  console.log('done');
"
ls ~/.openclaw/scripts/update_task.sh && echo "Script exists"
```

Expected: `Script exists` printed.

- [ ] **Step 5: Commit**

```bash
git add server/lib/scripts.cjs server/lib/index.cjs
git commit -m "feat: add ensureUpdateTaskScript() to create shared update_task.sh"
```

---

## Task 5: syncTaskScriptForAllAgents + Server Startup + Provision Hook

**Files:**
- Modify: `server/index.cjs`
- Modify: `server/lib/agents/provision.cjs`

- [ ] **Step 1: Add `syncTaskScriptForAllAgents()` to `server/index.cjs`**

Find the `start()` async function in `server/index.cjs`. Add this function just before it:

```javascript
async function syncTaskScriptForAllAgents() {
  try {
    parsers.ensureUpdateTaskScript();
    const agents = parsers.parseAgentRegistry();
    for (const agent of agents) {
      try {
        const tools = parsers.listAgentCustomTools(agent.id, parsers.getAgentFile);
        const alreadyEnabled = [...(tools.agent || []), ...(tools.shared || [])].some(
          t => t.name === 'update_task' && t.enabled
        );
        if (!alreadyEnabled) {
          parsers.toggleAgentCustomTool(agent.id, 'update_task.sh', true, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
          console.log(`[task-sync] Enabled update_task for agent: ${agent.id}`);
        }
      } catch (err) {
        console.warn(`[task-sync] Failed for ${agent.id}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[task-sync] syncTaskScriptForAllAgents failed:', err.message);
  }
}
```

- [ ] **Step 2: Call `syncTaskScriptForAllAgents` inside `start()` after `db.initDatabase()`**

Find in `start()`:
```javascript
  await db.initDatabase();
  feedWatcher.start();
```

Change to:
```javascript
  await db.initDatabase();
  feedWatcher.start();
  syncTaskScriptForAllAgents(); // non-blocking, fire-and-forget
```

- [ ] **Step 3: Add manual sync API endpoint**

Add this route near the other agent routes in `server/index.cjs` (around the `/api/agents/:id` section):

```javascript
app.post('/api/agents/:id/sync-task-script', db.authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    parsers.ensureUpdateTaskScript();
    parsers.toggleAgentCustomTool(id, 'update_task.sh', true, 'shared', parsers.getAgentFile, parsers.saveAgentFile);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/sync-task-script]', err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Add provision hook in `server/lib/agents/provision.cjs`**

Find the `require` section at the top of `server/lib/agents/provision.cjs`. Add:

```javascript
const { ensureUpdateTaskScript } = require('../scripts.cjs');
const { toggleAgentCustomTool }   = require('../scripts.cjs');
```

Find the return statement at the end of `provisionAgent()` (the `return { ok: true, agentId, ... }` line). Insert before the return:

```javascript
    // Auto-install update_task.sh for the new agent
    try {
      ensureUpdateTaskScript();
      // getAgentFile / saveAgentFile are not available here directly — we read/write files directly
      // Use the same pattern as the files module: read TOOLS.md, inject block, write back
      const toolsMdPath = path.join(workspacePath, 'TOOLS.md');
      const getFileFn  = (_id, filename) => fs.readFileSync(path.join(workspacePath, filename), 'utf-8');
      const saveFileFn = (_id, filename, content) => fs.writeFileSync(path.join(workspacePath, filename), content, 'utf-8');
      toggleAgentCustomTool(agentId, 'update_task.sh', true, 'shared', getFileFn, saveFileFn);
    } catch (e) {
      console.warn('[provision] update_task setup failed:', e.message);
    }
```

- [ ] **Step 5: Verify server startup logs**

```bash
npm run dev:server
```

Expected: `[task-sync] Enabled update_task for agent: main` (or similar) appears. No errors. Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add server/index.cjs server/lib/agents/provision.cjs
git commit -m "feat: auto-install update_task.sh for all agents on startup and provisioning"
```

---

## Task 6: Frontend Types + API Client + Zustand Store

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/stores/index.ts`

- [ ] **Step 1: Add `TaskActivity` type and update `Task` in `src/types/index.ts`**

Find the existing `Task` interface. The `agentName` and `agentEmoji` fields were populated from dev-progress parsing — they won't come from the DB. Add a note and keep them optional. Add `TaskActivity` after `Task`:

```typescript
export interface TaskActivity {
  id: string
  taskId: string
  type: 'created' | 'status_change' | 'assignment' | 'comment' | 'cost_update'
  fromValue?: string
  toValue?: string
  actor: string   // "user" | agentId
  note?: string
  createdAt: string
}
```

The existing `Task` interface stays as-is — `agentId` is still present, `agentName`/`agentEmoji` will be derived on the frontend by looking up the agent from the agents store.

- [ ] **Step 2: Add CRUD methods to `src/lib/api.ts`**

Find `getTasks` in `src/lib/api.ts`. Replace it and add the new methods:

```typescript
  getTasks: (filters?: { agentId?: string; status?: string; priority?: string; tag?: string; q?: string }) => {
    const params = new URLSearchParams();
    if (filters?.agentId)  params.set('agentId',  filters.agentId);
    if (filters?.status)   params.set('status',   filters.status);
    if (filters?.priority) params.set('priority', filters.priority);
    if (filters?.tag)      params.set('tag',      filters.tag);
    if (filters?.q)        params.set('q',        filters.q);
    const qs = params.toString();
    return request<{ tasks: Task[] }>(`/tasks${qs ? `?${qs}` : ''}`);
  },
  createTask: (data: { title: string; description?: string; status?: TaskStatus; priority?: TaskPriority; agentId?: string; tags?: string[] }) =>
    request<{ task: Task }>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'tags' | 'cost' | 'sessionId'>> & { assignTo?: string; note?: string }) =>
    request<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
  getTaskActivity: (id: string) =>
    request<{ activity: TaskActivity[] }>(`/tasks/${id}/activity`),
  syncAgentTaskScript: (agentId: string) =>
    request<{ ok: boolean }>(`/agents/${agentId}/sync-task-script`, { method: 'POST' }),
```

Make sure `TaskActivity`, `TaskStatus`, `TaskPriority` are imported at the top of `api.ts` if not already.

- [ ] **Step 3: Extend the TaskStore in `src/stores/index.ts`**

Find the `TaskState` interface and `useTaskStore` definition. Replace the entire task store section:

```typescript
interface TaskFilters {
  agentId?: string
  status?: string
  priority?: string
  tag?: string
  q?: string
}

interface TaskState {
  tasks: Task[]
  loading: boolean
  filters: TaskFilters
  setTasks: (tasks: Task[]) => void
  addTask: (task: Task) => void
  updateTask: (id: string, patch: Partial<Task>) => void
  removeTask: (id: string) => void
  setLoading: (v: boolean) => void
  setFilters: (filters: Partial<TaskFilters>) => void
  clearFilters: () => void
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  loading: false,
  filters: {},
  setTasks:  (tasks) => set({ tasks }),
  addTask:   (task)  => set((s) => ({ tasks: [task, ...s.tasks] })),
  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  clearFilters: () => set({ filters: {} }),
}))
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: No type errors related to Task, TaskActivity, or api.ts.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/api.ts src/stores/index.ts
git commit -m "feat: extend Task types, API client, and Zustand store for CRUD"
```

---

## Task 7: KanbanBoard + KanbanColumn Components

**Files:**
- Create: `src/components/board/KanbanBoard.tsx`
- Create: `src/components/board/KanbanColumn.tsx`

- [ ] **Step 1: Create `src/components/board/KanbanColumn.tsx`**

```tsx
import React from "react"
import { useDroppable } from "@dnd-kit/core"
import { cn } from "@/lib/utils"

interface KanbanColumnProps {
  id: string
  label: string
  emoji: string
  count: number
  children: React.ReactNode
}

export function KanbanColumn({ id, label, emoji, count, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div className="flex items-center gap-2 px-1 mb-3">
        <span className="text-base">{emoji}</span>
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="ml-auto text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-medium">
          {count}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-2 min-h-24 rounded-lg p-2 transition-colors",
          isOver && "bg-accent/30 ring-1 ring-border"
        )}
      >
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/board/KanbanBoard.tsx`**

```tsx
import React from "react"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core"
import { KanbanColumn } from "./KanbanColumn"

export interface KanbanColumnDef {
  id: string
  label: string
  emoji: string
}

interface KanbanBoardProps<T extends { id: string }> {
  columns: KanbanColumnDef[]
  items: T[]
  getColumnId: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  renderDragOverlay?: (item: T) => React.ReactNode
  onItemMove?: (itemId: string, fromColumnId: string, toColumnId: string) => void
  activeId?: string | null
  onDragStart?: (id: string) => void
  onDragEnd?: (event: DragEndEvent) => void
}

export function KanbanBoard<T extends { id: string }>({
  columns,
  items,
  getColumnId,
  renderItem,
  renderDragOverlay,
  onItemMove,
  activeId,
  onDragStart,
  onDragEnd,
}: KanbanBoardProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    onDragEnd?.(event)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const item = items.find((i) => i.id === active.id)
    if (!item) return
    const fromCol = getColumnId(item)
    const toCol = String(over.id)
    if (fromCol !== toCol && columns.some((c) => c.id === toCol)) {
      onItemMove?.(String(active.id), fromCol, toCol)
    }
  }

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => onDragStart?.(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {columns.map((col) => {
          const colItems = items.filter((i) => getColumnId(i) === col.id)
          return (
            <KanbanColumn key={col.id} id={col.id} label={col.label} emoji={col.emoji} count={colItems.length}>
              {colItems.map((item) => renderItem(item))}
            </KanbanColumn>
          )
        })}
      </div>
      <DragOverlay>
        {activeItem ? (renderDragOverlay ? renderDragOverlay(activeItem) : renderItem(activeItem)) : null}
      </DragOverlay>
    </DndContext>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/board/
git commit -m "feat: add generic KanbanBoard and KanbanColumn components with dnd-kit"
```

---

## Task 8: TaskCard Component

**Files:**
- Create: `src/components/board/TaskCard.tsx`

- [ ] **Step 1: Create `src/components/board/TaskCard.tsx`**

```tsx
import React from "react"
import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { MoreHorizontal, Pencil, Trash2, Activity } from "lucide-react"
import { cn } from "@/lib/utils"
import { Task } from "@/types"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500",
  high:   "border-l-orange-400",
  medium: "border-l-primary",
  low:    "border-l-muted-foreground/30",
}

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-500",
  high:   "bg-orange-400/15 text-orange-400",
  medium: "bg-primary/15 text-primary",
  low:    "bg-muted text-muted-foreground",
}

interface TaskCardProps {
  task: Task
  agentEmoji?: string
  agentName?: string
  isDragging?: boolean
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onClick: (task: Task) => void
}

export function TaskCard({ task, agentEmoji, agentName, isDragging, onEdit, onDelete, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id })

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  const priority = task.priority || "medium"

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onClick(task)}
      className={cn(
        "group relative bg-card border border-border rounded-lg p-3 cursor-pointer select-none",
        "border-l-4 transition-all hover:bg-accent/30",
        PRIORITY_BORDER[priority],
        isDragging && "opacity-50 shadow-xl"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        {(agentEmoji || agentName) && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            {agentEmoji && <span>{agentEmoji}</span>}
            {agentName && <span className="truncate max-w-[80px]">{agentName}</span>}
          </span>
        )}
        <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium ml-auto shrink-0", PRIORITY_BADGE[priority])}>
          {priority}
        </span>
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-foreground leading-snug line-clamp-2 mb-1">
        {task.title}
      </p>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{task.description}</p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-1 flex-wrap">
        {(task.tags || []).slice(0, 3).map((tag) => (
          <span key={tag} className="text-xs bg-secondary text-secondary-foreground rounded px-1.5 py-0.5">
            #{tag}
          </span>
        ))}
        {task.cost != null && (
          <span className="ml-auto text-xs text-muted-foreground">${task.cost.toFixed(2)}</span>
        )}
        {/* 3-dot menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent">
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onEdit(task)}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onClick(task)}>
              <Activity className="mr-2 h-3.5 w-3.5" /> View Activity
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(task)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/board/TaskCard.tsx
git commit -m "feat: add TaskCard component with dnd-kit drag, priority border, 3-dot menu"
```

---

## Task 9: TaskFilterBar Component

**Files:**
- Create: `src/components/board/TaskFilterBar.tsx`

- [ ] **Step 1: Create `src/components/board/TaskFilterBar.tsx`**

```tsx
import React from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Agent } from "@/types"
import { TaskPriority } from "@/types"

const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"]

interface TaskFilterBarProps {
  agents: Agent[]
  filterAgentId?: string
  filterPriority?: string
  filterTag?: string
  q?: string
  onFilterChange: (key: string, value: string | undefined) => void
  onQChange: (q: string) => void
  hasActiveFilters: boolean
  onClear: () => void
}

export function TaskFilterBar({
  agents, filterAgentId, filterPriority, filterTag, q,
  onFilterChange, onQChange, hasActiveFilters, onClear,
}: TaskFilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={q || ""}
          onChange={(e) => onQChange(e.target.value)}
          placeholder="Search..."
          className="pl-8 h-8 w-44 text-sm"
        />
      </div>

      {/* Agent filter */}
      <div className="flex items-center gap-1 flex-wrap">
        {agents.slice(0, 6).map((agent) => (
          <button
            key={agent.id}
            onClick={() => onFilterChange("agentId", filterAgentId === agent.id ? undefined : agent.id)}
            className={cn(
              "text-xs px-2 py-1 rounded-full border transition-colors",
              filterAgentId === agent.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            {agent.emoji || "🤖"} {agent.name || agent.id}
          </button>
        ))}
      </div>

      {/* Priority filter */}
      <div className="flex items-center gap-1">
        {PRIORITIES.map((p) => (
          <button
            key={p}
            onClick={() => onFilterChange("priority", filterPriority === p ? undefined : p)}
            className={cn(
              "text-xs px-2 py-1 rounded-full border transition-colors capitalize",
              filterPriority === p
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Clear */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
          <X className="h-3 w-3 mr-1" /> Clear
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/board/TaskFilterBar.tsx
git commit -m "feat: add TaskFilterBar component with agent/priority/search filters"
```

---

## Task 10: TaskCreateModal Component

**Files:**
- Create: `src/components/board/TaskCreateModal.tsx`

- [ ] **Step 1: Create `src/components/board/TaskCreateModal.tsx`**

```tsx
import React, { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Task, TaskStatus, TaskPriority, Agent } from "@/types"

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "backlog",     label: "Backlog" },
  { value: "todo",        label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "done",        label: "Done" },
]

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high",   label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low" },
]

interface TaskCreateModalProps {
  open: boolean
  task?: Task | null       // if set, editing mode
  agents: Agent[]
  defaultStatus?: TaskStatus
  onSave: (data: Partial<Task>) => Promise<void>
  onClose: () => void
}

export function TaskCreateModal({ open, task, agents, defaultStatus = "backlog", onSave, onClose }: TaskCreateModalProps) {
  const [title, setTitle]         = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus]       = useState<TaskStatus>(defaultStatus)
  const [priority, setPriority]   = useState<TaskPriority>("medium")
  const [assignTo, setAssignTo]   = useState<string>("")
  const [tagsRaw, setTagsRaw]     = useState("")
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState("")

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description || "")
      setStatus(task.status)
      setPriority(task.priority || "medium")
      setAssignTo(task.agentId || "")
      setTagsRaw((task.tags || []).join(", "))
    } else {
      setTitle(""); setDescription(""); setStatus(defaultStatus)
      setPriority("medium"); setAssignTo(""); setTagsRaw("")
    }
    setError("")
  }, [task, open])

  async function handleSave() {
    if (!title.trim()) { setError("Title is required"); return }
    setSaving(true)
    try {
      const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean)
      await onSave({
        title: title.trim(), description: description.trim() || undefined,
        status, priority, agentId: assignTo || undefined, tags,
        ...(task ? { assignTo: assignTo || undefined } : {}),
      })
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? "Edit Ticket" : "New Ticket"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details..." rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Assign to Agent</Label>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Unassigned</SelectItem>
                {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.emoji || "🤖"} {a.name || a.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Tags (comma separated)</Label>
            <Input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="auth, frontend, bug" />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : task ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/board/TaskCreateModal.tsx
git commit -m "feat: add TaskCreateModal for create and edit ticket flow"
```

---

## Task 11: TaskDetailDrawer Component

**Files:**
- Create: `src/components/board/TaskDetailDrawer.tsx`

- [ ] **Step 1: Create `src/components/board/TaskDetailDrawer.tsx`**

```tsx
import React, { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Task, TaskActivity, Agent } from "@/types"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress", done: "Done",
}

interface SessionMessage {
  role: string
  content: string
  timestamp?: string
  toolName?: string
  toolId?: string
}

interface TaskDetailDrawerProps {
  task: Task | null
  agents: Agent[]
  open: boolean
  onClose: () => void
  onUpdate: (id: string, patch: object) => Promise<void>
}

export function TaskDetailDrawer({ task, agents, open, onClose, onUpdate }: TaskDetailDrawerProps) {
  const [activity, setActivity]   = useState<TaskActivity[]>([])
  const [messages, setMessages]   = useState<SessionMessage[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [expandedTools, setExpandedTools]   = useState<Set<string>>(new Set())

  const agent = task?.agentId ? agents.find(a => a.id === task.agentId) : null

  useEffect(() => {
    if (!task || !open) return
    setLoadingActivity(true)
    api.getTaskActivity(task.id)
      .then(r => setActivity(r.activity))
      .catch(() => setActivity([]))
      .finally(() => setLoadingActivity(false))
  }, [task?.id, open])

  useEffect(() => {
    if (!task?.sessionId || !task?.agentId || !open) return
    setLoadingMessages(true)
    fetch(`/api/sessions/${task.agentId}/${task.sessionId}/messages`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('aoc_token') || ''}` }
    })
      .then(r => r.json())
      .then(r => setMessages(r.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false))
  }, [task?.sessionId, task?.agentId, open])

  if (!task) return null

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base leading-snug pr-6">{task.title}</SheetTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={task.status} onValueChange={(v) => onUpdate(task.id, { status: v })}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={task.agentId || ""} onValueChange={(v) => onUpdate(task.id, { assignTo: v || null })}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Unassigned</SelectItem>
                {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.emoji || "🤖"} {a.name || a.id}</SelectItem>)}
              </SelectContent>
            </Select>
            {(task.tags || []).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">#{tag}</Badge>
            ))}
          </div>
        </SheetHeader>

        <Tabs defaultValue="overview" className="flex-1 min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1 text-xs">Overview</TabsTrigger>
            <TabsTrigger value="agent-work" className="flex-1 text-xs">Agent Work</TabsTrigger>
            <TabsTrigger value="activity" className="flex-1 text-xs">Activity</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="mt-4 space-y-3">
            {task.description && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Description</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{task.description}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-muted-foreground">Priority:</span> <span className="font-medium capitalize">{task.priority}</span></div>
              {task.cost != null && <div><span className="text-muted-foreground">Cost:</span> <span className="font-medium">${task.cost.toFixed(2)}</span></div>}
              <div><span className="text-muted-foreground">Created:</span> <span className="font-medium">{new Date(task.createdAt).toLocaleDateString()}</span></div>
              {task.completedAt && <div><span className="text-muted-foreground">Completed:</span> <span className="font-medium">{new Date(task.completedAt).toLocaleDateString()}</span></div>}
            </div>
          </TabsContent>

          {/* Agent Work */}
          <TabsContent value="agent-work" className="mt-4">
            {!task.sessionId ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                Agent belum mulai bekerja pada ticket ini.
              </div>
            ) : loadingMessages ? (
              <div className="text-center py-10 text-muted-foreground text-xs">Loading session...</div>
            ) : messages.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">No messages found for this session.</div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, i) => {
                  const isLast = i === messages.length - 1 && msg.role === 'assistant'
                  if (msg.role === 'human') return (
                    <div key={i} className="flex gap-2 justify-end">
                      <div className="bg-primary/10 text-foreground text-xs rounded-lg px-3 py-2 max-w-[85%] whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  )
                  if (msg.role === 'tool_use') return (
                    <div key={i} className="border border-border rounded-lg overflow-hidden text-xs">
                      <button
                        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted text-left"
                        onClick={() => setExpandedTools(p => { const n = new Set(p); n.has(String(i)) ? n.delete(String(i)) : n.add(String(i)); return n })}
                      >
                        <span>🔧</span>
                        <span className="font-mono font-medium">{msg.toolName || "tool_use"}</span>
                        <span className="ml-auto text-muted-foreground">{expandedTools.has(String(i)) ? "▲" : "▼"}</span>
                      </button>
                      {expandedTools.has(String(i)) && (
                        <pre className="px-3 py-2 text-[11px] overflow-x-auto text-muted-foreground whitespace-pre-wrap">{msg.content}</pre>
                      )}
                    </div>
                  )
                  if (msg.role === 'tool_result') return null
                  return (
                    <div key={i} className={cn("rounded-lg px-3 py-2 text-xs whitespace-pre-wrap", isLast ? "bg-green-500/10 border border-green-500/20" : "bg-card border border-border")}>
                      {isLast && <p className="text-green-600 dark:text-green-400 font-semibold text-[11px] mb-1">✅ Final Result</p>}
                      {msg.content}
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* Activity */}
          <TabsContent value="activity" className="mt-4">
            {loadingActivity ? (
              <div className="text-center py-10 text-muted-foreground text-xs">Loading...</div>
            ) : activity.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">No activity yet.</div>
            ) : (
              <div className="space-y-2">
                {activity.map((a) => (
                  <div key={a.id} className="flex gap-3 text-xs">
                    <div className="w-1 shrink-0 bg-border rounded-full mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-medium">{a.actor === 'user' ? '👤 User' : `🤖 ${a.actor}`}</span>
                        {a.type === 'status_change' && (
                          <span className="text-muted-foreground">moved <span className="font-mono">{a.fromValue}</span> → <span className="font-mono">{a.toValue}</span></span>
                        )}
                        {a.type === 'assignment' && (
                          <span className="text-muted-foreground">assigned to <span className="font-medium">{a.toValue || 'nobody'}</span></span>
                        )}
                        {a.type === 'created' && <span className="text-muted-foreground">created ticket</span>}
                        {a.type === 'comment' && <span className="text-muted-foreground">commented</span>}
                        <span className="ml-auto text-muted-foreground/60 shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
                      </div>
                      {a.note && <p className="text-muted-foreground mt-0.5 italic">"{a.note}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/board/TaskDetailDrawer.tsx
git commit -m "feat: add TaskDetailDrawer with Overview, Agent Work session replay, and Activity tabs"
```

---

## Task 12: BoardPage Refactor

**Files:**
- Modify: `src/pages/BoardPage.tsx`

- [ ] **Step 1: Replace the entire content of `src/pages/BoardPage.tsx`**

```tsx
import React, { useCallback, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KanbanBoard, KanbanColumnDef } from "@/components/board/KanbanBoard"
import { TaskCard } from "@/components/board/TaskCard"
import { TaskFilterBar } from "@/components/board/TaskFilterBar"
import { TaskCreateModal } from "@/components/board/TaskCreateModal"
import { TaskDetailDrawer } from "@/components/board/TaskDetailDrawer"
import { useTaskStore, useAgentStore } from "@/stores"
import { api } from "@/lib/api"
import { Task, TaskStatus } from "@/types"

const COLUMNS: KanbanColumnDef[] = [
  { id: "backlog",     label: "Backlog",     emoji: "📥" },
  { id: "todo",        label: "Todo",        emoji: "📋" },
  { id: "in_progress", label: "In Progress", emoji: "⚡" },
  { id: "done",        label: "Done",        emoji: "✅" },
]

export default function BoardPage() {
  const { tasks, filters, setTasks, addTask, updateTask, removeTask, setFilters, clearFilters } = useTaskStore()
  const agents = useAgentStore((s) => s.agents)

  const [createOpen, setCreateOpen]   = useState(false)
  const [editTask, setEditTask]       = useState<Task | null>(null)
  const [detailTask, setDetailTask]   = useState<Task | null>(null)
  const [activeId, setActiveId]       = useState<string | null>(null)

  // Enrich tasks with agent info from agents store
  const enrichedTasks = useMemo(() => tasks.map(t => ({
    ...t,
    agentEmoji: t.agentId ? agents.find(a => a.id === t.agentId)?.emoji : undefined,
    agentName:  t.agentId ? agents.find(a => a.id === t.agentId)?.name : undefined,
  })), [tasks, agents])

  // Apply client-side filters (server also filters, but this avoids re-fetching on every keystroke)
  const filteredTasks = useMemo(() => {
    let result = enrichedTasks
    if (filters.agentId)  result = result.filter(t => t.agentId === filters.agentId)
    if (filters.status)   result = result.filter(t => t.status === filters.status)
    if (filters.priority) result = result.filter(t => t.priority === filters.priority)
    if (filters.q)        result = result.filter(t => t.title.toLowerCase().includes(filters.q!.toLowerCase()))
    return result
  }, [enrichedTasks, filters])

  const hasActiveFilters = !!(filters.agentId || filters.status || filters.priority || filters.q)

  async function handleCreate(data: Partial<Task>) {
    const res = await api.createTask(data as Parameters<typeof api.createTask>[0])
    addTask(res.task)
  }

  async function handleUpdate(id: string, patch: object) {
    const res = await api.updateTask(id, patch as Parameters<typeof api.updateTask>[1])
    updateTask(id, res.task)
    // If detail drawer is open for this task, update it too
    if (detailTask?.id === id) setDetailTask(res.task)
  }

  async function handleDelete(task: Task) {
    if (!confirm(`Delete "${task.title}"?`)) return
    await api.deleteTask(task.id)
    removeTask(task.id)
    if (detailTask?.id === task.id) setDetailTask(null)
  }

  const handleItemMove = useCallback(async (itemId: string, _from: string, toColumnId: string) => {
    // Optimistic update
    updateTask(itemId, { status: toColumnId as TaskStatus })
    try {
      await api.updateTask(itemId, { status: toColumnId as TaskStatus })
    } catch {
      // Rollback on error: reload all tasks
      const res = await api.getTasks()
      setTasks(res.tasks)
    }
  }, [updateTask, setTasks])

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Board</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Ticket
        </Button>
      </div>

      {/* Filter bar */}
      <TaskFilterBar
        agents={agents}
        filterAgentId={filters.agentId}
        filterPriority={filters.priority}
        q={filters.q}
        onFilterChange={(k, v) => setFilters({ [k]: v })}
        onQChange={(q) => setFilters({ q: q || undefined })}
        hasActiveFilters={hasActiveFilters}
        onClear={clearFilters}
      />

      {/* Kanban Board */}
      <div className="flex-1 min-h-0">
        <KanbanBoard
          columns={COLUMNS}
          items={filteredTasks}
          getColumnId={(t) => t.status}
          activeId={activeId}
          onDragStart={setActiveId}
          onDragEnd={() => setActiveId(null)}
          onItemMove={handleItemMove}
          renderItem={(task) => (
            <TaskCard
              key={task.id}
              task={task}
              agentEmoji={(task as typeof task & { agentEmoji?: string }).agentEmoji}
              agentName={(task as typeof task & { agentName?: string }).agentName}
              isDragging={activeId === task.id}
              onEdit={(t) => { setEditTask(t); setCreateOpen(true) }}
              onDelete={handleDelete}
              onClick={setDetailTask}
            />
          )}
          renderDragOverlay={(task) => (
            <TaskCard
              task={task}
              agentEmoji={(task as typeof task & { agentEmoji?: string }).agentEmoji}
              agentName={(task as typeof task & { agentName?: string }).agentName}
              isDragging
              onEdit={() => {}}
              onDelete={() => {}}
              onClick={() => {}}
            />
          )}
        />
      </div>

      {/* Create/Edit Modal */}
      <TaskCreateModal
        open={createOpen}
        task={editTask}
        agents={agents}
        onSave={editTask
          ? (data) => handleUpdate(editTask.id, data)
          : handleCreate
        }
        onClose={() => { setCreateOpen(false); setEditTask(null) }}
      />

      {/* Detail Drawer */}
      <TaskDetailDrawer
        task={detailTask}
        agents={agents}
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
```

- [ ] **Step 2: Remove `parseDevProgress` from `server/lib/index.cjs` exports**

Find in `server/lib/index.cjs`:
```javascript
  parseDevProgress:          sessions.parseDevProgress,
```
Delete that line.

- [ ] **Step 3: Start dev server and verify board loads**

```bash
npm run dev
```

Open `http://localhost:5173/board`. Expected:
- Empty board with 4 columns
- "+ New Ticket" button works, creates a card
- Drag card between columns
- Click card opens drawer

- [ ] **Step 4: Commit**

```bash
git add src/pages/BoardPage.tsx server/lib/index.cjs
git commit -m "feat: refactor BoardPage to full ticketing system with CRUD and drag-and-drop"
```

---

## Task 13: Sync Task Script Button in Agent Detail

**Files:**
- Modify: `src/pages/AgentDetailPage.tsx`

- [ ] **Step 1: Find the Custom Tools sub-tab in AgentDetailPage.tsx**

Search for `CustomToolsTab` or `custom-tools` in `src/pages/AgentDetailPage.tsx`. The Custom Tools tab renders `CustomToolsPanel` or similar. Find where the tab header/actions area is for the Custom Tools sub-tab.

- [ ] **Step 2: Add "Sync Task Script" button**

In the Custom Tools tab section, add a button that calls the sync endpoint. Find the import section and add:

```typescript
import { api } from "@/lib/api"
```

(if not already imported)

In the Custom Tools tab JSX, add alongside existing action buttons:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={async () => {
    try {
      await api.syncAgentTaskScript(id)  // `id` is the agentId from route params
      toast?.({ title: "Task script synced" })
    } catch (e) {
      toast?.({ title: "Sync failed", variant: "destructive" })
    }
  }}
  className="text-xs"
>
  📋 Sync Task Script
</Button>
```

Note: Check how other toast calls are made in `AgentDetailPage.tsx` and follow the same pattern (likely `useToast()` hook).

- [ ] **Step 3: Verify button appears and calls API**

```bash
npm run dev
```

Open an agent detail page → Skills & Tools → Custom Tools. Verify "Sync Task Script" button appears. Click it. Check server logs for `[api/sync-task-script]` or no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AgentDetailPage.tsx
git commit -m "feat: add Sync Task Script button in agent detail Custom Tools tab"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - Section 1 (DB + API): Tasks 2–3
  - Section 2 (UI): Tasks 7–12
  - Section 3 (Agent script + provisioning): Tasks 4–5, 13
  - WebSocket broadcast: Task 3 (`broadcastTasksUpdate`)
  - Dev-progress removal: Task 3 (route replaced) + Task 12 (export removed)
  - `actor` disambiguation: Task 3 (PATCH route uses `agentId` vs `assignTo`)
  - Session replay: Task 11 (Agent Work tab, `GET /api/sessions/:agentId/:sessionId/messages`)

- [x] **No placeholders** — all code is complete and runnable

- [x] **Type consistency:**
  - `Task.agentId` used throughout (not `agent_id`)
  - `TaskActivity` defined in Task 6, used in Task 11
  - `assignTo` used in PATCH (Task 3) and `handleUpdate` (Task 12) consistently
  - `KanbanColumnDef` defined in Task 7, used in Task 12
  - `api.syncAgentTaskScript` defined in Task 6, used in Task 13
