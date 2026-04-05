export interface AvatarPreset {
  id: string
  name: string
  file: string      // public URL path
  color: string     // matching accent hex
  vibe: string      // personality hint
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "emerald",  name: "Evergreen",  file: "/avatars/bot-emerald.png",  color: "#10b981", vibe: "Confident & helpful" },
  { id: "violet",   name: "Oracle",     file: "/avatars/bot-violet.png",   color: "#8b5cf6", vibe: "Wise & mysterious" },
  { id: "amber",    name: "Sparky",     file: "/avatars/bot-amber.png",    color: "#f59e0b", vibe: "Energetic & playful" },
  { id: "rose",     name: "Rosie",      file: "/avatars/bot-rose.png",     color: "#f43f5e", vibe: "Friendly & cheerful" },
  { id: "teal",     name: "Nexus",      file: "/avatars/bot-teal.png",     color: "#14b8a6", vibe: "Focused & precise" },
  { id: "orange",   name: "Blaze",      file: "/avatars/bot-orange.png",   color: "#f97316", vibe: "Bold & decisive" },
  { id: "slate",    name: "Shadow",     file: "/avatars/bot-slate.png",    color: "#475569", vibe: "Serious & stealthy" },
  { id: "gold",     name: "Lumi",       file: "/avatars/bot-gold.png",     color: "#eab308", vibe: "Creative & bright" },
  { id: "cyan",     name: "Flux",       file: "/avatars/bot-cyan.png",     color: "#06b6d4", vibe: "Technical & cyber" },
  { id: "red",      name: "Titan",      file: "/avatars/bot-red.png",      color: "#dc2626", vibe: "Powerful & bold" },
  { id: "midnight", name: "Cosmos",     file: "/avatars/bot-midnight.png", color: "#1e3a8a", vibe: "Mysterious & cosmic" },
  { id: "copper",   name: "Archie",     file: "/avatars/bot-copper.png",   color: "#b45309", vibe: "Wise & experienced" },
  { id: "lime",     name: "Zippy",      file: "/avatars/bot-lime.png",     color: "#84cc16", vibe: "Eager & eager" },
  { id: "sky",      name: "Callisto",   file: "/avatars/bot-sky.png",      color: "#0ea5e9", vibe: "Calm & analytical" },
  { id: "indigo",   name: "Cipher",     file: "/avatars/bot-indigo.png",   color: "#6366f1", vibe: "Strategic & cool" },
  { id: "fuchsia",  name: "Nova",       file: "/avatars/bot-fuchsia.png",  color: "#c026d3", vibe: "Epic & dramatic" },
]
