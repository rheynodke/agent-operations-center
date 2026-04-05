# FSD: Agent Operations Center (AOC)
## Functional Specification Document

| Field | Value |
|---|---|
| **Product** | Agent Operations Center (AOC) |
| **Version** | 2.0 |
| **Author** | Enno (Architect) |
| **Date** | 3 April 2026 |
| **Status** | Draft — Awaiting Review |
| **PRD Reference** | [PRD.md](./PRD.md) |

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       AOC Web Dashboard (Vite + React)                   │
│                                                                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ │
│  │ Overview  │ │  Agents   │ │Task Board │ │ Sessions  │ │  Routing  │ │
│  │           │ │           │ │           │ │           │ │  (GW)     │ │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ │
│        │              │              │              │              │      │
│  ┌─────┴──────────────┴──────────────┴──────────────┴──────────────┴───┐  │
│  │                 Zustand Store (Client State)                        │  │
│  │  agents[] | sessions[] | routes[] | alerts[] | stats{} | telemetry │  │
│  └─────┬──────────────┬──────────────┬─────────────────────────────────┘  │
│        │              │              │                                    │
│  ┌─────┴──────────────┴──────────────┴───┐                               │
│  │       API Client (fetch + WebSocket)   │                               │
│  └───────────────────┬───────────────────┘                               │
└──────────────────────┼───────────────────────────────────────────────────┘
                       │
                 HTTP REST + WS
                       │
┌──────────────────────┼───────────────────────────────────────────────────┐
│                AOC Backend (Node.js + Express)                           │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  REST API    │  │  WebSocket   │  │  File        │  │  Alert      │ │
│  │  Routes      │  │  Hub         │  │  Watchers    │  │  Engine     │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                  │                  │                  │       │
│  ┌──────┴──────────────────┴──────────────────┴──────────────────┴────┐  │
│  │                      Service Layer                                 │  │
│  │  AgentService │ RoutingService │ SessionService │ AlertService     │  │
│  └──────┬──────────────────┬──────────────────┬──────────────────┴────┘  │
│         │                  │                  │                          │
│  ┌──────┴──────────────────┴──────────────────┴──────────────────────┐   │
│  │                      Data Access Layer                            │   │
│  │  Parsers (existing) │ ConfigManager │ WorkspaceScaffolder        │   │
│  └──────┬──────────────────┬──────────────────┬──────────────────────┘   │
└─────────┼──────────────────┼──────────────────┼─────────────────────────┘
          │                  │                  │
    ┌─────┴─────┐    ┌──────┴──────┐    ┌──────┴──────┐
    │ OpenClaw  │    │  File       │    │  AOC State  │
    │ Filesystem│    │  System     │    │  (JSON)     │
    │ ~/.openclaw│    │  Watcher   │    │  .data/     │
    └───────────┘    └─────────────┘    └─────────────┘
