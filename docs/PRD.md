# PRD: Agent Operations Center (AOC)
## Mission Control Dashboard for OpenClaw Agents

| Field | Value |
|---|---|
| **Product** | Agent Operations Center (AOC) |
| **Version** | 2.0 |
| **Author** | Enno (Product Owner) |
| **Date** | 3 April 2026 |
| **Status** | Draft — Awaiting Review |

---

## 1. Executive Summary

### 1.1 Problem Statement

OpenClaw saat ini beroperasi sebagai "black box" — agent bekerja di background tanpa visibility yang memadai. Operator harus:
- SSH ke server untuk cek log agent
- Tidak bisa melihat real-time progress task yang sedang dikerjakan agent
- Tidak punya mekanisme untuk **menghentikan**, **mengarahkan**, atau **mengintervensi** agent yang sedang bekerja
- Tidak bisa mengelola lifecycle agent (create/delete/pause/resume) dari UI
- Tidak punya tracking biaya per agent per project
- Agent provisioning dilakukan manual via config files — tidak ada scaffolding yang proper

### 1.2 Solution

**Agent Operations Center (AOC)** — sebuah web-based mission control dashboard yang memberikan:
1. **Full Visibility** — real-time monitoring semua agent dan task mereka
2. **Full Control** — CRUD operations untuk agent lifecycle management
3. **Proper Provisioning** — scaffolding agent workspace sesuai kaidah OpenClaw (SKILL.md, identity, credentials directory)
4. **Gateway Routing** — connect agent ke channel Telegram setelah provisioning, dengan dual-mode routing (direct + pipeline)
5. **Human-in-the-Loop** — approval gates, steering message, dan intervention controls
6. **Cost Intelligence** — budget tracking dan usage analytics per agent

### 1.3 Vision Statement

> *"Satu dashboard untuk memantau, mengelola, dan mengarahkan seluruh agent yang bekerja secara autonomous — the mission control for your AI workforce."*

### 1.4 Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Time to see agent status | < 3 seconds | Page load → agent status visible |
| Time to intervene (steer/stop) | < 10 seconds | Alert → action sent to agent |
| Agent provisioning time | < 60 seconds | Click "Deploy" → agent active with proper workspace |
| Monthly cost visibility | 100% | Semua token usage tracked |
| Approval response time | < 1 hour | Notification → approve/reject |

---

## 2. Business Context

### 2.1 Strategic Alignment

AOC adalah komponen sentral dari **AI-Driven Development Lifecycle (AI-DLC)** — framework pengembangan software yang memanfaatkan multi-agent AI orchestration. AOC menghubungkan:

- **OpenClaw Gateway** (agent runtime) — sumber data real-time
- **Telegram Channels** (user interface) — primary interaction layer
- **Web Dashboard** (operations center) — monitoring & management
- **Outline** (knowledge base) — documentation hub
- **Linear** (project management) — task tracking

### 2.2 Current State vs Target State

| Dimension | Current (v1.0) | Target (v2.0) |
|---|---|---|
| **Agent Lifecycle** | Manual config, no scaffolding | UI-based provisioning with OpenClaw-compliant workspace |
| **Monitoring** | Read-only, vanilla HTML dashboard | Full operations + monitoring, React-based SPA |
| **Agent Management** | Manual config files | UI-based CRUD with proper workspace scaffolding |
| **Gateway Routing** | Pre-configured in config | UI-based connect/disconnect per channel |
| **Intervention** | None (autonomous only) | Steer, pause, reassign, approve |
| **Routing Mode** | Single mode (orchestrator) | Dual mode (direct + pipeline) |
| **Cost Tracking** | Basic totals | Per-agent, per-project breakdown |
| **Channels** | Single Telegram bot | Per-agent Telegram channel binding |
| **Tech Stack** | Express + vanilla HTML/CSS/JS | Vite + React + Node.js + Zustand |

