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
npm run generate-token  # Generate a random 32-byte hex token (for DASHBOARD_TOKEN)
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
- **Sub-modules:** (see each file for its exact exports — the barrel rule above is the load-bearing invariant)
  - `server/lib/agents/detail.cjs` — agent CRUD + channel binding management
  - `server/lib/agents/files.cjs` — editable files allowlist: `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `AGENTS.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`. `injectSoulStandard()` idempotently appends the AOC research output standard block (guarded by `<!-- aoc:research-standard:start -->` marker)
  - `server/lib/agents/skills.cjs` — per-agent + global skill CRUD and toggling
  - `server/lib/agents/tools.cjs` — `BUILTIN_TOOLS` list + per-agent tool enable/disable
  - `server/lib/agents/skillScripts.cjs` — scripts under `{skillDir}/scripts/`
  - `server/lib/agents/provision.cjs` — writes new agent to `openclaw.json` + scaffolds workspace
  - `server/lib/pairing.cjs` — DM pairing approval + allow-list for telegram/whatsapp/discord. Reads `~/.openclaw/credentials/{channel}-pairing.json` and `{channel}[-{accountId}]-allowFrom.json`. 1-hour pending TTL matches OpenClaw's `PAIRING_PENDING_TTL_MS`.
  - `server/lib/sessions/index.cjs` — sessions sub-barrel (composes opencode + gateway via spread)
  - `server/lib/sessions/opencode.cjs` — parses OpenCode JSONL session files from `~/.openclaw/`; `parseCronJobs()` reads `~/.openclaw/cron/jobs.json` and normalizes the schedule object to display string
  - `server/lib/sessions/gateway.cjs` — parses gateway JSONL session files from `~/.openclaw/agents/{agentId}/sessions/`; handles text-encoded tool call markers (`<|tool_calls_section_begin|>`) and strips gateway-injected metadata from user messages
  - `server/lib/models.cjs` — `getAvailableModels` reads model list from `openclaw.json`
  - `server/lib/gateway-ws.cjs` — persistent WebSocket proxy to OpenClaw Gateway (port 18789); 3-layer auth hierarchy: device auth token > Ed25519 signing > passphrase fallback. Cron RPC methods: `cronList`, `cronRun`, `cronRuns`, `cronStatus` (gateway supports these; `cron.create/update/delete/toggle` do NOT exist — use file write instead)
  - `server/lib/db.cjs` — SQLite via `sql.js` for user auth, agent profiles, avatars. `getAgentProfile` returns both snake_case columns and explicit camelCase aliases (e.g. `avatarPresetId` from `avatar_preset_id`) — always add aliases here when adding new columns.
  - `server/lib/routing.cjs` — `parseRoutes` (enriches `openclaw.json` bindings with agent metadata for the Routing page), `getChannelsConfig` (sanitized global channel config without bot tokens)
  - `server/lib/watchers.cjs` — chokidar file watchers; broadcasts `session:live-event` and `processing_end` WS events with `sessionKey`
  - `server/lib/automation/cron.cjs` — cron CRUD (create/update/delete/toggle/run/runs); tries gateway RPC first, falls back to direct `~/.openclaw/cron/jobs.json` file write. `buildSchedule()` converts form opts to gateway schema (`{kind, everyMs}` etc). `buildJobFromOpts()` produces the full job object.
  - `server/lib/scripts.cjs` — shared workspace scripts (`~/.openclaw/scripts/`) and agent-specific scripts (`{agentWorkspace}/scripts/`). Metadata stored in `.tools.json` per directory. `listAgentCustomTools()` returns `{shared, agent}` enriched with `enabled` from agent's TOOLS.md. `toggleAgentCustomTool()` injects/removes HTML-comment-delimited blocks in TOOLS.md.
  - `server/lib/versioning.cjs` — file version history in SQLite (max 50 per scope). Scope key conventions: `agent:{agentId}:{fileName}`, `skill:{agentId}:{skillName}`, `skill:global:{slug}`, `skill-script:{agentId}:{skill}:{file}`, `script:agent:{agentId}:{file}`, `script:global:{file}`. Deduplicates by SHA-256 checksum.
  - `server/lib/integrations/index.cjs` — project integration engine; `init(db, broadcast)` wires up DB + WS broadcast, `syncIntegration(id)` pulls tickets from the adapter and upserts into tasks. Currently supports `google_sheets` adapter (`server/lib/integrations/google-sheets.cjs`). Credentials stored encrypted via `server/lib/integrations/base.cjs`.
- **Config:** `server/lib/config.cjs` exports `OPENCLAW_HOME`, `OPENCLAW_WORKSPACE`, `AGENTS_DIR`, `readJsonSafe`.
- **AI generation:** `server/lib/ai.cjs` — `generateStream()` (async generator, SSE via Claude CLI), `getOsContext()`, `FILE_CONTEXTS`.
- **`server.js` (root)** — legacy file, NOT used. The active entry is `server/index.cjs`.

### Data Flow

OpenClaw filesystem → chokidar watchers → Express parsers → REST API + WebSocket broadcasts → Zustand stores → React UI

The backend does NOT own agent data. It reads from OpenClaw's filesystem as the source of truth, and uses SQLite only for dashboard-specific data (user accounts, agent profiles/avatars, UI preferences, tasks, projects, integrations, file versions).

### Cron / Scheduled Tasks

- Jobs persist at `~/.openclaw/cron/jobs.json` (gateway schema): `{id, name, agentId, schedule: {kind, everyMs|cronExpr|atMs}, sessionTarget, payload: {kind: "agentTurn"|"systemEvent", message}, delivery: {channel, accountId, to}, state}`
- **Gateway is the scheduler.** It loads `jobs.json` at startup — newly written jobs only activate after gateway restart.
- `parseCronJobs()` normalizes raw job objects: `schedule` object → display string (`"5m"`, `"0 9 * * 1-5"`), `sessionTarget` → `session`, `state.*` → `runCount/lastRun/nextRun`.
- Run history at `~/.openclaw/cron/runs/{jobId}.jsonl` — JSONL, one entry per execution.
- `CronPage` accepts optional `filterAgentId` prop; when set (from AgentDetailPage Schedules tab), hides agent filter pills and pre-fills new job form.

### Custom Tools / Scripts

Two scopes:
- **Shared** (`~/.openclaw/scripts/`) — all agents can use, managed in Skills & Tools > Custom Tools tab (full CRUD). Read-only preview in agent detail.
- **Agent-specific** (`{agentWorkspace}/scripts/`) — per-agent, full CRUD in agent detail Custom Tools sub-tab.

Metadata stored in `.tools.json` per directory (not as companion files). When a script is "enabled" for an agent, `toggleAgentCustomTool()` appends a `<!-- custom-tool: name -->` ... `<!-- /custom-tool: name -->` block to the agent's `TOOLS.md` so the agent can read its exec hint and description.

Allowed extensions: `.sh`, `.py`, `.js`, `.ts`, `.rb`, `.bash`, `.zsh`, `.fish`, `.lua`. Max 512KB.

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

**Discord has two coexisting patterns:**
- **Legacy shared pattern:** Config at `config.channels.discord` (enabled, token, dmPolicy, groupPolicy). Token stored as `{ source: 'env', provider: 'default', id: 'DISCORD_BOT_TOKEN' }`. Binding has no `accountId`: `{ type: 'route', agentId, match: { channel: 'discord' } }`.
- **Per-account pattern (used by provisioning):** `config.channels.discord.accounts[agentId] = { token, dmPolicy, groupPolicy }`. Binding includes `accountId`: `{ type: 'route', agentId, match: { channel: 'discord', accountId: agentId } }`.
- OpenClaw validates exact field names — use `groupPolicy` (not `guildPolicy`).
- Removing a Discord binding does NOT delete `channels.discord` (it may be shared).
- `getAgentChannels()` checks both patterns when discovering existing Discord bindings.

### Channel Login & DM Pairing

- **WhatsApp QR login** (`server/index.cjs` around L2563): `POST /api/channels/:channel/login/start` calls gateway RPC `web.login.start` → returns `{ qrDataUrl, message }`. If `qrDataUrl` is null the account is already linked. `POST /api/channels/:channel/login/wait` long-polls (up to 3 min) for scan completion.
- **DM pairing approval**: users DM the bot, bot replies with a short-lived code, user enters it in AOC to authorize ongoing DMs.
  - `GET /api/agents/:id/pairing` — pending requests across all channels for an agent.
  - `GET /api/pairing/:channel?account=...` — pending requests for a channel (optionally per accountId).
  - `POST /api/pairing/:channel/approve` `{ code, accountId? }` — approves and adds to allow-list.
  - Pending requests live in `~/.openclaw/credentials/{channel}-pairing.json`; approvals write to `{channel}[-{accountId}]-allowFrom.json`.

### Agent Detail Page Tab Structure

`AgentDetailPage.tsx` uses a 4-tab body layout (`bodyTab` state): **Agent Files** | **Skills & Tools** | **Channels** | **Schedules**.

The Skills & Tools tab has its own `activeTab` state: `'skills'` | `'tools'` (built-in) | `'custom-tools'`. The Custom Tools sub-tab shows `CustomToolsPanel` with agent-specific (full CRUD) and shared (toggle + read-only preview) scripts side-by-side.

The Schedules tab embeds `<CronPage filterAgentId={id} />` which filters to the agent's jobs only.

### Agent Rename

When an agent's display name changes, `updateAgent` in `detail.cjs` computes a new slug ID (`slugify(newName)`). If it differs from the current ID (and the agent is not `"main"`), it performs an atomic rename:
- `openclaw.json` agent entry key
- `channels.telegram.accounts` / `channels.whatsapp.accounts` keys that match the old ID
- All binding `agentId` references
- Filesystem: `~/.openclaw/agents/{id}/` and the agent's workspace directory

`updateAgent` returns `{ agentId, changed }` — `agentId` may differ from the request param on rename. The PATCH handler in `server/index.cjs` calls `db.renameAgentProfile(oldId, newId)` when a rename is detected, migrating the SQLite profile row. The frontend navigates to the new `/agents/{newId}` path on success.

### Agent Provisioning

`ProvisionAgentWizard.tsx` — 4-step modal (Identity → Personality → Channels → Review). On submit, calls `POST /api/agents/provision` which writes the agent entry to `openclaw.json` and scaffolds the workspace with `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md` (and `USER.md` copied from main workspace if available). Also auto-installs `update_task.sh` and `check_tasks.sh` shared scripts for the new agent and injects a heartbeat task check into `HEARTBEAT.md`.

The `fsWorkspaceOnly` boolean (defaults true) maps to `tools.fs.workspaceOnly: false` in the agent's `openclaw.json` entry — controls whether the agent's FS tools are restricted to its workspace directory.

Note: per-agent `env` fields are **not** supported in OpenClaw 2026.4.8+. AOC env vars (`AOC_TOKEN`, `AOC_URL`, `AOC_AGENT_ID`) are injected at runtime via the agent's `update_task.sh` script.

### Skill Resolution Order

Skills are resolved by searching these directories in order (first `SKILL.md` match wins):
1. `{agentWorkspace}/skills/{name}/`
2. `{agentWorkspace}/.agents/skills/{name}/`
3. `~/.agents/skills/{name}/`
4. `~/.openclaw/skills/{name}/`

Skill scripts live at `{skillDir}/scripts/` and are managed via `skillScripts.cjs`.

### AI Assist (Content Generation)

`POST /api/ai/generate` — SSE streaming endpoint. Spawns a `claude` CLI subprocess via `server/lib/ai.cjs` (`generateStream()`). Uses `CLAUDE_BIN` env var (default `/opt/homebrew/bin/claude`).

- `AiAssistPanel.tsx` (`src/components/ai/`) — floating panel rendered inline next to editable file areas. Calls `streamAiGenerate()` which reads SSE chunks and appends to output.
- `server/lib/ai.cjs` — also exports `getOsContext()` (detects installed runtimes/shells on the host) used by `GET /api/ai/os-context`, and `FILE_CONTEXTS` map (per-filetype generation hints for `IDENTITY.md`, `SOUL.md`, `SKILL.md`, `script`, etc.).
- SSE format: `data: {"text": "..."}` chunks, terminated by `data: {"done": true}` or `data: {"error": "..."}`.
- Abort: client disconnect detected via `req.socket.on('close')` → `AbortController` signal passed to `generateStream`.

### Skill & Script Templates

`src/data/templates/` — ADLC-aligned template library for Skills and Scripts.

- **Types:** `SkillTemplate` (has `agent`, `agentEmoji`, `slug`, full `SKILL.md` content) and `ScriptTemplate` (has `filename` with extension, `content`).
- **Skill templates** organized per ADLC agent: `pm-analyst`, `ux-designer`, `em-architecture`, `qa-engineer`, `doc-writer`, `ai-ops`, `odoo-skills`, `superpowers`.
- **Script templates:** `data-integration`, `notifications`, `cost-quality`, `task-management`.
- Entry point: `src/data/templates/index.ts` exports `SKILL_TEMPLATES`, `SCRIPT_TEMPLATES`, `SUPERPOWERS_TEMPLATES`.
- `src/data/adlcTemplates.ts` — **deprecated** re-export wrapper; use `src/data/templates/index.ts` directly.
- `SkillTemplatePicker.tsx` (`src/components/skills/`) — modal picker UI consumed by `SkillsPage` and agent detail Skills tab.

### SyntaxEditor Component

`src/components/ui/SyntaxEditor.tsx` — transparent-textarea-over-highlighted-pre pattern. Architecture: fixed-width gutter (48px, line numbers rendered manually) + code area (highlight layer + textarea overlay with `color: transparent; caret-color: #abb2bf`). Both layers share identical `font`, `fontSize`, `lineHeight`, and `padding` — the gutter is a separate column to avoid em-calculation drift. Uses `react-syntax-highlighter` (lazy-loaded) for the highlight layer. Used in `CustomToolsTab.tsx` and `AgentDetailPage.tsx` for script editing.

