# Ticket Detail Revamp + In Review Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ticket detail side drawer with a full-screen modal using single-scroll layout, add `in_review` status with human validation UI, and redesign the Agent Work section as a grouped turn log with markdown result rendering.

**Architecture:** New `TaskDetailModal` (Dialog-based) replaces `TaskDetailDrawer` (Sheet-based). Agent work is split into `AgentWorkSection` (turn-grouped log + result) and `InReviewBanner` (approval UI). Backend dispatch message updated so agents report `in_review` instead of `done`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui Dialog, react-markdown, remark-gfm, Zustand, Express 5 (CommonJS backend)

**No test runner configured** — verification steps use TypeScript check (`npx tsc --noEmit`) and manual browser testing.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/types/index.ts` | Add `"in_review"` to `TaskStatus` union |
| Modify | `server/index.cjs` | Update dispatch message: `done` → `in_review` |
| Modify | `src/pages/BoardPage.tsx` | Add `in_review` column; swap `TaskDetailDrawer` → `TaskDetailModal` |
| Create | `src/components/board/InReviewBanner.tsx` | Approve / Request Changes UI (binary validation) |
| Create | `src/components/board/AgentWorkSection.tsx` | Turn-grouped execution log + markdown result; replaces AgentWorkTab |
| Create | `src/components/board/TaskDetailModal.tsx` | Full-screen Dialog modal replacing TaskDetailDrawer |
| Keep | `src/components/board/TaskDetailDrawer.tsx` | Not deleted — just no longer used in BoardPage |
| Keep | `src/components/board/AgentWorkTab.tsx` | Not deleted — superseded by AgentWorkSection |

---

## Task 1: Add `in_review` to TaskStatus

**Files:**
- Modify: `src/types/index.ts` (line 1)

- [ ] **Step 1: Update TaskStatus union**

Open `src/types/index.ts`. Change the first line from:
```typescript
export type TaskStatus = "backlog" | "todo" | "in_progress" | "done" | "blocked"
```
to:
```typescript
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked"
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors (the new union member is additive, no breaking changes).

- [ ] **Step 3: Stage**

```bash
git add src/types/index.ts
```

---

## Task 2: Update Dispatch Message (agent reports `in_review` not `done`)

**Files:**
- Modify: `server/index.cjs` lines 1317–1329

- [ ] **Step 1: Replace dispatch instruction block**

In `server/index.cjs`, find the message array (around line 1317). Replace the status reporting lines:

**Before (lines 1317–1329):**
```javascript
`IMPORTANT: Report your progress using ONE of these methods:`,
``,
`**Method 1 — Script (preferred):**`,
`\`update_task.sh ${task.id} in_progress "Starting..."\``,
`\`update_task.sh ${task.id} done "Summary"\``,
`\`update_task.sh ${task.id} blocked "Reason"\``,
``,
`**Method 2 — Direct curl (fallback if script fails):**`,
`\`${curlBase} -d '{"status":"in_progress","note":"Starting"}'\``,
`\`${curlBase} -d '{"status":"done","note":"Summary here"}'\``,
`\`${curlBase} -d '{"status":"blocked","note":"Reason here"}'\``,
``,
`If you cannot complete the task for ANY reason, ALWAYS report it with status "blocked" so the operator knows.`,
```

**After:**
```javascript
`IMPORTANT: Report your progress using ONE of these methods:`,
``,
`**Method 1 — Script (preferred):**`,
`\`update_task.sh ${task.id} in_progress "Starting..." $SESSION_KEY\``,
`\`update_task.sh ${task.id} in_review "Summary of completed work"\``,
`\`update_task.sh ${task.id} blocked "Reason here"\``,
``,
`**Method 2 — Direct curl (fallback if script fails):**`,
`\`${curlBase} -d '{"status":"in_progress","note":"Starting"}'\``,
`\`${curlBase} -d '{"status":"in_review","note":"Summary here"}'\``,
`\`${curlBase} -d '{"status":"blocked","note":"Reason here"}'\``,
``,
`When your work is complete, set status to "in_review" — NOT "done". A human will review and approve.`,
`If you cannot complete the task for ANY reason, ALWAYS report it as "blocked".`,
```

- [ ] **Step 2: Stage**

```bash
git add server/index.cjs
```

---

## Task 3: Add `in_review` Column to BoardPage

**Files:**
- Modify: `src/pages/BoardPage.tsx` lines 13–18

- [ ] **Step 1: Add in_review to COLUMNS array**

In `src/pages/BoardPage.tsx`, update the `COLUMNS` array:

**Before:**
```typescript
const COLUMNS: KanbanColumnDef[] = [
  { id: "backlog",     label: "Backlog",     emoji: "📥" },
  { id: "todo",        label: "Todo",        emoji: "📋" },
  { id: "in_progress", label: "In Progress", emoji: "⚡" },
  { id: "blocked",     label: "Blocked",     emoji: "🚫" },
  { id: "done",        label: "Done",        emoji: "✅" },
]
```

**After:**
```typescript
const COLUMNS: KanbanColumnDef[] = [
  { id: "backlog",     label: "Backlog",     emoji: "📥" },
  { id: "todo",        label: "Todo",        emoji: "📋" },
  { id: "in_progress", label: "In Progress", emoji: "⚡" },
  { id: "in_review",   label: "In Review",   emoji: "🔍" },
  { id: "blocked",     label: "Blocked",     emoji: "🚫" },
  { id: "done",        label: "Done",        emoji: "✅" },
]
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Stage**

