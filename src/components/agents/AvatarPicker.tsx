import { cn } from "@/lib/utils"
import { AVATAR_PRESETS } from "@/lib/avatarPresets"
import type { AvatarPreset } from "@/lib/avatarPresets"

interface AvatarPickerProps {
  value: string | null
  onChange: (preset: AvatarPreset) => void
  className?: string
}

export function AvatarPicker({ value, onChange, className }: AvatarPickerProps) {
  return (
    <div className={cn("grid grid-cols-4 gap-2.5", className)}>
      {AVATAR_PRESETS.map((preset) => {
        const isSelected = value === preset.id
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset)}
            title={`${preset.name} — ${preset.vibe}`}
            className={cn(
              "relative group flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all duration-200",
              isSelected
                ? "border-2 shadow-lg scale-[1.03]"
                : "border-white/10 bg-white/3 hover:bg-white/6 hover:border-white/20"
            )}
            style={
              isSelected
                ? {
                    borderColor: preset.color,
                    backgroundColor: `${preset.color}18`,
                    boxShadow: `0 0 16px ${preset.color}30`,
                  }
                : undefined
            }
          >
            {/* Avatar image */}
            <div className="w-14 h-14 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
              <img
                src={preset.file}
                alt={preset.name}
                className="w-full h-full object-cover object-top"
                loading="lazy"
              />
            </div>

            {/* Name */}
            <span
              className={cn(
                "text-[10px] font-semibold truncate w-full text-center leading-tight",
                isSelected ? "text-white" : "text-muted-foreground group-hover:text-foreground"
              )}
              style={isSelected ? { color: preset.color } : undefined}
            >
              {preset.name}
            </span>

            {/* Selected ring indicator */}
            {isSelected && (
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                style={{ backgroundColor: preset.color }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