### Agent World (3D View)

`AgentWorldPage` → `AgentWorldView` → `AgentWorld3D` (in `src/components/world/`). Built with React Three Fiber + `@react-three/drei`. Renders a top-down isometric office scene where each agent gets a desk; agent state (`processing` | `working` | `idle` | `offline`) drives animated character behavior. Theme-aware via `SCENE_THEME` (dark/light palettes for canvas bg, floor, lighting). `AgentWorld3D` accepts `agents`, `agentStates`, and `deskXPcts` props — the wrapper (`AgentWorldView`) derives these from Zustand stores.

### Tasks & Project Board

- Tasks stored in SQLite (`data/aoc.db`). `Task` has: `id`, `title`, `description`, `status` (`open`|`in_progress`|`review`|`done`|`cancelled`), `priority` (`urgent`|`high`|`medium`|`low`), `agentId`, `tags`, `cost`, `sessionId`, `projectId`.
- **Dispatch model:** `POST /api/tasks/{id}/dispatch` sends the task to the assigned agent via gateway RPC, stores the resulting `sessionKey` on the task. `loadAllJSONLMessagesForTask()` in `server/index.cjs` reconstructs full multi-dispatch history by scanning all JSONL files that mention the `taskId`.
- `AgentWorkSection.tsx` (`src/components/board/`) — renders the multi-turn agent conversation history for a task inside `TaskDetailModal`. Lazy-loads `react-markdown` + `remark-gfm`. Strips gateway-injected markers (`[[reply_to_current]]`, etc.).
- `syncAgentTaskScript` (`POST /api/agents/{agentId}/sync-task-script`) — ensures `update_task.sh` is installed for an agent.