```

### 1.2 Tech Stack

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| **Frontend** | React + TypeScript | 19.x | Component model, hooks, concurrent features |
| **Build** | Vite | 6.x | Instant HMR, ES modules, fast builds |
| **State** | Zustand | 5.x | Minimal footprint, no providers needed |
| **Routing** | React Router | 7.x | File-based or config routing |
| **Styling** | CSS Modules + CSS Custom Properties | - | Scoped styles with design system tokens |
| **Backend** | Express.js | 5.x | Proven, existing patterns |
| **Real-time** | ws (WebSocket) | - | Existing, battle-tested |
| **Data** | OpenClaw filesystem | - | Primary source of truth |
| **Test** | Vitest + Testing Library | - | Vite-native, fast |
| **Icons** | Material Symbols Outlined | - | Consistent with design system |
| **Fonts** | Manrope + Inter + JetBrains Mono | - | Existing typography |

### 1.3 Project Structure

```
agent-operations-center/
├── aoc-dashboard/              # Legacy dashboard (reference only)
│
├── aoc/                        # [NEW PROJECT]
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html              # Vite entry
│   │
│   ├── server/                 # Backend (Node.js)
│   │   ├── index.ts            # Express server entry
│   │   ├── routes/
│   │   │   ├── agents.ts       # Agent CRUD endpoints
│   │   │   ├── routing.ts      # Gateway routing endpoints
│   │   │   ├── sessions.ts     # Session/signal endpoints
│   │   │   ├── alerts.ts       # Alert endpoints
│   │   │   ├── dashboard.ts    # Aggregate stats
│   │   │   └── analytics.ts    # Cost analytics (Phase 2)
│   │   ├── services/
│   │   │   ├── agent.service.ts
│   │   │   ├── routing.service.ts
│   │   │   ├── session.service.ts
│   │   │   ├── alert.service.ts
│   │   │   ├── workspace-scaffolder.ts   # OpenClaw workspace creation
│   │   │   └── config-manager.ts         # Atomic openclaw.json read/write
│   │   ├── lib/
│   │   │   ├── parsers.ts      # Port from existing parsers.js
│   │   │   └── watchers.ts     # Port from existing watchers.js
│   │   ├── ws/
│   │   │   └── hub.ts          # WebSocket event hub
│   │   └── middleware/
│   │       ├── auth.ts
│   │       └── security.ts
│   │
│   ├── src/                    # Frontend (React)
│   │   ├── main.tsx            # React entry
│   │   ├── App.tsx             # Router shell
│   │   │
│   │   ├── assets/
│   │   │   └── design-system.css    # Obsidian Claw tokens + base styles
│   │   │
│   │   ├── stores/
│   │   │   ├── agent.store.ts       # Zustand: agents + CRUD
│   │   │   ├── session.store.ts     # Zustand: sessions
│   │   │   ├── routing.store.ts     # Zustand: gateway routes
│   │   │   ├── alert.store.ts       # Zustand: alerts
│   │   │   ├── dashboard.store.ts   # Zustand: stats/overview
│   │   │   └── ws.store.ts          # Zustand: WebSocket connection
│   │   │
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts      # WS connection + auto-reconnect
│   │   │   ├── useAgent.ts          # Agent CRUD operations
│   │   │   └── useAlert.ts          # Alert management
│   │   │
│   │   ├── pages/
│   │   │   ├── Overview.tsx          # Dashboard overview
│   │   │   ├── Agents.tsx            # Agent grid (list + CRUD)
│   │   │   ├── AgentDetail.tsx       # Agent detail profile
│   │   │   ├── TaskBoard.tsx         # Task board (Kanban)
│   │   │   ├── Sessions.tsx          # Session list
│   │   │   ├── Cron.tsx              # Cron jobs
│   │   │   ├── Routing.tsx           # Gateway routes table
│   │   │   ├── Pipelines.tsx         # Pipeline view (Phase 2)
│   │   │   ├── Analytics.tsx         # Cost analytics (Phase 2)
│   │   │   └── Settings.tsx
│   │   │
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── TopBar.tsx
│   │   │   │   └── Shell.tsx
│   │   │   ├── agent/
│   │   │   │   ├── AgentCard.tsx          # Agent card in grid
│   │   │   │   ├── AgentProfile.tsx       # Agent detail panel (Sims-style)
│   │   │   │   ├── DeployModal.tsx        # Create new agent
│   │   │   │   ├── EditModal.tsx
│   │   │   │   ├── WorkspacePreview.tsx   # Preview generated files
│   │   │   │   └── SteerPanel.tsx         # Steering message input
│   │   │   ├── routing/
│   │   │   │   ├── RouteTable.tsx        # Channel ↔ Agent mapping
│   │   │   │   ├── ConnectModal.tsx      # Connect to channel
│   │   │   │   └── RouteBadge.tsx
│   │   │   ├── shared/
│   │   │   │   ├── StatusChip.tsx
│   │   │   │   ├── StatCard.tsx
│   │   │   │   ├── ConfirmModal.tsx
│   │   │   │   ├── Toast.tsx
│   │   │   │   ├── LoadingSpinner.tsx
│   │   │   │   └── EmptyState.tsx
│   │   │   └── activity/
│   │   │       ├── ActivityFeed.tsx       # Live activity feed
│   │   │       └── EventCard.tsx
│   │   │
│   │   └── lib/
│   │       ├── api.ts               # HTTP client
│   │       ├── ws.ts                # WebSocket client
│   │       ├── types.ts             # TypeScript interfaces
│   │       └── constants.ts         # Enums, labels, colors
│   │
│   ├── .data/                  # AOC runtime state (gitignored)
│   │   ├── routes.json         # Gateway route bindings
│   │   ├── alerts.json         # Alert history
│   │   ├── agent-overrides.json
│   │   └── backups/            # Config backups before mutations
│   │
│   └── docs/                   # Shared with legacy
│       ├── PRD.md
│       └── FSD.md
```

---

## 2. API Specification

### 2.1 Existing Endpoints (Port from Legacy)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard` | Aggregate stats |
| `GET` | `/api/sessions` | All sessions/signals |
| `GET` | `/api/sessions/:id` | Signal detail with events |
| `GET` | `/api/agents` | Agent registry |
| `GET` | `/api/progress` | Dev progress files |

### 2.2 Agent Lifecycle Endpoints

#### `POST /api/agents` — Deploy New Agent

Creates agent entry in `openclaw.json` AND scaffolds OpenClaw-compliant workspace directory.