### 2.3 Navigation — Consistent with Existing AOC Dashboard

Menu structure extends the existing `aoc-dashboard` navigation naturally:

| Menu | Route | Existing? | Description |
|---|---|---|---|
| **Overview** | `/` | ✅ Existing | Dashboard overview with stats and activity feed |
| **Task Board** | `/board` | ✅ Existing | Kanban view of tasks |
| **Sessions** | `/sessions` | ✅ Existing | All gateway + code-agent sessions |
| **Agents** | `/agents` | ✅ Existing (expand) | Agent grid — **now with CRUD, deploy, pause, terminate** |
| **Cron** | `/cron` | ✅ Existing | Scheduled automations |
| **Routing** | `/routing` | 🆕 New | Gateway channel bindings (agent ↔ Telegram) |
| **Analytics** | `/analytics` | 🆕 New (Phase 2) | Cost intelligence and usage trends |
| **Settings** | `/settings` | 🆕 New | Gateway config, alert rules, export |

### 2.4 Constraints

| Constraint | Detail |
|---|---|
| **Tech Stack** | NEW: Vite + React 19 + TypeScript + Zustand + Node.js backend |
| **Data Source** | OpenClaw filesystem (`~/.openclaw/agents/`, `openclaw.json`) |
| **Agent Provisioning** | Must scaffold proper OpenClaw workspace (SKILL.md, identity files, credentials dir) |
| **Auth** | Single-user bearer token (expandable later) |
| **Deploy** | Must run on DKE Portal (`5.223.44.2:2222`) alongside OpenClaw |
| **Performance** | Must work over slow network (server in remote datacenter) |
| **Browser** | Chrome 120+, Firefox 120+, Safari 17+ |
| **Design System** | Must use "Obsidian Claw / Ethereal Observer" design system |

---

## 3. User Personas

### 3.1 Primary: AI Network Operator (Enno)

| Attribute | Detail |
|---|---|
| **Role** | Solo developer managing a network of 12+ AI agents |
| **Goal** | Maximize productivity of AI agents while maintaining quality control |
| **Primary Channel** | Telegram (mobile) for quick commands, Web dashboard for deep monitoring |
| **Pain Points** | Can't see what agents are doing, can't stop runaway agents, no cost visibility, manual agent setup is tedious |
| **Tech Level** | Advanced — comfortable with CLI, SSH, config files |

---

## 4. User Stories & Requirements

### 4.1 Epic 1: Agent Monitoring (Read)

> *"As an operator, I need to see the real-time status of all agents at a glance."*

| ID | Story | Priority | Acceptance Criteria |
|---|---|---|---|
| **US-101** | I want to see an Overview dashboard with all agents showing their current status | P0 | Dashboard loads < 3s, shows all registered agents with status indicators |
| **US-102** | I want to see what task each agent is currently executing | P0 | Each agent card shows current task name, progress %, duration |
| **US-103** | I want to see real-time activity feed of all agent actions | P0 | WebSocket-based live feed showing tool calls, file ops, messages |
| **US-104** | I want to see aggregate stats (active agents, total sessions, total cost) | P0 | Stats bar shows key metrics |
| **US-105** | I want to see detailed session history for each agent | P1 | Click agent → see all sessions/messages/tools/cost |
| **US-106** | I want to see which Telegram channels each agent is routed through | P1 | Agent card/profile shows Telegram bot info + channel binding |

### 4.2 Epic 2: Agent Lifecycle Management — OpenClaw-Compliant Provisioning

> *"As an operator, I want to provision, configure, and decommission agents with proper OpenClaw workspace scaffolding."*