### Projects & Integrations

- Projects group tasks. `Project` has: `id`, `name`, `color`, `description`.
- Project integrations sync external data sources into AOC tasks. Currently `google_sheets` type only.
- `ProjectIntegration` fields: `id`, `projectId`, `type`, `config` (encrypted credentials + spreadsheetId + sheetName + column mappings), `enabled`, `syncIntervalMs`, `lastSyncAt`.
- Integration test flow: `POST /api/projects/{id}/integrations/_new/test` validates credentials + returns sheet names. `POST .../headers` fetches column headers for a sheet. `POST .../sync` triggers immediate sync.
- WS event `project:sync_start` broadcasts when a sync begins (payload: `{integrationId, projectId}`).

### File Versioning

`server/lib/versioning.cjs` — every file save goes through `saveVersion()` which snapshots content in SQLite. Max 50 versions per scope key. Deduplicates by SHA-256 (no snapshot if content unchanged). REST endpoints: `GET /api/versions?scope=...`, `GET /api/versions/{id}`, `POST /api/versions/{id}/restore`, `DELETE /api/versions/{id}`. Frontend: `api.listVersions(scope)`, `api.restoreVersion(id)`.

### Skill Marketplace

Two marketplace integrations for installing skills from external sources:

- **ClawHub** (`/api/skills/clawhub/*`) — install skills from a URL (GitHub raw, direct link). Flow: `clawHubTargets()` → pick agent or global → `clawHubPreview(url)` → `clawHubInstall(url, target, agentId?)`. Supports passing pre-fetched buffer as base64 (`bufferB64`).
- **SkillsMP** (`/api/skills/skillsmp/*`) — curated skill marketplace. Requires API key stored in settings (`/api/settings/skillsmp`). Flow: `skillsmpSearch(q)` → `skillsmpPreview(skill)` → `skillsmpInstall(skill, target, agentId?)`.

