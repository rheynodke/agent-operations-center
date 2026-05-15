const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, getUserHome, readJsonSafe } = require('./config.cjs');
const {
  parseSingleGatewayEntry,
  parseSingleClaudeCliEntry,
  buildAgentClaudeCliMap,
} = require('./sessions/index.cjs');
const { processClaudeCliFile: forwardClaudeCliIntermediateToTelegram } =
  require('./claude-cli-telegram-forwarder.cjs');

class LiveFeedWatcher {
  constructor({ ownerUserId = 1, db = null } = {}) {
    this.ownerUserId = ownerUserId;
    this.listeners = new Set();
    this.watchers = [];
    this.tailPositions = new Map();
    // Optional db handle — when set, the JSONL tail loop credits per-user
    // token usage so the daily quota meter can reach a hard cap.
    this._db = db;
    // Loop detection: per-session tracker for consecutive identical failed
    // tool calls. The 50-step "spiral" pattern from the audit (agent retries
    // the same broken curl 8x) gets aborted at threshold so the user gets
    // their turn back instead of watching tokens burn.
    this._loopState = new Map(); // sessionId → { sig, count, sessionKey, agentId }
  }

  _onSessionAborted(sessionId, agentId, sessionKey, reason) {
    // Best-effort abort + system message + cleanup. Failures here are non-fatal —
    // worst case the agent finishes its current turn naturally and we miss the cap.
    try {
      this.broadcast({
        type: 'session:aborted',
        agent: agentId,
        sessionId,
        sessionKey: sessionKey || null,
        reason,
        ownerUserId: this.ownerUserId,
      });
    } catch (_) {}
    try {
      const { gatewayPool } = require('./gateway-ws.cjs');
      const conn = gatewayPool.forUser(this.ownerUserId);
      if (conn?.isConnected && sessionKey) {
        conn.chatAbort(sessionKey).catch((e) => {
          console.warn(`[watchers] loop-abort chatAbort failed sess=${sessionKey}: ${e.message}`);
        });
      }
    } catch (e) {
      console.warn(`[watchers] loop-abort dispatch failed: ${e.message}`);
    }
  }

  _home() {
    return Number(this.ownerUserId) === 1 ? OPENCLAW_HOME : getUserHome(this.ownerUserId);
  }

  _workspace() {
    return Number(this.ownerUserId) === 1
      ? OPENCLAW_WORKSPACE
      : path.join(getUserHome(this.ownerUserId), 'workspace');
  }

  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcast(event) {
    const payload = { ...event, ownerUserId: this.ownerUserId, timestamp: Date.now() };
    for (const fn of this.listeners) {
      try { fn(payload); } catch {}
    }
  }

  start() {
    this._watchFile(
      path.join(this._home(), 'code-agent-sessions.json'),
      'session:update',
    );

    this._watchDir(
      path.join(this._workspace(), 'dev-progress'),
      'progress:update',
    );

    this._watchFile(
      path.join(this._home(), 'cron', 'jobs.json'),
      'cron:update',
    );

    this._watchGlob(
      '/tmp/opencode-events-*.jsonl',
      'opencode:event',
      true,
    );

    this._watchFile(
      path.join(this._home(), 'subagents', 'runs.json'),
      'subagent:update',
    );

    // Watch ALL gateway agent session JSONL files via polling
    // (chokidar/inotify fails on this VPS due to low max_user_instances)
    const agentsDir = path.join(this._home(), 'agents');
    if (fs.existsSync(agentsDir)) {
      this._startAgentPolling(agentsDir);
    }

    // Watch Claude CLI session logs at ~/.claude/projects/<workspace-slug>/*.jsonl
    // When an OpenClaw agent uses claude-cli/* as its LLM, the transcript is
    // written there instead of the gateway session dir, so gateway polling alone
    // misses all thinking/tool-call/tool-result/final-text events.
    this._startClaudeCliPolling();

    this._watchSkillsDirs();
    this._watchAgentOutputs();

    console.log('[watchers] Live feed watchers started');
  }

