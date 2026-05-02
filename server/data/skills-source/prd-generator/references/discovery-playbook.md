# Discovery Playbook — Gathering Evidence Before Interviewing

This playbook tells the agent how to pull context from existing sources **before** asking the user questions. The goal: cut the interview by 50% and ground every Problem Statement claim in real data.

Discovery runs in **`discover`** and **`synthesize`** modes. It is optional but strongly recommended.

## Discovery sources, in priority order

| Source | When available | What to extract |
|---|---|---|
| 1. Explicit repo path | User mentions one, or an uploaded codebase is present | Tech stack, routes/models, READMEs, changelogs |
| 2. Uploaded files | User attached PDFs, markdown, transcripts | Research quotes, competitor specs, raw survey data |
| 3. MCP connectors | Data warehouse, Analytics, Slack, Asana/Jira, Datadog, GitHub | Metric baselines, open tickets, incident history |
| 4. Cowork workspace | Other files in the selected folder | Related docs, prior PRDs, product roadmap |
| 5. Web search | Named competitor / standard metric | Industry benchmarks, comparable specs |

**Rule**: use the highest-priority source available, then layer the next. Stop when you have enough to make the interview targeted. Don't discover forever.

## Source 1 — Repo scan

### Automated: `scripts/discover.js`

The skill ships `scripts/discover.js`. Run it against any repo-shaped directory:

```bash
node /path/to/scripts/discover.js --repo <path-to-repo> --out context.json
```

It inspects:

- **Language manifests**: `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Gemfile`, `Cargo.toml`, `pom.xml`, `composer.json`.
- **Framework hints**: presence of `next.config.*`, `nuxt.config.*`, `vite.config.*`, `django`, `rails`, `flask`, `fastapi`, `spring-boot`, `express`, `nestjs`.
- **Database hints**: `schema.prisma`, `schema.sql`, `alembic/`, `migrations/`, `db/migrate/`, `sequelize`, `drizzle`, `mongo`, `redis`, `postgres`, `mysql`.
- **Infra hints**: `Dockerfile`, `docker-compose*.yml`, `k8s/`, `terraform/`, `helm/`, `.github/workflows/`.
- **Docs**: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/`, `ADR*/`, `architecture/`.
- **Route / model inventory**: globs for `routes/*`, `controllers/*`, `models/*`, `app/api/*`, `pages/api/*`.
- **Git remote**: `git remote -v` for repo URL, `git log -1 --format=%ci` for last commit.

**Output**: `context.json` with a stable shape (see script for full schema):

```json
{
  "repo": { "path": "...", "remote": "...", "lastCommit": "..." },
  "stack": { "frontend": "Next.js 15", "backend": "Express", "database": "PostgreSQL + Redis", "infra": ["Docker", "GitHub Actions"] },
  "docs": [{ "path": "README.md", "title": "...", "summary": "..." }],
  "routes": [{ "method": "GET", "path": "/api/notifications", "file": "..." }],
  "models": [{ "name": "User", "file": "..." }],
  "dependencies": ["docx", "express", "socket.io"]
}
```

### Manual follow-up

After reading `context.json`, the agent should:

1. **Pre-fill SKILL.md fields** — Section 2.4 (Tech Stack), Section 13 (Dependencies), Section 9 (Technical Approach).
2. **Surface relevant existing features** — if the feature being PRD'd overlaps with an existing route or model, call that out in Section 6 (Solution Overview) and ask whether to extend or replace.
3. **Flag missing pieces** — if no tests directory, flag under Section 8 (Non-Functional Requirements) with a target.

### Direct-read fallback (no discover.js)

If `scripts/discover.js` isn't practical (e.g. repo is not on disk, or user only points to specific files), the agent uses its native tools directly:

- `Read` on `README.md`, `package.json`, key config files.
- `Grep` for route definitions, model definitions, feature flags.
- `Glob` for high-level folder structure (`src/**/*.ts`, `app/**/*.py`).
- Stop at ~15-20 file reads — more than that is over-scanning for a PRD.

## Source 2 — Uploaded files (synthesize mode)

Process uploaded files in this order:

1. **Interview transcripts** (markdown, PDF, .txt): extract **direct quotes** with speaker + timestamp. Store up to 10 quotes. Use them in Problem Statement and Section 3.1 (4 Risks questions).
2. **Survey results** (CSV, PDF): compute headline numbers (%, N). Put the strongest 2-3 numbers in the Problem Statement.
3. **Meeting notes**: extract action items and open decisions. Use them to pre-fill Section 12 (Open Questions).
4. **Existing PRDs** (reference docs): scan for section patterns the team already uses. Adopt their conventions (section numbering, vocabulary, tone).
5. **Competitor specs / research reports**: extract a short "what they do" summary. Use in Section 3 (Problem) or Section 5 (Options Considered) if the PRD is a vendor comparison.

After processing, reflect back: "I pulled 8 quotes from the user-interview transcripts, the most-cited theme is [X]. Do you want me to lead the Problem Statement with that?"

## Source 3 — MCP connectors

Check what's connected **before** asking for data the user might not have to hand. Call `search_mcp_registry` with relevant keywords and report back.

| Signal in user's request | Connector to suggest |
|---|---|
| "our dashboard metrics", "product analytics" | Mixpanel, Amplitude, PostHog, GA4 |
| "our SQL warehouse", "run a query" | Snowflake, BigQuery, Databricks, Postgres |
| "tickets", "support volume" | Zendesk, Intercom, HubSpot |
| "incidents", "latency" | Datadog, Sentry, PagerDuty |
| "engineering tickets" | Jira, Linear, Asana |
| "team discussion" | Slack, Microsoft Teams |
| "our roadmap" | Productboard, Notion, Confluence |

If the connector exists, offer: "I can pull the last 30 days of p95 latency from Datadog for the baseline — want me to?" If not, suggest installing: "I'd recommend connecting Datadog via the MCP registry so we can ground the latency claims in real data."

## Source 4 — Cowork workspace (other files in folder)

If the user selected a workspace folder:

- List files once to detect related docs (previous PRDs, roadmap spreadsheets, research notes).
- Read at most 3-5 related files. Focus on ones with names like `PRD_*`, `Roadmap_*`, `Research_*`, `Metrics_*`.
- Extract prior numbering (to avoid PRD-number collision) and tone conventions.

## Source 5 — Web search (sparingly)

Use `WebSearch` / `WebFetch` only when:

1. The user mentions a **named competitor** or third-party product — and we need to describe parity/differentiation.
2. The user mentions a **standard metric** (SUS, NPS, TTFB, LCP) — and we need a published benchmark.
3. The user mentions a **regulation** (UU PDP, GDPR, HIPAA) — and we need the specific clause reference.

Cap at 2-3 searches per PRD. Cite URLs in Section 16.2 (References).

## After discovery — briefing the user

Summarize findings **before** starting interview. Pattern:

> "Discovery done. Here's what I pulled:
> - Repo: Next.js 15 + Postgres + Redis. 3 existing notification-related routes (`POST /api/notify`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`).
> - Docs: README mentions 'email digest' as the current primary channel. CHANGELOG shows the digest was last overhauled in Feb 2026.
> - Uploaded: 4 user interviews (quotes attached). Strongest theme: 'I miss critical events when I'm out of my inbox.'
> - Connectors: Datadog is connected — I can pull baseline latency. Mixpanel is NOT connected — we won't be able to cite NSM baseline with precision.
>
> I'll skip the Tech Stack and existing-features questions since the repo told me. Starting the Problem + Metrics batch now."