### Inbound Webhooks / Hooks

`/api/hooks/*` — inbound webhook configuration. `getHooksConfig()` returns current config. `saveHooksConfig(updates)` persists. `generateHookToken()` creates a new inbound token. `getHookSessions(limit)` returns recent webhook-triggered sessions.

### Gateway Management

`/api/gateway/*` — manage the OpenClaw Gateway process:
- `GET /api/gateway/status` — returns `{ running, pids, port, portOpen, mode, bind }`.
- `POST /api/gateway/restart` — kills existing gateway processes and restarts.
- `POST /api/gateway/stop` — kills gateway processes without restart.

### OpenClaw Config Management

`/api/config` — read/write `openclaw.json` sections directly:
- `GET /api/config` — returns sanitized full config + path.
- `PATCH /api/config/{section}` — merges `value` into the specified top-level section.

### SQLite DB Location

In development, the SQLite database (`aoc.db`) is stored at `data/aoc.db` in the project root (not `~/.openclaw/`). This path is controlled by `server/lib/db.cjs`.

### ADLC Role Templates

`src/data/role-templates/` — 7 ADLC role templates (`pm-analyst`, `ux-designer`, `em-architect`, `swe`, `qa-engineer`, `doc-writer`, `biz-analyst`), each a TypeScript file exporting an `AgentRoleTemplate` object.

