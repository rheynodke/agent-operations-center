# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Agent Operations Center (AOC) — a **multi-tenant** full-stack web dashboard for monitoring, managing, and controlling OpenClaw AI agents. Each user gets:

- An isolated OpenClaw filesystem at `~/.openclaw/users/<id>/.openclaw/` (admin uses the root `~/.openclaw/`).
- A dedicated, lazily-spawned OpenClaw gateway process running on its own port (admin → external `18789`, others → managed range `19000-19999`).
- A **Master Agent** (one per user, created during onboarding) that orchestrates the user's team and routes intent to specialist sub-agents.
- A per-user "General" project + auto-managed Mission Rooms.

The backend reads agent state from each user's OpenClaw filesystem and provides real-time visibility via WebSocket. Cross-tenant isolation is enforced at the gateway, filesystem, and SQLite-row layers.

## Commands

```bash
npm run dev          # Start both client (Vite on :5173) and server (Node on :18800) concurrently
npm run dev:client   # Vite dev server only (port 5173)
npm run dev:server   # Express backend only with --watch (port 18800)
npm run build        # TypeScript check + Vite production build
npm start            # Production server (serves built frontend + API)
npm test             # node --test on server/lib/*.test.cjs (unit tests for db, provision, gateway-orchestrator, etc.)
npm run generate-token  # Generate a random 32-byte hex token (for DASHBOARD_TOKEN)
```

**Gateway manager (no server needed):**
```bash
./scripts/gw.sh                    # List all user gateway statuses (reads SQLite + OS process table directly)
./scripts/gw.sh status <userId>    # Detailed status for one user
./scripts/gw.sh start  <uid|all>   # Start gateway(s) — spawns openclaw-gateway, persists port/pid to DB
./scripts/gw.sh stop   <uid|all>   # Stop gateway(s) — SIGTERM → SIGKILL + clears DB state
./scripts/gw.sh restart <uid|all>  # stop + start
./scripts/gw.sh logs   <userId>    # Tail <userHome>/logs/gateway.log
./scripts/gw.sh orphans            # Find gateway PIDs not tracked in SQLite
```
`gw.sh` is useful when AOC is down or the orchestrator is misbehaving. It allocates ports using the same 3-stride logic as the orchestrator and requires `sqlite3` CLI.

No linter is configured. Tests use Node's built-in `node:test` framework — see `server/lib/*.test.cjs` and `server/routes/*.test.cjs`.

## Environment

Requires Node >= 20. Copy `.env.example` to `.env`. Key vars:

- `PORT` (default 18800) — AOC API port.
- `OPENCLAW_HOME` — admin's OpenClaw home (defaults to `~/.openclaw`).
- `OPENCLAW_BIN` — path to `openclaw` binary (default `/opt/homebrew/bin/openclaw`).
- `DASHBOARD_TOKEN` — legacy; superseded by SQLite users + JWT.
- `AOC_MAX_GATEWAYS` (default 50) — per-AOC cap on concurrently-running per-user gateways.
- `GATEWAY_BACKOFF_MS` — comma-separated retry delays for orchestrator (default `5000,30000,300000`).

## Architecture

**Two-process dev setup:** Vite dev server proxies `/api/*` and `/ws/*` to the Express backend (see `vite.config.ts`).

### Multi-Tenant Foundation (load-bearing — read FIRST)

The platform is **multi-tenant by default**. The cross-cutting invariants:

1. **Per-user gateway processes.** Admin (uid=1) connects to an external systemd-managed `openclaw-gateway` on port 18789. Every other user gets a per-user gateway lazy-spawned by `server/lib/gateway-orchestrator.cjs`, running under `<userHome>` with `OPENCLAW_STATE_DIR=<userHome>` env. Gateway processes survive AOC restart (detached + token persisted in SQLite `users.gateway_token`); on AOC startup, `cleanupOrphans()` re-attaches alive PIDs rather than killing them.

2. **Per-user filesystem.** `getUserHome(userId)` from `server/lib/config.cjs` returns:
   - `OPENCLAW_BASE` (admin's `~/.openclaw`) when `userId === 1`
   - `<OPENCLAW_BASE>/users/<userId>/.openclaw` otherwise
   `ensureUserHome()` in the orchestrator creates this on first spawn, copies admin's `agents.defaults` (rewriting `workspace` to per-user path), and inherits the top-level `tools` and `approvals` config.

3. **Symlinked shared resources.** `<userHome>/skills/` and `<userHome>/scripts/` are symlinks to admin's `~/.openclaw/skills/` and `~/.openclaw/scripts/`. Installing a built-in skill bundle once at admin's home propagates to every user.

4. **Master Agent = "default agent" for the user.** Master's workspace is `<userHome>/workspace/` (the singular global dir, same layout as admin's `main` agent). Sub-agents nest under `<userHome>/workspaces/<sub-id>/`. This is what `agents.defaults.workspace` points at, so Master == default semantically.

5. **GatewayPool keyed by userId.** `gatewayPool.forUser(userId)` returns a `GatewayConnection`. `gatewayProxy` is a back-compat alias for `gatewayPool.forUser(1)` (admin). Per-user connections do NOT auto-connect — caller must verify `conn.isConnected` and use `orchestrator.getRunningToken(userId)` + `conn.connect({port,token})` if stale. See `server/routes/master.cjs` for the lazy-connect pattern.

6. **WS auto-reconnect on orchestrator events.** `orchestrator.on('spawned'|'stopped')` listeners in `gateway-ws.cjs` reconnect any in-pool connection automatically — so a user-triggered restart doesn't require AOC restart or user re-login.

7. **Ownership scoping.** SQLite columns `agent_profiles.provisioned_by`, `connections.created_by`, `projects.created_by`, `mission_rooms.created_by`, `users.master_agent_id`, `agent_profiles.is_master`. `parseScopeUserId(req)` from `server/helpers/access-control.cjs` resolves the request's effective userId (admin can impersonate via `?owner=<id>`).

### Frontend (React 19 + TypeScript)

- **Routing:** React Router v7 in `src/App.tsx`. Auth flow: Setup → Login → `<MasterGate>` → DashboardShell. Pages at `src/pages/`.
  - `<MasterGate>` redirects users with no master to `/onboarding`.
  - `<OnboardingGate>` (wrapped around `/onboarding`) bounces users who already have a master back to `/`.
