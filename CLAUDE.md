# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Agent Operations Center (AOC) — a full-stack web dashboard for monitoring, managing, and controlling OpenClaw AI agents. It reads agent data from the OpenClaw filesystem (`~/.openclaw/`) and provides real-time visibility via WebSocket.

## Commands

```bash
npm run dev          # Start both client (Vite on :5173) and server (Node on :18800) concurrently
npm run dev:client   # Vite dev server only (port 5173)
npm run dev:server   # Express backend only with --watch (port 18800)
npm run build        # TypeScript check + Vite production build
npm start            # Production server (serves built frontend + API)
```

No test runner is configured. No linter is configured.

## Environment

Requires Node >= 20. Copy `.env.example` to `.env`. Key vars: `PORT` (default 18800), `OPENCLAW_HOME`, `OPENCLAW_WORKSPACE`, `DASHBOARD_TOKEN`.

## Architecture

**Two-process dev setup:** Vite dev server proxies `/api/*` and `/ws/*` to the Express backend (see `vite.config.ts`).

### Frontend (React 19 + TypeScript)

- **Routing:** React Router v7 in `src/App.tsx`. Auth flow: Setup → Login → DashboardShell. Pages at `src/pages/`.
- **State:** Zustand stores in `src/stores/index.ts` — one store per domain (agents, sessions, tasks, cron, routing, alerts, activity, live feed, auth, WebSocket status). Chat state lives in `src/stores/useChatStore.ts` separately. Theme (light/dark) lives in `src/stores/useThemeStore.ts`.
- **Real-time:** `src/hooks/useWebSocket.ts` connects to `/ws`, dispatches typed events to Zustand stores. `src/hooks/useDataLoader.ts` handles initial REST data fetch.
- **API clients:** `src/lib/api.ts` — all standard REST endpoints. `src/lib/chat-api.ts` — gateway/chat-specific endpoints (`/api/chat/*`). Both use auto-auth headers from `useAuthStore`.
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite` plugin. shadcn/ui components in `src/components/ui/`. Path alias `@/` maps to `src/`. Theme tokens defined in `src/index.css` — light and dark mode CSS vars. Always use semantic tokens (`bg-card`, `border-border`, `text-foreground`, `bg-foreground/X`) not `bg-white/X` or hardcoded hex colors, so both modes work.
- **Types:** All shared types in `src/types/index.ts`.

### Backend (Node.js + Express 5, CommonJS)

- **Entry:** `server/index.cjs` — Express app with JWT auth, Helmet, CORS, rate limiting.
- **Barrel:** `server/lib/index.cjs` — **explicit** named export list; adding a new function to any sub-module requires also adding it here. Does NOT use spread (`...submodule`). Note: `server/lib/agents/index.cjs` is a local sub-barrel that *does* use spread to compose its own files.
- **Sub-modules:**
  - `server/lib/agents/detail.cjs` — `getAgentDetail`, `updateAgent`, `getAgentChannels`, `addAgentChannel`, `updateAgentChannel`, `removeAgentChannel`
  - `server/lib/agents/files.cjs` — `getAgentFile`, `saveAgentFile`; editable files allowlist: `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `AGENTS.md`, `USER.md`
  - `server/lib/agents/skills.cjs` — `getAgentSkills`, `getAllSkills`, `getSkillFile`, `getSkillFileBySlug`, `saveSkillFile`, `saveSkillFileBySlug`, `createSkill`, `createGlobalSkill`, `toggleAgentSkill`
  - `server/lib/agents/tools.cjs` — `BUILTIN_TOOLS`, `getAgentTools`, `getAllTools`, `toggleAgentTool`
  - `server/lib/agents/skillScripts.cjs` — `listSkillScripts`, `getSkillScript`, `saveSkillScript`, `deleteSkillScript`, `getSkillScriptsPath`
  - `server/lib/agents/provision.cjs` — writes new agent to `openclaw.json` + scaffolds workspace
  - `server/lib/sessions/opencode.cjs` — parses OpenCode JSONL session files from `~/.openclaw/`
  - `server/lib/sessions/gateway.cjs` — parses gateway JSONL session files from `~/.openclaw/agents/{agentId}/sessions/`; handles text-encoded tool call markers (`<|tool_calls_section_begin|>`) and strips gateway-injected metadata from user messages
  - `server/lib/models.cjs` — `getAvailableModels` reads model list from `openclaw.json`
  - `server/lib/gateway-ws.cjs` — persistent WebSocket proxy to OpenClaw Gateway (port 18789); 3-layer auth hierarchy: device auth token (`~/.openclaw/identity/device-auth.json`, operator scopes) > Ed25519 signing (`~/.openclaw/identity/device.json`) > passphrase from `openclaw.json` (fallback, limited scopes)
  - `server/lib/db.cjs` — SQLite via `sql.js` for user auth, agent profiles, avatars. `getAgentProfile` returns both snake_case columns and explicit camelCase aliases (e.g. `avatarPresetId` from `avatar_preset_id`) — always add aliases here when adding new columns.
  - `server/lib/watchers.cjs` — chokidar file watchers; broadcasts `session:live-event` and `processing_end` WS events with `sessionKey`