This tells the user what you learned, which reduces interview friction significantly.

## Discovery-to-section mapping

Use this lookup table when writing the PRD to route discovered evidence to the right sections:

| Evidence type | PRD section to populate |
|---|---|
| Tech-stack manifests | 2.4 Tech Stack, 9 Technical Approach, 13 Dependencies |
| Existing routes / models | 6 Solution Overview, 9 Technical Approach |
| User-interview quotes | 3 Problem Statement, 3.1 4 Risks (Value Risk especially) |
| Survey / analytics numbers | 3 Problem Statement, 5 Product Metrics (baseline column) |
| Support ticket themes | 3 Problem Statement, 8 Non-Functional Requirements (reliability) |
| Incident history (Datadog / Sentry) | 8 Non-Functional Requirements, 11.3 Feasibility Risk |
| Competitor research | 5 Options Considered (if comparing vendors), 11.1 Value Risk |
| Regulation / compliance notes | 8 Non-Functional, 11.4 Business Viability Risk, 16.3 References |
| Prior PRD numbering | Cover page (PRD number collision avoidance) |

## Discovery is not an excuse to skip the interview

Even with rich discovery, **always** still interview for:

- Problem statement framing (what's the wording the user wants).
- Goals prioritization (which of many possible goals is #1).
- Non-goals (only the human knows what's out of scope this release).
- Stakeholder names + RACI.
- Timeline (only the human knows the real constraint).

Discovery makes the interview **shorter and sharper**, not optional.
