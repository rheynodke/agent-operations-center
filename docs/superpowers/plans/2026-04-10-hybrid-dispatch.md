# Hybrid Dispatch Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three auto-dispatch mechanisms so agents autonomously pick up assigned tasks: PATCH hook (instant), HEARTBEAT polling (30s), and startup sweep (on gateway connect).

**Architecture:** Extract `dispatchTaskToAgent()` as a shared function called by all three triggers. HEARTBEAT injection adds a task-check block to each agent's HEARTBEAT.md. Startup sweep fires once on `gateway:connected` event. No throttling anywhere.

**Tech Stack:** Node.js CommonJS, Express 5, sql.js, OpenClaw gateway WebSocket

---

## File Map

**Modify:**
- `server/lib/scripts.cjs` — add `ensureCheckTasksScript()`, `injectHeartbeatTaskCheck(agentId, workspacePath)`
- `server/lib/index.cjs` — export both new functions
- `server/index.cjs` — extract `dispatchTaskToAgent()`, refactor dispatch route, add PATCH hook, `syncHeartbeatForAllAgents()`, `sweepPendingTasks()`, gateway listener
- `server/lib/agents/provision.cjs` — call `ensureCheckTasksScript()` + `injectHeartbeatTaskCheck()` on new agent

---

## Task 1: ensureCheckTasksScript() + injectHeartbeatTaskCheck() in scripts.cjs

**Files:**
- Modify: `server/lib/scripts.cjs`
- Modify: `server/lib/index.cjs`

- [ ] **Step 1: Add `ensureCheckTasksScript()` to `server/lib/scripts.cjs`**

Find the `function ensureAocEnvFile()` block in `server/lib/scripts.cjs`. Insert this immediately before it:

```javascript
const CHECK_TASKS_SCRIPT_NAME = 'check_tasks.sh';
const CHECK_TASKS_SCRIPT_CONTENT = `#!/usr/bin/env bash
# check_tasks — List todo tasks assigned to this agent, sorted by priority
# Called automatically via HEARTBEAT.md

source "\${OPENCLAW_HOME:-$HOME/.openclaw}/.aoc_env"

[ -z "$AOC_AGENT_ID" ] && exit 0   # no agent id configured, skip silently

TASKS=$(curl -sf "$AOC_URL/api/tasks?agentId=$AOC_AGENT_ID&status=todo" \\
  -H "Authorization: Bearer $AOC_TOKEN" 2>/dev/null) || exit 0

echo "$TASKS" | python3 -c "
import json, sys
tasks = json.load(sys.stdin).get('tasks', [])
if not tasks:
    print('No pending tasks.')
    sys.exit(0)
order = {'urgent': 0, 'high': 1, 'medium': 2, 'low': 3}
for t in sorted(tasks, key=lambda t: order.get(t.get('priority', 'medium'), 2)):
    print(f\\"[{t.get('priority','medium').upper()}] {t['title']}\\")
    print(f\\"  ID: {t['id']}\\")
    print(f\\"  Description: {t.get('description', '(none)')[:120]}\\")
    print()
"
`;

function ensureCheckTasksScript() {
  ensureDir();
  const scriptPath = path.join(SCRIPTS_DIR, CHECK_TASKS_SCRIPT_NAME);
  if (fs.existsSync(scriptPath)) return; // idempotent

  fs.writeFileSync(scriptPath, CHECK_TASKS_SCRIPT_CONTENT, { mode: 0o755, encoding: 'utf-8' });

  const meta = readMeta(SCRIPTS_DIR);
  meta[CHECK_TASKS_SCRIPT_NAME] = {
    name: 'check_tasks',
    emoji: '🔍',
    description: 'List todo tasks assigned to this agent, sorted by priority. Called via HEARTBEAT.md.',
    execHint: `${SCRIPTS_DIR}/check_tasks.sh`,
  };
  writeMeta(SCRIPTS_DIR, meta);

  console.log('[scripts] Created shared check_tasks.sh script');
}
```