| ID | Story | Priority | Acceptance Criteria |
|---|---|---|---|
| **US-201** | I want to deploy a new agent with proper OpenClaw workspace scaffolding | P0 | Form → creates agent directory + SKILL.md + identity files + registers in `openclaw.json` |
| **US-202** | I want to edit an agent's configuration (model, instructions, workspace) | P1 | Edit form → updates `openclaw.json` entry + regenerates SKILL.md if changed |
| **US-203** | I want to decommission an agent (remove from registry, preserve data) | P1 | Confirm dialog → agent removed from registry, session logs archived |
| **US-204** | I want to pause and resume an agent session | P0 | Pause → agent stops accepting tasks; Resume → reactivated |
| **US-205** | I want to see the generated SKILL.md and workspace files before deploying | P1 | Preview step in Deploy modal showing generated files |
| **US-206** | I want to duplicate an existing agent as a template | P2 | Clone button → pre-filled Deploy form with source agent's config |

**OpenClaw Workspace Scaffolding (US-201 detail):**

When deploying a new agent, AOC must create:

```
~/.openclaw/agents/{agent-id}/
├── SKILL.md            # Role-specific instructions (generated from form input)
├── IDENTITY.md         # Agent name, emoji, personality brief
├── sessions/           # Session storage directory
│   └── sessions.json   # Empty session registry
└── credentials/        # Channel-specific tokens (populated during routing)

# Additionally register in ~/.openclaw/openclaw.json → agents.list[]
```

### 4.3 Epic 3: Gateway Channel Routing (Post-Deploy)

> *"As an operator, after deploying an agent, I want to connect it to specific Telegram channels via the Gateway."*

| ID | Story | Priority | Acceptance Criteria |
|---|---|---|---|
| **US-301** | After deploying an agent, I want to connect it to a Telegram bot/channel | P0 | "Connect Channel" action → configure bot token + channel → gateway binding created |
| **US-302** | I want to disconnect an agent from a Telegram channel | P1 | "Disconnect" → gateway binding removed, agent still exists |
| **US-303** | I want to see all active gateway routes (which agent handles which channel) | P0 | Routing table view showing agent ↔ channel mappings |
| **US-304** | I want to switch which agent handles a specific Telegram channel | P1 | Re-route dropdown → update gateway binding |
| **US-305** | I want to configure routing mode per channel (direct vs pipeline) | P2 | Toggle per route: Direct (goes to agent), Pipeline (goes to orchestrator) |

**Gateway Routing Flow:**
```
Deploy Agent   →   Agent Node Created   →   Connect Channel
(no routing)       (idle, standalone)        (bind to Telegram bot)
                                              │
                                              ├── Direct Mode: channel → agent directly
                                              └── Pipeline Mode: channel → orchestrator → agent
```

### 4.4 Epic 4: Human-in-the-Loop Intervention

> *"As an operator, I want to intervene when an agent needs guidance or is unresponsive."*

| ID | Story | Priority | Acceptance Criteria |
|---|---|---|---|
| **US-401** | I want to send a steering message to an active agent mid-task | P0 | Text input → message sent to agent's active session |
| **US-402** | I want to approve/reject agent outputs at gate checkpoints | P1 | Approval card with [Approve] [Reject] [Request Changes] |
| **US-403** | I want to receive alerts when agents go silent > 20 min | P1 | Alert system with configurable stuck detection thresholds |
| **US-404** | I want to forcefully terminate a runaway agent | P0 | Terminate button → sends kill signal to agent session |
| **US-405** | I want to reassign a task from one agent to another | P2 | Reassign UI → task context transferred to target agent |

### 4.5 Epic 5: Pipeline Orchestration

> *"As an operator, I want to run multi-phase development pipelines with automatic agent assignment and approval gates."*

| ID | Story | Priority | Acceptance Criteria |
|---|---|---|---|
| **US-501** | I want to visualize active pipelines with phase progression | P1 | Pipeline view showing phases, assigned agents, gate statuses |
| **US-502** | I want to create a pipeline from a template (e.g., Feature Development) | P2 | Template selector → auto-creates phases with gate rules |
| **US-503** | I want to see cross-agent handoff queue | P2 | Queue view showing pending handoffs between agents |
| **US-504** | I want manual approval gates between pipeline phases | P1 | Gate blocks pipeline until explicitly approved |