- **Type:** `src/types/agentRoleTemplate.ts` — `AgentRoleTemplate` interface with `id`, `adlcAgentNumber`, `role`, `emoji`, `color`, `description`, `modelRecommendation`, `agentFiles` (identity/soul/tools/agents strings), `skillSlugs`, `skillContents` (slug → full SKILL.md), `scriptTemplates` (filename + content), `fsWorkspaceOnly: false`.
- **Barrel:** `src/data/agentRoleTemplates.ts` — exports `ADLC_ROLE_TEMPLATES[]`, `getTemplateById()`, `getTemplateColor()`, `getTemplateLabel()`.
- **Shell scripts in templates** use `\${...}` (escaped) for bash variables inside TypeScript template literals — `${...}` without escape causes esbuild parse errors.

**Provisioning flow with a template:**
1. `TemplateEntryModal` (split screen: ADLC Template vs Blank Agent) replaces direct wizard open on `AgentsPage`.
2. `TemplatePickerGrid` — 7-card grid; selecting a template passes it to `ProvisionAgentWizard` as `template` prop.
3. `ProvisionAgentWizard` pre-fills emoji/color/description/model from template (name + id left blank for user). On step 1→2 transition, auto-injects soul via `buildRoleSoul()` which substitutes the role name with the user's chosen agent name and prepends an identity line (`You are **{name}**, an ADLC autonomous agent with the role of **{role}**`).
4. On provision, `handleProvision` adds `adlcRole`, `agentFiles`, `skillSlugs`, `skillContents`, `scriptTemplates` to the POST body.
5. `server/lib/agents/provision.cjs` handles 4 blocks: override agent files (IDENTITY/SOUL/TOOLS/AGENTS.md) + create `outputs/` dir, install global skills to `~/.openclaw/skills/{slug}/SKILL.md` (idempotent), write agent scripts to `{workspace}/scripts/`, persist `adlcRole` in `openclaw.json`.
6. `ensureSharedAdlcScripts()` in `scripts.cjs` idempotently writes shared scripts (`notify.sh`, `gdocs-export.sh`, `email-notif.sh`) to `~/.openclaw/scripts/`.
7. SQLite `agent_profiles` has a `role` column (migration in `db.cjs`). `GET /api/agents` exposes `role` from profile. `AgentCard` uses `getTemplateColor()`/`getTemplateLabel()` for left border + role badge.

