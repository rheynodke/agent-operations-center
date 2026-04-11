import React, { useState } from "react"
import { cn } from "@/lib/utils"

const STEPS = [
  { num: 1, text: "Buka console.cloud.google.com → buat / pilih project" },
  { num: 2, text: 'APIs & Services → Library → "Google Sheets API" → Enable' },
  { num: 3, text: 'Credentials → + Create Credentials → Service Account → isi nama' },
  { num: 4, text: 'Klik service account → Keys → Add Key → JSON → Download file' },
  { num: 5, text: 'Copy email SA → buka spreadsheet → Share → paste email → Editor' },
]

export function CredentialGuide() {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-md border border-border/40 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary/70 shrink-0">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
          </svg>
          Cara mendapatkan credentials
        </span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={cn("text-muted-foreground/60 transition-transform duration-150 shrink-0", open && "rotate-180")}
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div className="border-t border-border/40 px-2.5 py-2 space-y-1.5 bg-muted/10">
          {STEPS.map(s => (
            <div key={s.num} className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {s.num}
              </span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{s.text}</p>
            </div>
          ))}
          <div className="flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5 mt-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <p className="text-[10px] text-amber-300/80 leading-relaxed">
              Share spreadsheet ke email SA dengan akses <strong>Editor</strong> agar push status bisa berjalan.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