  /**
   * Watch every agent workspace's `outputs/` directory for files written by
   * the agent (e.g. deliverables for a task). Path structure:
   *   {agentWorkspace}/outputs/{taskId}/{filename}
   * Broadcasts `task:output_added` / `task:output_removed` so the frontend can
   * refresh the task detail modal in real time.
   */
  _watchAgentOutputs() {
    try {
      const cfg = readJsonSafe(path.join(this._home(), 'openclaw.json')) || {};
      const agents = cfg.agents?.list || [];
      const expandHome = (p) => (p || '').replace(/^~/, process.env.HOME || process.env.USERPROFILE || '~');

      for (const agent of agents) {
        const workspace = expandHome(agent.workspace || this._workspace());
        const outputsDir = path.join(workspace, 'outputs');
        try { fs.mkdirSync(outputsDir, { recursive: true }); } catch {}

        const watcher = chokidar.watch(outputsDir, {
          ignoreInitial: true,
          depth: 2, // outputs/{taskId}/{filename}
          ignored: (p) => /\/(\.DS_Store|node_modules|\.git)(\/|$)/.test(p) || path.basename(p).startsWith('.'),
        });

        const emit = (type, filePath) => {
          // filePath is absolute; extract taskId from the path segment right under outputs/
          const rel = path.relative(outputsDir, filePath);
          const parts = rel.split(path.sep).filter(Boolean);
          if (parts.length < 2) return; // need at least {taskId}/{filename}
          const [taskId, ...rest] = parts;
          const filename = rest.join('/');
          if (!filename || filename.startsWith('.')) return;
          let size, mtime;
          if (type !== 'removed') {
            try {
              const st = fs.statSync(filePath);
              size = st.size;
              mtime = st.mtime.toISOString();
            } catch { return; }
          }
          this.broadcast({
            type: type === 'removed' ? 'task:output_removed' : 'task:output_added',
            payload: {
              agentId: agent.id,
              taskId,
              filename,
              ...(size != null ? { size, mtime } : {}),
            },
          });
        };

        watcher.on('add',    (p) => emit('added',   p));
        watcher.on('change', (p) => emit('changed', p));
        watcher.on('unlink', (p) => emit('removed', p));
        this.watchers.push(watcher);
      }
      console.log(`[watchers] Agent outputs watcher started (${agents.length} workspace(s))`);
    } catch (err) {
      console.warn('[watchers] agent outputs watcher setup failed:', err.message);
    }
  }