- **Config:** `server/lib/config.cjs` exports `OPENCLAW_HOME`, `OPENCLAW_WORKSPACE`, `AGENTS_DIR`, `readJsonSafe`.

### Data Flow

OpenClaw filesystem → chokidar watchers → Express parsers → REST API + WebSocket broadcasts → Zustand stores → React UI

The backend does NOT own agent data. It reads from OpenClaw's filesystem as the source of truth, and uses SQLite only for dashboard-specific data (user accounts, agent profiles/avatars, UI preferences).

### Chat / Gateway Integration

- Chat requires a running OpenClaw Gateway (default port 18789). All `/api/chat/*` routes return 503 if gateway is disconnected.
- `chatApi.createSession()` → `POST /api/chat/sessions` → `gatewayProxy.sessionsCreate(agentId)` (RPC over WebSocket)
- Real-time message streaming: gateway WS events → `server/lib/gateway-ws.cjs` → dashboard WS broadcast → `src/hooks/useWebSocket.ts` → `useChatStore`
- JSONL poller in `watchers.cjs` serves as fallback for final responses when gateway lifecycle events arrive before the last message.
- `useChatStore.ts` contains `gatewayMessagesToGroups()` for converting raw gateway history into `ChatMessageGroup[]` (handles thinking blocks, text-encoded tool call markers, structured tool_use blocks).

### Channel Binding Architecture

Channel bindings in `openclaw.json` use two patterns:
1. **Explicit:** `config.bindings[].agentId === agentId` with `match.channel` + `match.accountId`
2. **Convention:** Account key equals `agentId` (or `"default"` for the main agent) in `config.channels.telegram.accounts` / `config.channels.whatsapp.accounts`

`getAgentChannels()` supports both patterns — always check both when discovering existing bindings.

**Discord is architecturally different from Telegram/WhatsApp:**
- Discord is a **shared top-level channel** — there is no `accounts` sub-object. Config lives at `config.channels.discord` (enabled, token, dmPolicy, groupPolicy).
- Token is stored as `{ source: 'env', provider: 'default', id: 'DISCORD_BOT_TOKEN' }` — actual value lives in `config.env.DISCORD_BOT_TOKEN`.
- Binding has **no `accountId`**: `{ type: 'route', agentId, match: { channel: 'discord' } }`.
- OpenClaw validates exact field names — use `groupPolicy` (not `guildPolicy`).
- Removing a Discord binding does NOT delete `channels.discord` (it's shared across agents).

### Agent Detail Page Tab Structure

`AgentDetailPage.tsx` uses a 3-tab body layout (`bodyTab` state): **Agent Files** | **Skills & Tools** | **Channels**. The Channels tab hosts `ChannelsPanel` (channel CRUD) and Recent Sessions. The inner Skills & Tools tab has its own `activeTab` state (`'skills'` | `'tools'`).

### Agent Rename

When an agent's display name changes, `updateAgent` in `detail.cjs` computes a new slug ID (`slugify(newName)`). If it differs from the current ID (and the agent is not `"main"`), it performs an atomic rename:
- `openclaw.json` agent entry key
- `channels.telegram.accounts` / `channels.whatsapp.accounts` keys that match the old ID
- All binding `agentId` references
- Filesystem: `~/.openclaw/agents/{id}/` and the agent's workspace directory

`updateAgent` returns `{ agentId, changed }` — `agentId` may differ from the request param on rename. The PATCH handler in `server/index.cjs` calls `db.renameAgentProfile(oldId, newId)` when a rename is detected, migrating the SQLite profile row. The frontend navigates to the new `/agents/{newId}` path on success.

### Agent Provisioning

`ProvisionAgentWizard.tsx` — 4-step modal (Identity → Personality → Channels → Review). On submit, calls `POST /api/agents/provision` which writes the agent entry to `openclaw.json` and scaffolds the workspace with `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `TOOLS.md` (and `USER.md` copied from main workspace if available).

The `fsWorkspaceOnly` boolean (defaults true) maps to `tools.fs.workspaceOnly: false` in the agent's `openclaw.json` entry — controls whether the agent's FS tools are restricted to its workspace directory.

### Skill Resolution Order

Skills are resolved by searching these directories in order (first `SKILL.md` match wins):
1. `{agentWorkspace}/skills/{name}/`
2. `{agentWorkspace}/.agents/skills/{name}/`
3. `~/.agents/skills/{name}/`
4. `~/.openclaw/skills/{name}/`

Skill scripts live at `{skillDir}/scripts/` and are managed via `skillScripts.cjs`.
