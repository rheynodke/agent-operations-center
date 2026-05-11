import { cn } from "@/lib/utils"

interface KeyboardShortcutProps {
  keys: string[]
  className?: string
}

const KEY_LABELS_MAC: Record<string, string> = {
  cmd: "⌘",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  ctrl: "⌃",
  enter: "↵",
  esc: "esc",
  tab: "⇥",
  backspace: "⌫",
}

const KEY_LABELS_OTHER: Record<string, string> = {
  cmd: "Ctrl",
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  enter: "Enter",
  esc: "Esc",
  tab: "Tab",
  backspace: "Backspace",
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false
  return navigator.platform.toUpperCase().includes("MAC")
}

export function KeyboardShortcut({ keys, className }: KeyboardShortcutProps) {
  const labels = isMac() ? KEY_LABELS_MAC : KEY_LABELS_OTHER
  return (
    <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
      {keys.map((key, idx) => (
        <kbd
          key={idx}
          className="px-1.5 py-0.5 rounded border border-border bg-muted text-foreground text-[11px] font-mono font-medium leading-none shadow-sm"
        >
          {labels[key.toLowerCase()] ?? key.toUpperCase()}
        </kbd>
      ))}
    </span>
  )
}
