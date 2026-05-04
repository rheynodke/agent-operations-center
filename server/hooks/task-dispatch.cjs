/**
 * hooks/task-dispatch.cjs
 *
 * Task dispatch and pre-flight analysis logic.
 * Extracted from index.cjs Step 4 of server modularization.
 *
 * Exports:
 *   - dispatchTaskToAgent(task, opts, deps)
 *   - analyzeTaskForAgent(task, deps)
 */
'use strict';
const path = require('path');

async function dispatchTaskToAgent(task, opts = {}, deps) {
  const { db, outputsLib, projectWs, parsers, broadcastTasksUpdate, userId } = deps;
  if (userId == null) throw new Error('dispatchTaskToAgent: deps.userId is required');

  const { gatewayPool } = require('../lib/gateway-ws.cjs');
  const gw = gatewayPool.forUser(userId);

  if (!task.agentId) throw new Error('Task has no assigned agent');
  if (!gw.isConnected) throw new Error('Gateway not connected');

  // Block dispatch if task has unmet blockers (skip with opts.force).
  if (!opts.force) {
    const unmet = db.getUnmetBlockers(task.id);
    if (unmet.length > 0) {
      const err = new Error(`Blocked by ${unmet.length} unfinished task${unmet.length === 1 ? '' : 's'}`);
      err.code = 'TASK_BLOCKED';
      err.unmetBlockers = unmet.map(t => ({ id: t.id, title: t.title, status: t.status }));
      throw err;
    }
  }

  // ── 1 Ticket = 1 Session: reuse existing session if available ──
  // We force a deterministic per-task session key so the gateway always
  // returns a session bound 1:1 to this task, with NO bleed-through from
  // unrelated DM chat or room conversations the agent had previously.
  const isFirstDispatch = !task.sessionId;
  let sessionKey;

  if (isFirstDispatch) {
    // First dispatch → create a fresh task-scoped session.
    // Key shape: `agent:<agentId>:task:<taskId>` — matches the existing
    // 4-segment session key convention (agent:<id>:<channel>:<uuid>) where
    // channel = "task" and the uuid slot = taskId.
    const desiredKey = `agent:${task.agentId}:task:${task.id}`;
    const sessionResult = await gw.sessionsCreate(task.agentId, { key: desiredKey });
    sessionKey = sessionResult.key || sessionResult.session_key || sessionResult.id;
    if (!sessionKey) throw new Error('Gateway did not return a session key');
    if (sessionKey !== desiredKey) {
      console.warn(`[dispatch] gateway returned session=${sessionKey} but we requested ${desiredKey}; using gateway value`);
    }
  } else {
    // Subsequent dispatch → reuse the same session (context preserved)
    sessionKey = task.sessionId;
  }

  // ── Resolve project workspace, if any ──
  // When the task's project has a bound workspace_path (greenfield or brownfield),
  // the agent should treat that path as primary working directory. We can't
  // change the agent's CWD per-dispatch (gateway doesn't expose that knob), so
  // we encode it explicitly in the message and persist a context.json the agent
  // can read at the start of every turn.
  let project = null;
  let projectWorkspaceCtx = null; // { taskDir, ctxFile, inputsDir, outputsDir }
  if (task.projectId && task.projectId !== 'general') {
    try {
      project = db.getProject(task.projectId) || null;
    } catch {}
  }
  if (project?.workspacePath) {
    try {
      projectWorkspaceCtx = projectWs.writeTaskContext(project.workspacePath, task.id, {
        taskId: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        agentId: task.agentId,
        projectId: project.id,
        projectName: project.name,
        projectKind: project.kind,
        workspacePath: project.workspacePath,
        workspaceMode: project.workspaceMode,
        repoBranch: project.repoBranch || null,
        repoUrl: project.repoUrl || null,
        // ADLC stage/role surfaced from the task itself (Phase B). Both
        // nullable — only meaningful for projects with kind='adlc'.
        stage: task.stage || null,
        role: task.role || null,
        epicId: task.epicId || null,
        dispatchedAt: new Date().toISOString(),
        // Project memory snapshot (Phase A2) — open questions/risks + recent
        // decisions + glossary. Read by agents via project_memory.sh helper
        // or directly from context.json. Null when memory is empty.
        projectMemory: db.buildProjectMemorySnapshot(project.id) || null,
      });
      projectWs.appendActivityLog(
        project.workspacePath,
        `dispatch task=${task.id} agent=${task.agentId} session=${sessionKey}`
      );
    } catch (e) { console.warn('[dispatch] failed to write project task context:', e.message); }
  }

  // Ensure the per-task outputs folder exists so the agent can write deliverables
  // to a predictable location that AOC watches. With a bound project, we still
  // create the legacy per-agent outputs dir (AOC watcher uses it for pickups),
  // but we ALSO mention the project workspace's outputs/ as the preferred home.
  let outputsDirAbs = null;
  try { outputsDirAbs = outputsLib.ensureOutputsDir(task.agentId, task.id); }
  catch (e) { console.warn('[dispatch] failed to create outputs dir:', e.message); }

  // Brief reminder of any outputs already saved (useful on re-dispatch)
  let existingOutputsNote = '';
  try {
    const existing = outputsLib.listOutputs(task.agentId, task.id).filter(f => f.filename !== 'MANIFEST.json');
    if (existing.length > 0) {
      existingOutputsNote = `Already saved (${existing.length}): ${existing.slice(0, 5).map(f => `\`${f.filename}\``).join(', ')}${existing.length > 5 ? ', …' : ''}.`;
    }
  } catch {}

  const outputsContext = outputsDirAbs ? [
    '',
    '**📤 Output Directory** (save final deliverables here — AOC watches this folder):',
    `\`${outputsDirAbs}\``,
    '',
    'Guidelines:',
    '- One logical output per file. Use descriptive filenames (`sales_q1_report.pdf`, not `output.pdf`).',
    '- Supported formats: pdf, xlsx, csv, png/jpg, md, html, json, docx, zip, txt.',
    `- Helper: \`save_output.sh ${task.id} <source|-> <filename> [--description "..."]\` — copies the file here and updates \`MANIFEST.json\`. You can also write directly to the folder.`,
    '- Before marking the task `in_review`, ensure every deliverable lives in this folder.',
    existingOutputsNote,
    '',
  ].filter(Boolean).join('\n') : '';

  const aocToken = process.env.DASHBOARD_TOKEN || '';
  const aocPort  = process.env.PORT || '18800';
  const aocUrl   = `http://localhost:${aocPort}`;
  const curlBase = `curl -sf -X PATCH ${aocUrl}/api/tasks/${task.id} -H "Authorization: Bearer ${aocToken}" -H "Content-Type: application/json"`;
  const tagsLine = (task.tags || []).length > 0 ? `Tags: ${task.tags.join(', ')}` : '';

  // Build attachments context — list URLs agent can fetch via fetch_attachment.sh
  const attachments = Array.isArray(task.attachments) ? task.attachments : [];
  function renderAttachmentLines(list) {
    return list.map(att => {
      const fullUrl = att.source === 'upload' ? `${aocUrl}${att.url}` : att.url;
      const mime = att.mimeType ? ` · \`${att.mimeType}\`` : '';
      return `  - **${att.filename}**${mime} (${att.source})\n    URL: \`${fullUrl}\`\n    Fetch: \`fetch_attachment.sh "${fullUrl}"\``;
    }).join('\n');
  }
  let attachmentsContext = '';
  if (attachments.length > 0) {
    attachmentsContext = [
      '',
      '**Attachments** (download with `fetch_attachment.sh` — it auto-adds `AOC_TOKEN` for internal URLs, extracts `.zip`, and converts `.docx` to plain text):',
      renderAttachmentLines(attachments),
      '',
    ].join('\n');
  }

  // Build a narrower "new attachments" block for re-dispatches (change request, etc.)
  let newAttachmentsBlock = '';
  if (Array.isArray(opts.newAttachmentIds) && opts.newAttachmentIds.length && attachments.length) {
    const newOnes = attachments.filter(a => opts.newAttachmentIds.includes(a.id));
    if (newOnes.length) {
      newAttachmentsBlock = [
        '',
        '**📎 New attachments from reviewer:**',
        renderAttachmentLines(newOnes),
        '',
      ].join('\n');
    }
  }

  // Recent comments — lets the agent "hear" user questions/remarks posted between dispatches.
  let commentsContext = '';
  try {
    const recent = db.getRecentTaskComments(task.id, 10);
    if (recent.length > 0) {
      const lines = recent.map(c => {
        const who = c.authorType === 'agent' ? `🤖 ${c.authorName || c.authorId}` : `👤 ${c.authorName || c.authorId}`;
        const when = new Date(c.createdAt).toISOString().replace('T', ' ').slice(0, 16);
        // Indent multi-line bodies so they render cleanly
        const body = String(c.body || '').split('\n').map(l => `    ${l}`).join('\n');
        return `  - ${who} · ${when}\n${body}`;
      });
      commentsContext = [
        '',
        `**💬 Recent comments** (${recent.length} most recent — use \`post_comment.sh ${task.id} "message"\` to reply without changing status):`,
        lines.join('\n'),
        '',
      ].join('\n');
    }
  } catch (e) { console.warn('[dispatch] comments context failed:', e.message); }

  // Build project context. Two layers:
  //  - description (legacy, free-form prose)
  //  - workspace block (NEW): physical path, mode (greenfield/brownfield),
  //    kind, branch, where to read code, where to save outputs, context.json
  //    pointer. Only emitted when the project has a bound workspace_path.
  let projectContext = '';
  if (project) {
    const lines = [];
    if (project.description) lines.push(`**Project Context:** ${project.description}`);
    if (project.workspacePath && projectWorkspaceCtx) {
      const projectOutputsRoot = path.join(project.workspacePath, 'outputs');
      lines.push(``);
      lines.push(`**📁 Project Workspace** (your physical working directory for this task):`);
      lines.push(`- Path: \`${project.workspacePath}\``);
      lines.push(`- Mode: \`${project.workspaceMode || 'unbound'}\` · Kind: \`${project.kind || 'ops'}\`${project.repoBranch ? ` · Branch: \`${project.repoBranch}\`` : ''}`);
      if (project.workspaceMode === 'brownfield') {
        lines.push(`- This is an **existing codebase** — read it as context. Do NOT modify user files unless this task explicitly asks you to.`);
      } else if (project.workspaceMode === 'greenfield') {
        lines.push(`- This is a **fresh project** — you may scaffold any structure the task calls for.`);
      }
      lines.push(`- Save deliverables to \`${projectOutputsRoot}/\` (organized per ADLC stage when applicable)`);
      lines.push(`- Task context (read at start of each turn): \`${projectWorkspaceCtx.ctxFile}\``);
      lines.push(`- Per-task scratch: \`${projectWorkspaceCtx.taskDir}/\` (\`inputs/\`, \`outputs/\` already created)`);
    }
    if (lines.length) projectContext = '\n' + lines.join('\n') + '\n';
  }

  // Build available connections context for the agent (NO inline credentials, filtered by assignment)
  let connectionsContext = '';
  try {
    const agentConnIds = db.getAgentConnectionIds(task.agentId);
    const allConns = db.getAllConnections().filter(c => c.enabled);
    const conns = allConns.filter(c => agentConnIds.includes(c.id));
    if (conns.length > 0) {
      const lines = conns.map(c => {
        const meta = c.metadata || {};
        if (c.type === 'bigquery') {
          const ds = meta.datasets?.length ? meta.datasets.join(', ') : '(discover via bq ls)';
          return `  - **${c.name}** (BigQuery): project \`${meta.projectId || '?'}\`, datasets: ${ds}\n    → \`aoc-connect.sh "${c.name}" query "SELECT ..."\``;
        }
        if (c.type === 'postgres') {
          return `  - **${c.name}** (PostgreSQL): host \`${meta.host || 'localhost'}\`, port ${meta.port || 5432}, db \`${meta.database || '?'}\`\n    → \`aoc-connect.sh "${c.name}" query "SELECT ..."\``;
        }
        if (c.type === 'ssh') {
          return `  - **${c.name}** (SSH/VPS): \`${meta.sshUser || 'root'}@${meta.sshHost || '?'}\` port ${meta.sshPort || 22}\n    → \`aoc-connect.sh "${c.name}" exec "command"\``;
        }
        if (c.type === 'website') {
          const baseUrl = meta.url || '?';
          const loginUrl = meta.loginUrl ? `${baseUrl.replace(/\/$/, '')}${meta.loginUrl}` : null;
          const desc = meta.description ? ` — ${meta.description}` : '';
          const authLabel = meta.authType === 'none' ? 'public' : `auth: ${meta.authType}`;
          return `  - **${c.name}** (Website): \`${baseUrl}\` (${authLabel})${loginUrl ? ` login: \`${loginUrl}\`` : ''}${desc}\n    → Browse: \`aoc-connect.sh "${c.name}" browse "/path"\`\n    → API: \`aoc-connect.sh "${c.name}" api "/endpoint"\``;
        }
        if (c.type === 'github') {
          const repo = `${meta.repoOwner || '?'}/${meta.repoName || '?'}`;
          const desc = meta.description ? ` — ${meta.description}` : '';
          return `  - **${c.name}** (GitHub): \`${repo}\` branch \`${meta.branch || 'main'}\`${desc}\n    → \`aoc-connect.sh "${c.name}" <info|prs|issues|files|diff|clone>\``;
        }
        if (c.type === 'odoocli') {
          const desc = meta.description ? ` — ${meta.description}` : '';
          return `  - **${c.name}** (Odoo XML-RPC): \`${meta.odooUrl || '?'}\` db \`${meta.odooDb || '?'}\`${desc}\n    → \`aoc-connect.sh "${c.name}" <odoocli-subcommand>\`\n    Example: \`aoc-connect.sh "${c.name}" record search sale.order --domain "[('state','=','draft')]" --fields name,partner_id,amount_total\``;
        }
        if (c.type === 'google_workspace') {
          const linked = meta.linkedEmail || '(not linked)';
          const preset = meta.preset || 'custom';
          const state  = meta.authState || 'unknown';
          return `  - **${c.name}** (Google Workspace): linked \`${linked}\` · preset \`${preset}\` · state \`${state}\`\n    → \`gws-call.sh "${c.name}" <service> <method> '<json-body>'\`\n    Services: drive, docs, sheets, slides, gmail, calendar. Example: \`gws-call.sh "${c.name}" docs documents.create '{"title":"..."}'\``;
        }
        if (c.type === 'mcp') {
          const preset = meta.preset || 'custom';
          const transport = meta.transport || 'stdio';
          const target = transport === 'stdio' ? `\`${meta.command || '?'}\`` : `\`${meta.url || '?'}\``;
          const toolList = (meta.tools || []).map(t => t.name);
          const toolsPreview = toolList.length
            ? toolList.slice(0, 8).join(', ') + (toolList.length > 8 ? ` +${toolList.length - 8} more` : '')
            : '(run `mcp-call.sh "' + c.name + '" --list-tools` to discover)';
          return `  - **${c.name}** (MCP · ${preset} · ${transport}): ${toolList.length} tool(s) · ${target}\n    Tools: ${toolsPreview}\n    → \`mcp-call.sh "${c.name}" <tool-name> '<json-args>'\`\n    List tools: \`mcp-call.sh "${c.name}" --list-tools\``;
        }
        return `  - **${c.name}** (${c.type})`;
      });
      connectionsContext = `\n**Available Connections** (use \`aoc-connect.sh\` — credentials are handled automatically, never hardcode them):\n${lines.join('\n')}\n\nTo list all connections: \`check_connections.sh\`\n`;
    }
  } catch {}

  let message;

  if (isFirstDispatch) {
    // Full task briefing for first dispatch
    const extraContext = opts.additionalContext;
    message = [
      `📋 **Task: ${task.title}**`,
      ``,
      `Task ID: \`${task.id}\``,
      `Priority: ${task.priority || 'medium'}`,
      tagsLine,
      ``,
      task.description ? `**Description:**\n${task.description}` : '',
      projectContext,
      attachmentsContext,
      outputsContext,
      commentsContext,
      extraContext ? `\n**Additional Context from operator:**\n${extraContext}` : '',
      connectionsContext,
      ``,
      `---`,
      `IMPORTANT: Report your progress using ONE of these methods:`,
      ``,
      `**Method 1 — Script (preferred):**`,
      `\`update_task.sh ${task.id} in_progress "Starting..." $SESSION_KEY\``,
      `\`update_task.sh ${task.id} in_review "Summary" "" <input_tokens> <output_tokens>\``,
      `\`update_task.sh ${task.id} blocked "Reason here"\``,
      ``,
      `Replace <input_tokens> and <output_tokens> with your actual token usage if available (integers, omit if unknown).`,
      ``,
      `**Method 2 — Direct curl (fallback if script fails):**`,
      `\`${curlBase} -d '{"status":"in_progress","note":"Starting"}'\``,
      `\`${curlBase} -d '{"status":"in_review","note":"Summary","inputTokens":1234,"outputTokens":567}'\``,
      `\`${curlBase} -d '{"status":"blocked","note":"Reason here"}'\``,
      ``,
      `When your work is complete, set status to "in_review" — NOT "done". A human will review and approve.`,
      `If you cannot complete the task for ANY reason, ALWAYS report it as "blocked".`,
    ].filter(l => l !== null && l !== undefined).join('\n');
  } else if (opts.blockerResolvedNote !== undefined) {
    // Blocker resolved — inform agent the issue is fixed and they should continue
    const resolvedNote = opts.blockerResolvedNote;
    message = resolvedNote
      ? [
          `---`,
          `✅ **Blocker resolved — please continue.**`,
          ``,
          `The issue that was blocking you has been fixed:`,
          resolvedNote,
          newAttachmentsBlock,
          `You already have the full context from your previous work. Please continue where you left off.`,
          `When done, update status to "in_review".`,
        ].filter(Boolean).join('\n')
      : [
          `---`,
          `✅ **Blocker resolved — please continue.**`,
          newAttachmentsBlock,
          `The issue that was blocking you has been fixed. You already have the full context from your previous work.`,
          `Please continue where you left off.`,
          `When done, update status to "in_review".`,
        ].filter(Boolean).join('\n');
  } else if (opts.memoryReflection) {
    // Phase A2.1 — closing reflection prompt (Level 2 strategy).
    // Agent just closed the task. Ask them to log decisions/questions/
    // risks/glossary terms worth keeping at project level. NO status change
    // expected — they should just write memory and end the turn.
    message = [
      `---`,
      `📝 **Closing reflection** — task is now ${task.status}, but before we move on:`,
      ``,
      `Looking back at this task's work, were there any:`,
      `- **Decisions** you made that future-you / other agents should know? (e.g. "chose X over Y because Z")`,
      `- **Open questions** you couldn't fully resolve here? (project-level uncertainty)`,
      `- **Risks** you identified for the project (Value / Usability / Feasibility / Viability)?`,
      `- **Glossary terms** specific to this project worth defining?`,
      ``,
      `If yes, log them now using \`project_memory.sh\`:`,
      `\`\`\``,
      `project_memory.sh add decision "title" "rationale"`,
      `project_memory.sh add question "the question" "context"`,
      `project_memory.sh add risk "title" "body" <category> <severity>   # category=value|usability|feasibility|viability`,
      `project_memory.sh add glossary "Term" "Definition"`,
      `\`\`\``,
      ``,
      `If nothing notable, just reply briefly with "no entries needed". Don't change task status.`,
      ``,
      `(This prompt fires once per task at close — see SKILL.md for project memory guidance.)`,
    ].join('\n');
  } else {
    // Continue message for re-dispatch — agent already has full context from prior messages
    const changeNote = opts.changeRequestNote;
    const extraContext = opts.additionalContext;
    const outputsReminder = outputsDirAbs ? `📤 Save updated deliverables to \`${outputsDirAbs}\` (use \`save_output.sh ${task.id} ...\`).` : '';
    if (changeNote) {
      message = [
        `---`,
        `⚠️ **Change Request from reviewer:**`,
        changeNote,
        newAttachmentsBlock,
        commentsContext,
        `Please address the feedback above. You already have the full context from your previous work on this ticket.`,
        outputsReminder,
        `When done, update status to "in_review" again.`,
      ].filter(Boolean).join('\n');
    } else if (extraContext) {
      message = [
        `---`,
        `🔄 **Continue working on this ticket.**`,
        ``,
        `**Additional instructions from operator:**`,
        extraContext,
        newAttachmentsBlock,
        commentsContext,
        `You already have the full context from your previous work. Please continue where you left off.`,
        outputsReminder,
        `When done, update status to "in_review".`,
      ].filter(Boolean).join('\n');
    } else {
      message = [
        `---`,
        `🔄 **Continue working on this ticket.**`,
        newAttachmentsBlock,
        commentsContext,
        `You already have the full context from your previous work. Please continue where you left off.`,
        outputsReminder,
        `When done, update status to "in_review".`,
      ].filter(Boolean).join('\n');
    }
  }

  await gw.chatSend(sessionKey, message);

  // Update task — always use the same sessionId (no allSessionIds tracking).
  // For memory-reflection dispatches, keep the existing status (already
  // done/in_review) so reflection doesn't reopen the task.
  const patch = opts.memoryReflection
    ? { sessionId: sessionKey }
    : { sessionId: sessionKey, status: 'in_progress' };
  db.updateTask(task.id, patch);
  if (!opts.memoryReflection) {
    db.addTaskActivity({
      taskId: task.id,
      type: 'status_change',
      fromValue: task.status,
      toValue: 'in_progress',
      actor: 'system',
      note: isFirstDispatch
        ? `Dispatched to agent ${task.agentId}`
        : `Continued by agent ${task.agentId}${opts.changeRequestNote ? ' (change request)' : ''}`,
    });
  } else {
    db.addTaskActivity({
      taskId: task.id,
      type: 'comment',
      actor: 'system',
      note: 'Closing reflection prompt sent (project memory)',
    });
  }
  broadcastTasksUpdate();

  console.log(`[dispatch] Task ${task.id} → ${task.agentId} (session: ${sessionKey}, first: ${isFirstDispatch})`);
  return { sessionKey, agentId: task.agentId };
}

