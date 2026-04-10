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
    <div className={cn("rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden")}>
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
            <button onClick={handleCancel} className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
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