```bash
git add src/pages/BoardPage.tsx
```

---

## Task 4: Create `InReviewBanner` Component

**Files:**
- Create: `src/components/board/InReviewBanner.tsx`

- [ ] **Step 1: Create the file**

```typescript
import React, { useState } from "react"
import { CheckCircle2, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface InReviewBannerProps {
  onApprove: () => void
  onRequestChanges: (note: string, targetStatus: "todo" | "in_progress") => void
  isSubmitting?: boolean
}

export function InReviewBanner({ onApprove, onRequestChanges, isSubmitting }: InReviewBannerProps) {
  const [mode, setMode] = useState<"idle" | "requesting">("idle")
  const [note, setNote] = useState("")
  const [targetStatus, setTargetStatus] = useState<"todo" | "in_progress">("in_progress")

  function handleSendBack() {
    if (!note.trim()) return
    onRequestChanges(note.trim(), targetStatus)
  }

  function handleCancel() {
    setMode("idle")
    setNote("")
    setTargetStatus("in_progress")
  }

  return (
    <div className={cn(
      "rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden",
    )}>
      {mode === "idle" ? (
        <div className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-400">🔍 In Review</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Agent selesai. Periksa Agent Result di bawah sebelum approve.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5 border-border/50"
              onClick={() => setMode("requesting")}
              disabled={isSubmitting}
            >
              <RotateCcw className="h-3 w-3" />
              Request Changes
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onApprove}
              disabled={isSubmitting}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve & Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-amber-400">🔄 Apa yang perlu diperbaiki?</p>
            <button onClick={handleCancel} className="text-muted-foreground/50 hover:text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Describe what needs to be fixed or improved..."
            className="text-sm resize-none min-h-[80px]"
            autoFocus
          />
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Kembalikan ke:</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="targetStatus"
                  value="todo"
                  checked={targetStatus === "todo"}
                  onChange={() => setTargetStatus("todo")}
                  className="accent-amber-500"
                />
                Todo
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="targetStatus"
                  value="in_progress"
                  checked={targetStatus === "in_progress"}
                  onChange={() => setTargetStatus("in_progress")}
                  className="accent-amber-500"
                />
                In Progress
              </label>
            </div>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleSendBack}
              disabled={!note.trim() || isSubmitting}
            >
              Send Back →
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Stage**

```bash
git add src/components/board/InReviewBanner.tsx
```

---

## Task 5: Create `AgentWorkSection` Component

**Files:**
- Create: `src/components/board/AgentWorkSection.tsx`

This replaces `AgentWorkTab`. Introduces turn grouping: each turn = contiguous block of [thinking blocks] + [tool calls] + [one assistant response]. Last assistant response = Result (shown separately, always visible).

- [ ] **Step 1: Create the file**

```typescript
import React, { useEffect, useRef, useState, lazy, Suspense } from "react"
import { chatApi, GatewayMessage } from "@/lib/chat-api"
import { cn } from "@/lib/utils"
import {
  ChevronDown, ChevronRight, Brain, Terminal,
  CheckCircle2, Loader2, Zap, AlertCircle
} from "lucide-react"

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(content: GatewayMessage["content"]): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content.map(b => ("text" in b ? b.text : "")).filter(Boolean).join("")
}

