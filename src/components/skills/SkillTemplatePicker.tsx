import { cn } from "@/lib/utils"

// ── Template definitions ──────────────────────────────────────────────────────

export interface SkillTemplate {
  id: string
  name: string
  icon: string
  badge?: string
  description: string
  category: "workflow" | "communication" | "safety" | "blank"
  suggestedSlug: string
  suggestedDescription: string
  /** Full SKILL.md content. {slug}, {name}, {description} are replaced at creation time. */
  content: string
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    icon: "📄",
    description: "Start from scratch",
    category: "blank",
    suggestedSlug: "",
    suggestedDescription: "",
    content: [
      `---`,
      `name: {slug}`,
      `description: "{description}"`,
      `---`,
      ``,
      `# {name}`,
      ``,
      `## Instructions`,
      ``,
      `Describe what this skill does and how the agent should use it.`,
      ``,
    ].join("\n"),
  },
  {
    id: "greeting-protocol",
    name: "Greeting Protocol",
    icon: "👋",
    badge: "Communication",
    description: "Greet users warmly at session start",
    category: "communication",
    suggestedSlug: "greeting-protocol",
    suggestedDescription: "WAJIB DIGUNAKAN: Saat user memulai percakapan baru atau mengucapkan salam",
    content: [
      `---`,
      `name: greeting-protocol`,
      `description: "WAJIB DIGUNAKAN: Saat user memulai percakapan baru, mengucapkan salam, atau berkata 'halo', 'hi', 'hai', 'hello'"`,
      `---`,
      ``,
      `# Greeting Protocol`,
      ``,
      `Cara menyambut user di awal percakapan dengan hangat dan personal.`,
      ``,
      `## Instructions`,
      ``,
      `Saat user pertama kali memulai percakapan atau mengucapkan salam:`,
      ``,
      `1. Baca \`MEMORY.md\` terlebih dahulu untuk konteks terkini tentang user`,
      `2. Sambut user dengan hangat — gunakan nama mereka jika diketahui`,
      `3. Sebutkan secara singkat apa yang sedang dikerjakan atau diingat dari sesi terakhir`,
      `4. Tanya apa yang ingin mereka kerjakan hari ini`,
      ``,
      `Jadilah natural seperti rekan kerja yang sudah kenal, bukan robot formal.`,
      ``,
    ].join("\n"),
  },
  {
    id: "systematic-debugging",
    name: "Systematic Debugging",
    icon: "🔍",
    badge: "Workflow",
    description: "Debug step-by-step before touching any code",
    category: "workflow",
    suggestedSlug: "systematic-debugging",
    suggestedDescription: "WAJIB DIGUNAKAN: Saat ada error, bug, atau behavior yang tidak sesuai ekspektasi",
    content: [
      `---`,
      `name: systematic-debugging`,
      `description: "WAJIB DIGUNAKAN: Saat ada error, bug, exception, atau behavior yang tidak sesuai ekspektasi — STOP, ikuti protokol ini sebelum mengubah kode apapun"`,
      `---`,
      ``,
      `# Systematic Debugging`,
      ``,
      `Protokol debugging terstruktur agar tidak menebak-nebak dan langsung merusak kode.`,
      ``,
      `## Protocol`,
      ``,
      `### 1. Reproduce Dulu`,
      `- Konfirmasi kamu bisa trigger error yang sama`,
      `- Catat exact error message, stack trace, atau behavior yang salah`,
      `- Jangan lanjut sebelum bisa reproduce secara konsisten`,
      ``,
      `### 2. Isolasi Area Masalah`,
      `- Persempit: modul mana? fungsi mana? kondisi apa?`,
      `- Gunakan binary search: nonaktifkan sebagian kode, cek apakah masalah masih ada`,
      `- Cari perbedaan antara "kondisi berhasil" dan "kondisi gagal"`,
      ``,
      `### 3. Buat Hipotesis`,
      `- Tulis minimal 2 hipotesis penyebab masalah SEBELUM mengubah kode`,
      `- Ranking dari yang paling mungkin`,
      `- Komunikasikan hipotesis ke user`,
      ``,
      `### 4. Verifikasi Satu per Satu`,
      `- Test satu hipotesis dulu, dari yang paling mungkin`,
      `- Jangan ubah banyak hal sekaligus`,
      ``,
      `### 5. Fix & Verify`,
      `- Setelah fix: pastikan error original sudah hilang`,
      `- Cek side effect ke fitur lain`,
      `- Dokumentasikan root cause dan solusi`,
      ``,
    ].join("\n"),
  },
  {
    id: "planning-first",
    name: "Planning First",
    icon: "📋",
    badge: "Workflow",
    description: "Write a plan and get approval before implementing",
    category: "workflow",
    suggestedSlug: "planning-first",
    suggestedDescription: "WAJIB DIGUNAKAN: Saat diminta membuat fitur baru, refactor besar, atau implementasi yang melibatkan lebih dari 2 file",
    content: [
      `---`,
      `name: planning-first`,
      `description: "WAJIB DIGUNAKAN: Saat diminta membuat fitur baru, refactor besar, atau implementasi yang melibatkan lebih dari 2 file — buat rencana dulu sebelum coding"`,
      `---`,
      ``,
      `# Planning First`,
      ``,
      `Jangan langsung coding. Buat rencana yang jelas, konfirmasi dengan user, baru eksekusi.`,
      ``,
      `## Protocol`,
      ``,
      `### 1. Pahami Kebutuhan`,
      `- Tanya jika ada hal yang belum jelas`,
      `- Konfirmasi scope: apa yang MASUK dan apa yang TIDAK MASUK`,
      `- Identifikasi constraint atau dependensi`,
      ``,
      `### 2. Tulis Rencana`,
      `Buat dokumen singkat yang mencakup:`,
      `- **Tujuan**: apa yang ingin dicapai`,
      `- **Pendekatan**: arsitektur atau strategi yang digunakan`,
      `- **File yang diubah**: list semua file yang perlu dimodifikasi`,
      `- **Langkah-langkah**: breakdown menjadi task kecil (5–15 menit tiap task)`,
      `- **Risiko**: apa yang bisa salah?`,
      ``,
      `### 3. Konfirmasi dengan User`,
      `- Presentasikan rencana sebelum mulai coding`,
      `- Tunggu approval atau feedback`,
      `- Jangan eksekusi tanpa persetujuan eksplisit`,
      ``,
      `### 4. Eksekusi Bertahap`,
      `- Kerjakan satu langkah, laporkan progress, lanjutkan`,
      `- Tandai langkah yang sudah selesai`,
      `- Jika ada blocking issue, berhenti dan konsultasikan`,
      ``,
    ].join("\n"),
  },
  {
    id: "memory-ritual",
    name: "Memory Ritual",
    icon: "🧠",
    badge: "Workflow",
    description: "Save context to memory files at session end",
    category: "workflow",
    suggestedSlug: "memory-ritual",
    suggestedDescription: "WAJIB DIGUNAKAN: Di akhir sesi yang produktif atau saat user mengucapkan perpisahan",
    content: [
      `---`,
      `name: memory-ritual`,
      `description: "WAJIB DIGUNAKAN: Di akhir sesi yang produktif, saat user berkata 'selesai', 'udah', 'makasih', 'bye', atau akan menutup chat"`,
      `---`,
      ``,
      `# Memory Ritual`,
      ``,
      `Ritual akhir sesi untuk memastikan konteks penting tersimpan dan tidak hilang.`,
      ``,
      `## Protocol`,
      ``,
      `### 1. Tulis Daily Note`,
      `Buat atau update \`memory/YYYY-MM-DD-{deskripsi-singkat}.md\` dengan:`,
      `- Apa yang dikerjakan hari ini (ringkas tapi lengkap)`,
      `- Keputusan penting yang dibuat`,
      `- Problem yang ditemukan dan solusinya`,
      `- Context yang berguna untuk sesi berikutnya`,
      ``,
      `### 2. Update MEMORY.md (jika ada yang penting)`,
      `Jika ada hal yang layak diingat jangka panjang:`,
      `- Preferensi atau kebiasaan user yang baru diketahui`,
      `- Pelajaran penting dari kesalahan`,
      `- Keputusan arsitektur yang perlu diingat`,
      `- Info tentang project yang tidak ada di codebase`,
      ``,
      `### 3. Pamit dengan Ramah`,
      `Beri summary singkat: "Hari ini kita sudah [X, Y, Z]. Sampai jumpa!"`,
      ``,
    ].join("\n"),
  },
  {
    id: "safety-checkpoint",
    name: "Safety Checkpoint",
    icon: "🛡️",
    badge: "Safety",
    description: "Confirm before any irreversible or destructive operation",
    category: "safety",
    suggestedSlug: "safety-checkpoint",
    suggestedDescription: "WAJIB DIGUNAKAN: Sebelum operasi yang tidak bisa di-undo — hapus file, drop database, push force, atau deploy production",
    content: [
      `---`,
      `name: safety-checkpoint`,
      `description: "WAJIB DIGUNAKAN: Sebelum melakukan operasi yang tidak bisa di-undo — hapus file, drop database, overwrite data, push --force, atau deploy ke production"`,
      `---`,
      ``,
      `# Safety Checkpoint`,
      ``,
      `Berhenti sejenak dan konfirmasi ke user sebelum melakukan sesuatu yang tidak bisa dibatalkan.`,
      ``,
      `## Checklist`,
      ``,
      `Sebelum eksekusi operasi berisiko, komunikasikan ke user:`,
      ``,
      `1. **Apa yang akan dilakukan**: jelaskan operasi secara spesifik`,
      `2. **Data yang terpengaruh**: file apa, tabel apa, environment mana?`,
      `3. **Apakah ada backup?**: tanya atau cek dulu sebelum lanjut`,
      `4. **Apakah bisa di-undo?**: sebutkan dengan jelas jika tidak bisa`,
      `5. **Konfirmasi eksplisit**: minta user ketik konfirmasi sebelum eksekusi`,
      ``,
      `## Contoh Kalimat`,
      ``,
      `"Saya akan menghapus \`tabel users_backup\` di database production. Operasi ini **tidak bisa di-undo**.",`,
      `"Apakah kamu sudah memastikan data ini tidak diperlukan lagi? Ketik 'lanjut' untuk konfirmasi."`,
      ``,
    ].join("\n"),
  },
]

