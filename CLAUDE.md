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
- **State:** Zustand stores in `src/stores/index.ts` — one store per domain (agents, sessions, tasks, cron, routing, alerts, activity, live feed, auth, WebSocket status). No Redux.
- **Real-time:** `src/hooks/useWebSocket.ts` connects to `/ws`, dispatches typed events to Zustand stores. `src/hooks/useDataLoader.ts` handles initial REST data fetch.
- **API client:** `src/lib/api.ts` — thin wrapper around `fetch` with auto-auth headers from `useAuthStore`. All endpoints under `/api`.
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite` plugin. shadcn/ui components in `src/components/ui/`. Path alias `@/` maps to `src/`.
- **Types:** All shared types in `src/types/index.ts`.

### Backend (Node.js + Express 5, CommonJS)

- **Entry:** `server/index.cjs` — Express app with JWT auth, Helmet, CORS, rate limiting.
- **Parsers:** `server/lib/index.cjs` (barrel) — modules that read/parse OpenClaw filesystem data (`~/.openclaw/agents/`, `openclaw.json`, session JSONL files).
- **Database:** `server/lib/db.cjs` — SQLite via `sql.js` (in-memory/file) for user auth, agent profiles, and dashboard-specific state.
- **WebSocket:** Native `ws` library. Server broadcasts real-time events to connected clients. `server/lib/gateway-ws.cjs` proxies to OpenClaw gateway WebSocket.
- **File watching:** `server/lib/watchers.cjs` uses `chokidar` to watch OpenClaw filesystem for changes and emit live feed events.

### Data Flow

OpenClaw filesystem → chokidar watchers → Express parsers → REST API + WebSocket broadcasts → Zustand stores → React UI

The backend does NOT own agent data. It reads from OpenClaw's filesystem as the source of truth, and uses SQLite only for dashboard-specific data (user accounts, agent profiles/avatars, UI preferences).