function isSystemMessage(text: string): boolean {
  const t = text.trim()
  return /^HEARTBEAT_OK$/i.test(t) || /^\[HEARTBEAT\]$/i.test(t) || t === ""
}

// ── Markdown ──────────────────────────────────────────────────────────────────

const ReactMarkdown = lazy(() => import("react-markdown"))

function MarkdownContent({ children }: { children: string }) {
  const [plugins, setPlugins] = useState<unknown[]>([])
  useEffect(() => { import("remark-gfm").then(m => setPlugins([m.default])) }, [])
  return (
    <Suspense fallback={<pre className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{children}</pre>}>
      <ReactMarkdown
        remarkPlugins={plugins as never}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed text-sm text-foreground/90">{children}</p>,
          h1: ({ children }) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 text-foreground border-b border-border/40 pb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mb-2 mt-4 first:mt-0 text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mb-2 mt-3 first:mt-0 text-foreground">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mb-3 space-y-1 pl-1">{children}</ol>,
          li: ({ children }) => <li className="text-sm text-foreground/90 leading-relaxed">{children}</li>,
          code: ({ inline, children, ...props }: { inline?: boolean; children?: React.ReactNode } & Record<string, unknown>) =>
            inline ? (
              <code className="bg-muted/60 text-foreground font-mono text-[11px] px-1.5 py-0.5 rounded" {...props}>{children}</code>
            ) : (
              <code className="block bg-muted/40 text-foreground/85 font-mono text-[11px] p-3 rounded-md overflow-x-auto leading-relaxed whitespace-pre" {...props}>{children}</code>
            ),
          pre: ({ children }) => <pre className="mb-3 rounded-md overflow-hidden">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 my-3 text-muted-foreground italic">{children}</blockquote>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          table: ({ children }) => <div className="overflow-x-auto mb-3"><table className="w-full text-xs border-collapse">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
          th: ({ children }) => <th className="border border-border/40 px-3 py-1.5 font-semibold text-left text-foreground">{children}</th>,
          td: ({ children }) => <td className="border border-border/40 px-3 py-1.5 text-foreground/85">{children}</td>,
          a: ({ children, href }) => <a href={href} className="text-primary underline underline-offset-2 hover:text-primary/80" target="_blank" rel="noopener noreferrer">{children}</a>,
        }}
      >
        {children}
      </ReactMarkdown>
    </Suspense>
  )
}

// ── Turn event types ──────────────────────────────────────────────────────────

interface ToolCallItem {
  name: string
  input?: string | Record<string, unknown>
  result?: string | Record<string, unknown>
  isError?: boolean
}

interface Turn {
  id: number
  thinkingBlocks: string[]
  toolCalls: ToolCallItem[]
  intermediateText?: string  // assistant text mid-session (not final result)
  isStreaming?: boolean
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = text.split("\n").length
  return (
    <div className="rounded-md border border-purple-500/20 overflow-hidden bg-purple-500/3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-purple-500/5 text-left transition-colors"
      >
        <Brain className="h-3 w-3 text-purple-400 shrink-0" />
        <span className="text-[11px] font-medium text-purple-300/80">Thinking</span>
        <span className="ml-1 text-[10px] text-muted-foreground/40">({lines} lines)</span>
        <span className="ml-auto text-muted-foreground/50 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <pre className="px-3 py-2.5 text-[11px] text-purple-200/60 whitespace-pre-wrap leading-relaxed bg-purple-500/5 border-t border-purple-500/10 overflow-x-auto max-h-56">
          {text}
        </pre>
      )}
    </div>
  )
}