```
Request:
{
  "id": "dev-mobile",                      // unique slug
  "name": "Dev Mobile Agent",              // display name
  "layer": "CTO",                          // CPO | CTO | Ops
  "model": "anthropic/claude-sonnet-4",    // provider/model
  "role": "Mobile app development specialist using React Native",
  "identity": {
    "emoji": "📱",                         // agent avatar emoji
    "personality": "Focused mobile developer with deep RN expertise"
  },
  "skillTemplate": "code-dev",            // predefined template | "custom"
  "customInstructions": "...",            // only if skillTemplate = "custom"
  "workspace": "/root/.openclaw/workspace" // shared workspace path
}

Response: 201
{
  "success": true,
  "agent": { ...full agent object },
  "scaffolded": {
    "directory": "~/.openclaw/agents/dev-mobile/",
    "files": [
      "SKILL.md",
      "IDENTITY.md",
      "sessions/sessions.json"
    ]
  }
}
```

**Backend logic — WorkspaceScaffolder:**
1. Validate input (id uniqueness, required fields)
2. Scaffold directory: `~/.openclaw/agents/{id}/`
3. Generate `SKILL.md` from template + role + customInstructions
4. Generate `IDENTITY.md` from name + emoji + personality
5. Create `sessions/sessions.json` (empty `{}`)
6. Create `credentials/` directory
7. Register agent in `openclaw.json` → `agents.list[]`
8. Emit WebSocket `agent:deployed`

**SKILL.md Generation Templates:**

| Template | Content Focus |
|---|---|
| `code-dev` | Code generation, file management, testing, Git |
| `research` | Web browsing, document analysis, summarization |
| `devops` | Infrastructure, Docker, CI/CD, monitoring |
| `design` | UI/UX patterns, design systems, prototyping |
| `pm` | Task management, documentation, stakeholder communication |
| `custom` | User-provided instructions only |

#### `PUT /api/agents/:id` — Edit Agent Configuration

```
Request:
{
  "name": "Dev Mobile Agent v2",           // optional
  "model": "anthropic/claude-opus-4",      // optional
  "role": "Updated role description",      // optional
  "identity": { "emoji": "📲" },           // optional (merge)
  "customInstructions": "..."              // optional → regenerates SKILL.md
}

Response: 200
{
  "success": true,
  "agent": { ...updated },
  "filesUpdated": ["SKILL.md"]            // if instructions changed
}
```

#### `DELETE /api/agents/:id` — Decommission Agent

```
Request body:
{
  "preserveData": true         // default true — keep session logs
}

Response: 200
{
  "success": true,
  "message": "Agent dev-mobile decommissioned",
  "archived": "~/.openclaw/agents/dev-mobile/.archived"
}
```

**Logic:**
1. Remove from `openclaw.json` → `agents.list[]`
2. Disconnect all gateway routes for this agent
3. If preserveData: rename dir to `{id}/.archived` timestamp
4. If !preserveData: delete agent directory
5. Emit `agent:decommissioned`

#### `POST /api/agents/:id/pause` — Pause Agent

```
Response: 200 { "success": true, "status": "paused" }
```

#### `POST /api/agents/:id/resume` — Resume Agent

```
Response: 200 { "success": true, "status": "active" }
```

#### `POST /api/agents/:id/terminate` — Force Terminate

```
Response: 200 { "success": true, "terminated": true }
```

#### `POST /api/agents/:id/steer` — Send Steering Message

```
Request:
{
  "sessionId": "abc-123",    // optional (auto-detect active session)
  "message": "Focus on the balance calculation logic first"
}

Response: 200
{
  "success": true,
  "delivered": true,
  "sessionId": "abc-123",
  "agentId": "dev-odoo"
}
```

#### `GET /api/agents/:id/workspace` — Preview Agent Workspace

```
Response: 200
{
  "directory": "~/.openclaw/agents/dev-odoo/",
  "files": {
    "SKILL.md": "# Dev Odoo Agent\n\n## Role\n...",
    "IDENTITY.md": "# Identity\n- Name: Dev Odoo Agent\n- Emoji: 🐍\n..."
  },
  "sessions": { "total": 45, "active": 2 },
  "diskUsage": "12.4 MB"
}
```

### 2.3 Gateway Routing Endpoints

#### `GET /api/routes` — List All Routes

```
Response: 200
{
  "routes": [
    {
      "id": "route-001",
      "agentId": "dev-odoo",
      "agentName": "Dev Odoo Agent",
      "channelType": "telegram",
      "channelConfig": {
        "botUsername": "@aoc_dev_odoo_bot",
        "channelId": "577142951"
      },
      "routeMode": "direct",
      "status": "connected",
      "connectedAt": "2026-04-01T10:00:00Z",
      "lastActivity": "2026-04-03T00:30:00Z"
    }
  ]
}
```

