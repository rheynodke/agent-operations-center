'use strict';

/**
 * Lessons writer — composes per-session markdown file with YAML frontmatter
 * and writes atomically to <workspace>/aoc-lessons/. qmd auto-indexes on
 * its 5-min update tick.
 *
 * See spec §7 + plan Tasks 12-14.
 */

const fs = require('fs');
const path = require('path');

function _yamlList(items) {
  if (!items || items.length === 0) return '[]';
  return '[' + items.map(t => String(t).trim()).filter(Boolean).join(', ') + ']';
}

function _aggregateTags(llmOutput, examples) {
  const set = new Set();
  for (const l of (llmOutput.lessons || [])) for (const t of (l.tags || [])) set.add(t);
  for (const e of (examples || [])) for (const t of (e.tags || [])) set.add(t);
  return [...set];
}

function renderLessonsFile({ sessionMeta, llmOutput, examples }) {
  const m = sessionMeta;
  const tags = _aggregateTags(llmOutput, examples);

  const frontmatter = [
    '---',
    'schema_version: 1',
    `session_id: ${m.sessionId}`,
    `agent_id: ${m.agentId}`,
    `owner_id: ${m.ownerId}`,
    `reflection_at: ${m.reflectionAt}`,
    `prompt_version: ${m.promptVersion}`,
    `session_quality: ${m.sessionQuality}`,
    'session_metrics:',
    `  message_count: ${m.messageCount}`,
    `  endorsed_count: ${m.endorsedCount}`,
    `  flagged_count: ${m.flaggedCount}`,
    `  hallucination_rate: ${m.hallucinationRate}`,
    `tags: ${_yamlList(tags)}`,
    'pinned: false',
    '---',
    '',
  ].join('\n');

  const dateLabel = (m.reflectionAt || '').slice(0, 16).replace('T', ' ');
  const lines = [];
  lines.push(`# Session Lessons — ${dateLabel}`, '');

  if ((llmOutput.lessons || []).length > 0) {
    lines.push('## Lessons', '');
    llmOutput.lessons.forEach((l, i) => {
      lines.push(`### lesson-${i + 1}`);
      lines.push(`- **kind**: ${l.kind || 'fact'}`);
      if (l.tags && l.tags.length) lines.push(`- **tags**: ${l.tags.join(', ')}`);
      if (l.evidence_message_ids && l.evidence_message_ids.length) {
        lines.push(`- **evidence**: msgId ${l.evidence_message_ids.join(', ')}`);
      }
      lines.push('');
      lines.push(l.text || '');
      lines.push('');
    });
  }

  if ((examples || []).length > 0) {
    lines.push('## Validated Examples', '');
    examples.forEach((ex, i) => {
      lines.push(`### example-${i + 1}: ${ex.title || ''}`);
      lines.push(`- **messageId**: ${ex.messageId}`);
      lines.push(`- **kind**: ${ex.kind || 'explanation'}`);
      if (ex.tags && ex.tags.length) lines.push(`- **tags**: ${ex.tags.join(', ')}`);
      lines.push('');
      const lang = ex.kind === 'code' ? 'sql' : (ex.kind === 'config' ? 'bash' : '');
      lines.push('```' + lang);
      lines.push(ex.verbatim || '');
      lines.push('```');
      lines.push('');
    });
  }

  return frontmatter + lines.join('\n');
}

function _extractAssistantText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(b => b && b.type === 'text')
    .map(b => b.text || '')
    .join('\n')
    .trim();
}

async function _readJsonlMessages(jsonlPath) {
  const raw = await fs.promises.readFile(jsonlPath, 'utf8');
  const messages = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed.type === 'message' || parsed.role) {
      messages.push(parsed);
    }
  }
  return messages;
}

async function resolveVerbatim(examples, jsonlPath) {
  if (!examples || examples.length === 0) return [];
  let messages;
  try {
    messages = await _readJsonlMessages(jsonlPath);
  } catch {
    return [];
  }
  const byId = new Map(messages.map(m => [m.id, m]));
  const out = [];
  for (const ex of examples) {
    const msg = byId.get(ex.messageId);
    if (!msg || msg.role !== 'assistant') continue;
    const verbatim = _extractAssistantText(msg.content);
    out.push({ ...ex, verbatim });
  }
  return out;
}

const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function _safeTimestamp(iso) {
  // 2026-05-09T14:32:00.000Z → 20260509T143200Z
  const t = (iso || new Date().toISOString()).replace(/[-:.]/g, '').slice(0, 15);
  return t.endsWith('Z') ? t : t + 'Z';
}

async function writeLessonsForSession({
  workspace, sessionId, agentId, ownerId,
  llmOutput, jsonlPath, sessionMeta,
}) {
  if (!sessionId || !SESSION_ID_REGEX.test(sessionId)) {
    throw new Error(`invalid sessionId: ${sessionId}`);
  }
  if (!workspace || typeof workspace !== 'string') {
    throw new Error('workspace path required');
  }

  const examples = await resolveVerbatim(llmOutput.validated_examples || [], jsonlPath);
  const content = renderLessonsFile({ sessionMeta, llmOutput, examples });

  const dir = path.join(workspace, 'aoc-lessons');
  await fs.promises.mkdir(dir, { recursive: true });

  const ts = _safeTimestamp(sessionMeta?.reflectionAt);
  const filename = `${ts}__${sessionId}.md`;
  const finalPath = path.join(dir, filename);
  const tempPath = path.join(dir, `.${filename}.tmp`);

  // Path traversal guard
  const resolvedFinal = path.resolve(finalPath);
  const resolvedDir = path.resolve(dir);
  if (!resolvedFinal.startsWith(resolvedDir + path.sep)) {
    throw new Error('path traversal detected');
  }

  await fs.promises.writeFile(tempPath, content, 'utf8');
  await fs.promises.rename(tempPath, finalPath);
  return finalPath;
}

module.exports = {
  renderLessonsFile,
  resolveVerbatim,
  writeLessonsForSession,
};
