# Ticket Detail Revamp + In Review Workflow

**Date:** 2026-04-10
**Status:** Approved for implementation

---

## Overview

Revamp the ticket detail view from a narrow side drawer with 3 tabs into a full-screen dialog with a single-scroll layout. Add a new `in_review` status between `in_progress` and `done` to enforce human validation before a task is marked complete. The agent work section is redesigned as a grouped turn log with a distinct final result section.

---

## 1. Status Flow

**Before:** `backlog → todo → in_progress → done` (+ `blocked`)

**After:** `backlog → todo → in_progress → in_review → done` (+ `blocked`)

- `in_review` is agent-driven: dispatch message updated so agents call `update_task.sh <id> in_review "<summary>"` instead of `done`
- Human validates the result in `in_review` before approving to `done`
- `blocked` remains valid from any status

---

## 2. Backend Changes

### 2.1 Types

**`src/types/index.ts`**
- Add `"in_review"` to `TaskStatus` union

### 2.2 Dispatch Message Template

**`server/index.cjs` — POST /api/tasks/:id/dispatch**

Update the instruction block sent to the agent. The exact replacement text for the status instructions:

```
When you start working:
`update_task.sh {taskId} in_progress "Starting..." $SESSION_KEY`

When your work is complete and ready for human review:
`update_task.sh {taskId} in_review "Summary of completed work"`

When blocked:
`update_task.sh {taskId} blocked "Reason here"`
```

Remove `done` from the agent instructions entirely. Agents set `in_review` when complete; only humans approve to `done` via the UI.

### 2.3 Board Column

**`src/pages/BoardPage.tsx`**
- Add `in_review` column between `in_progress` and `done`
- Label: `"In Review"`, color accent: amber/yellow to distinguish from green Done

### 2.4 PATCH Endpoint

No logic changes needed. `in_review` is treated identically to other statuses.

---

## 3. Modal Layout

Replace `Sheet` (side drawer) with `Dialog` (full modal).

- Size: `max-w-4xl w-full`, `max-h-[90vh]`, `overflow-y-auto`
- Triggered the same way: clicking a task card on the board

### 3.1 Structure (top to bottom, single scroll)

```
┌──────────────────────────────────────────────────────┐
│ [X]                                  [⚡ Dispatch]   │
│                                                      │
│  Task Title  (large, prominent)                      │
│                                                      │
│  [● Status ▾]  [↑ Priority ▾]  [🤖 Agent ▾]  [#tag] │
│  Created Apr 10  ·  Completed Apr 10  ·  $0.00       │
│                                                      │
├── IN REVIEW BANNER (only when status=in_review) ─────┤
│                                                      │
├── DESCRIPTION ───────────────────────────────────────┤
│                                                      │
├── AGENT WORK ────────────────────────────────────────┤
│   Turn log + Result                                  │
│                                                      │
├── ACTIVITY ──────────────────────────────────────────┤
└──────────────────────────────────────────────────────┘
```

---

## 4. Header

- Title: `text-xl font-semibold`, read-only display (no inline edit)
- Metadata row: status dropdown, priority dropdown, agent dropdown, tags as badges
- Meta line: created date, completed date (if set), cost (if set)
- Dispatch button: top-right, shown only when agent is assigned
  - Label: "Dispatch to Agent" or "Re-dispatch" if sessionId exists
  - Disabled while dispatching

---

## 5. In Review Banner

Visible **only** when `task.status === "in_review"`. Rendered in normal document flow below the header metadata (not viewport-sticky — scrolls with content).

### Default state

```
┌──────────────────────────────────────────────────────┐
│ 🔍 IN REVIEW                                         │
│ Agent selesai. Periksa Agent Result di bawah.        │
│                                                      │
│  [✅ Approve & Done]       [🔄 Request Changes]       │
└──────────────────────────────────────────────────────┘
```

Styling: amber/yellow border, subtle amber background.

### Approve flow

Click "Approve & Done" → `PATCH { status: "done", note: "Approved" }` → banner disappears.

### Request Changes flow

Click "Request Changes" → banner expands inline:

```
┌──────────────────────────────────────────────────────┐
│ 🔄 Apa yang perlu diperbaiki?                        │
│ ┌──────────────────────────────────────────────────┐ │
│ │ [textarea placeholder: "Describe what to fix..."]│ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│  Kembalikan ke:  ○ Todo   ● In Progress              │
│                                                      │
│  [Cancel]                      [Send Back →]         │
└──────────────────────────────────────────────────────┘
```

