/**
 * hooks/room-task-bridge.cjs
 *
 * Room ↔ Agent mention forwarding and delegation-depth loop prevention.
 *
 * Exported functions:
 *   - forwardRoomMentionToAgent(room, message, agentId, deps)
 *   - forwardAgentMentionChain(room, agentMsg, sourceAgentId, deps)
 *
 * Singleton state:
 *   - delegationDepth   — Map<messageId, depth>
 *   - delegationByAgent — Map<`${agentId}:${roomId}`, depth>
 *
 * Step 3 of server modularization.
 */
'use strict';

// ── Singleton state — shared with the auto-reply listener in index.cjs ────────
const _delegationDepth = new Map();      // messageId → depth (0 = root user post)
const _delegationByAgentRoom = new Map(); // `${agentId}:${roomId}` → depth
const MAX_DELEGATION_DEPTH = 3;

/**
 * Forward a room message to a specific agent by creating / reusing a
 * gateway session and sending a rich prompt containing project context,
 * room roster, conversation history, and orchestrator tool instructions.
 *
 * @param {object} room
 * @param {object} message
 * @param {string} agentId
 * @param {{ db, gatewayProxy, getEnrichedAgents, getAgentDisplayName }} deps
 */
async function forwardRoomMentionToAgent(room, message, agentId, deps) {
  const { db, gatewayProxy } = deps;
  if (!gatewayProxy.isConnected) return;

  // Phase 2: Reuse existing session for this agent+room combo (context continuity)
  let sessionKey = db.getRoomAgentSession(room.id, agentId);

  if (!sessionKey) {
    // Create a room-scoped session, isolated from DM 1:1 chat and other
    // rooms. Key shape: `agent:<agentId>:room:<roomId>`.
    const desiredKey = `agent:${agentId}:room:${room.id}`;
    const sessionResult = await gatewayProxy.sessionsCreate(agentId, { key: desiredKey });
    sessionKey = sessionResult.key || sessionResult.session_key || sessionResult.id;
    if (!sessionKey) throw new Error('Gateway did not return a session key');
    if (sessionKey !== desiredKey) {
      console.warn(`[forward-mention] gateway returned session=${sessionKey} but we requested ${desiredKey}`);
    }
    // Phase 1: Tag session as room-triggered in SQLite
    db.markSessionAsRoomTriggered(sessionKey, room.id, agentId);
  }

  // Build a rich project context — gives the agent enough information to
  // actually be useful, not just respond "I don't know what this project is".
  let projectContext = '';
  if (room.kind === 'project' && room.projectId) {
    const project = db.getProject(room.projectId);
    if (project) {
      const lines = [
        '',
        '═══ PROJECT CONTEXT ═══',
        `Project: ${project.name} (id: ${project.id})`,
        project.description ? `Description: ${project.description}` : null,
        project.kind ? `Kind: ${project.kind}` : null,
      ].filter(Boolean);

      // Project memory — canonical "what we've decided / what's open".
      try {
        const mem = db.buildProjectMemorySnapshot(project.id, { decisionLimit: 5, glossaryLimit: 20 });
        if (mem) {
          if (mem.decisions?.length) {
            lines.push('', 'Recent decisions:');
            for (const d of mem.decisions.slice(0, 5)) lines.push(`  • ${d.title}${d.body ? ` — ${String(d.body).slice(0, 120)}` : ''}`);
          }
          if (mem.openQuestions?.length) {
            lines.push('', 'Open questions:');
            for (const q of mem.openQuestions.slice(0, 5)) lines.push(`  • ${q.title}`);
          }
          if (mem.openRisks?.length) {
            lines.push('', 'Open risks:');
            for (const r of mem.openRisks.slice(0, 5)) lines.push(`  • ${r.title}${r.severity ? ` [${r.severity}]` : ''}`);
          }
          if (mem.glossary?.length) {
            lines.push('', 'Glossary:');
            for (const g of mem.glossary.slice(0, 10)) lines.push(`  • ${g.term}: ${String(g.definition || '').slice(0, 80)}`);
          }
        }
      } catch (_) { /* ignore */ }

      // Active tasks — what's currently in flight.
      try {
        const tasks = db.getAllTasks({ projectId: project.id }) || [];
        const inProgress = tasks.filter(t => t.status === 'in_progress');
        const inReview   = tasks.filter(t => t.status === 'in_review');
        const open       = tasks.filter(t => t.status === 'open' || t.status === 'todo');
        if (inProgress.length || inReview.length || open.length) {
          lines.push('', 'Tasks:');
          for (const t of inProgress.slice(0, 5)) lines.push(`  • [in_progress] ${t.title} → ${t.agentId || '?'}${t.priority ? ` (${t.priority})` : ''}`);
          for (const t of inReview.slice(0, 5))   lines.push(`  • [in_review]   ${t.title} → ${t.agentId || '?'}`);
          for (const t of open.slice(0, 8))       lines.push(`  • [open]        ${t.title}${t.agentId ? ` → ${t.agentId}` : ''}`);
        }
      } catch (_) { /* ignore */ }

      // Epics / plan
      try {
        const epics = db.listEpics(project.id) || [];
        if (epics.length) {
          lines.push('', 'Epics / Plan:');
          for (const e of epics.slice(0, 5)) lines.push(`  • ${e.title}${e.status ? ` [${e.status}]` : ''}`);
        }
      } catch (_) { /* ignore */ }

      lines.push('═══════════════════════', '');
      projectContext = lines.join('\n');
    }
  }

  // Roster — who else is in this room and what they do. Enables delegation
  // AND task assignment (the orchestrator needs the agent IDs to pass as
  // --assignee to mission_room.sh create-task).
  let rosterContext = '';
  try {
    const allAgents = deps.getEnrichedAgents() || [];
    const roomMembers = (room.memberAgentIds || [])
      .filter(id => id !== agentId)
      .map(id => allAgents.find(a => a.id === id))
      .filter(Boolean);
    if (roomMembers.length) {
      const lines = [
        '',
        '═══ ROOM MEMBERS ═══',
        '(Use the @name to delegate inside the room. Use the id="..." value as --assignee when creating tasks via mission_room.sh.)',
      ];
      for (const m of roomMembers) {
        const role = m.role ? ` — role: ${m.role}` : '';
        const desc = m.description ? ` — ${String(m.description).slice(0, 100)}` : '';
        lines.push(`  • @${m.name} (id="${m.id}")${role}${desc}`);
      }
      lines.push('═══════════════════', '');
      rosterContext = lines.join('\n');
    }
  } catch (_) { /* ignore */ }

  const history = db.listMissionMessages(room.id, { limit: 20 }).reverse();
  const transcript = history.map(m => `${m.authorName || m.authorId || m.authorType}: ${m.body}`).join('\n');

  // Tools section — only the main orchestrator gets the task-board helpers,
  // since `mission-orchestrator` skill (and its mission_room.sh) is installed
  // for `main` only. Specialists drive their own tasks via `update_task.sh`
  // from the `aoc-tasks` skill, which they already have.
  const isOrchestrator = agentId === 'main';
  const projectIdForTools = (room.kind === 'project' && room.projectId) ? room.projectId : null;
  const toolsBlock = isOrchestrator ? [
    '',
    '═══ TASK BOARD TOOLS (you are the orchestrator) ═══',
    'You can drive plans/tasks/comments/dispatch from this room conversation:',
    `  • Create task:    mission_room.sh create-task --project ${projectIdForTools || '<projectId>'} --title "..." --assignee <agentId> [--priority high] [--stage ...] [--role swe|qa|ux|...]`,
    '  • Update task:    mission_room.sh update-task <taskId> --status in_review|done|...',
    '  • Comment:        mission_room.sh comment-task <taskId> "..."',
    '  • Dispatch:       mission_room.sh dispatch-task <taskId>     (todo → in_progress)',
    '  • Approve:        mission_room.sh approve <taskId> [--note "..."]    (in_review → done)',
    '  • Request change: mission_room.sh request-change <taskId> --reason "..." (in_review → in_progress, auto re-dispatch)',
    '  • Request approval: mission_room.sh request-approval --room <roomId> --task <taskId> --reason "..."',
    '',
    'TASK CLASSIFICATION — every create-task MUST set --stage AND --role correctly:',
    '',
    '  Stage / Role mapping (ADLC):',
    '    Stage          | Role | Use for',
    '    ───────────────┼──────┼──────────────────────────────────────────────',
    '    discovery      | pm   | PRD, requirements, scope, user research, briefs',
    '    discovery      | pa   | analytics scope, metrics definition, hypothesis',
    '    design         | ux   | wireframes, UI mockups, design specs',
    '    architecture   | em   | system design, API spec, technical decisions',
    '    implementation | swe  | coding, integration, refactoring',
    '    qa             | qa   | test plan, regression, edge cases, validation',
    '    docs           | doc  | docs, README, runbooks, user guides',
    '    release        | swe  | deployment, release coordination',
    '    ops            | swe  | infra, monitoring, on-call work',
    '',
    '  Examples:',
    '    "Buat PRD game pingpong"        → --stage discovery --role pm',
    '    "Design landing page"            → --stage design --role ux',
    '    "Implement pricing engine"       → --stage implementation --role swe',
    '    "QA pricing flow edge cases"     → --stage qa --role qa',
    '',
    'Assignment rules:',
    '  • --assignee MUST be the id="..." of a specialist from the ROOM MEMBERS list above whose role matches the task. NEVER use "main" — you are the orchestrator, you delegate, you do not execute.',
    '  • If NO room member fits the required role: leave --assignee unset (creates an unassigned task with the correct stage+role tag) AND ask the user "Tidak ada specialist dengan role <role> di room ini — mau saya assign ke siapa atau biarkan unassigned?". Never self-assign as a fallback.',
    '  • For complex requests, decompose into MULTIPLE tasks: e.g. "build feature X" → PRD (discovery/pm) → Design (design/ux) → Implementation (implementation/swe) → QA (qa/qa).',
    '',
    'Dispatch rules:',
    '  • Only call dispatch-task if the task IS assigned to a specialist. Never dispatch a task assigned to "main" — that would make you execute work that\'s not yours. If the task is unassigned, do not dispatch.',
    '',
    'Each create/update fires a Task Board lifecycle hook that posts a system message into this room automatically — do NOT also announce the action manually in your reply.',
    '═══════════════════════════════════════════════',
    '',
  ].join('\n') : '';

  const prompt = [
    `[Mission Room: "${room.name}" (${room.id})]`,
    'You are participating in a multi-agent chat room. Use the project context below to give grounded, useful answers — do NOT say "I don\'t know" if the answer is in the context.',
    projectContext,
    rosterContext,
    toolsBlock,
    'Recent room conversation:',
    transcript || '(no prior messages)',
    '',
    `New message from ${message.authorName || message.authorId || 'user'}:`,
    message.body,
    '',
    'Instructions:',
    '  • Respond as plain text. AOC captures your assistant message and posts it to the room automatically.',
    '  • Do NOT call mission_room.sh post to reply to THIS room — it would loop. (mission_room.sh post is only for cross-room broadcasts.)',
    '  • To delegate to another agent in this room, include "@<their name>" in your reply (e.g. "@Tadaki please investigate X"). AOC will route the message to them.',
    isOrchestrator
      ? '  • When the user describes work that needs doing: decompose into tasks, run mission_room.sh create-task / dispatch-task as appropriate, then write a short summary reply. The lifecycle system messages will appear automatically.'
      : null,
    '  • If the question is unanswerable from the context, say so concisely AND ask one specific clarifying question.',
    '  • Reply with the literal token "NO_REPLY" only if no answer is warranted.',
  ].filter(Boolean).join('\n');
  try {
    await gatewayProxy.chatSend(sessionKey, prompt);
  } catch (err) {
    console.warn(`[mission-rooms] mention forward failed room=${room.id} agent=${agentId}:`, err.message);
  }
}