- [ ] **Step 2: Add `injectHeartbeatTaskCheck()` to `server/lib/scripts.cjs`**

Insert immediately after `ensureCheckTasksScript()`:

```javascript
const HEARTBEAT_BLOCK_START = '<!-- aoc-task-check -->';
const HEARTBEAT_BLOCK_END   = '<!-- /aoc-task-check -->';
const HEARTBEAT_BLOCK_CONTENT = `${HEARTBEAT_BLOCK_START}
## Autonomous Task Check

Check if you have tasks assigned to you:

1. Run: \`bash ~/.openclaw/scripts/check_tasks.sh\`
2. If tasks are listed, pick the **highest priority** task (shown first) and start working on it immediately
3. You may work on **multiple tasks in parallel** — do not wait for current tasks to finish
4. For each task you start, immediately run:
   \`update_task.sh <taskId> in_progress "Starting work"\`
5. When done: \`update_task.sh <taskId> done "Summary of what was done"\`
6. If blocked: \`update_task.sh <taskId> blocked "Specific reason"\`
${HEARTBEAT_BLOCK_END}`;

function injectHeartbeatTaskCheck(agentId, workspacePath) {
  const heartbeatPath = path.join(workspacePath, 'HEARTBEAT.md');

  // Create HEARTBEAT.md if it doesn't exist
  if (!fs.existsSync(heartbeatPath)) {
    fs.writeFileSync(heartbeatPath, HEARTBEAT_BLOCK_CONTENT + '\n', 'utf-8');
    console.log(`[scripts] Created HEARTBEAT.md for agent: ${agentId}`);
    return;
  }

  let content = fs.readFileSync(heartbeatPath, 'utf-8');
  const startIdx = content.indexOf(HEARTBEAT_BLOCK_START);
  const endIdx   = content.indexOf(HEARTBEAT_BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing block
    content = content.slice(0, startIdx) + HEARTBEAT_BLOCK_CONTENT + content.slice(endIdx + HEARTBEAT_BLOCK_END.length);
  } else {
    // Append new block
    content = content.trimEnd() + '\n\n' + HEARTBEAT_BLOCK_CONTENT + '\n';
  }

  fs.writeFileSync(heartbeatPath, content, 'utf-8');
  console.log(`[scripts] Injected HEARTBEAT task check for agent: ${agentId}`);
}
```

- [ ] **Step 3: Export both from `scripts.cjs` module.exports**

Find the `module.exports` block at the bottom of `server/lib/scripts.cjs`. Add:

```javascript
  ensureCheckTasksScript,
  injectHeartbeatTaskCheck,
```

- [ ] **Step 4: Export both from `server/lib/index.cjs`**

Find the scripts section in `server/lib/index.cjs` (around `ensureUpdateTaskScript` and `ensureAocEnvFile`). Add:

```javascript
  ensureCheckTasksScript:    scriptsLib.ensureCheckTasksScript,
  injectHeartbeatTaskCheck:  scriptsLib.injectHeartbeatTaskCheck,
```

- [ ] **Step 5: Verify syntax**

```bash
node --check server/lib/scripts.cjs && node --check server/lib/index.cjs && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`

- [ ] **Step 6: Manual smoke test**

```bash
node -e "
  require('dotenv').config();
  const s = require('./server/lib/scripts.cjs');
  s.ensureCheckTasksScript();
  console.log('check_tasks.sh:', require('fs').existsSync(require('os').homedir() + '/.openclaw/scripts/check_tasks.sh') ? 'EXISTS' : 'MISSING');
