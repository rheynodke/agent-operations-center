import React, { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Wand2, X, StopCircle, CornerDownLeft } from "lucide-react"
import { useAuthStore } from "@/stores"

// ── Streaming helper ──────────────────────────────────────────────────────────

export async function streamAiGenerate(
  params: {
    prompt: string
    currentContent: string
    fileType: string
    agentName?: string
    agentId?: string
    extraContext?: string
  },
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  signal: AbortSignal,
) {
  const token = useAuthStore.getState().token

  console.log("[AI] fetch start, token:", token ? "ok" : "MISSING")
  let res: Response
  try {
    res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
      signal,
    })
    console.log("[AI] fetch response:", res.status, res.headers.get("content-type"))
  } catch (e: unknown) {
    const msg = (e as Error).message || "Network error"
    console.error("[AI] fetch error:", (e as Error).name, msg)
    // Show AbortError too so user sees something
    onError(`${(e as Error).name}: ${msg}`)
    return
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status} ${res.statusText}` }))
    console.error("[AI] HTTP error:", res.status, err)
    onError(err.error || `HTTP ${res.status}`)
    return
  }

  if (!res.body) { onError("No response body"); return }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let chunkCount = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { console.log("[AI] stream done after", chunkCount, "chunks"); break }
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split("\n\n")
      buf = parts.pop()!
      for (const part of parts) {
        if (!part.startsWith("data: ")) continue
        try {
          const data = JSON.parse(part.slice(6))
          if (data.error) { console.error("[AI] server error:", data.error); onError(data.error); return }
          if (data.done) { console.log("[AI] server done after", chunkCount, "chunks"); onDone(); return }
          if (data.text) { chunkCount++; onChunk(data.text) }
        } catch {}
      }
    }
  } catch (e: unknown) {
    console.error("[AI] reader error:", (e as Error).name, (e as Error).message)
    onError(`Stream error: ${(e as Error).message}`)
    return
  } finally {
    reader.releaseLock()
  }
  onDone()
}

// ── AiAssistPanel ─────────────────────────────────────────────────────────────

export function AiAssistPanel({
  fileType,
  currentContent,
  agentName,
  agentId,
  extraContext,
  placeholder,
  onApply,
  onClose,
}: {
  fileType: string
  currentContent: string
  agentName?: string
  agentId?: string
  extraContext?: string
  placeholder?: string
  onApply: (content: string) => void
  onClose: () => void
}) {
  const [prompt, setPrompt] = useState("")
  const [generated, setGenerated] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const previewRef = useRef<HTMLPreElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { promptRef.current?.focus() }, [])

  useEffect(() => {
    if (streaming && previewRef.current) {
      previewRef.current.scrollTop = previewRef.current.scrollHeight
    }
  }, [generated, streaming])

  async function handleGenerate() {
    if (!prompt.trim() || streaming) return
    setGenerated("")
    setDone(false)
    setError("")
    setStreaming(true)

    abortRef.current = new AbortController()
    try {
      await streamAiGenerate(
        { prompt, currentContent, fileType, agentName, agentId, extraContext },
        (chunk) => setGenerated(prev => prev + chunk),
        () => { setStreaming(false); setDone(true) },
        (msg) => { setError(msg); setStreaming(false) },
        abortRef.current.signal,
      )
    } catch (e: unknown) {
      const err = e as Error
      console.error("[AI] handleGenerate catch:", err.name, err.message)
      setError(`${err.name}: ${err.message}`)
      setStreaming(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setStreaming(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      handleGenerate()
    }
  }

  const defaultPlaceholder = fileType === "SKILL.md"
    ? `Describe the skill… (e.g. "Greet the user when they say hello, reply with a fun message")`
    : fileType === "script"
    ? `Describe the script… (e.g. "Check disk usage and alert if over 80%")`
    : `Describe what you want… (e.g. "Make this agent more focused on DevOps tasks")`

  return (
    <div className="border-t border-violet-500/20 bg-violet-500/3 flex flex-col shrink-0" style={{ maxHeight: "55%" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-violet-500/15 shrink-0">
        <Wand2 className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-[11px] font-bold text-violet-400 uppercase tracking-wider">AI Assist</span>
        {streaming && (
          <span className="flex items-center gap-1 text-[10px] text-violet-400/60">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Generating…
          </span>
        )}
        <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-foreground/5 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3 overflow-hidden flex-1 min-h-0">
        {/* Prompt input */}
        <div className="flex gap-2 items-end shrink-0">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || defaultPlaceholder}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-violet-500/25 bg-background/60 px-3 py-2 text-[12px] font-mono text-foreground/90 placeholder:text-muted-foreground/40 outline-none focus:border-violet-500/50 transition-colors leading-relaxed"
          />
          {streaming ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/25 text-[11px] text-red-400 font-bold hover:bg-red-500/25 transition-colors shrink-0"
            >
              <StopCircle className="w-3.5 h-3.5" /> Stop
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/20 border border-violet-500/30 text-[11px] text-violet-300 font-bold hover:bg-violet-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Generate
              <span className="text-[9px] text-violet-400/50 ml-0.5">⌘↵</span>
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 shrink-0">
            {error}
          </div>
        )}

        {/* Generated preview */}
        {(generated || streaming) && (
          <div className="flex flex-col gap-1.5 flex-1 min-h-0">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-semibold">Preview</span>
              {done && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setGenerated(""); setDone(false); setPrompt("") }}
                    className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-foreground/5"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => onApply(generated)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-[11px] text-emerald-400 font-bold hover:bg-emerald-500/30 transition-colors"
                  >
                    <CornerDownLeft className="w-3 h-3" /> Apply to editor
                  </button>
                </div>
              )}
            </div>
            <pre
              ref={previewRef}
              className={cn(
                "flex-1 overflow-auto rounded-lg border border-violet-500/15 bg-background/60 p-3 text-[11.5px] font-mono text-foreground/70 leading-relaxed whitespace-pre-wrap",
              )}
            >
              {generated}
              {streaming && <span className="inline-block w-1.5 h-3.5 bg-violet-400 animate-pulse ml-0.5 align-middle" />}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