#### `POST /api/routes` — Connect Agent to Channel

**This is a POST-DEPLOY action** — agent must already exist.

```
Request:
{
  "agentId": "dev-odoo",
  "channelType": "telegram",
  "channelConfig": {
    "botToken": "123456:ABC-DEF...",
    "channelId": "577142951"
  },
  "routeMode": "direct"              // "direct" | "pipeline"
}

Response: 201
{
  "success": true,
  "route": { ...full route object },
  "gatewayUpdated": true
}
```

**Backend logic — RoutingService:**
1. Validate agentId exists
2. Validate no duplicate route for same channel
3. Update `openclaw.json` → `channels` section with binding
4. Store route metadata in `.data/routes.json`
5. Emit `route:connected`

#### `DELETE /api/routes/:id` — Disconnect Route

```
Response: 200
{
  "success": true,
  "agentId": "dev-odoo",
  "channel": "telegram:577142951",
  "status": "disconnected"
}
```

#### `PUT /api/routes/:id` — Update Route (change mode or agent)

```
Request:
{
  "routeMode": "pipeline",    // switch from direct to pipeline
  "agentId": "orchestrator"   // re-route to different agent
}

Response: 200
{ "success": true, "route": { ...updated } }
```

### 2.4 Alert Endpoints

#### `GET /api/alerts` — Active Alerts

```
Response: 200
{
  "alerts": [
    {
      "id": "alert-001",
      "rule": "stuck",
      "level": "warning",
      "agentId": "dev-odoo",
      "agentName": "Dev Odoo Agent",
      "message": "No activity detected for 25 minutes",
      "acknowledged": false,
      "timestamp": 1712108400000
    }
  ]
}
```

#### `POST /api/alerts/:id/acknowledge`

```
Response: 200 { "success": true }
```

---

## 3. Frontend Specification

### 3.1 Zustand Store Architecture

```typescript
// stores/agent.store.ts
interface AgentStore {
  // State
  agents: Agent[];
  selectedAgent: Agent | null;
  isLoading: boolean;
  filter: AgentStatus | 'all';

  // Actions
  fetchAgents: () => Promise<void>;
  deployAgent: (data: DeployAgentRequest) => Promise<Agent>;
  updateAgent: (id: string, data: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string, preserveData?: boolean) => Promise<void>;
  pauseAgent: (id: string) => Promise<void>;
  resumeAgent: (id: string) => Promise<void>;
  terminateAgent: (id: string) => Promise<void>;
  steerAgent: (id: string, message: string) => Promise<void>;
  selectAgent: (id: string | null) => void;
  setFilter: (filter: AgentStatus | 'all') => void;
}

// stores/routing.store.ts
interface RoutingStore {
  routes: GatewayRoute[];
  isLoading: boolean;

  fetchRoutes: () => Promise<void>;
  connectChannel: (data: ConnectChannelRequest) => Promise<GatewayRoute>;
  disconnectChannel: (routeId: string) => Promise<void>;
  updateRoute: (routeId: string, data: Partial<GatewayRoute>) => Promise<void>;
}

// stores/session.store.ts
interface SessionStore {
  sessions: Session[];
  selectedSession: Session | null;
  isLoading: boolean;
  typeFilter: SessionType | 'all';

  fetchSessions: () => Promise<void>;
  fetchSessionDetail: (id: string) => Promise<void>;
  setTypeFilter: (type: SessionType | 'all') => void;
}

// stores/alert.store.ts
interface AlertStore {
  alerts: Alert[];
  unacknowledgedCount: number;

  fetchAlerts: () => Promise<void>;
  acknowledge: (id: string) => Promise<void>;
}

// stores/ws.store.ts
interface WebSocketStore {
  connected: boolean;
  reconnecting: boolean;

  connect: () => void;
  disconnect: () => void;
  // Auto-dispatches events to relevant stores
}
```

### 3.2 TypeScript Types