### 4.6 Epic 6: Cost & Analytics

> *"As an operator, I want to understand AI spending and optimize resource allocation."*

| ID | Story | Priority | Acceptance Criteria |
|---|---|---|---|
| **US-601** | I want to see token usage and cost per agent | P0 | Agent profile shows cumulative cost, token breakdown |
| **US-602** | I want to see cost trends over time (daily/weekly/monthly) | P1 | Chart showing cost over time with agent breakdown |
| **US-603** | I want to set budget limits per agent | P2 | Budget field per agent, alert on threshold exceed |
| **US-604** | I want to export data for cost analysis | P2 | CSV/JSON export |

### 4.7 Epic 7: Agent Identity & Profile (The Sims Vibe)

> *"As an operator, I want to see my agents as 'characters' with personality, skills, and progression."*

| ID | Story | Priority | Acceptance Criteria |
|---|---|---|---|
| **US-701** | I want to see agent profile cards with avatar, level, and mood | P2 | Profile card with visual identity elements |
| **US-702** | I want to see skill progression per agent (from task history) | P3 | Skill bars derived from completed task categories |
| **US-703** | I want to see XP and level from successful completions | P3 | XP formula: completed tasks × complexity weight |

---

## 5. Feature Priority Matrix

| Priority | Features | Phase |
|---|---|---|
| **P0** | Agent monitoring, Agent CRUD (deploy/edit/pause/terminate), Steering, Cost per agent, Stats, Live activity feed, Gateway channel connect | Phase 1 |
| **P1** | Session detail, Approval gates, Stuck alerts, Pipeline visualization, Cost trends, Routing table, Gateway disconnect | Phase 2 |
| **P2** | Pipeline templates, Reassign tasks, Budget limits, Agent clone, Export, Routing mode switch, Agent identity cards | Phase 3 |
| **P3** | Skill progression XP, Agent learning, Multi-project context | Future |

---

## 6. Information Architecture

### 6.1 Navigation Structure

Extends the existing `aoc-dashboard` nav: **Overview | Task Board | Sessions | Agents | Cron** — with new pages layered in naturally.

```
AOC Dashboard
├── Overview (/)                              ← EXISTING (enhanced)
│   ├── Stats Bar (active agents, sessions, cost)
│   ├── Agent Status Grid (mini cards with live status)
│   ├── Activity Feed (last 10 events)
│   └── Active Pipelines Widget (Phase 2)
│
├── Task Board (/board)                       ← EXISTING
│   ├── Kanban Columns (Queued → Running → Completed → Failed)
│   ├── Task Cards (agent, duration, cost, progress)
│   └── Task Detail Modal
│
├── Sessions (/sessions)                      ← EXISTING
│   ├── Filter (by type: telegram, cron, hook, opencode)
│   ├── Session List (all gateway + code-agent sessions)
│   └── Session Detail Modal
│
├── Agents (/agents)                          ← EXISTING (major expansion)
│   ├── Agent Grid/List (all agents with status, actions)
│   ├── [+ Deploy Agent] → Deploy Modal
│   │   └── Step 1: Configure → Step 2: Preview workspace → Step 3: Deploy
│   ├── Agent Actions (edit, pause, resume, terminate)
│   ├── [→ Connect Channel] → Channel Modal (post-deploy)
│   └── Agent Detail (/agents/:id)
│       ├── Profile Card (identity, model, layer, The Sims vibe)
│       ├── Current Task (progress, files, phase)
│       ├── Activity Log (recent actions)
│       ├── Session History (all sessions for this agent)
│       ├── Gateway Routes (connected channels)
│       ├── Steer Agent (send guidance message)
│       └── Operations Menu (pause, restart, edit, terminate)
│
├── Cron (/cron)                              ← EXISTING
│   ├── Scheduled Jobs
│   └── Job History
│
├── Routing (/routing)                        ← NEW
│   ├── Route Table (agent ↔ channel mappings)
│   ├── [+ New Route] → Connect Channel Modal
│   └── Route Mode Toggle (Direct vs Pipeline)
│
├── Pipelines (/pipelines)                    ← NEW (Phase 2)
│   ├── Active Pipelines (phase visualization)
│   ├── Pipeline History
│   └── Approval Queue
│
├── Analytics (/analytics)                    ← NEW (Phase 2)
│   ├── Cost Dashboard (per agent, per time)
│   ├── Usage Trends
│   └── Performance Metrics
│
└── Settings (/settings)                      ← NEW
    ├── Gateway Configuration
    ├── Alert Rules
    └── Export / Import
```