// Dispatch task to agent via gateway chat session
// ── Pre-flight task analysis (lightweight AI, no gateway needed) ──────────────
async function analyzeTaskForAgent(task, deps) {
  const { db, parsers } = deps;
  if (!task.agentId) throw new Error('Task has no assigned agent');

  // Gather agent's skills & tools for readiness check
  let agentSkills = [], agentTools = [];
  try { agentSkills = parsers.getAgentSkills(task.agentId).map(s => s.slug || s.name); } catch {}
  try { agentTools = parsers.getAgentTools(task.agentId).filter(t => t.enabled).map(t => t.name); } catch {}

  // Fetch project context
  let projectContext = '';
  if (task.projectId && task.projectId !== 'general') {
    try {
      const project = db.getProject(task.projectId);
      if (project?.description) projectContext = project.description;
    } catch {}
  }

  const prompt = [
    `You are a task analyst for an AI agent operations center. Analyze this task ticket and produce a structured pre-flight analysis in JSON format.`,
    ``,
    projectContext ? `## Project Context\n${projectContext}\n` : '',
    `## Task`,
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : '',
    task.requestFrom ? `Requested by: ${task.requestFrom}` : '',
    task.priority ? `Priority: ${task.priority}` : '',
    (task.tags || []).length > 0 ? `Tags: ${task.tags.join(', ')}` : '',
    ``,
    `## Agent Capabilities`,
    `Agent ID: ${task.agentId}`,
    `Available skills: ${agentSkills.length > 0 ? agentSkills.join(', ') : '(none)'}`,
    `Available tools: ${agentTools.length > 0 ? agentTools.join(', ') : '(standard)'}`,
    ...(() => {
      try {
        const agentConnIds = db.getAgentConnectionIds(task.agentId);
        const allConns = db.getAllConnections().filter(c => c.enabled);
        const conns = allConns.filter(c => agentConnIds.includes(c.id));
        if (conns.length === 0) return ['', '## Available Connections', '(none registered)'];
        const lines = conns.map(c => {
          const m = c.metadata || {};
          if (c.type === 'bigquery') return `  - ${c.name} (BigQuery): project ${m.projectId || '?'}, datasets: ${(m.datasets || []).join(', ') || '?'} → aoc-connect.sh "${c.name}" query "SQL"`;
          if (c.type === 'postgres') return `  - ${c.name} (PostgreSQL): ${m.host || 'localhost'}:${m.port || 5432}/${m.database || '?'} → aoc-connect.sh "${c.name}" query "SQL"`;
          if (c.type === 'ssh') return `  - ${c.name} (SSH/VPS): ${m.sshUser || 'root'}@${m.sshHost || '?'}:${m.sshPort || 22} → aoc-connect.sh "${c.name}" exec "cmd"`;
          if (c.type === 'website') {
            const baseUrl = m.url || '?';
            const loginUrl = m.loginUrl ? `${baseUrl.replace(/\/$/, '')}${m.loginUrl}` : null;
            const auth = m.authType === 'none' ? 'public' : `auth: ${m.authType}`;
            const loginHint = loginUrl ? ` — browser login at ${loginUrl}` : '';
            const desc = m.description ? ` — ${m.description}` : '';
            return `  - ${c.name} (Website): ${baseUrl} (${auth})${loginHint}${desc} → aoc-connect.sh "${c.name}" browse|api`;
          }
          if (c.type === 'github') {
            const repo = `${m.repoOwner || '?'}/${m.repoName || '?'}`;
            const desc = m.description ? ` — ${m.description}` : '';
            return `  - ${c.name} (GitHub): ${repo} branch ${m.branch || 'main'}${desc} → aoc-connect.sh "${c.name}" info|prs|issues|files|diff|clone`;
          }
          if (c.type === 'odoocli') {
            const desc = m.description ? ` — ${m.description}` : '';
            return `  - ${c.name} (Odoo XML-RPC): ${m.odooUrl || '?'} db ${m.odooDb || '?'}${desc} → aoc-connect.sh "${c.name}" <odoocli subcommand>`;
          }
          return `  - ${c.name} (${c.type})`;
        });
        return ['', '## Available Connections (use aoc-connect.sh — credentials handled automatically)', ...lines];
      } catch { return []; }
    })(),
    ``,
    `## Instructions`,
    `Respond with ONLY valid JSON (no markdown fences, no explanation) matching this exact structure:`,
    `{`,
    `  "intent": "1-2 sentence summary of what the user actually wants, in business terms",`,
    `  "dataSources": ["list of likely data sources/tables/APIs needed"],`,
    `  "executionPlan": ["step 1", "step 2", "...ordered steps the agent will take"],`,
    `  "estimatedOutput": "describe expected output format and volume",`,
    `  "potentialIssues": ["any ambiguities, missing info, or risks"],`,
    `  "readiness": {`,
    `    "ready": true/false,`,
    `    "missingSkills": ["skills agent needs but doesn't have"],`,
    `    "missingTools": ["tools agent needs but doesn't have"],`,
    `    "availableSkills": ["relevant skills agent already has"]`,
    `  }`,
    `}`,
    ``,
    `Analyze the ticket thoroughly based on what the task requires and what the agent can do.`,
    `For dataSources, infer what resources (databases, APIs, files, services, etc.) are likely needed based on the task description.`,
    `For readiness, compare the task requirements against the agent's available skills and tools listed above. Only flag a skill/tool as missing if the task clearly requires a capability the agent does not have.`,
    `If the task is general (e.g. writing, research, coding), standard agent tools may be sufficient — don't require specialized skills unnecessarily.`,
    `Answer in the same language as the ticket (Indonesian if ticket is in Indonesian).`,
  ].filter(Boolean).join('\n');

  // Direct Claude CLI call — bypass buildPrompt (which is for agent file generation)
  const { spawn } = require('child_process');
  const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude';
  const model = process.env.AI_ASSIST_MODEL || 'haiku';
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ['--print', prompt, '--output-format', 'text', '--no-session-persistence', '--model', model], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(stderr.trim() || `Claude CLI exited with code ${code}`));
      else resolve(stdout.trim());
    });
  });

  // Parse JSON — strip markdown fences if AI added them
  const cleaned = result.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  const analysis = JSON.parse(cleaned);
  analysis.analyzedAt = new Date().toISOString();
  return analysis;
}

module.exports = { dispatchTaskToAgent, analyzeTaskForAgent };
