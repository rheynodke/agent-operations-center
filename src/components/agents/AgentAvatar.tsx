/**
 * AgentAvatar
 * Renders the mascot image when `avatarPresetId` is set,
 * otherwise falls back to the agent emoji in a subtle dark pill.
 *
 * Background is always transparent/dark — no white bg.
 * Emoji size is auto-derived from the numeric part of the size class.
 */
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import { cn } from "@/lib/utils"

interface AgentAvatarProps {
  avatarPresetId?: string | null
  emoji?: string
  /** Tailwind size classes, e.g. "w-12 h-12" */
  size?: string
  className?: string
}

/** Map w-N → reasonable emoji text-size class */
function emojiSizeClass(size: string): string {
  const match = size.match(/w-(\d+)/)
  const n = match ? parseInt(match[1], 10) : 12
  if (n <= 6) return "text-base"
  if (n <= 8) return "text-lg"
  if (n <= 10) return "text-xl"
  if (n <= 12) return "text-2xl"
  if (n <= 16) return "text-3xl"
  return "text-4xl"
}

export function AgentAvatar({
  avatarPresetId,
  emoji,
  size = "w-12 h-12",
  className,
}: AgentAvatarProps) {
  const preset = avatarPresetId
    ? AVATAR_PRESETS.find(p => p.id === avatarPresetId)
    : null

  if (preset) {
    return (
      <div
        className={cn(size, "rounded-xl overflow-hidden shrink-0", className)}
        style={{ background: "transparent" }}
      >
        <img
          src={preset.file}
          alt={preset.name}
          className="w-full h-full object-contain"
          draggable={false}
        />
      </div>
    )
  }

  // Emoji fallback — subtle dark bg, properly sized
  const textSize = emojiSizeClass(size)
  return (
    <div
      className={cn(
        size,
        "rounded-xl flex items-center justify-center shrink-0 bg-white/5 ring-1 ring-white/8",
        className
      )}
    >
      <span className={cn("leading-none select-none", textSize)}>
        {emoji || "🤖"}
      </span>
    </div>
  )
}
