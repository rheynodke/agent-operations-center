const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME, OPENCLAW_WORKSPACE, parseSingleGatewayEntry } = require('./index.cjs');
const { readJsonSafe } = require('./config.cjs');

class LiveFeedWatcher {
  constructor() {
    this.listeners = new Set();
    this.watchers = [];
    this.tailPositions = new Map();
  }

  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcast(event) {
    const payload = { ...event, timestamp: Date.now() };
    for (const fn of this.listeners) {
      try { fn(payload); } catch {}
    }
  }

  start() {
    this._watchFile(
      path.join(OPENCLAW_HOME, 'code-agent-sessions.json'),
      'session:update',
    );

    this._watchDir(
      path.join(OPENCLAW_WORKSPACE, 'dev-progress'),
      'progress:update',
    );

    this._watchFile(
      path.join(OPENCLAW_HOME, 'cron', 'jobs.json'),
      'cron:update',
    );

    this._watchGlob(
      '/tmp/opencode-events-*.jsonl',
      'opencode:event',
      true,
    );

    this._watchFile(
      path.join(OPENCLAW_HOME, 'subagents', 'runs.json'),
      'subagent:update',
    );

    // Watch ALL gateway agent session JSONL files via polling
    // (chokidar/inotify fails on this VPS due to low max_user_instances)
    const agentsDir = path.join(OPENCLAW_HOME, 'agents');
    if (fs.existsSync(agentsDir)) {
      this._startAgentPolling(agentsDir);
    }

    console.log('[watchers] Live feed watchers started');
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
      // Refresh the sessionId -> sessionKey map every 10 polls (~20s)
      if (pollCount % 10 === 0) {
        this._sessionIdMap = this._buildSessionIdMap(agentsDir);
      }
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
                this.broadcast({
                  type: 'session:update',
                  action: 'processing_start',
                  agent: agentId,
                  file: file.replace('.lock', ''),
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
    this.watchers = [];
    this.listeners.clear();
    console.log('[watchers] Live feed watchers stopped');
  }
}

module.exports = { LiveFeedWatcher };