```typescript
// lib/types.ts

type AgentLayer = 'CPO' | 'CTO' | 'Ops';
type AgentStatus = 'active' | 'idle' | 'paused' | 'error' | 'terminated';
type RouteMode = 'direct' | 'pipeline';
type RouteStatus = 'connected' | 'disconnected';
type ChannelType = 'telegram' | 'slack' | 'discord' | 'webhook';
type SessionType = 'telegram' | 'cron' | 'hook' | 'opencode' | 'direct';
type AlertRule = 'stuck' | 'completion' | 'failure' | 'budget' | 'approvalTimeout' | 'qualityGate';
type AlertLevel = 'critical' | 'warning' | 'info';

interface Agent {
  id: string;
  name: string;
  label: string;
  layer: AgentLayer;
  model: string;
  role: string;
  identity: {
    emoji: string;
    personality: string;
  };
  workspace: string;
  status: AgentStatus;
  stats: AgentStats;
  routes: GatewayRoute[];       // connected channels
  currentTask?: CurrentTask;
  createdAt: number;
}

interface AgentStats {
  totalSessions: number;
  activeSessions: number;
  totalCost: number;
  totalTasks: number;
  avgDuration: number;
  successRate: number;
}

interface GatewayRoute {
  id: string;
  agentId: string;
  agentName: string;
  channelType: ChannelType;
  channelConfig: {
    botToken?: string;       // never sent to frontend
    botUsername?: string;
    channelId: string;
  };
  routeMode: RouteMode;
  status: RouteStatus;
  connectedAt: string;
  lastActivity: string;
}

interface Session {
  id: string;
  agentId: string;
  agentName: string;
  name: string;
  type: SessionType;
  status: 'active' | 'idle' | 'completed' | 'failed' | 'killed';
  messageCount: number;
  toolCalls: number;
  cost: number;
  lastMessage: string;
  updatedAt: number;
  events?: SessionEvent[];
}

interface Alert {
  id: string;
  rule: AlertRule;
  level: AlertLevel;
  agentId: string;
  agentName: string;
  message: string;
  acknowledged: boolean;
  timestamp: number;
}
```

### 3.3 Page Specifications

#### 3.3.1 Overview (`/`)

The main dashboard — at-a-glance status of all agents.