### 6.2 Core Data Model

```
Agent
├── id: string (e.g., "orchestrator", "pm", "dev-odoo")
├── name: string (display name)
├── label: string (e.g., "agent:dev-odoo")
├── layer: enum (CPO, CTO, Ops)
├── model: string (e.g., "anthropic/claude-sonnet-4")
├── role: string (description)
├── instructions: text (SKILL.md content)
├── identity: { emoji, personality }
├── workspace: string (file path to agent dir)
├── status: enum (active, idle, paused, error, terminated)
├── stats: { totalSessions, totalCost, totalTasks, avgDuration, successRate }
├── createdAt: timestamp
└── sessions: Session[]

GatewayRoute
├── id: string
├── agentId: string (foreign key → Agent)
├── channelType: enum (telegram, slack, discord, webhook)
├── channelConfig: { botToken, channelId, botUsername }
├── routeMode: enum (direct, pipeline)
├── status: enum (connected, disconnected)
├── connectedAt: timestamp
└── lastActivity: timestamp

Session
├── id: string (session UUID)
├── agentId: string
├── name: string
├── type: enum (telegram, cron, hook, opencode, direct)
├── status: enum (active, idle, completed, failed, killed)
├── messageCount: number
├── toolCalls: number
├── cost: number (USD)
├── lastMessage: string
├── updatedAt: timestamp
└── events: Event[]

Pipeline [Phase 2]
├── id: string
├── name: string
├── currentPhase: number
├── phases: Phase[]
├── totalCost: number
└── status: enum (active, paused, completed, failed)

Alert
├── id: string
├── rule: enum (stuck, completion, failure, budget, approvalTimeout, qualityGate)
├── level: enum (critical, warning, info)
├── agentId: string
├── message: string
├── acknowledged: boolean
└── timestamp: timestamp
```

---

## 7. Non-Functional Requirements

| Requirement | Specification |
|---|---|
| **Performance** | Dashboard loads < 3s on 10Mbps, Lighthouse score > 85 |
| **Real-time** | Agent status updates within 2s via WebSocket |
| **Responsive** | 360px (mobile) → 2560px (desktop) |
| **Accessibility** | WCAG 2.1 AA for all interactive elements |
| **Security** | Bearer token auth, CSRF protection, rate limiting, Helmet |
| **Data Retention** | Session logs 90 days, stats aggregated indefinitely |
| **Browser Support** | Chrome 120+, Firefox 120+, Safari 17+ |
| **Offline** | Show cached state on disconnect, auto-reconnect |

---

## 8. Tech Stack (New Project)

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend Framework** | React 19 + TypeScript | Modern component model, ecosystem |
| **Build Tool** | Vite 6 | Fast HMR, modern bundling |
| **State Management** | Zustand 5 | Minimal, performant, no boilerplate |
| **Styling** | CSS Modules + CSS Custom Properties | Design system tokens, scoped styles |
| **Routing** | React Router 7 | Established, full-featured |
| **Real-time** | WebSocket (native) | Direct, no library overhead |
| **Backend** | Node.js + Express 5 | Proven, lightweight |
| **Data Source** | OpenClaw filesystem | Primary source of truth |
| **AOC State** | JSON files in `.data/` | AOC-specific state (routes, alerts, overrides) |
| **Design System** | "Obsidian Claw / Ethereal Observer" | Existing, documented, proven |
| **Icons** | Material Symbols Outlined | Consistent with existing design |
| **Fonts** | Manrope + Inter + JetBrains Mono | Existing typography system |