- **State:** Zustand stores in `src/stores/index.ts` — one store per domain (agents, sessions, tasks, cron, routing, alerts, activity, live feed, auth, WebSocket status). Chat state in `src/stores/useChatStore.ts`. Theme in `src/stores/useThemeStore.ts`. Auth user includes `hasMaster: boolean` and `masterAgentId: string | null`.
- **Real-time:** `src/hooks/useWebSocket.ts` connects to `/ws`, dispatches typed events to Zustand stores. `src/hooks/useDataLoader.ts` handles initial REST data fetch. `src/hooks/useMasterStatus.ts` exposes `{ hasMaster, masterAgentId, refresh }`.
- **API clients:** `src/lib/api.ts` — all standard REST endpoints. `src/lib/chat-api.ts` — gateway/chat-specific endpoints. Both use auto-auth headers from `useAuthStore`.
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite` plugin. shadcn/ui components in `src/components/ui/`. Path alias `@/` maps to `src/`. **Always use semantic tokens** (`bg-card`, `border-border`, `text-foreground`, `bg-foreground/X`) — not raw colors — so light/dark mode work.
- **Types:** All shared types in `src/types/index.ts`. `Agent` includes `isMaster?`, `provisionedBy?`. `AuthUser` includes `hasMaster`, `masterAgentId`.

### Backend (Node.js + Express 5, CommonJS)

- **Entry:** `server/index.cjs` — Express app with JWT auth, Helmet, CORS, rate limiting.
- **Barrel:** `server/lib/index.cjs` — **explicit** named export list; adding a new function to any sub-module requires also adding it here. Does NOT use spread (`...submodule`). Note: `server/lib/agents/index.cjs` is a local sub-barrel that *does* use spread to compose its own files.
- **Sub-modules:**
  - `server/lib/agents/detail.cjs` — agent CRUD + channel binding management. `_ownerOf(agentId)` resolves owner via `db.getAgentOwner` for per-tenant path resolution (`homeFor`/`agentsDirFor`/`workspaceFor` all use it).
  - `server/lib/agents/files.cjs` — editable files allowlist: `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `AGENTS.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`. `injectSoulStandard()` idempotently appends the AOC research output standard.
  - `server/lib/agents/skills.cjs`, `tools.cjs`, `skillScripts.cjs` — per-agent skill + tool plumbing.
  - `server/lib/agents/provision.cjs` — writes new agent to `openclaw.json` + scaffolds workspace. **Master-aware**: when `isMaster=true`, uses `<home>/workspace` (not nested), grants broad fs access (`tools.fs.workspaceOnly: false`), explicit skills allowlist (`MASTER_EXTRA_SKILLS + agents.defaults.skills`), injects orchestration sections into SOUL.md/AGENTS.md/TOOLS.md.
  - `server/lib/aoc-master/installer.cjs` — bundled `aoc-master` skill (delegate.sh, team-status.sh, list-team-roles.sh, provision.sh, mission_room.sh + SKILL.md). Master-only auto-enable via `ensureSkillEnabledForUserMasters({ masterAgentIds })`. As of 1.1.0 this skill absorbed the deprecated `mission-orchestrator` (mission_room.sh + task-board playbook); `migrateRetireMissionOrchestrator()` strips the legacy slug from every openclaw.json on startup.
  - `server/lib/aoc-tasks/installer.cjs`, `aoc-connections/installer.cjs`, `browser-harness/odoo-installer.cjs` — other built-in skill bundles. See **AOC Built-in Skills & Sync Engine** below.
  - `server/lib/pairing.cjs` — DM pairing approval + allow-list for telegram/whatsapp/discord.
  - `server/lib/sessions/index.cjs`, `opencode.cjs`, `gateway.cjs` — session parsers (per-user via `homeFor(userId)`).
  - `server/lib/models.cjs` — `getAvailableModels` reads model list from per-user `openclaw.json`.
  - `server/lib/gateway-ws.cjs` — `GatewayPool` (keyed by userId) + persistent WebSocket connections to per-user gateways. 3-layer auth: device token > Ed25519 signing > passphrase. Auto-reconnect on orchestrator `spawned`/`stopped` events.
  - `server/lib/gateway-orchestrator.cjs` — per-user gateway lifecycle: `spawnGateway(userId)`, `stopGateway(userId)`, `restartGateway(userId)`, `cleanupOrphans()` (re-attaches alive PIDs after AOC restart), `gracefulShutdown()` (leaves children running for next AOC startup), `allocatePort()` (3-port stride + OS probe), `findAocManagedOrphanPids()` (lsof port-based detection — macOS `ps -E` doesn't expose env).
  - `server/lib/db.cjs` — SQLite via `sql.js`. Master flag helpers: `markAgentProfileMaster`, `setUserMasterAgent`, `getUserMasterAgentId`. Profile reads expose camelCase aliases (`avatarPresetId`, `isMaster`). `normalizeMissionMembers(ids, masterAgentId?)` — per-user master-aware membership normalizer; `normalizeMissionRoom(row)` reads owner's master via `created_by` → `getUserMasterAgentId`.
  - `server/lib/routing.cjs` — `parseRoutes` (per-tenant), `getChannelsConfig` (sanitized).
  - `server/lib/watchers.cjs` — chokidar file watchers; broadcasts `session:live-event` and `processing_end` WS events.
  - `server/lib/automation/cron.cjs` — cron CRUD (per-tenant `~/.openclaw/users/<id>/.openclaw/cron/jobs.json`).
  - `server/lib/scripts.cjs` — shared + agent-specific loose scripts. `syncAgentBuiltins(agentId)` + `LEGACY_FLAT_SCRIPTS_MOVED_TO_SKILLS` for migration cleanup.
  - `server/lib/workspace-browser.cjs` — read-only file manager rooted at agent workspace. Path-traversal hardened.
  - `server/lib/terminal.cjs` — Claude Code WS terminal with `CWD_TARGETS` allowlist.
  - `server/lib/versioning.cjs` — file version history in SQLite (max 50 per scope, SHA-256 dedupe).
  - `server/lib/integrations/index.cjs` — project integration engine (currently `google_sheets` only).
- **Routes:**
  - `server/routes/auth.cjs` — login, register-invite (auto-spawns gateway), `/auth/me` (returns `hasMaster`, `masterAgentId`), invitation CRUD, password reset.
  - `server/routes/onboarding.cjs` — `POST /api/onboarding/master` (atomic: provision + link + auto-create General project + restart gateway). `runMasterBackfill()` ensures admin has `master_agent_id='main'` at startup.
  - `server/routes/master.cjs` — `GET /api/master/team` (excludes master), `POST /api/master/delegate` (calls user's gateway `sessions.create` + `chat.send`). Lazy-connects gateway pool if stale.
  - `server/routes/rooms.cjs` — agent CRUD, mission rooms CRUD (master-aware membership).
  - `server/routes/agents.cjs` — agent profile/skills/avatar/pairing.
  - `server/routes/gateway.cjs`, `health.cjs`, `tasks.cjs`, `projects.cjs`, `skills.cjs`, `browser-harness.cjs`, `mcp-agents.cjs` — domain endpoints.
- **Config:** `server/lib/config.cjs` exports `OPENCLAW_HOME`, `OPENCLAW_BASE`, `OPENCLAW_WORKSPACE`, `AGENTS_DIR`, `getUserHome(userId)`, `getUserAgentsDir(userId)`, `readJsonSafe`.
- **AI generation:** `server/lib/ai.cjs` — `generateStream()` (SSE via Claude CLI subprocess), `getOsContext()`, `FILE_CONTEXTS`.

### Data Flow

OpenClaw filesystem (per-user) → chokidar watchers → Express parsers (scoped via `parseScopeUserId(req)`) → REST API + WebSocket broadcasts → Zustand stores → React UI.

The backend does NOT own agent data. Each user's OpenClaw filesystem (`<userHome>/`) is the source of truth. SQLite holds dashboard-only data: user accounts, agent profiles/avatars, master agent links, projects, mission rooms, tasks, integrations, file versions, gateway state.

## Authentication, Onboarding, & Master Agent

### Invitations & Registration

Self-serve registration is invite-only. Admins generate invitation tokens; new users redeem at `/register?token=...`.

- Table: `invitations (id, token, created_by, expires_at, default_role, note, use_count, revoked_at, created_at)`.
- Management UI: `src/pages/UserManagementPage.tsx` (`/users`, admin-only) — users tab + invitations tab.
- Registration UI: `src/pages/RegisterPage.tsx` (`/register?token=...`) — public route.
- Default admin bootstrap: if no users exist, the setup flow creates the first admin (no invitation required).
- On register, `server/routes/auth.cjs` calls `ensureUserGateway(user.id)` to spawn the per-user gateway. Login retains the call as silent fallback for post-AOC-restart recovery.

### Onboarding Wizard

`/onboarding` (gated by `<OnboardingGate>` — bounces users who already have a master). 4-step wizard at `src/pages/OnboardingPage.tsx`:

1. **Mulai (Welcome)** — friendly intro, no template picker.
2. **Identitas** — `<CompactAvatarPicker>` (16 presets); selecting a preset autofills name/persona/description (Bahasa Indonesia) IF the field is empty OR matches the previously-selected preset's value (so user customizations survive).
3. **Channel** — Telegram / WhatsApp / Discord cards or skip. Each card expands an inline form using shared `ChannelBindingForms` components.
4. **Review** — hero card uses the avatar **image** (not emoji) when a preset is selected. "Buat Agent" button.

If WhatsApp/Telegram/Discord channel is selected, the wizard advances to a 5th **Hubungkan** step that polls `/api/agents/:id/pairing` every 3s and auto-approves the first matching pairing request. WhatsApp also calls `/api/channels/whatsapp/:agentId/login/start` to fetch the QR code with retry-with-backoff (gateway needs ~5-10s to come up after restart).

`finish()` triggers a smooth zoom-in transition (700ms hero animation) then navigates to `/`.

The wizard's PixelSnow background (`src/components/onboarding/PixelSnow.tsx`) is a Three.js shader inherited from reactbits.dev; color is read from the active theme's `--primary` CSS variable so it matches the obsidian cyberpunk theme.

### Master Agent

Each user has exactly **one** Master Agent. Backed by:
- `users.master_agent_id` (TEXT, nullable; partial unique constraint to prevent duplicates per user).
- `agent_profiles.is_master` (INTEGER 0/1; partial unique index `WHERE is_master=1` per `provisioned_by`).
- Auto-injected workspace files (see below).

**Auto-injection on `provisionAgent({ isMaster: true })`:**
- Workspace path: `<userHome>/workspace/` (singular global, NOT `workspaces/<id>/`).
- `tools.fs.workspaceOnly: false` (broad fs access — needed for skills outside workspace).
- `skills` array: `['aoc-master', 'browser-harness-odoo', ...config.agents.defaults.skills]` (deduped). `MASTER_EXTRA_SKILLS` constant in provision.cjs holds the master-only slugs.
- **SOUL.md** — Master Agent addendum appended after research-standard block.
- **AGENTS.md** — `MASTER_AGENTS_ADDENDUM`: routing decision table + risk-aware operating style + memory habits.
- **TOOLS.md** — built-in AOC skill table with key entry points + pointer to AGENTS.md orchestration section.

**Onboarding endpoint** (`POST /api/onboarding/master`):
1. 409 if user already has a master.
2. Calls `provisionAgent({ ..., isMaster: true })`.
3. Persists `agent_profiles` (with `avatar_preset_id`, `provisioned_by=userId`).
4. `db.markAgentProfileMaster(agentId)` + `db.setUserMasterAgent(userId, agentId)`.
5. `aocMasterInstaller.ensureSkillEnabledForUserMasters({ masterAgentIds: [agentId] })` (belt-and-suspenders).
6. Auto-creates per-user "General" project (`db.createProject({ name: 'General', createdBy: userId })`), which in turn auto-creates a project default mission room with the master as the always-on member.
7. `restartGateway(userId)` so the new agent + channel bindings load.

**Risk-aware operating style** (lives in the prompting layer, NOT gateway approval gates):
- `tools.exec.security: 'full'` and `approvals.exec.enabled: false` (inherited from admin via `ensureUserHome`).
- AGENTS.md instructs three-tier behavior: safe ops just run; risky ops announce + 1 clarifying question; hard-stop ops refuse and surface to user.
- Don't re-introduce gateway approval prompts thinking it's safer — it breaks the master's flow and contradicts the design.

### `aoc-master` Skill (Delegation + Task Board Primitives)

Bundled at `~/.openclaw/skills/aoc-master/` (symlinked into per-user homes). Master-only — `ensureSkillEnabledForUserMasters` enrols only agents with `is_master=1`. **History**: as of 1.1.0 this skill absorbed the previously-separate `mission-orchestrator` skill; `mission_room.sh` (Task Board driver) now ships from here, so every per-user master gets task-board operations — not just admin's `main` like before.

- `team-status.sh` — list user's sub-agents (excludes master) with role + last activity. Hits `GET /api/master/team`.
- `delegate.sh <agent_id> "<task>"` — opens or reuses session keyed `master-delegate-<master>-<target>` via `gateway.sessionsCreate` + posts task as first chat turn. Hits `POST /api/master/delegate`.
- `list-team-roles.sh` — short `agent_id<TAB>role` list for quick lookup.

Backend endpoints (`server/routes/master.cjs`):
- `GET /api/master/team` — `db.getAllAgentProfiles().filter(p => p.provisioned_by === userId && p.agent_id !== masterId)`.
- `POST /api/master/delegate {targetAgentId, task}` — verifies caller has master + target is owned by same user. Lazy-connects gateway pool. Returns `{ sessionKey, targetAgentId, masterAgentId }`. 400 self-delegate, 403 no-master, 404 cross-tenant target.

### Master role identity in Agent Detail

The Edit Configuration modal in `src/pages/AgentDetailPage.tsx` (`EditConfigModal`):
- ADLC role dropdown options include `master-orchestrator` (🧭).
- When `detail.profile?.isMaster` is true: dropdown is locked to `master-orchestrator`, a "🧭 Master Orchestrator" badge shows in the section header, and the helper text reads "This is your Master Agent — role is locked. The Master orchestrates your team and routes user intent to the right specialist."

`/api/agents/:id/detail` includes `profile.isMaster`, `profile.role`, `profile.provisionedBy`, `profile.avatarPresetId`, `profile.color`.

## Mission Rooms

Per-user, master-scoped membership.

### Schema

Core `mission_rooms` table: `id, kind, project_id, name, description, member_agent_ids, created_by, created_at, updated_at`. Phase 1 HQ columns: `is_hq INTEGER DEFAULT 0`, `is_system INTEGER DEFAULT 0`, `owner_user_id INTEGER` + unique index `WHERE is_hq=1`. Phase 2 collab flag: `supports_collab INTEGER DEFAULT 0`.

Phase 2 collaboration tables:
- `room_artifacts (id, room_id, category, title, description, tags, created_by, created_at, updated_at, pinned, archived, latest_version_id)`
- `room_artifact_versions (id, artifact_id, version_number, file_path, file_name, mime_type, size_bytes, sha256, created_by, created_at)` — unique on `(artifact_id, version_number)`
- `room_collaboration_sessions (id, room_id, session_key, agent_id, started_by, started_at, ended_at)` — unique on `session_key`

### Master-Scoped Membership (sub-project 4.5 — DONE)

Every mission room MUST include the requesting user's master agent — NOT the literal string `'main'`. Helpers in `server/lib/db.cjs`:

- `normalizeMissionMembers(ids, masterAgentId?)` — dedupes + prepends master. Falls back to `'main'` when master id can't be resolved (legacy paths, admin).
- `createMissionRoom({ ..., masterAgentId? })` — derives master from `createdBy` if not explicit.
- `updateMissionRoomMembers(id, ids, masterAgentId?)` — looks up master from room's `created_by`.
- `ensureProjectDefaultRoom(projectId, createdBy)` — calls `getUserMasterAgentId(createdBy)` for the always-on member.
- `normalizeMissionRoom(row)` — reads owner's master via `created_by` so re-normalization on read doesn't re-prepend `'main'`.
- `listMissionRoomsForUser(req)` — visibility filter excludes user's own master (its presence alone shouldn't grant access).

Routes in `server/routes/rooms.cjs`:
- `POST /api/rooms` — derives `masterAgentId` from `req.user.userId` and threads through.
- `PATCH /api/rooms/:id/members` — derives master from room's `createdBy`.

`canAccessRoom(req, room, db)` in `server/helpers/access-control.cjs` excludes per-user master id from ownership check.

### Auto-Created on Onboarding

Per-user "General" project is created in `POST /api/onboarding/master` (NOT register-invite — master must exist first so the project's default room can use it as the always-on member). Project's default mission room (id `room-project-<uuid>`) is auto-created via `ensureProjectDefaultRoom` and gets the master as initial member.

### HQ Room (sub-project 3 — Phase 1 + Phase 2 DONE, uncommitted)

**Phase 1 — HQ Foundation:**
- Per-user HQ room: `is_hq=1, is_system=1, owner_user_id=userId`. Auto-created in `POST /api/onboarding/master` and on AOC startup (backfill for all users with masters but no HQ).
- `server/lib/hq-room.cjs` — `ensureHqRoom(db, userId, masterAgentId)`, `addAgentToHq`, `removeAgentFromHq`, `postHqSystemMessage`.
- Auto-membership: new agent provision → `addAgentToHq`; agent delete → `removeAgentFromHq` (master deletion silenced).
- Delegation broadcasts: `POST /api/master/delegate` → `postHqSystemMessage` with `kind: 'delegation'` meta.
- Delete guard: `DELETE /api/rooms/:id` → 409 `ROOM_IS_SYSTEM` for any room with `is_system=1`.
- List scoping: HQ rooms only visible to owner (`ownerUserId`) + admin.
- Frontend: `🏠` prefix on HQ room cards, delete button hidden for system rooms, HQ sorted first.

**Phase 2 — Collaboration Layers:**
- `server/lib/room-artifacts.cjs` — `createArtifact`, `addArtifactVersion`, `listArtifacts`, `getArtifact`, `getArtifactContent`, `pinArtifact`, `archiveArtifact`, `deleteArtifact`. Files at `<OPENCLAW_HOME>/rooms/<roomId>/<artifactId>/<versionNumber>/<fileName>`. SHA-256 dedup.
- `server/lib/room-context.cjs` — `getRoomContext`, `appendToContext`, `clearContext` (CONTEXT.md at `<OPENCLAW_HOME>/rooms/<roomId>/CONTEXT.md`, append-only API). `getAgentRoomState`, `setAgentRoomState` via `agent_profiles.meta.roomState[roomId]`.
- REST endpoints in `server/routes/rooms.cjs`: 8 artifact routes (`/rooms/:id/artifacts/...`), 3 context routes (`/rooms/:id/context/...`), 2 agent-state routes (`/rooms/:id/agents/:agentId/state`).
- `aoc-room` skill bundle at `~/.openclaw/skills/aoc-room/` — 6 scripts: `room-publish.sh`, `room-list.sh`, `room-context-read.sh`, `room-context-append.sh`, `room-state-get.sh`, `room-state-set.sh`. Installed at startup. Added to `agents.defaults.skills` — all agents inherit it.
- `AOC_ROOM_ID` env injection: `POST /chat/sessions` with `roomId` body → injects `AOC_ROOM_ID` into gateway session env. Room-mention forwarding (`server/hooks/room-task-bridge.cjs`) also injects it.
- **`room-task-bridge.cjs` session strategy:** Persistent-per-room sessions keyed `agent:<agentId>:room:<roomId>:v<N>`. First message in a session gets full context (project, roster, hints); subsequent messages get compact `authorName: message.body`. Sessions auto-reset after 30 min idle (version counter bumps so gateway sees a new session key). Delegation-depth tracking (`MAX_DELEGATION_DEPTH = 3`) prevents agent ↔ agent mention loops: root user post = depth 0; each re-forward increments depth; at limit the chain is silently dropped.
- UI side panel (`src/components/mission-rooms/RoomSidePanel.tsx`): 3 tabs (Members/Artifacts/Context) for `kind='global'` rooms. Toggle via 🗂️ button in room header.

## Cron / Scheduled Tasks

- Jobs persist per-user at `<userHome>/cron/jobs.json` (gateway schema): `{id, name, agentId, schedule, sessionTarget, payload, delivery, state}`.
- **Gateway is the scheduler.** It loads `jobs.json` at startup — newly written jobs only activate after gateway restart.
- `parseCronJobs(userId)` normalizes raw job objects into UI-friendly shapes.
- Run history: `<userHome>/cron/runs/<jobId>.jsonl`.
- `CronPage` accepts optional `filterAgentId` prop; when set (from AgentDetailPage Schedules tab), hides agent filter pills and pre-fills new job form.

## Custom Tools / Scripts — Skill-as-Unit Strategy

**Core principle:** the unit of capability is a **Skill bundle**, not a loose script. Agents enable a skill; the skill's scripts come along automatically. Loose toggleable "custom tools" are a thin escape hatch, not the primary contract.

**Three tiers:**
1. **AOC built-in skills** — packaged & owned by AOC, auto-enabled. Currently: `aoc-tasks`, `aoc-connections`, `aoc-room`, `aoc-odoo`, `aoc-schedules`, `aoc-self`, `browser-harness-odoo`, and `aoc-master` (master-only). See **AOC Built-in Skills & Sync Engine** below.
2. **User skills** — full CRUD via Skills page or per-agent. Resolved via the Skill Resolution Order. Scripts at `{skillDir}/scripts/`.
3. **Loose scripts** (`server/lib/scripts.cjs`) — only for cron/orchestrator wiring or one-offs not yet warranting a skill bundle. Two scopes:
   - **Shared** (`~/.openclaw/scripts/`, symlinked into per-user homes) — managed in Skills & Tools → Custom Tools.
   - **Agent-specific** (`<agentWorkspace>/scripts/`) — per-agent.

When a loose script is "enabled", `toggleAgentCustomTool()` appends a `<!-- custom-tool: name -->` ... `<!-- /custom-tool: name -->` block to the agent's `TOOLS.md`. Metadata stored in `.tools.json` per directory.

**Don't add new flat shared scripts for capabilities that belong in a skill** — package them as a skill bundle (SKILL.md + scripts/) and either install via the Skills marketplace or, if AOC-owned plumbing, add a new installer under `server/lib/{slug}/installer.cjs` and wire it into the sync engine.

Allowed extensions: `.sh`, `.py`, `.js`, `.ts`, `.rb`, `.bash`, `.zsh`, `.fish`, `.lua`. Max 512KB.

## AOC Built-in Skills & Sync Engine

AOC ships **ten** skill bundles. They are infrastructure, not toggleable in the UI.

| Slug | Master-only? | Purpose |
|---|---|---|
| `aoc-tasks` | No | Task board contract: `update_task`, `check_tasks`, `save_output`, `post_comment`, `fetch_attachment`. |
| `aoc-connections` | No | Connection layer: `aoc-connect`, `mcp-call`, `gws-call`, `check_connections`. |
| `aoc-room` | No | Room collaboration toolkit: `room-publish`, `room-list`, `room-context-read`, `room-context-append`, `room-state-get`, `room-state-set`. Reads `AOC_ROOM_ID` env (injected when session started from a room). |
| `aoc-odoo` | No | Full odoocli operator surface (auth, model, record, method, debug, view) + 5 reference docs. Wrapper `odoo.sh <connection-name> <args...>` fetches creds from the assigned `odoocli`-typed connection at runtime via `GET /api/connections/:idOrName/odoo-profile`, materializes ephemeral `.odoocli.toml` (mode 0600 in `$TMPDIR`), runs odoocli with `--config`, removes the file on exit. **Never writes `~/.odoocli.toml`.** Bundle source vendored under `server/lib/aoc-odoo/bundle/`. Connection lookup accepts ID or name; ambiguous names → 409 with candidates. |
| `aoc-schedules` | No | Scheduled-task toolkit for in-room conversations: `schedules-list`, `-create`, `-update`, `-toggle`, `-run-now`, `-runs`, `-delete`. New jobs bind to `AOC_AGENT_ID` by default; pass `--no-bind` for owner-level. **Always reminds the user that gateway restart is required after any mutation** (cron scheduler reads `jobs.json` once at gateway boot). Delete refuses without `--yes`. |
| `aoc-self` | No | Lets agents author their own personal (scope='agent') skills: `agent-skill-create`, `-add-script`, `-list`, `-remove`. Skills land at `<workspace>/.agents/skills/<slug>/` — visible only to that agent. `buildSkillsPathPrefix` walks each agent's workspace too, so script names resolve on PATH after gateway restart. Delete refuses without `--yes`. |
| `browser-harness-odoo` | No (but defaults exclude it) | Odoo browser automation. SKILL.md + 10 shell scripts. |
| `aoc-master` | **Yes** | Orchestration toolkit: `delegate.sh`, `team-status.sh`, `list-team-roles.sh`, `provision.sh`, `mission_room.sh` (Task Board driver: create/update/comment/dispatch/approve/request-change tasks + post to other rooms). Auto-enabled only for agents with `is_master=1`. As of 1.1.0 absorbed the deprecated `mission-orchestrator` skill. |
| `aoc-safety-core` | No | Universal safety hard limits — tenant boundary, credential disclosure, prompt injection, config integrity. Auto-enabled for every agent. Text-only SKILL.md (no scripts). |
| `aoc-safety-worker` | Excluded for master | Sub-agent additional limits — workspace boundary, no orchestration, out-of-band auth refusal. Master agents strip this via `MASTER_EXCLUDED_SKILLS` in `provision.cjs`. |

**Auto-enable mechanism (each installer):**
1. Install/refresh the skill bundle to `~/.openclaw/skills/{slug}/`.
2. (For non-master-only) Add slug to admin's `agents.defaults.skills`.
3. (For non-master-only) Walk every existing admin agent and add to per-agent allowlist.
4. (For master-only) `ensureSkillEnabledForUserMasters({ masterAgentIds })` adds to specific agent's allowlist only.

**Per-user inheritance:** New users inherit `agents.defaults.skills` via `ensureUserHome` in the orchestrator. Sub-agents provisioned in user homes get this set as explicit `skills` array (NOT empty `[]` — OpenClaw treats `[]` as full override, no merge). Master gets `MASTER_EXTRA_SKILLS + defaults` deduped.

**`syncAgentBuiltins(agentId)`** in `scripts.cjs` reconciles built-in shared scripts (currently `BUILTIN_SCRIPT_MANIFEST` is empty — all built-ins migrated to skills) and purges legacy flat scripts (`LEGACY_FLAT_SCRIPTS_MOVED_TO_SKILLS`). Wired into startup, connection PUT, skill toggle/create/delete, browser-harness install — idempotent.

**Bundle versioning.** Each installer has `BUNDLE_VERSION`. Bumping it forces overwrite of `protect: true` files. Use this when a skill's contract changes and you need every user to pick up the new version. Files marked `exec: true` get explicit `fs.chmodSync(target, 0o755)` after write because `fs.writeFileSync(..., {mode})` is ignored when the file already exists.

## Chat / Gateway Integration

- Chat requires the user's gateway to be running. Per-user routes return 503 if the gateway pool entry is disconnected.
- `chatApi.createSession()` → `POST /api/chat/sessions` → `gatewayPool.forUser(uid).sessionsCreate(agentId)`.
- Real-time message streaming: gateway WS events → `gateway-ws.cjs` → dashboard WS broadcast → `useWebSocket.ts` → `useChatStore`.
- JSONL poller in `watchers.cjs` is fallback for final responses when gateway lifecycle events arrive before the last message.
- `useChatStore.ts` has `gatewayMessagesToGroups()` for converting raw gateway history into `ChatMessageGroup[]` (handles thinking blocks, text-encoded tool call markers, structured tool_use blocks).

## Channel Binding Architecture

Channel bindings in per-user `openclaw.json` use two patterns:
1. **Explicit:** `config.bindings[].agentId === agentId` with `match.channel` + `match.accountId`.
2. **Convention:** Account key equals `agentId` in `config.channels.telegram.accounts` / `config.channels.whatsapp.accounts`.

`getAgentChannels()` supports both — always check both when discovering existing bindings.

**Discord** has two coexisting patterns:
- **Legacy shared:** `config.channels.discord` (enabled, token, dmPolicy, groupPolicy).
- **Per-account:** `config.channels.discord.accounts[agentId] = { token, dmPolicy, groupPolicy }` + binding with `match.accountId`.
- Use `groupPolicy` (not `guildPolicy`) — OpenClaw validates field names.

## Channel Login & DM Pairing

- **WhatsApp QR login:** `POST /api/channels/:channel/:account/login/start` calls gateway RPC `web.login.start` → returns `{ qrDataUrl, message }`. `null` qr means already linked. **Retry-with-backoff** is needed because gateway needs ~5-10s after restart for the WA web-login provider to come up — see `OnboardingPage.tsx` step 5.
- **DM pairing:** users DM the bot, bot replies with a short-lived code, user enters it (or wizard auto-approves the first matching code).
  - `GET /api/agents/:id/pairing` — pending requests across channels for an agent.
  - `POST /api/pairing/:channel/approve` `{ code, accountId? }` — adds to allow-list.
  - Pending: `<userHome>/credentials/{channel}-pairing.json`. Approvals: `{channel}[-{accountId}]-allowFrom.json`.

## Agent Detail Page Tab Structure

`AgentDetailPage.tsx` uses 5 body tabs: **Agent Files** | **Skills & Tools** | **Channels** | **Connections** | **Schedules**.

- **Agent Files** — two modes (`filesMode`):
  - *Curated*: editable allowlist (IDENTITY/SOUL/TOOLS/AGENTS/USER/HEARTBEAT/MEMORY.md). View + edit both use `MonacoCodeEditor`.
  - *Browse*: `WorkspaceBrowser` (read-only file manager, tree + preview, lazy-load, `DirCache`).
- **Skills & Tools** — sub-tabs `'skills' | 'tools' | 'custom-tools'`. Custom Tools sub-tab embeds `SkillsTerminal` with `cwd="agent-scripts"`.
- **Connections** — `AgentConnectionsTab`. Search + per-type filter chips + collapsible groups + Bulk select. Backed by `api.getAgentConnections` / `api.setAgentConnections`.
- **Schedules** — embeds `<CronPage filterAgentId={id} />`.

**Edit Configuration modal** (`EditConfigModal`) — see Master Agent section above for the locked dropdown behavior. ADLC role options include `master-orchestrator`.

**Compact header mode** (persisted in `localStorage` `aoc.agent-detail.headerCompact`) — toggle a ~40px single-row header.

## Agent Rename

When display name changes, `updateAgent` in `detail.cjs` computes a new slug (`slugify(newName)`). If different and not `"main"`, atomic rename across:
- `openclaw.json` agent entry key.
- `channels.telegram.accounts` / `channels.whatsapp.accounts` keys matching the old ID.
- All binding `agentId` references.
- Filesystem: `<userHome>/agents/{id}/` and the agent's workspace directory.

`updateAgent` returns `{ agentId, changed }` — `agentId` may differ from request param. PATCH handler calls `db.renameAgentProfile(oldId, newId)`. Frontend navigates to new `/agents/{newId}`.

## Agent Provisioning

Two entry points:

1. **Master onboarding** (`POST /api/onboarding/master`) — see Master Agent section.
2. **Sub-agent provision** (`POST /api/agents`) — gated by 409 if user has no master. `ProvisionAgentWizard.tsx` 4-step modal; `handleProvision` calls `api.provisionAgent({ adlcRole, agentFiles, skillSlugs, skillContents, scriptTemplates })`.

`provisionAgent({ id, name, isMaster?, adlcRole?, ... }, userId)`:
1. Validate.
2. Resolve paths per-tenant (master uses `<home>/workspace`, sub-agents use `<home>/workspaces/<id>`).
3. Add to `openclaw.json` (do NOT write `isMaster` or `adlcRole` into the agent entry — OpenClaw rejects unknown keys; track those in SQLite only).
4. Write workspace files (IDENTITY/SOUL/TOOLS/AGENTS/MEMORY.md). Master gets addendum content via `MASTER_AGENTS_ADDENDUM`. Skill from template overrides workspace files when `agentFiles` provided.
5. Install global skills (template's `skillSlugs` + `skillContents`) to `~/.openclaw/skills/{slug}/SKILL.md`.
6. Write per-agent script templates to `{workspace}/scripts/`.
7. Run `syncAgentBuiltins(id)` to clean up legacy flat-script blocks in TOOLS.md.

`fsWorkspaceOnly: false` in opts maps to `tools.fs.workspaceOnly: false`. Master agents and `adlcRole` agents get this automatically.

Per-agent `env` fields are NOT supported in OpenClaw 2026.4.8+. AOC env vars (`AOC_TOKEN`, `AOC_URL`, `AOC_AGENT_ID`) are injected at runtime via the agent's `update_task.sh` script and `.aoc_agent_env` env file.

## Skill Resolution Order

Skills resolved by searching in order (first `SKILL.md` match wins):
1. `<agentWorkspace>/skills/{name}/`
2. `<agentWorkspace>/.agents/skills/{name}/`
3. `~/.agents/skills/{name}/`
4. `<userHome>/skills/{name}/` (which is symlinked to `~/.openclaw/skills/{name}/` for non-admin users)

Skill scripts at `{skillDir}/scripts/`, managed via `skillScripts.cjs`.

## AI Assist (Content Generation)

`POST /api/ai/generate` — SSE streaming endpoint. Spawns a `claude` CLI subprocess via `server/lib/ai.cjs` (`generateStream()`). `CLAUDE_BIN` env var (default `/opt/homebrew/bin/claude`).

- `AiAssistPanel.tsx` (`src/components/ai/`) — floating panel inline next to editable file areas. Calls `streamAiGenerate()`.
- `getOsContext()` detects installed runtimes/shells; consumed by `GET /api/ai/os-context`.
- `FILE_CONTEXTS` map per-filetype generation hints.
- SSE format: `data: {"text": "..."}` chunks, terminated by `data: {"done": true}` or `data: {"error": "..."}`.
- Abort: client disconnect detected via `req.socket.on('close')` → `AbortController`.

## Skill & Script Templates

`src/data/templates/` — ADLC-aligned template library.

- **Types:** `SkillTemplate` (per ADLC agent), `ScriptTemplate` (filename + content).
- Entry point: `src/data/templates/index.ts` exports `SKILL_TEMPLATES`, `SCRIPT_TEMPLATES`, `SUPERPOWERS_TEMPLATES`.
- `SkillTemplatePicker.tsx` — modal picker UI consumed by SkillsPage and agent detail Skills tab.
- `src/data/adlcTemplates.ts` — **deprecated** re-export wrapper; use `src/data/templates/index.ts` directly.

## Code Editors

**`MonacoCodeEditor`** (`src/components/ui/MonacoCodeEditor.tsx`) — preferred everywhere. Lazy-loaded Monaco with bundled workers (CSP-safe, no CDN). Auto-language from `filename`. Theme-aware. **Single editor pattern** — adding a new editable code surface should use `MonacoCodeEditor`, not `<textarea>` or `<pre>`.

**`SyntaxEditor`** — legacy; prefer Monaco for new surfaces.

## Workspace Browser API

`server/lib/workspace-browser.cjs` — read-only file manager rooted at agent workspace.

- `GET /api/agents/:id/workspace/tree?path=` — directory tree.
- `GET /api/agents/:id/workspace/file?path=` — file content. Auth uses `authMiddlewareWithQueryToken` for `<img src>` and direct downloads.
- Frontend: `getWorkspaceTree`, `getWorkspaceFile`, `getWorkspaceFileUrl` in `src/lib/api.ts`.
- **Security:** path traversal blocked; symlinks refused via `fs.lstat`.

## Settings Page Tab Layout

`src/pages/SettingsPage.tsx` `Tab` union: `'account' | 'engine' | 'channels' | ...openclaw.json sections`.

- **Account** — user profile + auth.
- **Engine** — AOC's own built-in feature config (NOT `openclaw.json`). `AgentStandardsCard` (research output standard) + `BrowserHarnessCard` (re-install bundle).
- Sidebar has visible group separator between user-section tabs and openclaw.json config tabs.

## Sidebar Component

`src/components/layout/Sidebar.tsx` — `min-h-0 overflow-y-auto` on `<nav>` so menu scrolls at short viewports. Logo block has `shrink-0`.

## Agent World (3D View)

`AgentWorldPage` → `AgentWorldView` → `AgentWorld3D` (`src/components/world/`). React Three Fiber + drei. Top-down isometric scene; agent state drives animated character behavior. Theme-aware via `SCENE_THEME`.

## Tasks & Project Board

- Tasks in SQLite (`data/aoc.db`). Fields: `id, title, description, status (open|in_progress|review|done|cancelled), priority (urgent|high|medium|low), agentId, tags, cost, sessionId, projectId`.
- **Dispatch model:** `POST /api/tasks/{id}/dispatch` sends task to assigned agent via gateway RPC, stores `sessionKey`. `loadAllJSONLMessagesForTask()` reconstructs full multi-dispatch history.
- `AgentWorkSection.tsx` renders multi-turn agent conversation history inside `TaskDetailModal`.
- `syncAgentTaskScript` ensures `update_task.sh` is installed for the agent.

## Projects & Integrations

- Projects group tasks. Per-user `created_by` for ownership scoping.
- Per-user "General" project auto-created on onboarding finish.
- Project integrations sync external data into AOC tasks. Currently `google_sheets` only.
- WS event `project:sync_start` broadcasts when a sync begins.

## File Versioning

`server/lib/versioning.cjs` — every file save → `saveVersion()`. Max 50 per scope, SHA-256 dedupe. REST: `GET /api/versions?scope=...`, `POST /api/versions/{id}/restore`, `DELETE /api/versions/{id}`.

## Skill Marketplace

- **ClawHub** — install skills from a URL (GitHub raw, direct link). Flow: `clawHubTargets()` → `clawHubPreview(url)` → `clawHubInstall(url, target, agentId?)`.
- **SkillsMP** — curated marketplace. Requires API key. Flow: `skillsmpSearch(q)` → `skillsmpPreview(skill)` → `skillsmpInstall(skill, target, agentId?)`.

## Inbound Webhooks / Hooks

`/api/hooks/*` — inbound webhook configuration. `getHooksConfig`, `saveHooksConfig`, `generateHookToken`, `getHookSessions(limit)`.

## Gateway Management

`/api/gateway/*`:
- `GET /api/gateway/status` — `{ running, pids, port, portOpen, mode, bind }` for the current user's gateway.
- `POST /api/gateway/restart` — admin restarts external gateway; non-admin restarts their per-user gateway via orchestrator.
- `POST /api/gateway/stop` — kills without restart.

## OpenClaw Config Management

`/api/config` — read/write `openclaw.json` sections (per-tenant):
- `GET /api/config` — sanitized full config + path.
- `PATCH /api/config/{section}` — merges value into top-level section.

## SQLite DB Location

In dev, the DB (`aoc.db`) is at `data/aoc.db` in project root. Path controlled by `server/lib/db.cjs`.

## ADLC Role Templates

`src/data/role-templates/` — TypeScript files exporting `AgentRoleTemplate` objects. 9 templates currently: `pm-discovery`, `pa-monitor`, `ux-designer`, `em-architect`, `swe`, `qa-engineer`, `doc-writer`, `biz-analyst`, `data-analyst`. The `master-orchestrator` template is planned (sub-project 5) but not yet authored — master persona is currently auto-injected via `provision.cjs` without a template.

- **Type:** `AgentRoleTemplate` interface with `id, adlcAgentNumber, role, emoji, color, description, modelRecommendation, agentFiles, skillSlugs, skillContents, scriptTemplates, fsWorkspaceOnly: false`.
- **Barrel:** `src/data/agentRoleTemplates.ts` — `ADLC_ROLE_TEMPLATES[]`, `getTemplateById()`, `getTemplateColor()`, `getTemplateLabel()`.
- **Shell scripts in templates** must use `\${...}` (escaped) for bash variables inside TypeScript template literals.

**Provisioning flow with a template:**
1. `TemplateEntryModal` (split: ADLC Template vs Blank) on AgentsPage.
2. `TemplatePickerGrid` — selecting passes template to `ProvisionAgentWizard` as `template` prop.
3. Wizard pre-fills emoji/color/description/model from template. On step 1→2, auto-injects soul via `buildRoleSoul()`.
4. On provision, `handleProvision` adds `adlcRole, agentFiles, skillSlugs, skillContents, scriptTemplates` to POST body.
5. `provision.cjs` overrides agent files, installs global skills, writes per-agent scripts, persists role to SQLite (NOT openclaw.json).
6. `ensureSharedAdlcScripts()` writes shared scripts (`notify.sh`, `gdocs-export.sh`, `email-notif.sh`) to `~/.openclaw/scripts/`.
7. `agent_profiles.role` set; `AgentCard` uses `getTemplateColor()`/`getTemplateLabel()` for left border + role badge.

**`notify.sh`** is channel-agnostic: queries `AOC_URL/api/agents/$AOC_AGENT_ID/channels` to auto-detect bound channel (priority: Telegram > WhatsApp > Discord), with `--channel` override.

## Role-Based Access Control

Two user roles: `admin` and `user` (plus internal `agent` role for service tokens). Admin bypasses ownership checks; users retain read access to most things but mutate only resources they created.

- **Ownership columns:** `agent_profiles.provisioned_by`, `connections.created_by`, `projects.created_by`, `mission_rooms.created_by`, `users.master_agent_id`, `agent_profiles.is_master`. All nullable, set on create.
- **Server enforcement** (`server/lib/db.cjs`):
  - `requireAdmin` — 403 unless admin.
  - `requireAgentOwnership` / `requireConnectionOwnership` — admin + agent role bypass; otherwise checks ownership column.
  - `parseScopeUserId(req)` — admin can impersonate via `?owner=<id>`; non-admin always self.
- **Client mirror** (`src/lib/permissions.ts`) — `useIsAdmin()`, `useCanEditAgent(agent)`, `useCanEditConnection(conn)` hooks. Keep in sync with server when adding new ownership-scoped resources.
- Admin-only routes are gated in `src/App.tsx` via `<AdminOnly>` wrapper (e.g., `/users`, `/settings`).

## Managed Role Templates

`role_templates` SQLite table (seeded from `server/data/role-templates-seed.json` on startup) — persists ADLC role presets server-side in addition to the compile-time TS templates. Origin column distinguishes `seed` vs user-created presets. Use this table (not the TS files) for runtime mutation.

## Sharp Edges / Gotchas (read before touching the affected area)

These are the load-bearing constraints discovered during Tier 3 multi-tenant work. Future you will re-introduce them otherwise.

- **`aoc-safety-worker` exclusion lives in two places.** (1) `MASTER_EXCLUDED_SKILLS` in `server/lib/agents/provision.cjs` filters it out when a new master agent is provisioned. (2) `ensureWorkerEnabledForNonMasterAgents` in `server/lib/aoc-safety/installer.cjs` skips the master agent ID when walking existing per-user `openclaw.json`. Both are required — provision-time handles new masters, installer-time handles existing ones. Skip either and masters will end up with the wrong skill set after a re-install.
- **Safety skill changes need gateway restart to reach existing sessions.** New agents created after AOC boot pick up the safety skills automatically. Existing live sessions keep their old skill set until the gateway is restarted. Run `./scripts/gw.sh restart all` after bumping `BUNDLE_VERSION` if you need immediate cluster-wide effect.
- **OpenClaw gateway rejects unknown keys** in `agents.list[]` of `openclaw.json`. Confirmed rejected: `isMaster`, `adlcRole`. **Track all custom flags in SQLite** (`agent_profiles` columns), NEVER in openclaw.json.
- **`<userHome>/skills/` is a symlink** to admin's `~/.openclaw/skills/`. Installing a bundle once at admin's home propagates to every user. Don't try to install per-user.
- **Gateway exec PATH must include skill scripts dirs.** OpenClaw's `exec` tool spawns `zsh -c '<cmd>'` / `bash -c '<cmd>'` — non-interactive non-login shells that **do NOT source `~/.openclaw/.aoc_env`**. Bare commands like `aoc-connect.sh` / `team-status.sh` / `schedules-list.sh` fail with "command not found" unless skill scripts dirs are pre-injected into the gateway's PATH. Per-user gateways: orchestrator's `buildSkillsPathPrefix(userHome)` does this in `childEnv` at spawn. It walks (a) `<userHome>/skills/*/scripts` (admin-symlinked + user-installed), (b) `<adminBase>/skills/*/scripts` (defensive double-glob), AND (c) every agent's workspace via `cfg.agents.list[].workspace` for `<ws>/skills/*/scripts` + `<ws>/.agents/skills/*/scripts` — so agent-authored personal skills (via `aoc-self`) resolve too. Admin's external (systemd-managed) gateway: read `~/.openclaw/.aoc_paths` (static KEY=VALUE format, written at AOC startup alongside `.aoc_env`) via `EnvironmentFile=` in the systemd unit. The `.aoc_env` file uses shell `for` loops and is NOT consumable by systemd directly — that's what `.aoc_paths` is for. New skills (built-in OR agent-authored) require gateway restart to land on PATH.
- **GatewayPool does not auto-connect.** `gatewayPool.forUser(userId)` returns a connection object but you must verify `conn.isConnected` and use `orchestrator.getRunningToken(userId)` + `conn.connect({port,token})` if stale. See `server/routes/master.cjs` for the lazy-connect pattern.
- **macOS `ps -E` doesn't expose env.** Orphan gateway detection uses `lsof -p <pid> -i tcp -P -n -a -sTCP:LISTEN` to map PIDs to listening ports — see `findAocManagedOrphanPids()` in the orchestrator.
- **Composite-PK for cross-tenant agent slugs.** `agent_profiles` is keyed by `(agent_id, provisioned_by)` — two users can independently provision agents with the same slug and they coexist as distinct rows. `agent_connections` carries `owner_id` for the same reason. **Implication for accessors:** `db.getAgentProfile`, `getAgentConnectionIds`, `setAgentConnections`, `deleteAgentProfile`, `markAgentProfileMaster`, `renameAgentProfile` all take `ownerId` — some throw if you forget. `getAgentOwner(agentId)` returns null on ambiguity; pass `ownerHint` (usually `req.user.userId`) to disambiguate.
- **`requireAgentOwnership` establishes owner context.** It wraps the handler in `withOwnerContext(userId, …)` so per-tenant filesystem resolvers (`detail.cjs`, `skills.cjs`, `tools.cjs`, `files.cjs`, `skillScripts.cjs`, `discord-guilds.cjs`, `workspace-browser.cjs`) read THIS user's `~/.openclaw/users/<id>` even when the slug is ambiguous. Implementation: `server/lib/agents/owner-context.cjs` (AsyncLocalStorage). Service tokens (role=agent) skip this — they rely on header/query agentId routing.
- **Default list scope is `'me'` for everyone, admin included.** `/api/agents`, `/api/connections`, `/api/rooms`, `/api/projects` return only the caller's resources unless `?owner=all` or `?owner=<id>` is passed (admin only). A separate cross-tenant admin monitoring UI is planned — don't restore the old `'all'` default; it leaks other users' data.
- **`db.persist()` is debounced (250ms trailing).** `persistNow()` forces a synchronous flush; `flushPendingPersist()` is wired to `beforeExit`/`SIGINT`/`SIGTERM`. Don't call `persist()` inside a tight read-after-write — call `persistNow()` if you need durability before the next read. Routes can ignore the distinction; the debounce is intentional for burst writes (concurrent registration).
- **Schema migrations live in `server/lib/db-migrations/NNNN-*.cjs`.** Append entries to the `MIGRATIONS` array in `index.cjs` — never reorder. Each migration must be idempotent (use `IF NOT EXISTS`, check `PRAGMA` before destructive rebuilds). The runner records applied ids in `schema_migrations` so they only run once. Inline `ALTER TABLE` in `initDatabase()` is the implicit "baseline v0"; new schema changes must go through the framework.
- **WS event types are pinned via `server/lib/ws-events.cjs` + `WsEventType` in `src/types/index.ts`.** `broadcast()` validates the type at runtime via `assertEventType` — typos throw at the call site. Adding a new event = update **both** files in lockstep. `AOC_WS_STRICT=0` to log-instead-of-throw during incremental adoption.
- **Per-agent service tokens (Sprint 2).** New agents get a JWT minted at provision time (claim: `kind='agent-service', agentId, ownerId, role='agent'`) and stored in `<workspace>/.aoc_agent_env` as `AOC_AGENT_TOKEN`. `authMiddleware` accepts these alongside dashboard user JWTs; `userOwnsAgent` enforces `req.user.agentId === requestedAgentId` for these tokens. Effect: a leaked agent token compromises **only that agent**, not the cluster. Legacy `DASHBOARD_TOKEN` retains full bypass for back-compat — migrate skill scripts to `$AOC_AGENT_TOKEN` and plan to remove the env var.
- **Audit log (Sprint 2).** `server/lib/audit-log.cjs` writes to `audit_log` table on sensitive mutations (user delete/role change/password reset, invitation create/revoke/delete, agent delete, master link). Append-only; admin-only read at `GET /api/audit-log`. Action verbs follow `<resource>.<verb>` past-tense convention. Audit failure never blocks the user-facing operation — call site wraps in try/catch with log + continue.
- **`db.cjs` is split** into `server/lib/db/*.cjs` modules. Pattern: `db/_handle.cjs` holds the shared sql.js handle + persist accessors (registered by `initDatabase()`); domain modules `require('./_handle.cjs').getDb()` to read/write. `db.cjs` re-exports them via spread (`...require('./db/<name>.cjs')`) so existing callers keep working. **When adding new DB code: put it in a new `db/<domain>.cjs` rather than growing `db.cjs`.** Existing modules: `budget`, `invitations`, `pipelines`, `gateway-state`, `connections`, `agent-profiles`, `rooms`, `projects`, `tasks`. `db.cjs` is now down to ~1400 lines (init + schema + users + auth + JWT only).
- **`AgentDetailPage.tsx` is being incrementally split** into per-tab/section components under `src/pages/agent-detail/`. Pattern: each component is self-contained and takes only the props it needs (e.g. `{ agentId }`) — owns its own state/fetch/persist logic. The shell page routes between them. Existing extractions: `AgentConnectionsTab`, `PairingRequestsPanel`, `DiscordGuildsSection`. Remaining (Sprint 5 incremental): Telegram/WhatsApp/Discord channel cards + AddChannelForm + ChannelAllowFromSection + ChannelsPanel cluster (~1500 lines), Skills tab (InlineSkillPanel + CreateSkillDialog + AgentSkillFilesPanel + SkillScriptsPanel), Tools tab (CustomToolsPanel + AgentScriptEditor + CodeView), Files tab (InlineFilePanel), Modals (EditConfigModal + DeleteAgentModal + RestartGatewayDialog + SelectField). **Don't add new tab logic to AgentDetailPage.tsx — create or reuse a tab module.** AgentDetailPage.tsx is now ~4900 lines (down from 5815).
- **Connection sharing is an org-wide boolean.** `connections.shared = 1` (migration `0003-connection-shared-flag`) means anyone on this AOC instance may **assign** the connection to their own agents (dispatch reads decrypted creds at runtime). Owner + admin remain the only ones who can edit / delete / test / reauth / toggle the flag itself; raw credentials are never exposed via API. Single decision point: `db.userIdCanUseConnection(uid, connId)` — owner OR admin OR `connections.shared=1`. `setAgentConnections` calls it for every requested id and throws `{status:403, code:'CONNECTION_NOT_ACCESSIBLE'}` on first violation. `requireConnectionOwnership` (mutation routes) deliberately stays owner+admin-only — it does NOT honor `shared`. Cascade: `setConnectionShared(id, false)` deletes `agent_connections WHERE connection_id=? AND owner_id != owner` so flipping share off detaches every non-owner assignment (avoids silent dispatch failures). `GET /api/connections` default scope is `accessible` (owned ∪ shared) for everyone; `?owner=me` is strict-owned, `?owner=all` is admin cross-tenant. `GET /api/connections/:id/usage` returns `[{agentId, ownerId, ownerEmail, assignedAt}]` for any user with use access, so the share dialog can show "5 agents are using this." Migration `0002` had a per-user ACL table (`connection_shares`); `0003` collapses it into the boolean flag and drops the table — never reintroduce per-user sharing without a clear product reason.
- **Login response shape** for `/api/auth/login` and `/api/auth/register-invite` MUST include `hasMaster` and `masterAgentId`, otherwise `<MasterGate>` redirects users to `/onboarding` even if they have a master.
- **Mission room membership is per-user master agent**, NOT literal `'main'`. The `normalizeMissionMembers(ids, masterAgentId?)` helper enforces this. Hardcoding `'main'` will leak admin's agent into other users' rooms. Falls back to `'main'` only when master can't be resolved.
- **`agents.defaults` inheritance from admin must rewrite admin-scoped paths.** `ensureUserHome()` rewrites `agents.defaults.workspace` to `<userHome>/workspace`. Add the same rewrite if you ever introduce another path-shaped default.
- **Master Agent uses the per-user GLOBAL workspace dir** (`<userHome>/workspace`), NOT a sub-folder. This matches admin's `main`. `provision.cjs` enforces via `isMaster ? path.join(home, 'workspace') : path.join(home, 'workspaces', id)`.
- **Master Agent permissions: broad fs + no approval gates, risk-aware via prompting.** `tools.fs.workspaceOnly: false`, `approvals.exec.enabled: false`. Risk-awareness lives in the **prompting layer** (AGENTS.md → Master Agent Orchestration + SOUL.md addendum). Don't re-introduce gateway approval gates thinking it's safer.
- **`agents.defaults.skills` is the source of truth for sub-agent skills.** OpenClaw treats any explicit `skills` array (including `[]`) as a full override — there is no merge with defaults. `provision.cjs` reads `config.agents.defaults.skills` at provision time and writes it verbatim into the new agent's entry. Master gets `MASTER_EXTRA_SKILLS` layered on top (deduped). When you add a new always-on built-in skill, update admin's `agents.defaults.skills` and `ensureUserHome` propagates it.
- **`AGENTS.md` and `TOOLS.md` for the master must include the orchestration playbook + skill table.** SOUL.md gets the persona addendum; AGENTS.md gets routing decisions + risk-aware operating style + memory habits; TOOLS.md gets the AOC skills table with key entry points. All three are auto-generated when `isMaster=true` is passed to `provisionAgent`. Don't strip them.

## Tier 3 Roadmap

Multi-tenant + Master Agent platform. State tracker: `docs/superpowers/plans/TIER3-STATE.md`. Per sub-project plans:

- **Sub-projects 1, 1.5, 2, 4, 4.5: ✅ DONE** (uncommitted, in working tree per user's no-auto-commit rule).
- **Sub-project 3** (Room Collaboration — HQ Room + artifacts/context/aoc-room skill): ✅ **DONE (uncommitted)**. Phase 1 (HQ foundation) + Phase 2 (collaboration layers) complete. Plan: `docs/superpowers/plans/2026-05-05-tier3-subproject3-hq-room.md`.
- **Sub-project 5** (`master-orchestrator` ADLC template): ⏳ Planned. Plan: `docs/superpowers/plans/2026-05-05-tier3-subproject5-master-orchestrator-template.md`.

When picking up Tier 3 work, **read `TIER3-STATE.md` first**, then the relevant sub-project plan. The plans assume zero context and are pre-shaped for the `superpowers:subagent-driven-development` workflow.
