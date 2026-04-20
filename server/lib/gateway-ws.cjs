'use strict';

/**
 * gateway-ws.cjs
 * Persistent WebSocket proxy to the OpenClaw Gateway.
 *
 * Auth flow (per protocol docs):
 *   1. On challenge, sign with Ed25519 private key from ~/.openclaw/identity/device.json
 *   2. Send deviceToken from device-auth.json (no explicit scopes → gateway reuses approved set)
 *   3. Fallback: passphrase-only auth (limited scopes)
 */

const { WebSocket } = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Config ───────────────────────────────────────────────────────────────────

function getGatewayConfig() {
  const home = process.env.OPENCLAW_HOME || path.join(process.env.HOME, '.openclaw');

  let port = process.env.GATEWAY_PORT ? Number(process.env.GATEWAY_PORT) : 18789;
  let token = process.env.GATEWAY_TOKEN || '';

  if (!token) {
    try {
      const raw = fs.readFileSync(path.join(home, 'openclaw.json'), 'utf-8');
      const cfg = JSON.parse(raw);
      token = cfg.gateway?.auth?.token || '';
      if (!port || port === 18789) port = cfg.gateway?.port || 18789;
    } catch {
      console.warn('[gateway-ws] Could not read openclaw.json — set GATEWAY_TOKEN in .env');
    }
  }

  // Device identity (for Ed25519 signing)
  let deviceIdentity = null;
  try {
    const raw = fs.readFileSync(path.join(home, 'identity', 'device.json'), 'utf-8');
    deviceIdentity = JSON.parse(raw);
  } catch { /* no device identity */ }

  // Device auth token + approved scopes (from pairing)
  let deviceAuthToken = null;
  let deviceApprovedScopes = null;
  try {
    const raw = fs.readFileSync(path.join(home, 'identity', 'device-auth.json'), 'utf-8');
    const authData = JSON.parse(raw);
    deviceAuthToken = authData.tokens?.operator?.token || null;
    deviceApprovedScopes = authData.tokens?.operator?.scopes || null;
  } catch { /* no device auth token */ }

  if (token) console.log(`[gateway-ws] Passphrase loaded (${token.slice(0, 8)}...), port: ${port}`);
  if (deviceIdentity) console.log(`[gateway-ws] Device identity loaded: ${deviceIdentity.deviceId?.slice(0, 16)}...`);
  if (deviceAuthToken) console.log(`[gateway-ws] Device token loaded (${deviceAuthToken.slice(0, 8)}...), approved scopes: [${(deviceApprovedScopes || []).join(',')}]`);

  return { port, token, deviceIdentity, deviceAuthToken, deviceApprovedScopes };
}

// ─── Ed25519 Signing ──────────────────────────────────────────────────────────

/**
 * Extract raw 32-byte Ed25519 public key from SPKI PEM, return as base64url.
 */
function publicKeyToBase64Url(publicKeyPem) {
  const keyObj = crypto.createPublicKey(publicKeyPem);
  const der = keyObj.export({ type: 'spki', format: 'der' });
  const rawKey = der.slice(-32);
  return rawKey.toString('base64url');
}

/**
 * Sign the connect payload with Ed25519 private key, return base64url signature.
 * Payload format (v3): v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily
 */
function signConnectPayload(privateKeyPem, payloadStr) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payloadStr, 'utf-8'), privateKey);
  return sig.toString('base64url');
}