"
```

Expected: `check_tasks.sh: EXISTS`

- [ ] **Step 7: Commit**

```bash
git add server/lib/scripts.cjs server/lib/index.cjs
git commit -m "feat: add ensureCheckTasksScript() and injectHeartbeatTaskCheck() for HEARTBEAT polling"
```

---

## Task 2: Extract dispatchTaskToAgent() + Refactor Dispatch Route

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Add `dispatchTaskToAgent()` function before the dispatch route**

Find the comment `// Dispatch task to agent via gateway chat session` in `server/index.cjs`. Insert this function immediately BEFORE that comment:

```javascript
// ── Shared dispatch logic (called by manual dispatch, PATCH hook, and startup sweep) ──
async function dispatchTaskToAgent(task) {
  if (!task.agentId) throw new Error('Task has no assigned agent');
  if (!gatewayProxy.isConnected) throw new Error('Gateway not connected');

  const sessionResult = await gatewayProxy.sessionsCreate(task.agentId);
  const sessionKey = sessionResult.key || sessionResult.session_key || sessionResult.id;
  if (!sessionKey) throw new Error('Gateway did not return a session key');

  const aocToken = process.env.DASHBOARD_TOKEN || '';
  const aocPort  = process.env.PORT || '18800';
  const aocUrl   = `http://localhost:${aocPort}`;
  const curlBase = `curl -sf -X PATCH ${aocUrl}/api/tasks/${task.id} -H "Authorization: Bearer ${aocToken}" -H "Content-Type: application/json"`;
  const tagsLine = (task.tags || []).length > 0 ? `Tags: ${task.tags.join(', ')}` : '';

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
  ].filter(l => l !== null && l !== undefined).join('\n');

  await gatewayProxy.chatSend(sessionKey, message);

  db.updateTask(task.id, { sessionId: sessionKey, status: 'in_progress' });
  db.addTaskActivity({
    taskId: task.id,
    type: 'status_change',
    fromValue: task.status,
    toValue: 'in_progress',
    actor: 'system',
    note: `Dispatched to agent ${task.agentId}`,
  });
  broadcastTasksUpdate();

  console.log(`[dispatch] Task ${task.id} → ${task.agentId} (session: ${sessionKey})`);
  return { sessionKey, agentId: task.agentId };
}
```

- [ ] **Step 2: Replace the body of the dispatch route with a thin wrapper**

Find the entire `app.post('/api/tasks/:id/dispatch', ...)` route body and replace it with:

```javascript
app.post('/api/tasks/:id/dispatch', db.authMiddleware, async (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.agentId) return res.status(400).json({ error: 'Task must be assigned to an agent first' });
    if (!gatewayProxy.isConnected) return res.status(503).json({ error: 'Gateway not connected' });
    const result = await dispatchTaskToAgent(task);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/tasks/dispatch]', err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Verify syntax**

```bash
node --check server/index.cjs && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`

- [ ] **Step 4: Test manual dispatch still works**

```bash
node server/index.cjs &
sleep 3
TOKEN=$(grep DASHBOARD_TOKEN .env | cut -d= -f2 | tr -d ' \r\n')
# Create a test task assigned to main agent
TASK_ID=$(curl -sf -X POST http://localhost:18800/api/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"dispatch refactor test","agentId":"main","status":"todo"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['task']['id'])")
echo "Task: $TASK_ID"
# Cleanup
curl -sf -X DELETE http://localhost:18800/api/tasks/$TASK_ID -H "Authorization: Bearer $TOKEN" > /dev/null
kill %1 2>/dev/null
```

Expected: Task ID printed (UUID), no errors.

- [ ] **Step 5: Commit**

```bash
git add server/index.cjs
git commit -m "refactor: extract dispatchTaskToAgent() shared function, slim down dispatch route"
```

---

## Task 3: PATCH Hook — Auto-dispatch When Status → todo

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Add auto-dispatch hook inside PATCH route**

In `server/index.cjs`, find the `PATCH /api/tasks/:id` route. Find this line:

```javascript
    broadcastTasksUpdate();
    res.json({ task: after });
```

Insert immediately BEFORE `broadcastTasksUpdate()`:

```javascript
    // Auto-dispatch: if ticket just moved to 'todo' and has an assigned agent, dispatch immediately
    const justMovedToTodo = status !== undefined && status === 'todo' && before.status !== 'todo';
    if (justMovedToTodo && after.agentId && gatewayProxy.isConnected) {
      dispatchTaskToAgent(after).catch(err =>
        console.warn('[auto-dispatch]', after.id, err.message)
      );
    }

```

- [ ] **Step 2: Verify syntax**

```bash
node --check server/index.cjs && echo "SYNTAX OK"
```

- [ ] **Step 3: Test the hook manually**

```bash
node server/index.cjs &
sleep 3
TOKEN=$(grep DASHBOARD_TOKEN .env | cut -d= -f2 | tr -d ' \r\n')
# Create task in backlog with agent assigned
TASK_ID=$(curl -sf -X POST http://localhost:18800/api/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"auto-dispatch hook test","agentId":"main","status":"backlog"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['task']['id'])")
echo "Task: $TASK_ID"
# Move to todo — should trigger auto-dispatch (gateway may not be running, that's OK)
RESULT=$(curl -sf -X PATCH http://localhost:18800/api/tasks/$TASK_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"todo"}')
echo "Status after PATCH: $(echo $RESULT | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["status"])')"
# Cleanup
curl -sf -X DELETE http://localhost:18800/api/tasks/$TASK_ID -H "Authorization: Bearer $TOKEN" > /dev/null
kill %1 2>/dev/null
```

Expected: Status = `todo` returned immediately. Server log may show `[auto-dispatch] ... Gateway not connected` if gateway isn't running — that's expected behavior (non-blocking).

- [ ] **Step 4: Commit**

```bash
git add server/index.cjs
git commit -m "feat: auto-dispatch task to agent when status moves to todo (PATCH hook)"
```

---

## Task 4: syncHeartbeatForAllAgents() + sweepPendingTasks() + Startup Wiring

**Files:**
- Modify: `server/index.cjs`

- [ ] **Step 1: Add `syncHeartbeatForAllAgents()` before `start()`**

Find the `async function start()` in `server/index.cjs`. Insert these two functions immediately BEFORE it:

```javascript
function syncHeartbeatForAllAgents() {
  try {
    parsers.ensureCheckTasksScript();
    const agents = parsers.parseAgentRegistry();
    for (const agent of agents) {
      try {
        const workspacePath = agent.workspace || parsers.OPENCLAW_WORKSPACE;
        parsers.injectHeartbeatTaskCheck(agent.id, workspacePath);
      } catch (err) {
        console.warn(`[heartbeat-sync] ${agent.id}:`, err.message);
      }
    }
    console.log(`[heartbeat-sync] Injected task check for ${agents.length} agents`);
  } catch (err) {
    console.warn('[heartbeat-sync] failed:', err.message);
  }
}

async function sweepPendingTasks() {
  try {
    const tasks = db.getAllTasks({ status: 'todo' });
    const pending = tasks.filter(t => t.agentId);
    if (pending.length === 0) return;
    console.log(`[startup-sweep] Found ${pending.length} pending tasks, dispatching...`);
    for (const task of pending) {
      await dispatchTaskToAgent(task).catch(err =>
        console.warn(`[startup-sweep] task ${task.id}:`, err.message)
      );
    }
    console.log('[startup-sweep] Done');
  } catch (err) {
    console.warn('[startup-sweep] failed:', err.message);
  }
}
```

- [ ] **Step 2: Add `startupSweepDone` flag + gateway:connected listener**

Find the line in `server/index.cjs` where `wss` is defined and the WebSocket server is set up (look for `const wss = new WebSocketServer`). Add the flag and listener immediately AFTER the `wss` definition:

```javascript
// One-shot startup sweep on first gateway connection
let startupSweepDone = false;
gatewayProxy.addListener((event) => {
  if (event.type === 'gateway:connected' && !startupSweepDone) {
    startupSweepDone = true;
    sweepPendingTasks().catch(err => console.warn('[startup-sweep]', err.message));
  }
});
```

- [ ] **Step 3: Call `syncHeartbeatForAllAgents()` inside `start()`**

Find this block inside `start()`:

```javascript
  parsers.ensureAocEnvFile();   // write ~/.openclaw/.aoc_env with current token
  syncTaskScriptForAllAgents(); // non-blocking, fire-and-forget
```

Add the heartbeat sync call on the next line:

```javascript
  parsers.ensureAocEnvFile();   // write ~/.openclaw/.aoc_env with current token
  syncTaskScriptForAllAgents(); // non-blocking, fire-and-forget
  syncHeartbeatForAllAgents();  // inject HEARTBEAT task check into all agent workspaces
```

- [ ] **Step 4: Verify syntax**

```bash
node --check server/index.cjs && echo "SYNTAX OK"
```

- [ ] **Step 5: Start server and verify HEARTBEAT injection in logs**

```bash
npm run dev:server 2>&1 | head -30
```

Expected output includes lines like:
```
[scripts] Created shared check_tasks.sh script    (first run only)
[scripts] Injected HEARTBEAT task check for agent: main
[scripts] Injected HEARTBEAT task check for agent: tadaki
[heartbeat-sync] Injected task check for N agents
```

Ctrl+C after verifying.

- [ ] **Step 6: Verify HEARTBEAT.md was updated**

```bash
grep -A5 "aoc-task-check" ~/.openclaw/workspaces/tadaki/HEARTBEAT.md | head -8
```

Expected: Shows the injected `<!-- aoc-task-check -->` block with check_tasks.sh instruction.

- [ ] **Step 7: Commit**

```bash
git add server/index.cjs
git commit -m "feat: add HEARTBEAT sync for all agents and startup sweep on gateway:connected"
```

---

## Task 5: Update provision.cjs for New Agent Auto-setup

**Files:**
- Modify: `server/lib/agents/provision.cjs`

- [ ] **Step 1: Add imports for new functions**

Find the top of `server/lib/agents/provision.cjs`:

```javascript
const { ensureUpdateTaskScript, toggleAgentCustomTool } = require('../scripts.cjs');
```

Replace with:

```javascript
const { ensureUpdateTaskScript, toggleAgentCustomTool, ensureCheckTasksScript, injectHeartbeatTaskCheck } = require('../scripts.cjs');
```

- [ ] **Step 2: Add HEARTBEAT injection to provision hook**

Find this existing block near the end of `provisionAgent()`:

```javascript
  // Auto-install update_task.sh for the new agent
  try {
    ensureUpdateTaskScript();
    const getFileFn  = (_id, filename) => fs.readFileSync(path.join(workspacePath, filename), 'utf-8');
    const saveFileFn = (_id, filename, content) => fs.writeFileSync(path.join(workspacePath, filename), content, 'utf-8');
    toggleAgentCustomTool(id, 'update_task.sh', true, 'shared', getFileFn, saveFileFn);
  } catch (e) {
    console.warn('[provision] update_task setup failed:', e.message);
  }
```

Replace with:

```javascript
  // Auto-install update_task.sh and inject HEARTBEAT task check for the new agent
  try {
    ensureUpdateTaskScript();
    ensureCheckTasksScript();
    const getFileFn  = (_id, filename) => fs.readFileSync(path.join(workspacePath, filename), 'utf-8');
    const saveFileFn = (_id, filename, content) => fs.writeFileSync(path.join(workspacePath, filename), content, 'utf-8');
    toggleAgentCustomTool(id, 'update_task.sh', true, 'shared', getFileFn, saveFileFn);
    injectHeartbeatTaskCheck(id, workspacePath);
  } catch (e) {
    console.warn('[provision] agent setup failed:', e.message);
  }
```