---

## 9. Phased Roadmap

### Phase 1: Core Operations (Week 1-3)
- 🔲 New project scaffold (Vite + React + Node.js)
- 🔲 Design system implementation (Obsidian Claw tokens in CSS)
- 🔲 Overview page (enhanced with agent stats)
- 🔲 Agents page — CRUD with OpenClaw-compliant workspace scaffolding
- 🔲 Agent detail page
- 🔲 Gateway channel routing UI (connect/disconnect post-deploy)
- 🔲 Agent steering (send guidance)
- 🔲 Terminate agent functionality
- 🔲 Enhanced cost tracking per agent
- 🔲 Stuck alert detection

### Phase 2: Intelligence Layer (Week 4-6)
- 🔲 Pipeline visualization
- 🔲 Approval gates
- 🔲 Cost analytics dashboard
- 🔲 Routing page
- 🔲 Session detail improvements

### Phase 3: Character Layer (Week 7-9)
- 🔲 Agent identity cards (The Sims vibe)
- 🔲 Pipeline templates
- 🔲 Budget limits & alerts
- 🔲 Data export
- 🔲 Agent cloning

---

## 10. Open Questions

| # | Question | Impact | Status |
|---|---|---|---|
| 1 | Agent deploy → langsung modify `openclaw.json` + scaffold dirs, atau via Gateway API? | Architecture | Open |
| 2 | Pause agent = block new messages (soft) atau terminate session (hard)? | UX + Backend | Open |
| 3 | Pipeline state → JSON files atau SQLite? | Persistence | Open |
| 4 | Gateway channel routing → modify `openclaw.json` channels section atau use Gateway API? | Integration | Open |
| 5 | Project folder name → `aoc` atau nama lain? | Structure | Open |

---

## 11. Appendix

### A. Reference Documents
- [AOC V1 — Mission Control Dashboard (Outline)](https://docs.iziapp.id/doc/agent-operations-center-aoc-mission-control-dashboard-B5MQROchXN)
- [AOC V2 — Main-Agent Persistent Orchestration (Outline)](https://docs.iziapp.id/doc/aoc-architecture-v2-main-agent-persistent-orchestration-LQUXmgQF0l)
- [Design System: The Ethereal Observer / Obsidian Claw](../mockup/obsidian_claw/DESIGN.md)

### B. OpenClaw Agent Workspace Specification

```
~/.openclaw/
├── openclaw.json                    # Master config (agents, models, channels, gateway)
├── workspace/                       # Shared workspace files
│   ├── AGENTS.md                   # Rules/guidelines for all agents
│   ├── SOUL.md                     # Agent personality
│   ├── IDENTITY.md                 # Quick profile (name, emoji)
│   ├── USER.md                     # Owner info (name, skills, timezone)
│   ├── TOOLS.md                    # Environment tools config
│   ├── HEARTBEAT.md                # Periodic tasks
│   └── memory/                     # Daily notes, summaries
├── agents/
│   ├── {agent-id}/
│   │   ├── SKILL.md               # Role-specific instructions
│   │   ├── IDENTITY.md            # Agent-specific identity
│   │   ├── sessions/
│   │   │   ├── sessions.json      # Session registry
│   │   │   └── {session-id}.jsonl # Session conversation logs
│   │   └── credentials/           # Channel tokens
│   └── ...
├── canvas/                         # A2UI visual workspace
├── credentials/                    # Global channel tokens
├── memory/                         # Shared memory
└── plugins/                        # Skill plugins
```