  _watchSkillsDirs() {
    const dirs = [
      path.join(this._home(), 'skills'),
      path.join(this._workspace(), '.agents', 'skills'),
      path.join(this._workspace(), 'skills'),
    ];
    let debounceTimer = null;
    const emit = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        this.broadcast({ type: 'skills:updated' });
      }, 300);
    };
    for (const dir of dirs) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const watcher = chokidar.watch(dir, {
        ignoreInitial: true,
        depth: 3,
        ignored: (p) => /\/(node_modules|\.git|\.DS_Store)(\/|$)/.test(p),
      });
      watcher.on('add', emit);
      watcher.on('change', emit);
      watcher.on('unlink', emit);
      watcher.on('addDir', emit);
      watcher.on('unlinkDir', emit);
      this.watchers.push(watcher);
    }
  }

  _buildSessionIdMap(agentsDir) {
    const map = new Map(); // sessionId (UUID) -> sessionKey (full key)
    try {
      const agentDirs = fs.readdirSync(agentsDir).filter(d => {
        return fs.existsSync(path.join(agentsDir, d)) && fs.statSync(path.join(agentsDir, d)).isDirectory();
      });
      for (const agentId of agentDirs) {
        const sessionsJsonPath = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
        const data = readJsonSafe(sessionsJsonPath);
        if (data && typeof data === 'object') {
          for (const [sessionKey, sessionInfo] of Object.entries(data)) {
            const sessionId = sessionInfo?.sessionId;
            if (sessionId) {
              map.set(sessionId, sessionKey);
            }
          }
        }
      }
    } catch (err) {
      console.error('[watchers] _buildSessionIdMap error:', err.message);
    }
    return map;
  }

  _startAgentPolling(agentsDir) {
    const fileSizes = new Map(); // filePath -> last known file size (for tailing)
    const activeLocks = new Set(); // track which .lock files we've already seen
    let pollCount = 0;
    this._sessionIdMap = this._buildSessionIdMap(agentsDir);

    const poll = () => {
      pollCount++;
      // Rebuild the sessionId -> sessionKey map every tick
      // to ensure new sessions immediately route live events to the UI
      this._sessionIdMap = this._buildSessionIdMap(agentsDir);
      
      try {
        const agentDirs = fs.readdirSync(agentsDir).filter(d => {
          const p = path.join(agentsDir, d, 'sessions');
          return fs.existsSync(p) && fs.statSync(p).isDirectory();
        });

        const currentLocks = new Set();

        for (const agentId of agentDirs) {
          const sessionsDir = path.join(agentsDir, agentId, 'sessions');
          let files;
          try { files = fs.readdirSync(sessionsDir); }
          catch { continue; }

          // Track lock files for processing state
          for (const file of files) {
            if (file.endsWith('.jsonl.lock')) {
              const lockPath = path.join(sessionsDir, file);
              currentLocks.add(lockPath);
              if (!activeLocks.has(lockPath)) {
                // New lock appeared — agent started processing
                activeLocks.add(lockPath);
                const startSessionId = file.replace('.jsonl.lock', '').replace('.lock', '');
                this.broadcast({
                  type: 'session:update',
                  action: 'processing_start',
                  agent: agentId,
                  file: file.replace('.lock', ''),
                  sessionKey: this._sessionIdMap?.get(startSessionId) || null,
                  source: 'gateway',
                });
              }
            }
          }

          // Tail session JSONL files — read only NEW bytes since last poll
          for (const file of files.filter(f => f.endsWith('.jsonl') && !f.endsWith('.jsonl.lock'))) {
            const filePath = path.join(sessionsDir, file);
            try {
              const stat = fs.statSync(filePath);
              const size = stat.size;
              const prevSize = fileSizes.get(filePath);

              if (prevSize === undefined) {
                // First time seeing this file — record current size (don't tail)
                fileSizes.set(filePath, size);
              } else if (size > prevSize) {
                // File grew — read only the NEW bytes
                fileSizes.set(filePath, size);
                const sessionId = file.replace('.jsonl', '');

                try {
                  const fd = fs.openSync(filePath, 'r');
                  const buffer = Buffer.alloc(size - prevSize);
                  fs.readSync(fd, buffer, 0, buffer.length, prevSize);
                  fs.closeSync(fd);

                  const newLines = buffer.toString('utf-8').trim().split('\n').filter(Boolean);
                  for (const line of newLines) {
                    // Parse the JSONL entry into a frontend-ready SessionEvent
                    const parsed = parseSingleGatewayEntry(line);
                    if (parsed) {
                      this.broadcast({
                        type: 'session:live-event',
                        agent: agentId,
                        sessionId,
                        sessionKey: this._sessionIdMap?.get(sessionId) || null,
                        event: parsed,
                      });
                    }
                    // Token-budget meter: any usage block in a freshly-appended
                    // gateway message represents tokens just spent. Attribute to
                    // the agent's owner so the per-user daily cap moves in
                    // near-realtime (2s polling interval). Best-effort — usage
                    // is parsed from raw JSONL because parseSingleGatewayEntry
                    // strips it for the wire shape.
                    let raw = null;
                    try { raw = JSON.parse(line); } catch { /* not JSON */ }
                    if (raw) {
                      try {
                        const usage = raw?.message?.usage;
                        if (usage) {
                          const total = Number(usage.totalTokens || 0)
                            || (Number(usage.input || 0) + Number(usage.output || 0));
                          if (total > 0 && this._db && typeof this._db.recordTokenUsage === 'function') {
                            const ownerId = this._db.getAgentOwner ? this._db.getAgentOwner(agentId) : null;
                            if (ownerId != null) {
                              this._db.recordTokenUsage(ownerId, total);
                            }
                          }
                        }
                      } catch (_) { /* ignore */ }

                      // Loop detection: same failed tool with same inputs N times
                      // in a row → abort the run and surface a system message.
                      // Threshold 3: anything less is normal retry hygiene; more
                      // than 3 starts wasting tokens on a problem the agent
                      // can't escape on its own.
                      try {
                        const msg = raw?.message;
                        if (msg?.role === 'toolResult') {
                          const content = Array.isArray(msg.content) ? msg.content : [];
                          const errLike = content.some((x) => {
                            if (!x || typeof x !== 'object') return false;
                            const t = x.text || (typeof x === 'string' ? x : '');
                            return /^(error|ERROR|Error)\b|HTTP 4|HTTP 5|"is_error":\s*true|^bash:|: command not found|: No such file|exit (?:status )?[1-9]/m.test(String(t).slice(0, 400));
                          });
                          if (errLike) {
                            const sig = String(msg.toolCallId || msg.toolName || '') + '|' +
                              JSON.stringify(content.map((x) => (x && (x.input || x.text)) || '')).slice(0, 200);
                            const prev = this._loopState.get(sessionId);
                            if (prev && prev.sig === sig) {
                              prev.count += 1;
                              if (prev.count >= 3 && !prev.aborted) {
                                prev.aborted = true;
                                console.warn(
                                  `[watchers] loop detected uid=${this.ownerUserId} agent=${agentId} sess=${sessionId} ` +
                                  `tool=${msg.toolName || '?'} count=${prev.count} — aborting`
                                );
                                const sessionKey = this._sessionIdMap?.get(sessionId) || null;
                                this._onSessionAborted(sessionId, agentId, sessionKey, {
                                  kind: 'loop',
                                  toolName: msg.toolName || null,
                                  consecutiveFailures: prev.count,
                                });
                              }
                            } else {
                              this._loopState.set(sessionId, { sig, count: 1, aborted: false });
                            }
                          } else {
                            // Successful tool result resets the loop counter for this session.
                            this._loopState.delete(sessionId);
                          }
                        } else if (msg?.role === 'assistant') {
                          // A new assistant message means the agent saw the result
                          // and decided to do something else — break the loop chain.
                          this._loopState.delete(sessionId);
                        }
                      } catch (_) { /* ignore */ }
                    }
                  }
                } catch {}

                // Also fire the generic update for the overview/session list
                this.broadcast({
                  type: 'session:update',
                  action: 'message',
                  agent: agentId,
                  file: file,
                  source: 'gateway',
                });
              }
            } catch {}
          }
        }

        // Check for removed locks — agent finished processing
        for (const lockPath of activeLocks) {
          if (!currentLocks.has(lockPath)) {
            activeLocks.delete(lockPath);
            const agentId = path.basename(path.dirname(path.dirname(lockPath)));
            const endSessionId = path.basename(lockPath).replace('.jsonl.lock', '').replace('.lock', '');
            this.broadcast({
              type: 'session:update',
              action: 'processing_end',
              agent: agentId,
              file: path.basename(lockPath).replace('.lock', ''),
              sessionKey: this._sessionIdMap?.get(endSessionId) || null,
              source: 'gateway',
            });
          }
        }
      } catch (err) {
        console.error('[watchers] Polling error:', err.message);
      }
    };

    // Initial scan to populate mtimes
    poll();
    // Poll every 2 seconds for fast real-time detection
    this._pollInterval = setInterval(poll, 2000);
    console.log('[watchers] Agent session polling started (2s interval)');
  }

  /**
   * Build a lookup: claude-cli UUID → { sessionKey, gatewaySessionId } by pairing
   * each agent's claude-cli jsonls to a gateway sessions.json entry by mtime.
   * Refreshed periodically from the poll loop.
   */
  _buildClaudeCliKeyMap() {
    const LINK_WINDOW_MS = 5 * 60_000;
    const map = new Map(); // claudeCliUuid -> { sessionKey, gatewaySessionId, agentId }
    // Scope to this watcher's owner. Without userId, every per-user watcher
    // iterates the SAME admin claude-cli workspace and forwards intermediate
    // assistant text to Telegram once each — producing N duplicate sends
    // (N = number of LiveFeedWatcher instances = number of users).
    const agentMap = buildAgentClaudeCliMap(this.ownerUserId);

    for (const [agentId, info] of Object.entries(agentMap)) {
      if (!fs.existsSync(info.projectDir)) continue;

      // Gateway sessions.json for this agent
      const sessionsFile = path.join(this._home(), 'agents', agentId, 'sessions', 'sessions.json');
      const gwData = readJsonSafe(sessionsFile);
      const gwEntries = (gwData && typeof gwData === 'object')
        ? Object.entries(gwData).map(([key, meta]) => ({ key, sessionId: meta?.sessionId, updatedAt: meta?.updatedAt || 0 }))
        : [];

      let files;
      try { files = fs.readdirSync(info.projectDir).filter(f => f.endsWith('.jsonl')); }
      catch { continue; }

      for (const file of files) {
        const uuid = file.replace(/\.jsonl$/, '');
        const full = path.join(info.projectDir, file);
        let stat; try { stat = fs.statSync(full); } catch { continue; }

        let best = null, bestDelta = Infinity;
        for (const gw of gwEntries) {
          if (!gw.updatedAt) continue;
          const delta = Math.abs(gw.updatedAt - stat.mtimeMs);
          if (delta < bestDelta) { bestDelta = delta; best = gw; }
        }

        if (best && bestDelta <= LINK_WINDOW_MS) {
          map.set(uuid, { sessionKey: best.key, gatewaySessionId: best.sessionId, agentId });
        } else {
          map.set(uuid, { sessionKey: `agent:${agentId}:claude-cli:${uuid}`, gatewaySessionId: null, agentId });
        }
      }
    }
    return map;
  }

  _startClaudeCliPolling() {
    const fileSizes   = new Map();  // filePath -> last known size
    const lastGrowth  = new Map();  // filePath -> timestamp of last growth (for processing_end)
    const processing  = new Set();  // filePaths currently in processing state
    const PROCESSING_IDLE_MS = 8_000; // emit processing_end after this much inactivity
    // Dedup set for the Telegram-forwarder: claude-cli text-block UUIDs we've
    // already forwarded. Persists for the life of the watcher (process lifetime).
    const forwardedTextBlockUuids = new Set();
    let tickCount = 0;

    this._claudeCliKeyMap = this._buildClaudeCliKeyMap();

    const poll = () => {
      tickCount++;
      // Rebuild the claude-cli→gateway-session keymap EVERY tick (used to be
      // every 10th). The map is what lets us broadcast `session:live-event`
      // with the correct gateway `sessionKey` — without a fresh map, live
      // tools/thinking were routed to a fallback `agent:<id>:claude-cli:<uuid>`
      // key that the frontend has no messages bucket for, so they were
      // silently dropped. Rebuild cost is ~ms for small agent counts.
      this._claudeCliKeyMap = this._buildClaudeCliKeyMap();

      // Scope to this watcher's owner — see _buildClaudeCliKeyMap comment.
      // Without this, every per-user watcher polls admin's claude-cli workspace
      // and forwards intermediate text to Telegram, duplicating N times.
      const agentMap = buildAgentClaudeCliMap(this.ownerUserId);
      const now = Date.now();

      // Look up each agent's primary model — used to decide whether
      // processing_start events should fire. Sub-agent / skill-driven
      // `claude` subprocesses produce jsonl in this dir even when the
      // *main* agent uses a different provider (kilocode, opencode, etc.).
      // For those agents we still parse the jsonl (so the dashboard timeline
      // and Telegram forwarder see tool use) but skip the
      // "session is processing" lifecycle — otherwise migi (which runs on
      // kilocode) appears to be perpetually processing whenever a sub-agent
      // briefly invokes claude.
      const agentConfig = readJsonSafe(path.join(this._home(), 'openclaw.json')) || {};
      const agentModels = new Map(
        (agentConfig.agents?.list || []).map(a => [a.id, String(a.model || '')])
      );

      for (const [agentId, info] of Object.entries(agentMap)) {
        const primaryUsesClaudeCli = (agentModels.get(agentId) || '').startsWith('claude-cli/');
        if (!fs.existsSync(info.projectDir)) continue;
        let files;
        try { files = fs.readdirSync(info.projectDir).filter(f => f.endsWith('.jsonl')); }
        catch { continue; }

        for (const file of files) {
          const full = path.join(info.projectDir, file);
          const uuid = file.replace(/\.jsonl$/, '');
          let stat; try { stat = fs.statSync(full); } catch { continue; }
          const size = stat.size;
          let prevSize = fileSizes.get(full);

          if (prevSize === undefined) {
            // First time seeing this file. If it was created very recently
            // (mid-session), replay it from byte 0 so we catch the first turn.
            // Otherwise just record the size as baseline (avoid replaying history).
            const isYoung = (now - stat.mtimeMs) < 15_000;
            if (isYoung) {
              prevSize = 0;
            } else {
              fileSizes.set(full, size);
              continue;
            }
          }

          if (size > prevSize) {
            // File grew — read new bytes
            fileSizes.set(full, size);
            lastGrowth.set(full, now);

            // First growth after idle → processing_start. Only fire the
            // lifecycle event when the agent's PRIMARY model is claude-cli;
            // otherwise the jsonl is from a transient sub-agent invocation
            // and shouldn't surface as the agent "being in a session".
            if (!processing.has(full) && primaryUsesClaudeCli) {
              processing.add(full);
              const link = this._claudeCliKeyMap?.get(uuid) || {};
              this.broadcast({
                type: 'session:update',
                action: 'processing_start',
                agent: agentId,
                file,
                sessionKey: link.sessionKey || null,
                source: 'claude-cli',
              });
            }

            try {
              const fd = fs.openSync(full, 'r');
              const buffer = Buffer.alloc(size - prevSize);
              fs.readSync(fd, buffer, 0, buffer.length, prevSize);
              fs.closeSync(fd);

              const link = this._claudeCliKeyMap?.get(uuid) || {};
              const newLines = buffer.toString('utf-8').trim().split('\n').filter(Boolean);
              for (const line of newLines) {
                const parsed = parseSingleClaudeCliEntry(line);
                if (!parsed) continue;
                this.broadcast({
                  type: 'session:live-event',
                  agent: agentId,
                  sessionId: link.gatewaySessionId || uuid,
                  sessionKey: link.sessionKey || null,
                  claudeCliSessionId: uuid,
                  source: 'claude-cli',
                  event: parsed,
                });
              }
            } catch {}

            // Generic update for sessions list refresh
            this.broadcast({
              type: 'session:update',
              action: 'message',
              agent: agentId,
              file,
              source: 'claude-cli',
            });

            // Forward intermediate assistant text blocks to Telegram. OpenClaw's
            // claude-cli backend only delivers the FINAL text block per turn to
            // the channel, so progress updates ("Let me check…", "Cek dulu…")
            // never reach the user. We scan the file for text blocks that are
            // followed by a tool_use or a new user turn (i.e. not the final)
            // and send those directly via the Telegram Bot API. The `forwarder`
            // handles dedup via UUID so repeated polls don't re-send.
            //
            // Fire-and-forget: the forwarder never throws, and we don't await
            // it so the poll loop stays responsive even under Telegram latency.
            forwardClaudeCliIntermediateToTelegram({
              agentId,
              filePath: full,
              forwardedUuids: forwardedTextBlockUuids,
              // Per-tenant: read THIS watcher's openclaw.json for bot creds.
              // Without this, non-admin watchers fall back to admin's 'main'
              // account → migi's intermediate text gets posted via Dex bot
              // into admin's chat (cross-tenant leak).
              userHome: getUserHome(this.ownerUserId),
            }).catch((err) => {
              console.error('[watchers] claude-cli→telegram forwarder:', err?.message || err);
            });
          } else if (processing.has(full)) {
            // No growth this tick — check idle threshold to emit processing_end
            const last = lastGrowth.get(full) || 0;
            if (now - last > PROCESSING_IDLE_MS) {
              processing.delete(full);
              const link = this._claudeCliKeyMap?.get(uuid) || {};
              this.broadcast({
                type: 'session:update',
                action: 'processing_end',
                agent: agentId,
                file,
                sessionKey: link.sessionKey || null,
                source: 'claude-cli',
              });

              // Finalize pass: on long-progress turns, OpenClaw's stdout
              // `type:"result"` line can be lost (stream idle-timeout / CLI
              // restart) and the final assistant text never reaches the
              // channel. Once the turn is idle, re-scan with finalize=true
              // so the forwarder also considers final text blocks from
              // turns that look interrupted or unusually long. UUID dedup
              // prevents re-sending anything already forwarded.
              forwardClaudeCliIntermediateToTelegram({
                agentId,
                filePath: full,
                forwardedUuids: forwardedTextBlockUuids,
                finalize: true,
                userHome: getUserHome(this.ownerUserId),
              }).catch((err) => {
                console.error('[watchers] claude-cli→telegram finalize:', err?.message || err);
              });
            }
          }
        }
      }
    };

    poll();
    this._claudeCliPollInterval = setInterval(poll, 2000);
    console.log('[watchers] Claude CLI session polling started (2s interval)');
  }

  _watchFile(filePath, eventType) {
    if (!fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir)) {
        const watcher = chokidar.watch(dir, { ignoreInitial: true, depth: 0 });
        watcher.on('add', (addedPath) => {
          if (addedPath === filePath) {
            this._watchFile(filePath, eventType);
          }
        });
        this.watchers.push(watcher);
      }
      return;
    }

    const watcher = chokidar.watch(filePath, { ignoreInitial: true });
    watcher.on('change', () => {
      this.broadcast({
        type: eventType,
        file: path.basename(filePath),
        source: filePath,
      });
    });
    this.watchers.push(watcher);
  }

  _watchDir(dirPath, eventType) {
    if (!fs.existsSync(dirPath)) return;

    const watcher = chokidar.watch(dirPath, {
      ignoreInitial: true,
      depth: 0,
    });

    watcher.on('add', (filePath) => {
      this.broadcast({
        type: eventType,
        action: 'created',
        file: path.basename(filePath),
        source: filePath,
      });
    });

    watcher.on('change', (filePath) => {
      this._emitProgressDiff(filePath, eventType);
    });

    this.watchers.push(watcher);
  }

  _emitProgressDiff(filePath, eventType) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1];

      const match = lastLine?.match(/^- \[(\d{2}:\d{2}:\d{2})\] \*\*(\w+)\*\*:?\s*(.*)/);
      if (match) {
        this.broadcast({
          type: 'progress:step',
          file: path.basename(filePath),
          time: match[1],
          stepType: match[2].toLowerCase(),
          detail: match[3].trim(),
        });
      } else {
        this.broadcast({
          type: eventType,
          action: 'changed',
          file: path.basename(filePath),
        });
      }
    } catch {}
  }

  _watchGlob(globPattern, eventType, tail = false) {
    const dir = path.dirname(globPattern);
    const prefix = path.basename(globPattern).replace('*', '');

    if (!fs.existsSync(dir)) return;

    const watcher = chokidar.watch(globPattern, { ignoreInitial: true });

    watcher.on('add', (filePath) => {
      if (tail) {
        this.tailPositions.set(filePath, 0);
        this._tailFile(filePath, eventType);
      }
      this.broadcast({
        type: eventType,
        action: 'new_session',
        file: path.basename(filePath),
      });
    });

    watcher.on('change', (filePath) => {
      if (tail) {
        this._tailFile(filePath, eventType);
      }
    });

    // Initialize tail positions for existing files
    if (tail) {
      try {
        const existingFiles = fs.readdirSync(dir).filter(f => {
          const base = path.basename(globPattern).replace('*', '');
          return f.includes(base.split('*')[0]);
        });
        for (const f of existingFiles) {
          if (f.startsWith('opencode-events-') && f.endsWith('.jsonl')) {
            const fullPath = path.join(dir, f);
            const stat = fs.statSync(fullPath);
            this.tailPositions.set(fullPath, stat.size);
          }
        }
      } catch {}
    }

    this.watchers.push(watcher);
  }

  _tailFile(filePath, eventType) {
    try {
      const stat = fs.statSync(filePath);
      const lastPos = this.tailPositions.get(filePath) || 0;

      if (stat.size <= lastPos) return;

      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stat.size - lastPos);
      fs.readSync(fd, buffer, 0, buffer.length, lastPos);
      fs.closeSync(fd);

      this.tailPositions.set(filePath, stat.size);

      const newLines = buffer.toString('utf-8').trim().split('\n').filter(Boolean);
      for (const line of newLines) {
        try {
          const event = JSON.parse(line);
          this.broadcast({
            type: 'opencode:event',
            sessionID: event.sessionID,
            eventType: event.type,
            tool: event.part?.tool || null,
            toolStatus: event.part?.state?.status || null,
            reason: event.part?.reason || null,
            cost: event.part?.cost || null,
            tokens: event.part?.tokens || null,
            text: event.part?.text?.slice(0, 200) || null,
            input: event.part?.state?.input ? {
              filePath: event.part.state.input.filePath,
              command: event.part.state.input.command,
              description: event.part.state.input.description,
            } : null,
          });
        } catch {}
      }
    } catch {}
  }

  stop() {
    for (const w of this.watchers) {
      w.close();
    }
    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    if (this._claudeCliPollInterval) { clearInterval(this._claudeCliPollInterval); this._claudeCliPollInterval = null; }
    this.watchers = [];
    this.listeners.clear();
    console.log('[watchers] Live feed watchers stopped');
  }
}

class WatcherPool {
  constructor({ db = null } = {}) {
    this.watchers = new Map();    // userId → LiveFeedWatcher
    this.listeners = new Set();
    this._db = db;
  }

  ensureForUser(userId) {
    const uid = Number(userId);
    if (this.watchers.has(uid)) return this.watchers.get(uid);
    const w = new LiveFeedWatcher({ ownerUserId: uid, db: this._db });
    w.addListener((event) => this._fanout(event));
    w.start();
    this.watchers.set(uid, w);
    return w;
  }

  removeForUser(userId) {
    const uid = Number(userId);
    const w = this.watchers.get(uid);
    if (!w) return;
    try { w.stop(); } catch (_) {}
    this.watchers.delete(uid);
  }

  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _fanout(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch {}
    }
  }

  list() {
    return Array.from(this.watchers.keys());
  }

  stopAll() {
    for (const uid of Array.from(this.watchers.keys())) {
      this.removeForUser(uid);
    }
  }
}

module.exports = { LiveFeedWatcher, WatcherPool };