- [ ] **Step 3: Verify syntax**

```bash
node --check server/lib/agents/provision.cjs && echo "SYNTAX OK"
```

- [ ] **Step 4: Verify HEARTBEAT.md content on existing agents**

```bash
# Check all 4 agents have the aoc-task-check block
for dir in ~/.openclaw/workspace ~/.openclaw/workspaces/tadaki ~/.openclaw/workspaces/artechh ~/.openclaw/workspaces/cemerlang; do
  echo "=== $dir/HEARTBEAT.md ==="
  grep -c "aoc-task-check" "$dir/HEARTBEAT.md" 2>/dev/null && echo "OK" || echo "MISSING"
done
```

Expected: Each file shows `2` (start + end markers) and `OK`.

- [ ] **Step 5: Verify check_tasks.sh script exists and is executable**

```bash
ls -la ~/.openclaw/scripts/check_tasks.sh
bash -n ~/.openclaw/scripts/check_tasks.sh && echo "BASH SYNTAX OK"
```

Expected: File exists with executable bit (`-rwxr-xr-x`), bash syntax OK.

- [ ] **Step 6: End-to-end test — assign + move to todo triggers auto-dispatch**

```bash
npm run dev:server &
sleep 4
TOKEN=$(grep DASHBOARD_TOKEN .env | cut -d= -f2 | tr -d ' \r\n')
# Create task in backlog
TASK_ID=$(curl -sf -X POST http://localhost:18800/api/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"e2e hybrid dispatch test","agentId":"main","status":"backlog"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['task']['id'])")
echo "Task created: $TASK_ID"
# Move to todo — auto-dispatch fires
curl -sf -X PATCH http://localhost:18800/api/tasks/$TASK_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"todo"}' > /dev/null
sleep 1
# Check task status — should be in_progress if gateway connected, still todo if not
STATUS=$(curl -sf http://localhost:18800/api/tasks \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json,sys
tasks = json.load(sys.stdin)['tasks']
t = next((x for x in tasks if x['id'] == '${TASK_ID}'), None)
print(t['status'] if t else 'NOT FOUND')")
echo "Task status: $STATUS"
# Cleanup
curl -sf -X DELETE http://localhost:18800/api/tasks/$TASK_ID -H "Authorization: Bearer $TOKEN" > /dev/null
kill %1 2>/dev/null
```

Expected (gateway connected): status = `in_progress`
Expected (gateway not connected): status = `todo`, server log shows `[auto-dispatch] ... Gateway not connected`

- [ ] **Step 7: Commit**

```bash
git add server/lib/agents/provision.cjs
git commit -m "feat: inject check_tasks.sh and HEARTBEAT task check on new agent provisioning"
```

---

## Self-Review

- [x] **Spec coverage:**
  - Section 1 (dispatchTaskToAgent extracted): Task 2
  - Section 2 (PATCH hook): Task 3
  - Section 3 (check_tasks.sh + HEARTBEAT.md injection): Task 1
  - Section 3 (syncHeartbeatForAllAgents on startup): Task 4
  - Section 4 (sweepPendingTasks on gateway:connected, one-shot): Task 4
  - New agent provisioning gets HEARTBEAT + check_tasks: Task 5

- [x] **No placeholders** — all code complete

- [x] **Function name consistency:**
  - `dispatchTaskToAgent(task)` — defined Task 2, used in Task 3 hook, Task 4 sweep
  - `ensureCheckTasksScript()` — defined Task 1, exported Task 1, used Task 4 + Task 5
  - `injectHeartbeatTaskCheck(agentId, workspacePath)` — defined Task 1, exported Task 1, used Task 4 + Task 5
  - `syncHeartbeatForAllAgents()` — defined + called Task 4
  - `sweepPendingTasks()` — defined + called Task 4
  - `parsers.OPENCLAW_WORKSPACE` — exported from lib/index.cjs (confirmed)