```
┌─ Layout ─────────────────────────────────────────────────────┐
│ ┌─ Sidebar ─┐ ┌─ Main Content ──────────────────────────┐   │
│ │            │ │                                          │   │
│ │ 🔮 AOC    │ │  STATS BAR                               │   │
│ │            │ │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │   │
│ │ 📊 Overview│ │  │Active│ │Idle  │ │Total │ │Cost  │   │   │
│ │            │ │  │Agents│ │Agents│ │Sess. │ │Today │   │   │
│ │ 🤖 Agents │ │  │  5   │ │  7   │ │ 142  │ │$4.20 │   │   │
│ │            │ │  └──────┘ └──────┘ └──────┘ └──────┘   │   │
│ │ 📋 Task   │ │                                          │   │
│ │   Board   │ │  AGENT STATUS          ACTIVITY FEED     │   │
│ │            │ │  ┌──────────────┐    ┌──────────────┐   │   │
│ │ 💬 Sessions│ │  │ Mini agent   │    │ 00:14 ✅ ..  │   │   │
│ │            │ │  │ cards (6)    │    │ 00:12 🔧 ..  │   │   │
│ │ ⏰ Cron   │ │  │ with status  │    │ 00:10 📡 ..  │   │   │
│ │            │ │  │ indicators   │    │ 00:08 💬 ..  │   │   │
│ │ 🔀 Routing│ │  └──────────────┘    └──────────────┘   │   │
│ │            │ │                                          │   │
│ │ ─────────  │ │  ACTIVE PIPELINES (if any)               │   │
│ │ 📈 Analyt.│ │                                          │   │
│ │ ⚙️ Settings│ │                                          │   │
│ └────────────┘ └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

#### 3.3.2 Agents (`/agents`)

```
┌──────────────────────────────────────────────────────────────┐
│ Agents                                    [+ Deploy Agent]  │
│ 12 agents provisioned • 5 active                             │
│                                                              │
│ [All] [Active] [Idle] [Paused] [Error]                      │
│                                                              │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│ │ 🎯 Active    │ │ 🧠 Idle      │ │ 📱 Active    │         │
│ │              │ │              │ │              │         │
│ │ Orchestrator │ │ PM Agent     │ │ Dev FE Agent │         │
│ │ agent:main   │ │ agent:pm     │ │ agent:dev-fe │         │
│ │              │ │              │ │              │         │
│ │ CPO • opus-4 │ │ CPO • son-4  │ │ CTO • son-4  │         │
│ │ 12 sess $2.40│ │ 8 sess $0.90 │ │ 24 sess $3.10│         │
│ │              │ │              │ │              │         │
│ │ 📡 connected │ │ 📡 connected │ │ 📡 connected │         │
│ │              │ │              │ │              │         │
│ │ [✏️] [⏸] [🗑] │ │ [✏️] [⏸] [🗑] │ │ [✏️] [⏸] [🗑] │         │
│ └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                              │
│ ... more rows                                                │
└──────────────────────────────────────────────────────────────┘
```

Each `AgentCard` shows:
- Status indicator (color + label)
- Agent name (Manrope bold)
- Label in mono (`agent:dev-odoo`)
- Layer badge + Model name
- Stats: session count + cost
- Gateway route indicator (📡 connected / ⚠ no route)
- Action buttons: Edit, Pause/Resume, Delete

#### 3.3.3 Deploy Agent Modal (Multi-Step)

**Step 1: Configure**
```
┌─────────────────────────────────────────┐
│ Deploy New Agent                    ✕   │
│ Provision a new agent in your workspace   │
│                                         │
│ Step [1●─────2─────3]                   │
│                                         │
│ Agent ID *          Layer *             │
│ [dev-mobile______]  [CTO ▼_____________]│
│                                         │
│ Display Name *      AI Model *          │
│ [Dev Mobile Agent]  [claude-sonnet-4 ▼] │
│                                         │
│ Role Description                        │
│ [Mobile app dev specialist... ________] │
│                                         │
│ Identity                                │
│ Emoji: [📱]  Personality Brief:         │
│              [Focused mobile dev... ___]│
│                                         │
│ SKILL Template      Custom Instructions │
│ [Code Dev ▼____]    (enabled if Custom) │
│                     [__________________ ]│
│                                         │
│               [Cancel]  [Next: Preview →]│
└─────────────────────────────────────────┘
```

**Step 2: Preview Workspace**
```
┌─────────────────────────────────────────┐
│ Deploy New Agent                    ✕   │
│ Review generated workspace files        │
│                                         │
│ Step [1─────2●─────3]                   │
│                                         │
│ Directory: ~/.openclaw/agents/dev-mobile│
│                                         │
│ ┌─ SKILL.md ────────────────────────┐   │
│ │ # Dev Mobile Agent                │   │
│ │                                   │   │
│ │ ## Role                           │   │
│ │ Mobile app development specialist │   │
│ │ using React Native                │   │
│ │                                   │   │
│ │ ## Capabilities                   │   │
│ │ - Code generation and review      │   │
│ │ - File management                 │   │
│ │ - Testing and debugging           │   │
│ │ ...                               │   │
│ └───────────────────────────────────┘   │
│                                         │
│ ┌─ IDENTITY.md ─────────────────────┐   │
│ │ - Name: Dev Mobile Agent          │   │
│ │ - Emoji: 📱                       │   │
│ │ - Personality: Focused mobile dev │   │
│ └───────────────────────────────────┘   │
│                                         │
│          [← Back]  [Deploy Agent →]     │
└─────────────────────────────────────────┘
```

**Step 3: Success**
```
┌─────────────────────────────────────────┐
│ Deploy New Agent                    ✕   │
│                                         │
│ Step [1─────2─────3●]                   │
│                                         │
│        ✅ Agent Deployed                │
│                                         │
│ "Dev Mobile Agent" has been             │
│ provisioned successfully.               │
│                                         │
│ Next: Connect to a Telegram channel     │
│ to start receiving messages.             │
│                                         │
│    [Done]   [Connect Channel →]         │
└─────────────────────────────────────────┘
```

#### 3.3.4 Connect Channel Modal (Post-Deploy)

```
┌─────────────────────────────────────────┐
│ Connect Channel                     ✕   │
│ Route a messaging channel to this agent │
│                                         │
│ Agent: Dev Mobile Agent (agent:dev-mob) │
│                                         │
│ Channel Type                            │
│ [Telegram ▼________________________]    │
│                                         │
│ Bot Token *                             │
│ [●●●●●●●●●●●●●●●●●●●●●●●●●]  [👁]    │
│                                         │
│ Channel ID *                            │
│ [577142951_____________________]         │
│                                         │
│ Bot Username (auto-detected)            │
│ [@aoc_dev_mobile_bot___________]         │
│                                         │
│ Routing Mode                            │
│ (●) Direct — messages go to this agent  │
│ ( ) Pipeline — messages go through      │
│     orchestrator first                  │
│                                         │
│          [Cancel]  [Connect Channel]    │
└─────────────────────────────────────────┘
```

#### 3.3.5 Routing Page (`/routing`)

```
┌──────────────────────────────────────────────────────────────┐
│ Gateway Routing                            [+ New Route]     │
│ 8 active routes • 2 modes                                    │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ Agent           │ Channel          │ Mode    │ Status  │   │
│ ├────────────────────────────────────────────────────────┤   │
│ │ 🎯 Orchestrator │ @aoc_main_bot    │ Direct  │ 🟢 Live│   │
│ │ 🐍 Dev Odoo     │ @aoc_odoo_bot    │ Direct  │ 🟢 Live│   │
│ │ ⚛️ Dev FE        │ @aoc_fe_bot      │ Direct  │ 🟢 Live│   │
│ │ 📋 PM Agent     │ @aoc_pm_bot      │ Pipeline│ 🟢 Live│   │
│ │ 🔍 Research     │ @aoc_research_bot│ Direct  │ ⚪ Idle│   │
│ │ 📱 Dev Mobile   │ —                │ —       │ ⚠ None │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                              │
│ ⚠ 4 agents have no channel route                            │
└──────────────────────────────────────────────────────────────┘
```

### 3.4 WebSocket Events

| Event | Direction | Payload | Action |
|---|---|---|---|
| `agent:deployed` | Server → Client | `{ agent }` | Add to agent store |
| `agent:updated` | Server → Client | `{ agent }` | Update in agent store |
| `agent:decommissioned` | Server → Client | `{ agentId }` | Remove from store |
| `agent:paused` | Server → Client | `{ agentId }` | Update status |
| `agent:resumed` | Server → Client | `{ agentId }` | Update status |
| `agent:terminated` | Server → Client | `{ agentId }` | Update status |
| `agent:steered` | Server → Client | `{ agentId, message }` | Show toast |
| `route:connected` | Server → Client | `{ route }` | Add to routing store |
| `route:disconnected` | Server → Client | `{ routeId }` | Update routing store |
| `route:updated` | Server → Client | `{ route }` | Update routing store |
| `alert:new` | Server → Client | `{ alert }` | Add to alert store |
| `alert:acknowledged` | Server → Client | `{ alertId }` | Remove from active |
| `telemetry:event` | Server → Client | `{ agentId, event }` | Append to activity feed |

---

## 4. Backend Services

### 4.1 WorkspaceScaffolder (`server/services/workspace-scaffolder.ts`)

The most critical new service — ensures agents are provisioned following OpenClaw conventions.

```typescript
class WorkspaceScaffolder {
  private agentsDir: string;  // ~/.openclaw/agents