function buildPayloadString({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  const scopeStr = Array.isArray(scopes) ? scopes.join(',') : (scopes || '');
  return `v3|${deviceId}|${clientId}|${clientMode}|${role}|${scopeStr}|${signedAtMs}|${token}|${nonce}|${platform}|${deviceFamily}`;
}

// ─── Tool Call Marker Parser ──────────────────────────────────────────────────

/**
 * Some models encode tool calls as text markers rather than structured objects.
 * Format: <|tool_calls_section_begin|> <|tool_call_begin|> funcname:id <|tool_call_argument_begin|> {...} <|tool_call_end|> <|tool_calls_section_end|>
 * Returns { cleanText, toolCalls[] }
 */
function parseToolCallMarkers(text) {
  if (!text || !text.includes('<|tool_calls_section_begin|>')) {
    return { cleanText: text, toolCalls: [] };
  }

  const toolCalls = [];
  let cleanText = text;

  const sectionRe = /<\|tool_calls_section_begin\|>([\s\S]*?)<\|tool_calls_section_end\|>/g;
  let sectionMatch;
  while ((sectionMatch = sectionRe.exec(text)) !== null) {
    const section = sectionMatch[1];
    const tcRe = /<\|tool_call_begin\|>\s*([\w.:/-]+)\s*<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/g;
    let tcMatch;
    while ((tcMatch = tcRe.exec(section)) !== null) {
      const [, nameWithId, argsRaw] = tcMatch;
      const colonIdx = nameWithId.lastIndexOf(':');
      const name = colonIdx > 0 ? nameWithId.slice(0, colonIdx).replace(/^functions\./, '') : nameWithId.replace(/^functions\./, '');
      const id = colonIdx > 0 ? nameWithId.slice(colonIdx + 1) : String(Date.now());
      let input;
      try { input = JSON.parse(argsRaw.trim()); } catch { input = argsRaw.trim(); }
      toolCalls.push({ name, id, input });
    }
    cleanText = cleanText.replace(sectionMatch[0], '');
  }

  return { cleanText: cleanText.trim(), toolCalls };
}

// ─── GatewayWsProxy ───────────────────────────────────────────────────────────

class GatewayWsProxy {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.pendingRequests = new Map();
    this.listeners = new Set();
    this.reconnectTimer = null;
    this.reconnectDelay = 2000;
    this.maxReconnectDelay = 30000;
    this._token = null;
    this._deviceIdentity = null;
    this._deviceAuthToken = null;
    this._port = 18789;
    // Track last accumulated assistant text per sessionKey so we can emit
    // per-chunk deltas to the frontend (gateway sends cumulative merged text).
    this._chatDeltaAccum = new Map();
  }

  /** Alias for this.connected — used by server/index.cjs */
  get isConnected() {
    return this.connected;
  }

  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcast(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* ignore */ }
    }
  }

  connect() {
    if (this.connecting || this.connected) return;

    const { port, token, deviceIdentity, deviceAuthToken, deviceApprovedScopes } = getGatewayConfig();

    if (!token && !deviceAuthToken) {
      console.warn('[gateway-ws] No auth token — skipping gateway connection');
      return;
    }

    this._token = token;
    this._deviceIdentity = deviceIdentity;
    this._deviceAuthToken = deviceAuthToken;
    this._deviceApprovedScopes = deviceApprovedScopes;
    this._port = port;
    this.connecting = true;

    const url = `ws://127.0.0.1:${port}`;
    console.log(`[gateway-ws] Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url, { handshakeTimeout: 10000 });
    } catch (e) {
      console.error('[gateway-ws] Failed to create WebSocket:', e.message);
      this.connecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[gateway-ws] WebSocket open — waiting for challenge...');
    });

    this.ws.on('message', (data) => {
      const raw = data.toString();
      try {
        const msg = JSON.parse(raw);
        // Attach raw string so _handleMessage can forward it to Gateway Logs
        msg._raw = raw.length > 800 ? raw.slice(0, 800) + '…' : raw;
        this._handleMessage(msg);
      } catch (e) {
        console.error('[gateway-ws] Message error:', e.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      const r = reason?.toString?.() || '';
      console.log(`[gateway-ws] Disconnected from Gateway ${code} ${r}`);
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      for (const [id, p] of this.pendingRequests) {
        clearTimeout(p.timeoutHandle);
        p.reject(new Error('Gateway disconnected'));
        this.pendingRequests.delete(id);
      }
      this.broadcast({ type: 'gateway:disconnected', code, reason: r });
      this._scheduleReconnect();
    });

    this.ws.on('error', (e) => {
      console.error('[gateway-ws] WebSocket error:', e.message);
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[gateway-ws] Reconnecting in ${this.reconnectDelay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  _reqId() {
    return crypto.randomBytes(8).toString('hex');
  }

  _handleMessage(msg) {
    // ── Challenge-response handshake ─────────────────────────────────────────
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      const nonce = msg.payload?.nonce?.trim?.() || msg.payload?.nonce || null;
      console.log('[gateway-ws] Got challenge, nonce:', nonce?.slice(0, 16));
      this._sendConnect(nonce);
      return;
    }

    // ── RPC responses ────────────────────────────────────────────────────────
    if (msg.type === 'res') {
      // Broadcast raw RPC response to Gateway Logs panel
      if (msg._raw) {
        this.broadcast({ type: 'gateway:log', payload: { line: msg._raw, ts: Date.now() } });
      }
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeoutHandle);
        this.pendingRequests.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error(msg.error?.message || msg.error || 'Gateway RPC error'));
        }
      }

      // hello-ok marks successful connection
      if (msg.ok && msg.payload?.type === 'hello-ok') {
        this.connected = true;
        this.connecting = false;
        this.reconnectDelay = 2000;
        const p = msg.payload || {};
        const methods = p.features?.methods || [];
        const grantedScopes = p.auth?.scopes || [];
        const writeable = methods.includes('chat.send') || methods.includes('sessions.create');
        console.log(`[gateway-ws] Connected! protocol: ${p.protocol}, server: ${p.server?.version}, methods: ${methods.length}, scopes: [${grantedScopes.join(',')}] (write: ${writeable})`);
        this.broadcast({ type: 'gateway:connected', methods, grantedScopes, writeable });
      }
      return;
    }

    // ── Real-time events ─────────────────────────────────────────────────────
    if (msg.type === 'event') {
      const evt = msg.event;
      const p = msg.payload || {};

      // DEBUG: log raw gateway events (non-noise)
      if (evt && !['tick', 'presence', 'health', 'heartbeat'].includes(evt)) {
        console.log(`[gateway-ws] EVENT ${evt}:`, JSON.stringify(p).slice(0, 600));
      }

      // ── Broadcast ALL gateway events to dashboard clients ─────────────────
      // "gateway:event" — structured event (all types including tick/health)
      this.broadcast({
        type: 'gateway:event',
        payload: {
          event: evt,
          data: p,
          ts: Date.now(),
        },
      });
      // "gateway:log" — raw log line for the Gateway Logs panel (request/response traffic)
      if (msg.raw || typeof msg._raw === 'string') {
        this.broadcast({
          type: 'gateway:log',
          payload: { line: msg._raw || msg.raw, ts: Date.now() },
        });
      }

      if (evt === 'session.message') {
        // Streaming message delta from agent
        // Content can be string, {type,text} object, or array of content blocks
        const inner = p.message || p;
        // Gateway uses p.key, p.sessionKey, or inner.sessionKey — normalise once
        const sessionKey = p.sessionKey ?? p.key ?? inner.sessionKey ?? inner.key ?? null;
        // Extract plain text only — skip thinking, toolCall, toolResult blocks
        const extractText = (v) => {
          if (v == null) return '';
          if (typeof v === 'string') return v;
          if (Array.isArray(v)) return v.map(extractText).join('');
          if (typeof v === 'object') {
            // Skip non-text content block types (thinking, toolCall, tool_use, tool_result)
            if (v.type && v.type !== 'text') return '';
            if (typeof v.text === 'string') return v.text;
            if (typeof v.content === 'string') return v.content;
            if (v.text != null) return extractText(v.text);
            if (v.content != null) return extractText(v.content);
            return ''; // Never String(v) — that produces [object Object]
          }
          return '';
        };
        // Extract thinking text from content blocks
        const extractThinking = (v) => {
          if (v == null) return '';
          if (typeof v === 'string') return '';
          if (Array.isArray(v)) return v.map(extractThinking).filter(Boolean).join('');
          if (typeof v === 'object' && v.type === 'thinking') return v.thinking || v.text || '';
          return '';
        };
        // A message is "done" only for terminal stop reasons (NOT tool_use — tools still need to run)
        const stopReason = inner.stopReason ?? p.stopReason ?? null;
        const isToolStop = stopReason === 'tool_use' || stopReason === 'tool_calls';
        const isDone = !!(inner.done ?? p.done ?? p.final ?? (stopReason && !isToolStop) ?? false);
        const rawText = extractText(inner.text || inner.content || inner.delta || p.text || p.delta);

        // Parse text-encoded tool call markers → emit proper chat:tool events + clean text
        const { cleanText, toolCalls } = parseToolCallMarkers(rawText);
        for (const tc of toolCalls) {
          this.broadcast({
            type: 'chat:tool',
            payload: {
              sessionKey,
              toolName: tc.name,
              toolInput: tc.input,
              toolCallId: tc.id,
              status: 'start',
            },
          });
        }

        // Extract thinking from content blocks + explicit thinking field
        const contentThinking = extractThinking(inner.content || p.content);
        const explicitThinking = typeof (inner.thinking || p.thinking) === 'string' ? (inner.thinking || p.thinking) : '';
        const thinking = contentThinking || explicitThinking;
        // Also extract structured tool calls from content blocks (toolCall, tool_use)
        if (Array.isArray(inner.content)) {
          for (const block of inner.content) {
            if (block && typeof block === 'object' && (block.type === 'toolCall' || block.type === 'tool_use')) {
              const tcName = (block.name || block.function?.name || 'unknown').replace(/^functions\./, '');
              const tcId = block.id || String(Date.now());
              const tcInput = block.arguments || block.input || block.function?.arguments || {};
              // Only emit if not already found via text markers
              if (!toolCalls.find(t => t.name === tcName)) {
                this.broadcast({
                  type: 'chat:tool',
                  payload: {
                    sessionKey,
                    toolName: tcName,
                    toolInput: tcInput,
                    toolCallId: tcId,
                    status: 'start',
                  },
                });
              }
            }
          }
        }

        if (cleanText || thinking || isDone || (!inner.toolName && !p.toolName && toolCalls.length === 0)) {
          this.broadcast({
            type: 'chat:message',
            payload: {
              sessionKey,
              role: inner.role || p.role || 'assistant',
              text: cleanText,
              thinking,
              done: isDone,
              toolName: inner.toolName || p.toolName,
              toolInput: inner.toolInput || p.toolInput,
              toolResult: inner.toolResult || p.toolResult,
              toolCallId: inner.toolCallId || inner.id || p.toolCallId || p.id,
              // `session.message` always carries a full snapshot (not an
              // incremental delta), so instruct the frontend to overwrite
              // responseText rather than append.
              replace: true,
            },
          });
        }
        // If the gateway explicitly signals completion, also send a dedicated done event
        if (isDone) {
          this.broadcast({ type: 'chat:done', payload: { sessionKey } });
        }
      } else if (['session.done', 'session.complete', 'session.end', 'session.finish', 'session.stopped', 'session.final'].includes(evt)) {
        // Explicit session completion events from the gateway
        const doneKey = p.sessionKey ?? p.key ?? p.session?.key ?? null;
        this.broadcast({ type: 'chat:done', payload: { sessionKey: doneKey } });
      } else if (evt === 'agent') {
        // Agent lifecycle events — phase:"end" means the run is definitively over
        if (p.stream === 'lifecycle' && p.data?.phase === 'end') {
          const agentKey = p.sessionKey ?? p.key ?? null;
          this.broadcast({ type: 'chat:done', payload: { sessionKey: agentKey } });
        }
      } else if (evt === 'chat') {
        // Chat lifecycle events. Policy: do NOT stream incremental delta text
        // to the UI — this caused "half-rendered then stuck" UX during long
        // tool calls. Instead:
        //   - on state=delta: emit a lightweight `chat:progress` heartbeat so
        //     the frontend keeps its "working" indicator alive, but no text.
        //     We also buffer the accumulating text on the server so that when
        //     `state=final` arrives we can emit ONE complete `chat:message`.
        //   - on state=final: emit the full buffered text as a single
        //     `chat:message` (done=true), then `chat:done`.
        const chatKey = p.sessionKey ?? p.key ?? null;
        const extractText = (v) => {
          if (v == null) return '';
          if (typeof v === 'string') return v;
          if (Array.isArray(v)) return v.map(extractText).join('');
          if (typeof v === 'object') {
            if (v.type && v.type !== 'text') return '';
            if (typeof v.text === 'string') return v.text;
            return '';
          }
          return '';
        };
        if (p.state === 'delta') {
          const msg = p.message || {};
          const fullText = extractText(msg.content || msg.text || '');
          if (chatKey) {
            // Remember the latest cumulative text on the server so that if
            // the gateway's own `state=final` doesn't carry the full payload
            // we can still emit it. Accept only forward-progressing updates.
            const prev = this._chatDeltaAccum.get(chatKey) || '';
            if (fullText && fullText.length >= prev.length) {
              this._chatDeltaAccum.set(chatKey, fullText);
            }
            this.broadcast({
              type: 'chat:progress',
              payload: { sessionKey: chatKey, ts: Date.now() },
            });
          }
        } else if (p.state === 'final') {
          const msg = p.message || {};
          const finalText = extractText(msg.content || msg.text || '')
            || this._chatDeltaAccum.get(chatKey) || '';
          this._chatDeltaAccum.delete(chatKey);
          if (finalText && chatKey) {
            this.broadcast({
              type: 'chat:message',
              payload: {
                sessionKey: chatKey,
                role: msg.role || 'assistant',
                text: finalText,
                thinking: '',
                done: true,
                replace: true,        // signal frontend: overwrite, not append
              },
            });
          }
          if (chatKey) this.broadcast({ type: 'chat:done', payload: { sessionKey: chatKey } });
        }
      } else if (evt === 'session.tool') {
        // Tool call event
        const toolSessionKey = p.sessionKey ?? p.key ?? null;
        this.broadcast({
          type: 'chat:tool',
          payload: {
            sessionKey: toolSessionKey,
            toolName: p.toolName,
            toolInput: p.toolInput,
            toolResult: p.toolResult,
            toolCallId: p.toolCallId || p.id,
            status: p.status || (p.toolResult !== undefined ? 'done' : 'start'),
          },
        });
      } else if (evt === 'sessions.changed') {
        this.broadcast({ type: 'chat:sessions-changed' });
      }
      // Other events are silently ignored (tick, presence, health, etc.)
    }
  }

  _sendConnect(nonce) {
    const id = this._reqId();
    const scopes = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'];

    const identity = this._deviceIdentity;
    const passphrase = this._token;

    if (!passphrase) {
      console.warn('[gateway-ws] No passphrase — cannot connect');
      return;
    }

    // Auth block: passphrase + deviceToken (from pairing)
    // Per protocol: deviceToken lets gateway reuse approved scopes without re-pairing
    const authBlock = { token: passphrase };
    if (this._deviceAuthToken) {
      authBlock.deviceToken = this._deviceAuthToken;
    }

    // Request all scopes needed by AOC. If scopes exceed the approved baseline,
    // gateway will trigger scope-upgrade pairing — approve via: openclaw devices approve
    const effectiveScopes = scopes;

    // Device signing: REQUIRED for scopes to be granted
    // Without valid device block, gateway clears scopes to []
    let deviceBlock;
    if (identity && identity.privateKeyPem) {
      const signedAtMs = Date.now();
      // v3 payload: must match exactly what gateway reconstructs for verification
      // Scopes in signature MUST match scopes sent in connect params
      // platform = process.platform ("darwin"), deviceFamily = "" (empty)
      const payloadStr = buildPayloadString({
        deviceId: identity.deviceId,
        clientId: 'cli',
        clientMode: 'cli',
        role: 'operator',
        scopes: effectiveScopes,
        signedAtMs,
        token: passphrase,
        nonce: nonce || '',
        platform: 'darwin',
        deviceFamily: '',
      });

      const signature = signConnectPayload(identity.privateKeyPem, payloadStr);
      const publicKeyB64 = publicKeyToBase64Url(identity.publicKeyPem);

      deviceBlock = {
        id: identity.deviceId,
        publicKey: publicKeyB64,
        signature,
        signedAt: signedAtMs,
        nonce: nonce || '',
      };

      console.log('[gateway-ws] Auth: passphrase + device signing + deviceToken');
    } else {
      console.warn('[gateway-ws] No device identity — scopes will be empty');
    }

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'cli',
        version: '2.0.0',
        platform: 'darwin',
        mode: 'cli',
      },
      role: 'operator',
      scopes: effectiveScopes,
      caps: [],
      commands: [],
      permissions: {},
      auth: authBlock,
      locale: 'en-US',
      userAgent: 'aoc-dashboard/2.0.0',
      ...(deviceBlock ? { device: deviceBlock } : {}),
    };

    console.log('[gateway-ws] Sending connect...');
    this.pendingRequests.set(id, {
      resolve: () => {},
      reject: (e) => console.error('[gateway-ws] connect rejected:', e.message),
      timeoutHandle: setTimeout(() => this.pendingRequests.delete(id), 12000),
    });

    this.ws.send(JSON.stringify({ type: 'req', id, method: 'connect', params }));
  }

  /** Send an RPC request, returns Promise<payload> */
  sendReq(method, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Gateway not connected'));
      }
      const id = this._reqId();
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Gateway RPC timeout: ${method}`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timeoutHandle });
      const reqPayload = JSON.stringify({ type: 'req', id, method, params });
      this.ws.send(reqPayload);
      // Broadcast outgoing request to Gateway Logs panel
      const truncated = reqPayload.length > 800 ? reqPayload.slice(0, 800) + '…' : reqPayload;
      this.broadcast({ type: 'gateway:log', payload: { line: truncated, ts: Date.now(), direction: 'out' } });
    });
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Dashboard shutdown');
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
  }

  // ─── RPC Wrappers (params match OpenClaw gateway schemas) ─────────────────────

  /** sessions.list — { agentId?, limit?, includeDerivedTitles?, includeLastMessage? } */
  sessionsList(agentId) {
    const params = { includeDerivedTitles: true, includeLastMessage: true };
    if (agentId) params.agentId = agentId;
    return this.sendReq('sessions.list', params);
  }

  /** sessions.create — { agentId?, key?, label?, model?, message? } */
  sessionsCreate(agentId) {
    const params = {};
    if (agentId) params.agentId = agentId;
    return this.sendReq('sessions.create', params);
  }

  /** chat.history — { sessionKey, maxChars?, limit? } */
  chatHistory(sessionKey, maxChars = 80000) {
    return this.sendReq('chat.history', { sessionKey, maxChars });
  }

  /** chat.send — { sessionKey, message, attachments?, idempotencyKey }
   *  - `message` MUST be a plain string (gateway schema `Type.String()`).
   *  - `attachments` carries media: `[{ type, mimeType, fileName, content }]`
   *    where `content` is base64 data for images. */
  chatSend(sessionKey, message, attachments) {
    const payload = {
      sessionKey,
      message: typeof message === 'string' ? message : '',
      idempotencyKey: crypto.randomBytes(8).toString('hex'),
    };
    if (Array.isArray(attachments) && attachments.length > 0) {
      payload.attachments = attachments;
    }
    return this.sendReq('chat.send', payload);
  }

  /** chat.abort — { sessionKey, runId? } */
  chatAbort(sessionKey) {
    return this.sendReq('chat.abort', { sessionKey });
  }

  /** sessions.messages.subscribe — { key } */
  sessionsMessagesSubscribe(sessionKey) {
    return this.sendReq('sessions.messages.subscribe', { key: sessionKey });
  }

  /** channels.status — returns built-in + bundled channel/plugin status summaries */
  channelsStatus() {
    return this.sendReq('channels.status', {});
  }

  /** web.login.start — starts a QR/web login flow for a QR-capable channel (e.g. WhatsApp)
   *  Schema: { accountId?, force?, timeoutMs?, verbose? } — no 'channel' field (auto-detected)
   *  Returns: { qrDataUrl: "data:image/png;base64,...", message } */
  webLoginStart(accountId) {
    const params = {};
    if (accountId) params.accountId = accountId;
    return this.sendReq('web.login.start', params, 20000);
  }

  /** web.login.wait — waits for the QR login flow to complete
   *  Schema: { accountId?, timeoutMs? }
   *  Long timeout (3 min) since user needs time to scan */
  webLoginWait(accountId) {
    const params = { timeoutMs: 175000 };
    if (accountId) params.accountId = accountId;
    return this.sendReq('web.login.wait', params, 180000);
  }

  // ─── Cron management ─────────────────────────────────────────────────────────

  /** cron.list — list all cron jobs */
  cronList() {
    return this.sendReq('cron.list', {});
  }

  /** cron.status — overall cron scheduler status */
  cronStatus() {
    return this.sendReq('cron.status', {});
  }

  /** cron.list — list jobs known to the gateway (in-memory, loaded at startup) */
  cronList() {
    return this.sendReq('cron.list', {});
  }

  /** cron.run — trigger a job immediately (job must be known to gateway) */
  cronRun(id) {
    return this.sendReq('cron.run', { id });
  }

  /** cron.runs — run history for a job */
  cronRuns(id, limit = 50) {
    return this.sendReq('cron.runs', { id, limit });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const gatewayProxy = new GatewayWsProxy();
gatewayProxy.connect();

module.exports = { gatewayProxy };
