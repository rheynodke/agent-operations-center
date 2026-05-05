import { cn } from '@/lib/utils'
import { AVATAR_PRESETS } from '@/lib/avatarPresets'
import type { AvatarPreset } from '@/lib/avatarPresets'

interface CompactAvatarPickerProps {
  value: string | null
  onChange: (preset: AvatarPreset) => void
  className?: string
}

export function CompactAvatarPicker({ value, onChange, className }: CompactAvatarPickerProps) {
  return (
    <div className={cn('grid grid-cols-8 gap-1.5', className)}>
      {AVATAR_PRESETS.map((preset) => {
        const isSelected = value === preset.id
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset)}
            title={`${preset.name} — ${preset.vibe}`}
            className={cn(
              'relative group flex flex-col items-center p-1 rounded-xl border transition-all duration-200',
              isSelected
                ? 'border-2 shadow-md scale-[1.03]'
                : 'border-white/10 bg-white/3 hover:bg-white/6 hover:border-white/20',
            )}
            style={
              isSelected
                ? {
                    borderColor: preset.color,
                    backgroundColor: `${preset.color}18`,
                    boxShadow: `0 0 10px ${preset.color}30`,
                  }
                : undefined
            }
          >
            {/* Avatar image */}
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
              <img
                src={preset.file}
                alt={preset.name}
                className="w-full h-full object-cover object-top"
                loading="lazy"
              />
            </div>

            {/* Selected color indicator dot */}
            {isSelected && (
              <span
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: preset.color }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