  // Create full agent workspace
  scaffold(config: DeployAgentRequest): ScaffoldResult {
    // 1. Create directory: agents/{id}/
    // 2. Generate SKILL.md from template + config
    // 3. Generate IDENTITY.md from identity fields
    // 4. Create sessions/sessions.json (empty {})
    // 5. Create credentials/ directory
    return { directory, files: [...] };
  }

  // Generate SKILL.md content from template + custom instructions
  generateSkillMd(template: SkillTemplate, role: string, custom?: string): string

  // Generate IDENTITY.md content
  generateIdentityMd(name: string, emoji: string, personality: string): string

  // Preview without writing (for Step 2 of Deploy modal)
  preview(config: DeployAgentRequest): PreviewResult

  // Archive agent workspace (for decommission with preserveData)
  archive(agentId: string): void

  // Delete agent workspace (for decommission without preserveData)
  destroy(agentId: string): void
}
```

### 4.2 RoutingService (`server/services/routing.service.ts`)

Manages gateway channel bindings — the POST-DEPLOY routing layer.

```typescript
class RoutingService {
  // Connect agent to a channel (creates gateway binding)
  connect(agentId: string, channelType: ChannelType, config: ChannelConfig, mode: RouteMode): GatewayRoute

  // Disconnect agent from channel
  disconnect(routeId: string): void

  // Switch route mode (direct ↔ pipeline)
  updateMode(routeId: string, mode: RouteMode): void

  // Re-route channel to different agent
  reassign(routeId: string, newAgentId: string): void

  // Get all routes
  getAll(): GatewayRoute[]

  // Get routes for specific agent
  getByAgent(agentId: string): GatewayRoute[]
}
```

### 4.3 ConfigManager (`server/services/config-manager.ts`)

Safe atomic read/write for `openclaw.json`.

```typescript
class ConfigManager {
  readConfig(): OpenClawConfig
  writeConfig(config: OpenClawConfig): void    // atomic: write .tmp → rename
  backupConfig(): string                        // → .data/backups/
  validateConfig(config: OpenClawConfig): ValidationResult

  // Agent-specific operations
  addAgent(agent: AgentEntry): void
  removeAgent(id: string): void
  updateAgent(id: string, data: Partial<AgentEntry>): void

  // Channel-specific operations
  addChannelBinding(binding: ChannelBinding): void
  removeChannelBinding(channelId: string): void
}
```

### 4.4 AlertService (`server/services/alert.service.ts`)

```typescript
class AlertService {
  rules: AlertRule[] = [
    { id: 'stuck', check: (agent) => noActivity > 20min, level: 'warning' },
    { id: 'completion', check: (session) => justCompleted, level: 'info' },
    { id: 'failure', check: (session) => justFailed, level: 'critical' },
    { id: 'budget', check: (agent) => cost > budget * 0.7, level: 'warning' },
  ];

