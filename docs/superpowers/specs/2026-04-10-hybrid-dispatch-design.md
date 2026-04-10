# Hybrid Dispatch Mechanism — Design Spec
**Date:** 2026-04-10
**Status:** Approved

## Overview

Extend the AOC Board ticketing system with three complementary auto-dispatch mechanisms so agents work on assigned tasks without manual operator intervention:

1. **PATCH Hook** — server-side trigger when ticket moves to `todo` with an agent assigned
2. **HEARTBEAT Polling** — agent autonomously checks for todo tasks every ~30s via gateway heartbeat
3. **Startup Sweep** — on server start (after gateway connects), dispatch all pre-existing todo+assigned tickets

All three mechanisms are idempotent: only dispatch tickets with `status === 'todo'`. Moving a ticket back from `done` → `todo` re-triggers dispatch.

Agents work on **multiple tasks in parallel** — no queuing, no waiting for current tasks to finish.

---

## Section 1: Extracted `dispatchTaskToAgent(task)` Function

The current dispatch logic inside `POST /api/tasks/:id/dispatch` is extracted into a reusable async function callable by all three mechanisms.

```javascript
// server/index.cjs — shared dispatch function
async function dispatchTaskToAgent(task) {
  if (!task.agentId) throw new Error('Task has no assigned agent')
  if (!gatewayProxy.isConnected) throw new Error('Gateway not connected')

  const sessionResult = await gatewayProxy.sessionsCreate(task.agentId)
  const sessionKey = sessionResult.key || sessionResult.session_key || sessionResult.id
  if (!sessionKey) throw new Error('Gateway did not return a session key')

  const aocToken = process.env.DASHBOARD_TOKEN || ''
  const aocPort  = process.env.PORT || '18800'
  const aocUrl   = `http://localhost:${aocPort}`
  const curlBase = `curl -sf -X PATCH ${aocUrl}/api/tasks/${task.id} -H "Authorization: Bearer ${aocToken}" -H "Content-Type: application/json"`
  const tagsLine = (task.tags || []).length > 0 ? `Tags: ${task.tags.join(', ')}` : ''

  const message = [
    `📋 **Task Assigned: ${task.title}**`,
    ``,
    `Task ID: \`${task.id}\``,
    `Priority: ${task.priority || 'medium'}`,
    tagsLine,
    ``,
    task.description ? `**Description:**\n${task.description}` : '',
    ``,
    `---`,
    `IMPORTANT: Report your progress using ONE of these methods:`,
    ``,
    `**Method 1 — Script (preferred):**`,
    `\`update_task.sh ${task.id} in_progress "Starting..."\``,
    `\`update_task.sh ${task.id} done "Summary"\``,
    `\`update_task.sh ${task.id} blocked "Reason"\``,
    ``,
    `**Method 2 — Direct curl (fallback if script fails):**`,
    `\`${curlBase} -d '{"status":"in_progress","note":"Starting"}'\``,
    `\`${curlBase} -d '{"status":"done","note":"Summary here"}'\``,
    `\`${curlBase} -d '{"status":"blocked","note":"Reason here"}'\``,
    ``,
    `If you cannot complete the task for ANY reason, ALWAYS report it with status "blocked".`,
  ].filter(l => l !== null && l !== undefined).join('\n')

  await gatewayProxy.chatSend(sessionKey, message)

  db.updateTask(task.id, { sessionId: sessionKey, status: 'in_progress' })
  db.addTaskActivity({
    taskId: task.id,
    type: 'status_change',
    fromValue: task.status,
    toValue: 'in_progress',
    actor: 'system',
    note: `Auto-dispatched to agent ${task.agentId}`,
  })
  broadcastTasksUpdate()

  console.log(`[dispatch] Task ${task.id} → ${task.agentId} (session: ${sessionKey})`)
  return { sessionKey, agentId: task.agentId }
}
```

The existing `POST /api/tasks/:id/dispatch` route becomes a thin wrapper calling `dispatchTaskToAgent(task)`.

---

## Section 2: PATCH Hook (Auto-dispatch on Todo)

In the existing `PATCH /api/tasks/:id` route, after `db.updateTask()` succeeds, add:

```javascript
// Auto-dispatch when ticket moves to todo with an agent assigned
const justMovedToTodo = status !== undefined && status === 'todo' && before.status !== 'todo'
if (justMovedToTodo && after.agentId && gatewayProxy.isConnected) {
  dispatchTaskToAgent(after).catch(err =>
    console.warn('[auto-dispatch]', task.id, err.message)
  )
}
```

**Idempotency:** Only fires when `before.status !== 'todo'` — prevents re-dispatch if other fields are patched while ticket is already in todo.

**Non-blocking:** Fire-and-forget via `.catch()` — PATCH response returns immediately regardless of dispatch success.

---

## Section 3: HEARTBEAT Mechanism

### Script: `~/.openclaw/scripts/check_tasks.sh`

Created by `ensureCheckTasksScript()` in `server/lib/scripts.cjs` (same pattern as `ensureUpdateTaskScript()`):

```bash
#!/usr/bin/env bash
# check_tasks — List todo tasks assigned to this agent, sorted by priority
# Called automatically via HEARTBEAT.md