- Default target: `in_progress`
- Toggle: `todo` (queued, not yet dispatched) or `in_progress` (active)
- Submit → `PATCH { status: "in_progress"|"todo", note: "<user note>" }` → banner hides
- Note is required before submit (empty note disables Send Back button)

---

## 6. Description Section

Section header: `DESCRIPTION` label.

- Display: `whitespace-pre-wrap`, `text-sm text-foreground/80`
- If empty: show subtle placeholder `"No description."` in muted text

---

## 7. Agent Work Section

Section header: `AGENT WORK` with live indicator (pulsing dot) when `status === "in_progress"` and session is streaming.

### 7.1 Empty state

If no `sessionId` and status not in `[in_review, done]`:
```
Agent belum mulai bekerja.
[Dispatch to Agent] (if agent assigned)
```

### 7.2 Turn Log

When `sessionId` exists (or task is done with completion note fallback):

**Status bar:**
```
SESSION REPLAY  ·  3 turns  ·  2 tools  ·  a9c20b38
```

**Turn definition:** One turn = one contiguous sequence of [optional thinking block(s)] + [zero or more tool calls with their results] + [one assistant text response]. Grouping is done by scanning messages in order: a new turn starts when a new thinking block or the first tool call after a prior assistant response is encountered.

**Turn blocks** (grouped by agent response cycle):

```
┌─ Turn 1 ─────────────────────────── [▼ expand] ─┐
│ 🧠 Thinking   · 🔧 list_google_docs  · 🔧 read   │
└──────────────────────────────────────────────────┘
```

Expanded turn:
```
┌─ Turn 1 ─────────────────────────── [▲ collapse] ┐
│  🧠 Thinking  (collapsible, shows line count)     │
│  🔧 list_google_docs                              │
│     Input: { ... }                                │
│     Output: [ ... ]                               │
│  🔧 read_document                                 │
│     Input: { ... }                                │
│     Output: ...                                   │
└──────────────────────────────────────────────────┘
```

- Turns collapsed by default
- Live/streaming turn: auto-expanded
- Turn header summary: icons + tool names, truncated if many

### 7.3 Result Section

Below all turns, always visible (not collapsible):

```
── RESULT ─────────────────────────────────────────
┌──────────────────────────────────────────────────┐
│ ✅ Agent Result                                   │
│                                                  │
│  [Full markdown rendered content]                 │
│  Headings / lists / tables / code — all styled   │
└──────────────────────────────────────────────────┘
```

- Rendered with `react-markdown` + `remark-gfm`
- Filtered: `HEARTBEAT_OK`, `[HEARTBEAT]`, empty strings excluded
- Fallback: if `sessionId` is null but task is `done` with activity completion note → show that note as result
- Streaming: shows pulsing indicator, no "Agent Result" header until done

---

## 8. Activity Section

Section header: `ACTIVITY`.

Timeline entries (most recent at bottom):
```
  │  👤 User  created ticket               Apr 10, 11:25 AM
  │  👤 User  moved backlog → in_progress  Apr 10, 11:26 AM
  │           "Dispatched to agent main"
  │  🤖 Agent moved in_progress → in_review  Apr 10, 11:40 AM
  │           "Summary of completed work..."
  │  👤 User  moved in_review → done       Apr 10, 11:41 AM
  │           "Approved"
```

No changes to existing activity data structure.

---

## 9. Component Structure

```
TaskDetailModal          ← replaces TaskDetailDrawer (Dialog instead of Sheet)
├── TaskModalHeader       ← title + metadata row + dispatch button
├── InReviewBanner        ← conditional, approve/reject UX
├── TaskDescription       ← description display
├── AgentWorkSection      ← replaces AgentWorkTab
│   ├── TurnGroup         ← collapsible per-turn block
│   │   ├── ThinkingBlock
│   │   └── ToolCallBlock (×n)
│   └── AgentResultBlock  ← markdown result, always visible
└── ActivitySection       ← timeline
```

Files to create/modify:
- **Rename/replace** `TaskDetailDrawer.tsx` → `TaskDetailModal.tsx`
- **Replace** `AgentWorkTab.tsx` → logic moved into `AgentWorkSection.tsx` (with `TurnGroup` sub-component)
- **New** `InReviewBanner.tsx`
- **Modify** `BoardPage.tsx` — add `in_review` column, use new modal
- **Modify** `src/types/index.ts` — add `in_review` to `TaskStatus`
- **Modify** `server/index.cjs` — dispatch message, STATUS_LABELS

---

## 10. Out of Scope

- Inline title editing
- Rich text description editing
- Comment/reply system
- Sub-tasks / relationships
- Attachments