function ToolCallBlock({ item, index }: { item: ToolCallItem; index: number }) {
  const [open, setOpen] = useState(false)
  const inputStr = typeof item.input === "object" ? JSON.stringify(item.input, null, 2) : (item.input || "")
  const resultStr = typeof item.result === "object" ? JSON.stringify(item.result, null, 2) : (item.result || "")
  return (
    <div className={cn("rounded-md border overflow-hidden", item.isError ? "border-destructive/30 bg-destructive/3" : "border-amber-500/20 bg-amber-500/3")}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/3 text-left transition-colors"
      >
        <span className={cn("flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold shrink-0", item.isError ? "bg-destructive/20 text-destructive" : "bg-amber-500/15 text-amber-400")}>
          {index + 1}
        </span>
        <Terminal className={cn("h-3 w-3 shrink-0", item.isError ? "text-destructive" : "text-amber-400")} />
        <span className="font-mono text-[11px] font-medium text-foreground/80 truncate">{item.name}</span>
        {item.isError && <span className="text-destructive text-[9px] ml-1 font-semibold uppercase">error</span>}
        <span className="ml-auto text-muted-foreground/50 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border/20 border-t border-border/20">
          {inputStr && (
            <div className="px-3 py-2 bg-black/5 dark:bg-black/20">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Input</p>
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-40 leading-relaxed">{inputStr}</pre>
            </div>
          )}
          {resultStr && (
            <div className="px-3 py-2 bg-black/3 dark:bg-black/15">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Output</p>
              <pre className={cn("text-[11px] whitespace-pre-wrap overflow-x-auto max-h-40 leading-relaxed", item.isError ? "text-destructive/80" : "text-muted-foreground")}>
                {resultStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TurnGroup({ turn, isLast }: { turn: Turn; isLast: boolean }) {
  // Live/streaming turn auto-expands; others collapsed by default
  const [open, setOpen] = useState(turn.isStreaming ?? false)
  const hasEvents = turn.thinkingBlocks.length > 0 || turn.toolCalls.length > 0

  // Summary label for collapsed state
  const summaryParts: string[] = []
  if (turn.thinkingBlocks.length > 0) summaryParts.push(`🧠 thinking`)
  turn.toolCalls.forEach(tc => summaryParts.push(`🔧 ${tc.name}`))

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/20 hover:bg-muted/30 text-left transition-colors"
      >
        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider shrink-0">
          Turn {turn.id + 1}
          {isLast && turn.isStreaming && (
            <span className="ml-2 relative inline-flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
          )}
        </span>
        <span className="text-[11px] text-muted-foreground/60 truncate flex-1">
          {summaryParts.join("  ·  ") || "—"}
        </span>
        <span className="ml-auto text-muted-foreground/40 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && hasEvents && (
        <div className="px-3 py-2 space-y-1.5 border-t border-border/30 bg-muted/5">
          {turn.thinkingBlocks.map((text, i) => (
            <ThinkingBlock key={`th-${i}`} text={text} />
          ))}
          {turn.toolCalls.map((tc, i) => (
            <ToolCallBlock key={`tc-${i}`} item={tc} index={i} />
          ))}
          {turn.intermediateText && (
            <div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2">
              <p className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1 font-semibold">Intermediate Response</p>
              <p className="text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed">{turn.intermediateText}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentResultBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/15">
        {isStreaming ? (
          <>
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">Generating…</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">Agent Result</span>
          </>
        )}
      </div>
      <div className="px-4 py-4">
        <MarkdownContent>{text}</MarkdownContent>
        {isStreaming && (
          <span className="inline-flex gap-0.5 ml-1">
            <span className="animate-bounce w-1 h-1 rounded-full bg-emerald-400 inline-block" style={{ animationDelay: "0ms" }} />
            <span className="animate-bounce w-1 h-1 rounded-full bg-emerald-400 inline-block" style={{ animationDelay: "150ms" }} />
            <span className="animate-bounce w-1 h-1 rounded-full bg-emerald-400 inline-block" style={{ animationDelay: "300ms" }} />
          </span>
        )}
      </div>
    </div>
  )
}

// ── Turn grouping logic ───────────────────────────────────────────────────────

function groupMessagesIntoTurns(messages: GatewayMessage[]): { turns: Turn[]; finalResult: string | null; finalIsStreaming: boolean } {
  const turns: Turn[] = []
  let current: Turn = { id: 0, thinkingBlocks: [], toolCalls: [] }
  const allAssistantTexts: { text: string; streaming: boolean }[] = []
  const pairedResultIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === "user") continue

    if (m.thinking) {
      current.thinkingBlocks.push(m.thinking)
      continue
    }

    if (m.role === "tool" && m.toolName) {
      const resultMsg = messages.slice(i + 1).find(
        r => r.role === "toolResult" && (r.toolCallId === m.toolCallId || r.toolCallId === m.id)
      )
      if (resultMsg?.id) pairedResultIds.add(resultMsg.id)
      current.toolCalls.push({
        name: m.toolName,
        input: m.toolInput,
        result: resultMsg?.toolResult ?? resultMsg?.content,
        isError: m.isError || resultMsg?.isError,
      })
      continue
    }

    if (m.role === "toolResult") {
      if (!pairedResultIds.has(m.id || "")) {
        current.toolCalls.push({
          name: "tool_result",
          result: m.toolResult ?? m.content,
          isError: m.isError,
        })
      }
      continue
    }

    if (m.role === "assistant") {
      const text = extractText(m.content) || m.text || ""
      if (isSystemMessage(text)) continue

      allAssistantTexts.push({ text, streaming: !!m.streaming })
      // Close turn — attach intermediate text (will be overridden if it becomes final)
      current.intermediateText = text
      current.isStreaming = !!m.streaming
      turns.push({ ...current })
      current = { id: turns.length, thinkingBlocks: [], toolCalls: [] }
    }
  }

  // Flush dangling events into a turn (streaming, no assistant response yet)
  if (current.thinkingBlocks.length > 0 || current.toolCalls.length > 0) {
    current.isStreaming = true
    turns.push({ ...current })
  }

  // Final result = last assistant text
  const lastAssistant = allAssistantTexts[allAssistantTexts.length - 1] ?? null
  const finalResult = lastAssistant?.text ?? null
  const finalIsStreaming = lastAssistant?.streaming ?? false

  // Remove intermediateText from the last turn that has it (it's shown in Result section)
  const lastTurnWithText = [...turns].reverse().find(t => t.intermediateText === finalResult)
  if (lastTurnWithText) delete lastTurnWithText.intermediateText

  return { turns, finalResult, finalIsStreaming }
}

// ── Main component ────────────────────────────────────────────────────────────

interface AgentWorkSectionProps {
  sessionKey: string
  isActive: boolean
  taskStatus?: string
  completionNoteFallback?: string   // from activity log when sessionId was lost
}

export function AgentWorkSection({ sessionKey, isActive, taskStatus, completionNoteFallback }: AgentWorkSectionProps) {
  const [messages, setMessages] = useState<GatewayMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [isLive, setIsLive] = useState(false)
  const [error, setError] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(false)

  async function fetchHistory() {
    if (!activeRef.current) return
    try {
      const res = await chatApi.getHistory(sessionKey)
      const msgs = res.messages || []
      setMessages(msgs)
      setIsLive(msgs.some(m => m.streaming))
      setError("")
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to load session")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isActive || !sessionKey) {
      setLoading(false)
      return
    }
    activeRef.current = true
    setLoading(true)
    chatApi.subscribe(sessionKey).catch(() => {})
    fetchHistory()
    const interval = taskStatus === "in_progress" ? 2000 : 5000
    pollRef.current = setInterval(fetchHistory, interval)
    return () => {
      activeRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isActive, sessionKey, taskStatus])

  useEffect(() => {
    if (isLive) bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, isLive])

  if (loading) return (
    <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Loading session…</span>
    </div>
  )

  if (error) return (
    <div className="py-8 flex flex-col items-center gap-2 text-center">
      <AlertCircle className="h-5 w-5 text-destructive/60" />
      <p className="text-sm text-destructive/70">Failed to load session</p>
      <p className="text-xs text-muted-foreground">{error}</p>
    </div>
  )

  // Fallback: no sessionId but task is done with completion note
  if (messages.length === 0 && completionNoteFallback) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-muted/20 border border-border/30">
          <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider">Completed</span>
          <span className="ml-auto text-[10px] text-amber-400/70 font-mono">session log unavailable</span>
        </div>
        <AgentResultBlock text={completionNoteFallback} isStreaming={false} />
      </div>
    )
  }

  if (messages.length === 0) return (
    <div className="py-8 text-center text-muted-foreground text-sm space-y-1">
      <Zap className="h-5 w-5 mx-auto mb-2 opacity-30" />
      <p>Agent belum mengirim response.</p>
      <p className="text-xs text-muted-foreground/50 font-mono">session: {sessionKey.slice(-12)}</p>
    </div>
  )

  const { turns, finalResult, finalIsStreaming } = groupMessagesIntoTurns(messages)
  const toolCount = turns.reduce((n, t) => n + t.toolCalls.length, 0)

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="flex items-center gap-2 py-1.5 px-3 rounded-md bg-muted/20 border border-border/30">
        {isLive ? (
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            Live
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider">
            {taskStatus === "done" || taskStatus === "in_review" ? "Completed" : "Session Replay"}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/40 font-mono">
          {turns.length > 0 && <span>{turns.length} turn{turns.length !== 1 ? "s" : ""}</span>}
          {toolCount > 0 && <span>· {toolCount} tool{toolCount !== 1 ? "s" : ""}</span>}
          <span>· {sessionKey.slice(-8)}</span>
        </span>
      </div>

      {/* Turn groups */}
      {turns.length > 0 && (
        <div className="space-y-1.5">
          {turns.map((turn, i) => (
            <TurnGroup key={turn.id} turn={turn} isLast={i === turns.length - 1} />
          ))}
        </div>
      )}

      {/* Final result */}
      {finalResult && (
        <div className="space-y-1.5">
          {turns.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-emerald-500/20" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/50">
                {taskStatus === "done" ? "Final Result" : "Result"}
              </span>
              <div className="h-px flex-1 bg-emerald-500/20" />
            </div>
          )}
          <AgentResultBlock text={finalResult} isStreaming={finalIsStreaming} />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Stage**

```bash
git add src/components/board/AgentWorkSection.tsx
```

---

## Task 6: Create `TaskDetailModal` Component

**Files:**
- Create: `src/components/board/TaskDetailModal.tsx`

This replaces `TaskDetailDrawer`. Uses `Dialog` (not `Sheet`), single-scroll layout, no tabs.

- [ ] **Step 1: Create the file**

```typescript
import React, { useEffect, useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Task, TaskActivity, Agent } from "@/types"
import { api } from "@/lib/api"
import { Zap } from "lucide-react"
import { InReviewBanner } from "./InReviewBanner"
import { AgentWorkSection } from "./AgentWorkSection"

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "🚫 Blocked",
  done: "Done",
}

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
}

interface TaskDetailModalProps {
  task: Task | null
  agents: Agent[]
  open: boolean
  isActive?: boolean
  onClose: () => void
  onUpdate: (id: string, patch: object) => Promise<void>
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">{label}</span>
      <div className="h-px flex-1 bg-border/30" />
    </div>
  )
}

export function TaskDetailModal({ task, agents, open, isActive = true, onClose, onUpdate }: TaskDetailModalProps) {
  const [activity, setActivity] = useState<TaskActivity[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [dispatchMsg, setDispatchMsg] = useState("")
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  const agent = task?.agentId ? agents.find(a => a.id === task.agentId) : null

  useEffect(() => {
    if (!task || !open) return
    setLoadingActivity(true)
    api.getTaskActivity(task.id)
      .then(r => setActivity(r.activity))
      .catch(() => setActivity([]))
      .finally(() => setLoadingActivity(false))
  }, [task?.id, open])

  async function handleDispatch() {
    if (!task) return
    setDispatching(true)
    setDispatchMsg("")
    try {
      await api.dispatchTask(task.id)
      setDispatchMsg("✓ Dispatched — agent is working")
      setTimeout(() => setDispatchMsg(""), 5000)
    } catch (e: unknown) {
      setDispatchMsg(`❌ ${(e as Error).message || "Dispatch failed"}`)
      setTimeout(() => setDispatchMsg(""), 5000)
    } finally {
      setDispatching(false)
    }
  }

  async function handleApprove() {
    if (!task) return
    setReviewSubmitting(true)
    try {
      await onUpdate(task.id, { status: "done", note: "Approved" })
    } finally {
      setReviewSubmitting(false)
    }
  }

  async function handleRequestChanges(note: string, targetStatus: "todo" | "in_progress") {
    if (!task) return
    setReviewSubmitting(true)
    try {
      await onUpdate(task.id, { status: targetStatus, note })
    } finally {
      setReviewSubmitting(false)
    }
  }

  if (!task) return null

  // Completion note fallback: used when sessionId is null but task is done with a note
  const completionNote = !task.sessionId && (task.status === "done" || task.status === "in_review")
    ? activity.find(a => a.type === "status_change" && (a.toValue === "done" || a.toValue === "in_review") && a.note)?.note
    : undefined

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl w-full max-h-[90vh] overflow-y-auto flex flex-col gap-0 p-0">
        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40 sticky top-0 bg-background z-10">
          <div className="flex items-start justify-between gap-4 pr-8">
            <DialogTitle className="text-lg font-semibold leading-snug flex-1">
              {task.title}
            </DialogTitle>
            {task.agentId && (
              <Button
                size="sm"
                variant={task.status === "in_progress" ? "outline" : "default"}
                className="h-7 text-xs gap-1 shrink-0"
                onClick={handleDispatch}
                disabled={dispatching}
              >
                <Zap className="h-3 w-3" />
                {dispatching ? "Dispatching…" : task.sessionId ? "Re-dispatch" : "Dispatch to Agent"}
              </Button>
            )}
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <Select value={task.status} onValueChange={v => onUpdate(task.id, { status: v })}>
              <SelectTrigger className="h-6 text-xs w-32 px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {task.priority && (
              <Select value={task.priority} onValueChange={v => onUpdate(task.id, { priority: v })}>
                <SelectTrigger className="h-6 text-xs w-28 px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={task.agentId || "__none__"} onValueChange={v => onUpdate(task.id, { assignTo: v === "__none__" ? null : v })}>
              <SelectTrigger className="h-6 text-xs w-36 px-2">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {agents.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.emoji || "🤖"} {a.name || a.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(task.tags || []).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs h-6">#{tag}</Badge>
            ))}
          </div>

          {/* Meta line */}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground/60">
            <span>Created {new Date(task.createdAt).toLocaleDateString()}</span>
            {task.completedAt && <span>· Completed {new Date(task.completedAt).toLocaleDateString()}</span>}
            {task.cost != null && <span>· ${task.cost.toFixed(2)}</span>}
          </div>

          {dispatchMsg && <p className="text-xs mt-1 text-muted-foreground">{dispatchMsg}</p>}
        </DialogHeader>

        {/* ── Body ── */}
        <div className="px-6 py-5 space-y-6 flex-1">

          {/* In Review Banner */}
          {task.status === "in_review" && (
            <InReviewBanner
              onApprove={handleApprove}
              onRequestChanges={handleRequestChanges}
              isSubmitting={reviewSubmitting}
            />
          )}

          {/* Description */}
          {task.description && (
            <section>
              <SectionHeader label="Description" />
              <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                {task.description}
              </p>
            </section>
          )}

          {/* Agent Work */}
          <section>
            <SectionHeader label={
              task.status === "in_progress" && task.sessionId ? "Agent Work · Live" : "Agent Work"
            } />
            {!task.sessionId && !completionNote ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-muted-foreground">Agent belum mulai bekerja pada ticket ini.</p>
                {task.agentId && (
                  <p className="text-xs text-muted-foreground/60">Klik "Dispatch to Agent" untuk mulai.</p>
                )}
              </div>
            ) : (
              <AgentWorkSection
                sessionKey={task.sessionId || ""}
                isActive={isActive && open}
                taskStatus={task.status}
                completionNoteFallback={completionNote}
              />
            )}
          </section>

          {/* Activity */}
          <section>
            <SectionHeader label="Activity" />
            {loadingActivity ? (
              <p className="text-xs text-muted-foreground/60 text-center py-4">Loading…</p>
            ) : activity.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 text-center py-4">No activity yet.</p>
            ) : (
              <div className="space-y-2">
                {activity.map(a => (
                  <div key={a.id} className="flex gap-3 text-xs">
                    <div className="w-0.5 shrink-0 bg-border/40 rounded-full mt-1 self-stretch" />
                    <div className="flex-1 min-w-0 pb-2">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-medium">
                          {a.actor === "user" ? "👤 User" : `🤖 ${a.actor}`}
                        </span>
                        {a.type === "status_change" && (
                          <span className="text-muted-foreground">
                            moved <span className="font-mono bg-muted/40 px-1 rounded">{a.fromValue}</span>
                            {" → "}
                            <span className="font-mono bg-muted/40 px-1 rounded">{a.toValue}</span>
                          </span>
                        )}
                        {a.type === "assignment" && (
                          <span className="text-muted-foreground">
                            assigned to <span className="font-medium">{a.toValue || "nobody"}</span>
                          </span>
                        )}
                        {a.type === "created" && <span className="text-muted-foreground">created ticket</span>}
                        {a.type === "comment" && <span className="text-muted-foreground">commented</span>}
                        <span className="ml-auto text-muted-foreground/50 shrink-0 tabular-nums">
                          {new Date(a.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {a.note && (
                        <p className="text-muted-foreground mt-0.5 italic text-[11px] leading-snug">
                          "{a.note}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Stage**

```bash
git add src/components/board/TaskDetailModal.tsx
```

---

## Task 7: Wire BoardPage to Use TaskDetailModal

**Files:**
- Modify: `src/pages/BoardPage.tsx`

- [ ] **Step 1: Replace import**

In `src/pages/BoardPage.tsx`, find the import of `TaskDetailDrawer` and replace with `TaskDetailModal`:

**Before:**
```typescript
import { TaskDetailDrawer } from "@/components/board/TaskDetailDrawer"
```

**After:**
```typescript
import { TaskDetailModal } from "@/components/board/TaskDetailModal"
```

- [ ] **Step 2: Replace JSX usage**

Find the `<TaskDetailDrawer` usage in the return statement and replace with `<TaskDetailModal`. The props interface is identical (`task`, `agents`, `open`, `isActive`, `onClose`, `onUpdate`):

**Before:**
```tsx
<TaskDetailDrawer
  task={detailTask}
  agents={agents}
  open={!!detailTask}
  isActive={!!detailTask}
  onClose={() => setDetailTask(null)}
  onUpdate={handleUpdate}
/>
```

**After:**
```tsx
<TaskDetailModal
  task={detailTask}
  agents={agents}
  open={!!detailTask}
  isActive={!!detailTask}
  onClose={() => setDetailTask(null)}
  onUpdate={handleUpdate}
/>
```

> **Note:** If the exact prop pattern differs in your BoardPage, match the new component's prop names: `task`, `agents`, `open`, `isActive`, `onClose`, `onUpdate`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Stage**

```bash
git add src/pages/BoardPage.tsx
```

---

## Task 8: Verify End-to-End in Browser

No automated tests configured. Manual verification checklist:

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify board columns**

Open the board page. Confirm column order is: Backlog → Todo → In Progress → **In Review** → Blocked → Done.

- [ ] **Step 3: Verify modal opens**

Click any task card. Confirm it opens as a full Dialog (not a side sheet). Confirm single-scroll layout with header, description, agent work, activity sections visible.

- [ ] **Step 4: Verify In Review banner**

Move a task to "In Review" via the status dropdown inside the modal. Confirm the amber banner appears with "Approve & Done" and "Request Changes" buttons.

- [ ] **Step 5: Verify Approve flow**

Click "Approve & Done". Confirm task moves to "Done" and banner disappears.

- [ ] **Step 6: Verify Request Changes flow**

Move task back to "In Review". Click "Request Changes". Confirm textarea + radio (Todo / In Progress) appears. Type a note and click "Send Back". Confirm task moves to the selected status.

- [ ] **Step 7: Verify Agent Work turn log**

Open a task with a completed session. Confirm the Agent Work section shows:
- Grouped turns (collapsed by default)
- Each turn header shows tool names as summary
- Expanding a turn shows thinking/tool call blocks
- Result section at bottom with markdown rendered content (not HEARTBEAT_OK)

- [ ] **Step 8: Verify dispatch message**

Dispatch a task to an agent and check the message in the gateway/session. Confirm instructions say `in_review` (not `done`) as the completion status.

---

## Task 9: Commit All Changes

- [ ] **Step 1: Final TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Review staged files**

```bash
git status
git diff --staged --stat
```

Expected staged files:
- `src/types/index.ts`
- `server/index.cjs`
- `src/pages/BoardPage.tsx`
- `src/components/board/InReviewBanner.tsx` (new)
- `src/components/board/AgentWorkSection.tsx` (new)
- `src/components/board/TaskDetailModal.tsx` (new)
- `docs/superpowers/specs/2026-04-10-ticket-detail-revamp-design.md`
- `docs/superpowers/plans/2026-04-10-ticket-detail-revamp.md`

- [ ] **Step 3: Commit** (only when user asks)

```bash
git commit -m "feat: revamp ticket detail modal with in_review workflow and turn log"
```