source "${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"

[ -z "$AOC_AGENT_ID" ] && exit 0   # no agent id configured, skip silently

TASKS=$(curl -sf "$AOC_URL/api/tasks?agentId=$AOC_AGENT_ID&status=todo" \
  -H "Authorization: Bearer $AOC_TOKEN" 2>/dev/null) || exit 0

echo "$TASKS" | python3 -c "
import json, sys
tasks = json.load(sys.stdin).get('tasks', [])
if not tasks:
    print('No pending tasks.')
    sys.exit(0)
order = {'urgent': 0, 'high': 1, 'medium': 2, 'low': 3}
for t in sorted(tasks, key=lambda t: order.get(t.get('priority', 'medium'), 2)):
    print(f\"[{t.get('priority','medium').upper()}] {t['title']}\")
    print(f\"  ID: {t['id']}\")
    print(f\"  Description: {t.get('description', '(none)')[:120]}\")
    print()
"
```

### HEARTBEAT.md Injection

`injectHeartbeatTaskCheck(agentId)` — reads agent's HEARTBEAT.md, replaces/appends the aoc-task-check block using HTML comment markers (idempotent):

```markdown
<!-- aoc-task-check -->
## Autonomous Task Check

Check if you have tasks assigned to you:

1. Run: `bash ~/.openclaw/scripts/check_tasks.sh`
2. If tasks are listed, pick the **highest priority** task (shown first) and start working on it immediately
3. You may work on **multiple tasks in parallel** — do not wait for current tasks to finish
4. For each task you start, immediately run:
   `update_task.sh <taskId> in_progress "Starting work"`
5. When done: `update_task.sh <taskId> done "Summary of what was done"`
6. If blocked: `update_task.sh <taskId> blocked "Specific reason"`
<!-- /aoc-task-check -->
```

**Idempotency:** Replace content between `<!-- aoc-task-check -->` and `<!-- /aoc-task-check -->` markers on every call. If markers absent, append to end of file.

### When injection runs:
- **Server startup** — `syncHeartbeatForAllAgents()` called after DB init
- **New agent provisioning** — `injectHeartbeatTaskCheck(agentId)` called in `provisionAgent()`

### Files modified:
- `server/lib/scripts.cjs` — add `ensureCheckTasksScript()`, `injectHeartbeatTaskCheck()`, export both
- `server/lib/index.cjs` — export both
- `server/lib/agents/provision.cjs` — call both on new agent
- `server/index.cjs` — call `syncHeartbeatForAllAgents()` at startup

---

## Section 4: Startup Sweep

Triggered when gateway connects (not on server start — gateway may connect with delay).

```javascript
// server/index.cjs — one-shot gateway:connected listener
let startupSweepDone = false

gatewayProxy.addListener(async (event) => {
  if (event.type === 'gateway:connected' && !startupSweepDone) {
    startupSweepDone = true
    await sweepPendingTasks()
  }
})

async function sweepPendingTasks() {
  try {
    const tasks = db.getAllTasks({ status: 'todo' })
    const pending = tasks.filter(t => t.agentId)
    if (pending.length === 0) return
    console.log(`[startup-sweep] Found ${pending.length} pending tasks, dispatching...`)
    for (const task of pending) {
      await dispatchTaskToAgent(task).catch(err =>
        console.warn(`[startup-sweep] task ${task.id}:`, err.message)
      )
    }
    console.log(`[startup-sweep] Done`)
  } catch (err) {
    console.warn('[startup-sweep] failed:', err.message)
  }
}
```

**One-shot**: `startupSweepDone` flag prevents re-sweep on gateway reconnects.  
**No throttling**: tasks dispatched sequentially without delay.

---

## File Map

**Modify:**
- `server/index.cjs` — extract `dispatchTaskToAgent()`, add PATCH hook, `sweepPendingTasks()`, gateway:connected listener
- `server/lib/scripts.cjs` — add `ensureCheckTasksScript()`, `injectHeartbeatTaskCheck()`
- `server/lib/index.cjs` — export both new functions
- `server/lib/agents/provision.cjs` — call `ensureCheckTasksScript()` + `injectHeartbeatTaskCheck()` on provision

---

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Parallel tasks | Yes | User requirement — agents don't wait |
| Throttling on startup sweep | None | User requirement — dispatch all immediately |
| Startup sweep trigger | `gateway:connected` event | Gateway needed for session creation |
| Startup sweep repeat | One-shot only | Prevent re-dispatch on gateway reconnects |
| HEARTBEAT idempotency | HTML comment markers | Same pattern as custom-tool injection |
| PATCH hook blocking | Non-blocking (fire & forget) | PATCH response must be immediate |
| Actor label on auto-dispatch | `"system"` | Distinguishes from user/agent in activity log |