**`notify.sh`** is channel-agnostic: queries `AOC_URL/api/agents/$AOC_AGENT_ID/channels` to auto-detect bound channel (priority: Telegram > WhatsApp > Discord), with `--channel` override flag.

### Role-Based Access Control

Two user roles: `admin` and `user` (plus internal `agent` role used by service tokens). Admin bypasses all ownership checks; regular users retain read access to everything but may only mutate resources they created.

- **Ownership columns** — `agent_profiles.provisioned_by`, `connections.created_by` (both nullable `INTEGER` referencing `users.id`). Set on create; checked on mutate.
- **Server enforcement** (`server/lib/db.cjs`):
  - `requireAdmin` — 403 unless `req.user.role === 'admin'`.
  - `requireAgentOwnership` / `requireConnectionOwnership` — admin + `agent` role bypass; otherwise checks ownership column. Apply as Express middleware on mutation routes.
- **Client mirror** (`src/lib/permissions.ts`) — `useIsAdmin()`, `useCanEditAgent(agent)`, `useCanEditConnection(conn)` hooks and pure `canEditAgent/canEditConnection(resource, user)` variants for list maps. Keep these in sync with server checks when adding new ownership-scoped resources.
- Admin-only routes are gated in `src/App.tsx` via `<AdminOnly>` wrapper (e.g., `/users`).

### Invitations & Registration

Self-serve registration is invite-only. Admins generate invitations; new users redeem tokens at `/register`.

- Table: `invitations (id, token, created_by, expires_at, default_role, note, use_count, revoked_at, created_at)` — see `server/lib/db.cjs`.
- Management UI: `src/pages/UserManagementPage.tsx` (`/users`, admin-only) — users tab + invitations tab (create, copy link, revoke, delete).
- Registration UI: `src/pages/RegisterPage.tsx` (`/register?token=...`) — public route.
- Helpers: `createInvitation`, `getInvitationByToken`, `revokeInvitation`, `incrementInvitationUse`. New user's role comes from `invitations.default_role`.
- Default admin bootstrap still works: if no users exist, the setup flow creates the first admin (no invitation required).

### Managed Role Templates

`role_templates` SQLite table (seeded from `server/data/role-templates-seed.json` on startup) — persists ADLC role presets server-side in addition to the compile-time TS templates in `src/data/role-templates/`. Origin column distinguishes `seed` vs user-created presets. Use this table (not the TS files) for anything that needs runtime mutation.