  evaluate(agents: Agent[], sessions: Session[]): Alert[]
  acknowledge(alertId: string): void
  getActive(): Alert[]
}
```

---

## 5. Design System Integration

### 5.1 CSS Custom Properties (Obsidian Claw Tokens)

The design system from [DESIGN.md](../mockup/obsidian_claw/DESIGN.md) is implemented as CSS Custom Properties in `src/assets/design-system.css`:

```css
:root {
  /* Surface Hierarchy */
  --surface: #0e0e0e;
  --surface-container-lowest: #000000;
  --surface-container-low: #131313;
  --surface-container: #191a1a;
  --surface-container-high: #1f2020;
  --surface-container-highest: #252626;
  --surface-bright: #2c2c2c;

  /* Primary (Purple) */
  --primary: #d0bcff;
  --primary-dim: #c4acff;
  --primary-container: #5516be;
  --on-primary-container: #d9c8ff;

  /* Text */
  --on-surface: #e7e5e4;
  --on-surface-variant: #acabaa;

  /* Status (muted, not Christmas tree) */
  --status-active: #4caf5040;
  --status-active-text: #81c784;
  --status-idle: #ffffff15;
  --status-idle-text: #acabaa;
  --status-paused: #ff980040;
  --status-paused-text: #ffb74d;
  --status-error: #ef535040;
  --status-error-text: #ef9a9a;

  /* Typography */
  --font-headline: 'Manrope', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* Shadows (absence of light, not gray) */
  --shadow-elevated: 0 20px 40px rgba(0, 0, 0, 0.4);
  --shadow-glow: 0 0 0 1px rgba(208, 188, 255, 0.15);

  /* Glass */
  --glass-bg: rgba(14, 14, 14, 0.7);
  --glass-blur: 20px;
}
```

### 5.2 Component Styling Rules

1. **No borders** — depth via background color shifts only
2. **Ghost borders** (accessibility) — `outline-variant` (#484848) at 15% opacity
3. **Cards** — always `radius-lg` (12px), hover = next surface level
4. **Buttons** — Primary: `primary-container` bg, Ghost: no bg + ghost border
5. **Inputs** — `surface-container-highest` bg, focus: `surface-bright` + purple glow
6. **Status chips** — muted backgrounds (40% opacity), soft text colors

---

## 6. Security

| Measure | Implementation |
|---|---|
| Config backup | Before every mutation → `.data/backups/` |
| Atomic writes | write `.tmp` → `fs.renameSync()` |
| Input validation | Strict types + regex on all API inputs |
| Rate limiting | Write endpoints: 10 req/min |
| Audit log | All mutations → `.data/audit.log` |
| CSRF | Custom header: `X-AOC-Action: true` |
| Sensitive data | Bot tokens never sent to frontend |
| Auth | Bearer token (timing-safe compare) |

---

## 7. Implementation Phases

### Phase 1: Network Core (3 weeks)

| Task | Effort | Dependencies |
|---|---|---|
| Project scaffold (Vite + React + Express) | 1 day | — |
| Design system CSS (tokens, base styles) | 2 days | — |
| Layout shell (Sidebar, TopBar, Router) | 2 days | CSS |
| Port parsers.js + watchers.js to TypeScript | 2 days | — |
| ConfigManager (atomic config read/write) | 2 days | Parsers |
| WorkspaceScaffolder (OpenClaw workspace creation) | 3 days | ConfigManager |
| AgentService (CRUD, pause/resume/terminate/steer) | 2 days | ConfigManager, Scaffolder |
| RoutingService (connect/disconnect channels) | 2 days | ConfigManager |
| API routes (all Phase 1 endpoints) | 2 days | Services |
| WebSocket hub (event broadcasting) | 1 day | API routes |
| Zustand stores (agent, routing, session, alert, ws) | 2 days | Types |
| Overview page | 2 days | Stores, CSS |
| Agents page (agent grid + filter + CRUD) | 2 days | Stores, CSS |
| Deploy Agent Modal (3-step) | 3 days | AgentService |
| Connect Channel Modal | 1 day | RoutingService |
| Agent Detail page | 3 days | All |
| Routing page (route table) | 1 day | RoutingService |
| AlertService (stuck + failure rules) | 1 day | Parsers |
| Alert UI (toast + badge) | 1 day | AlertService |
| Testing + polish | 3 days | All |

**Total: ~35 days allocated across 3 weeks with parallel work**

---

## 8. Glossary

| Term | Definition |
|---|---|
| **Deploy** | Provision a new agent with proper OpenClaw workspace |
| **Terminate** | Force-stop an agent's active session |
| **Steer** | Send a guidance message to an agent mid-task |
| **Stuck Alert** | Alert when agent has no activity for configured period |
| **Route** | A binding between an agent and a messaging channel |
| **Direct Mode** | Messages route directly to the assigned agent |
| **Pipeline Mode** | Messages route through orchestrator first |
| **Pipeline** | A multi-phase mission with approval gates between phases |