// ── Badge + category color maps ───────────────────────────────────────────────

const CARD_BORDER: Record<string, string> = {
  blank:         "border-border/50",
  workflow:      "border-blue-500/20",
  communication: "border-green-500/20",
  safety:        "border-amber-500/20",
}

const BADGE_COLOR: Record<string, string> = {
  Workflow:      "bg-blue-500/10 text-blue-400",
  Communication: "bg-green-500/10 text-green-400",
  Safety:        "bg-amber-500/10 text-amber-400",
}

// ── SkillTemplatePicker ───────────────────────────────────────────────────────

interface SkillTemplatePickerProps {
  /** Called when user picks a template (including Blank) */
  onSelect: (template: SkillTemplate) => void
  /** Called for the footer "Browse ADLC Templates" link */
  onBrowseAdlc?: () => void
}

export function SkillTemplatePicker({ onSelect, onBrowseAdlc }: SkillTemplatePickerProps) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Pick a template to pre-fill your skill, or start blank and write from scratch.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {SKILL_TEMPLATES.map(tpl => (
          <button
            key={tpl.id}
            onClick={() => onSelect(tpl)}
            className={cn(
              "flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left",
              "bg-foreground/2 hover:bg-foreground/5 transition-all hover:scale-[1.02] active:scale-[0.98]",
              CARD_BORDER[tpl.category],
            )}
          >
            <div className="flex items-center gap-1.5 w-full">
              <span className="text-lg leading-none">{tpl.icon}</span>
              {tpl.badge && (
                <span className={cn("ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full", BADGE_COLOR[tpl.badge])}>
                  {tpl.badge}
                </span>
              )}
            </div>
            <span className="text-[11px] font-bold text-foreground leading-tight">{tpl.name}</span>
            <span className="text-[10px] text-muted-foreground/70 leading-snug">{tpl.description}</span>
          </button>
        ))}
      </div>

      {onBrowseAdlc && (
        <button
          onClick={onBrowseAdlc}
          className="w-full py-2 rounded-xl border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-foreground/3 transition-colors"
        >
          Browse ADLC Templates →
        </button>
      )}
    </div>
  )
}