/**
 * After an agent posts to a room, check if it mentions other agents.
 * If so, forward the message to each mentioned agent — respecting max
 * delegation depth to prevent runaway chains.
 *
 * @param {object} room
 * @param {object} agentMsg   - the room message posted by the agent
 * @param {string} sourceAgentId
 * @param {{ getEnrichedAgents, forwardFn }} deps
 *   - forwardFn is the bound forwardRoomMentionToAgent with deps already applied
 */
function forwardAgentMentionChain(room, agentMsg, sourceAgentId, deps) {
  if (!agentMsg?.body) return;
  // Parent depth: find the most recent message before this one that we have a
  // depth entry for. Default to 0 if root (auto-reply to a user mention).
  const parentDepth = _delegationDepth.get(agentMsg.id) ?? 0;
  const nextDepth = parentDepth + 1;
  if (nextDepth > MAX_DELEGATION_DEPTH) {
    console.log(`[delegation] dropped — max depth ${MAX_DELEGATION_DEPTH} exceeded for msg=${agentMsg.id}`);
    return;
  }

  // Resolve mentions in the agent's body — same word-boundary semantics as user mentions.
  const allAgents = (typeof deps.getEnrichedAgents === 'function' ? deps.getEnrichedAgents() : []) || [];
  const memberAgents = (room.memberAgentIds || [])
    .map(id => allAgents.find(a => a.id === id))
    .filter(Boolean);
  const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const text = String(agentMsg.body);
  const mentioned = new Set();
  for (const a of memberAgents) {
    if (a.id === sourceAgentId) continue;          // don't self-mention
    if (a.id === 'main' && sourceAgentId !== 'main') {
      // Specialists can ping main as orchestrator — that's allowed.
    }
    const labels = [a.id, a.name, a.displayName].filter(Boolean).map(String);
    if (labels.some(l => new RegExp(`(^|[^\\w@])@${escapeRegex(l)}(?![\\w])`, 'i').test(text))) {
      mentioned.add(a.id);
    }
  }
  if (mentioned.size === 0) return;

  for (const targetAgentId of mentioned) {
    console.log(`[delegation] ${sourceAgentId} → ${targetAgentId} (depth ${nextDepth}) msg=${agentMsg.id}`);
    deps.forwardFn(room, agentMsg, targetAgentId)
      .then(() => {
        _delegationByAgentRoom.set(`${targetAgentId}:${room.id}`, nextDepth);
      })
      .catch(() => {});
  }
}

module.exports = {
  forwardRoomMentionToAgent,
  forwardAgentMentionChain,
  // Expose singleton maps so auto-reply listener can read/write them
  delegationDepth: _delegationDepth,
  delegationByAgentRoom: _delegationByAgentRoom,
  MAX_DELEGATION_DEPTH,
};
