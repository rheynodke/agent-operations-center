// ─── Agent Superpowers Skill Templates ─────────────────────────────────────────
// General-purpose workflow skills for any OpenClaw agent.
// Inspired by the superpowers framework (github.com/obra/superpowers), adapted
// for OpenClaw's skill injection system and MEMORY.md continuity model.

import type { SkillTemplate } from '../types'

export const SUPERPOWERS_TEMPLATES: SkillTemplate[] = [

  // ── 1. Brainstorming ─────────────────────────────────────────────────────────
  {
    id: 'sp-brainstorming',
    name: 'Brainstorming',
    slug: 'brainstorming',
    description: 'Eksplorasi ide sebelum commit ke satu pendekatan — diverge dulu, konverge kemudian',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['brainstorm', 'design', 'ideation', 'superpowers'],
    content: `---
name: brainstorming
description: "WAJIB DIGUNAKAN: Saat memulai desain fitur baru, menghadapi masalah kompleks, atau saat user meminta brainstorm, eksplorasi opsi, atau ide-ide"
---

# Brainstorming

Jangan langsung commit ke satu solusi. Eksplorasi ruang masalah dulu sebelum memilih pendekatan.

## Prinsip

**Diverge dulu, konverge kemudian.** Fase brainstorming bukan tentang mencari jawaban benar — tapi memastikan kita tidak melewatkan opsi yang lebih baik.

## Protocol

### Fase 1: Reframe Problem
Sebelum menjawab, pastikan kamu memahami masalah sebenarnya:
- Apa yang user minta? (literal)
- Apa yang sebenarnya mereka butuhkan? (underlying goal)
- Apa asumsi yang tersembunyi dalam pertanyaan mereka?
- Apakah ada cara untuk memvalidasi problem ini sebelum membangun solusi?

Tanya ke user jika ada yang belum jelas.

### Fase 2: Generate Opsi (minimal 3)
Hasilkan minimal 3 pendekatan berbeda:
- **Opsi Konservatif** — solusi sederhana, minim risiko, cepat diimplementasi
- **Opsi Optimal** — solusi terbaik untuk jangka panjang
- **Opsi Kreatif** — pendekatan tidak biasa yang mungkin jauh lebih baik

Untuk setiap opsi: jelaskan trade-off, risiko, dan kapan opsi itu paling cocok.

### Fase 3: Evaluasi & Rekomendasikan
- Bandingkan opsi secara eksplisit
- Rekomendasikan satu opsi dengan alasan yang jelas
- Sebutkan kondisi kapan opsi lain lebih tepat

### Fase 4: Konfirmasi
Sebelum lanjut ke implementasi:
- Presentasikan rekomendasi ke user
- Tunggu approval atau request untuk eksplorasi lebih lanjut
`,
  },

  // ── 2. Writing Plans ─────────────────────────────────────────────────────────
  {
    id: 'sp-writing-plans',
    name: 'Writing Plans',
    slug: 'writing-plans',
    description: 'Buat rencana implementasi yang solid sebelum mulai coding',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['planning', 'implementation', 'breakdown', 'superpowers'],
    content: `---
name: writing-plans
description: "WAJIB DIGUNAKAN: Setelah brainstorming selesai, atau saat diminta membuat plan, atau sebelum implementasi yang melibatkan lebih dari 2 file"
---

# Writing Plans

Rencana yang baik adalah dokumentasi keputusan arsitektur, bukan sekadar daftar tugas.

## Format Rencana

Tulis rencana dalam dokumen \`PLAN.md\` di workspace atau langsung di chat dengan format berikut:

\`\`\`markdown
# Plan: [Judul Fitur/Task]

## Konteks
[Kenapa ini perlu dilakukan? Apa trigger-nya?]

## Tujuan
[Apa yang ingin dicapai? Definisi "selesai" yang jelas.]

## Pendekatan
[Arsitektur atau strategi yang dipilih. Jelaskan kenapa ini dipilih vs alternatif.]

## File yang Diubah
- \`path/to/file.ts\` — [apa yang berubah]
- \`path/to/other.ts\` — [apa yang berubah]

## Langkah-langkah
1. [ ] [Task 1 — perkiraan 5-10 menit]
2. [ ] [Task 2 — perkiraan 5-10 menit]
3. [ ] [Task 3 — perkiraan 5-10 menit]

## Risiko & Mitigasi
- **Risiko**: [apa yang bisa salah]
  **Mitigasi**: [bagaimana mengatasinya]

## Test Plan
- [ ] [Apa yang perlu diuji setelah implementasi]
\`\`\`

## Aturan

- Setiap langkah harus cukup kecil untuk dikerjakan dan diverifikasi dalam satu context
- Jangan mulai eksekusi sebelum plan disetujui user
- Update plan saat ada perubahan scope — jangan biarkan plan dan realita tidak sinkron
`,
  },

  // ── 3. Executing Plans ───────────────────────────────────────────────────────
  {
    id: 'sp-executing-plans',
    name: 'Executing Plans',
    slug: 'executing-plans',
    description: 'Eksekusi plan yang sudah ada secara terstruktur, satu langkah per satu',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['execution', 'planning', 'progress', 'superpowers'],
    content: `---
name: executing-plans
description: "WAJIB DIGUNAKAN: Saat ada plan yang sudah disetujui dan saatnya eksekusi, atau saat user berkata 'lanjut', 'kerjakan', 'eksekusi plan-nya'"
---

# Executing Plans

Eksekusi plan yang terstruktur — satu langkah per satu, dengan komunikasi progress yang jelas.

## Protocol

### Sebelum Mulai
- Baca plan lengkap sekali lagi
- Identifikasi langkah pertama yang perlu dikerjakan
- Konfirmasi ke user: "Saya akan mulai dari [langkah X]. Siap?"

### Saat Eksekusi
Untuk setiap langkah:

1. **Announce** — "Mengerjakan: [deskripsi langkah]"
2. **Execute** — kerjakan langkahnya
3. **Verify** — pastikan output sesuai ekspektasi
4. **Checkpoint** — laporkan ke user: "✅ Selesai: [deskripsi]. Lanjut ke [langkah berikutnya]?"

### Jika Ada Blocking Issue
STOP segera jika:
- Langkah tidak bisa dikerjakan karena missing dependency
- Scope berubah dari plan awal
- Ada risiko yang tidak diperhitungkan sebelumnya

Laporkan ke user dan revisi plan sebelum lanjut.

### Setelah Semua Langkah Selesai
- Lakukan verification (gunakan skill \`verification-before-completion\` jika ada)
- Update plan — tandai semua langkah sebagai done
- Beri summary apa yang sudah dikerjakan
`,
  },

  // ── 4. Test-Driven Development ───────────────────────────────────────────────
  {
    id: 'sp-tdd',
    name: 'Test-Driven Development',
    slug: 'test-driven-development',
    description: 'RED-GREEN-REFACTOR cycle untuk implementasi yang aman dan teruji',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['tdd', 'testing', 'quality', 'superpowers'],
    content: `---
name: test-driven-development
description: "WAJIB DIGUNAKAN: Saat mengimplementasi fitur baru atau fix bug yang kritikal — ikuti RED-GREEN-REFACTOR cycle"
---

# Test-Driven Development

Tulis test dulu, implementasi kemudian. Ini bukan tentang coverage — tapi tentang desain yang lebih baik.

## Cycle: RED → GREEN → REFACTOR

### 🔴 RED — Tulis Test yang Gagal
1. Tentukan behavior yang diinginkan secara spesifik
2. Tulis test untuk behavior tersebut
3. Jalankan test — pastikan GAGAL dengan alasan yang benar
4. Jangan lanjut sebelum test benar-benar merah

### 🟢 GREEN — Buat Test Lulus (sesederhana mungkin)
1. Tulis kode MINIMUM yang membuat test lulus
2. Boleh ugly, boleh hardcoded — yang penting test hijau
3. Jangan tambahkan fitur yang belum ada test-nya
4. Jalankan test — pastikan LULUS

### 🔵 REFACTOR — Perbaiki Kode
1. Sekarang baru bersihkan kode — remove duplication, improve naming
2. Jalankan test lagi setelah refactor — pastikan masih hijau
3. Jangan ubah behavior saat refactoring

## Aturan Ketat

- **Tidak boleh menulis kode produksi tanpa test yang gagal terlebih dahulu**
- **Satu test, satu behavior** — test yang terlalu besar tidak efektif
- **Test harus cepat** — jika test lambat, desain mungkin kurang baik
- Jika tidak ada test framework: gunakan manual verification yang terdokumentasi

## Kapan Boleh Skip TDD

TDD bisa dimodifikasi (tapi tidak dihilangkan) untuk:
- UI/visual yang murni presentasi
- Prototype/spike untuk validasi ide
- Migration data satu kali

Untuk kasus ini: minimal tulis verification checklist dan jalankan setelah implementasi.
`,
  },

  // ── 5. Systematic Debugging ──────────────────────────────────────────────────
  {
    id: 'sp-systematic-debugging',
    name: 'Systematic Debugging',
    slug: 'systematic-debugging',
    description: 'Debug terstruktur — reproduce, isolasi, hipotesis, verifikasi, fix',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['debugging', 'bug', 'error', 'superpowers'],
    content: `---
name: systematic-debugging
description: "WAJIB DIGUNAKAN: Saat ada error, bug, exception, atau behavior yang tidak sesuai ekspektasi — STOP, ikuti protokol ini sebelum mengubah kode apapun"
---

# Systematic Debugging

Debugging yang efektif adalah proses ilmiah: observasi → hipotesis → eksperimen → kesimpulan.

## Protocol

### 1. Reproduce — Sebelum Apapun
- Konfirmasi kamu bisa trigger error yang sama secara konsisten
- Catat: exact error message, stack trace, kondisi yang memicu
- Tentukan: apakah selalu terjadi? kondisi apa? input apa?
- **Jangan sentuh kode sebelum bisa reproduce**

### 2. Isolasi Area Masalah
Persempit dari luas ke spesifik:
- Modul mana? File mana? Fungsi mana? Baris berapa?
- Teknik binary search: nonaktifkan/bypass setengah kode, cek apakah masalah masih ada
- Cari perbedaan antara "kondisi berhasil" dan "kondisi gagal"
- Gunakan logging/print strategis — jangan ubah logika dulu

### 3. Buat Hipotesis (minimal 2)
Sebelum mengubah kode apapun:
- Tulis hipotesis penyebab masalah
- Ranking dari yang paling mungkin ke paling tidak mungkin
- Untuk setiap hipotesis: apa yang harus benar jika hipotesis ini benar?
- Komunikasikan hipotesis ke user

### 4. Verifikasi Satu per Satu
- Mulai dari hipotesis paling mungkin
- Test satu hipotesis dulu, jangan ubah banyak hal sekaligus
- Jika hipotesis salah: catat apa yang dipelajari, pindah ke hipotesis berikutnya

### 5. Fix & Verify
- Setelah root cause ditemukan: tulis fix yang minimal dan tepat sasaran
- Jangan "sekalian refactor" saat bug fix — itu pekerjaan berbeda
- Jalankan test case original — pastikan error hilang
- Cek side effect: apakah ada fitur lain yang terpengaruh?
- Dokumentasikan: apa penyebabnya, kenapa terjadi, bagaimana diperbaiki

## Anti-pattern yang Harus Dihindari

- ❌ Langsung mengubah kode sebelum reproduce
- ❌ Mengganti banyak hal sekaligus
- ❌ "Coba-coba" tanpa hipotesis yang jelas
- ❌ Menganggap masalah selesai sebelum verify
`,
  },

  // ── 6. Verification Before Completion ───────────────────────────────────────
  {
    id: 'sp-verification',
    name: 'Verification Before Completion',
    slug: 'verification-before-completion',
    description: 'Checklist verifikasi sebelum menyatakan task selesai',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['verification', 'quality', 'done', 'superpowers'],
    content: `---
name: verification-before-completion
description: "WAJIB DIGUNAKAN: Sebelum menyatakan task selesai, sebelum bilang 'done', atau sebelum minta user review — jalankan checklist ini dulu"
---

# Verification Before Completion

Jangan bilang selesai sebelum benar-benar selesai. Verifikasi dulu.

## Checklist Wajib

### Fungsionalitas
- [ ] Fitur/fix yang diminta sudah bekerja sesuai ekspektasi
- [ ] Happy path sudah diuji
- [ ] Edge case utama sudah dipertimbangkan
- [ ] Tidak ada regresi pada fitur yang sudah ada

### Kode
- [ ] Kode bisa dibaca dan dipahami tanpa penjelasan
- [ ] Tidak ada kode yang tidak dipakai (dead code, commented-out code)
- [ ] Error handling sudah ada untuk skenario yang realistis
- [ ] Tidak ada hardcoded values yang seharusnya configurable

### Keamanan
- [ ] Tidak ada credentials/secrets dalam kode
- [ ] Input dari user divalidasi sebelum diproses
- [ ] Tidak ada SQL injection / command injection risk

### Konsistensi
- [ ] Naming konsisten dengan konvensi yang sudah ada
- [ ] Style dan struktur mengikuti pola yang sudah ada di codebase

## Setelah Checklist

Jika semua item centang:
- Tulis summary singkat apa yang dikerjakan
- Sebutkan jika ada item yang sengaja dilewati dan kenapa
- Baru katakan "selesai" ke user

Jika ada item yang gagal:
- Fix dulu sebelum menyatakan selesai
- Jangan lempar pekerjaan ke user kecuali benar-benar di luar scope
`,
  },

  // ── 7. Requesting Code Review ────────────────────────────────────────────────
  {
    id: 'sp-requesting-review',
    name: 'Requesting Code Review',
    slug: 'requesting-code-review',
    description: 'Siapkan perubahan sebelum minta review — buat reviewer mudah memberikan feedback',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['code-review', 'git', 'collaboration', 'superpowers'],
    content: `---
name: requesting-code-review
description: "WAJIB DIGUNAKAN: Sebelum minta review kode ke user atau orang lain — siapkan context yang cukup agar reviewer bisa bekerja efisien"
---

# Requesting Code Review

Review yang baik dimulai dari persiapan yang baik. Jangan buang waktu reviewer dengan konteks yang kurang.

## Protocol

### 1. Self-Review Dulu
Sebelum minta orang lain review, review sendiri dulu:
- Baca ulang semua perubahan dari perspektif reviewer baru
- Apakah ada yang membingungkan tanpa konteks tambahan?
- Apakah ada yang kamu sendiri tidak yakin?

### 2. Siapkan Context
Tulis ringkasan review yang mencakup:

\`\`\`
## Apa yang Berubah
[Deskripsi singkat perubahan — bukan parafrase diff]

## Kenapa Berubah
[Motivasi: bug fix? fitur baru? refactor? performance?]

## Cara Menguji
[Langkah spesifik untuk memverifikasi perubahan]

## Area yang Perlu Perhatian Khusus
[Bagian yang kamu tidak 100% yakin, atau yang paling berpengaruh]

## Yang Tidak Perlu Di-review (opsional)
[Perubahan trivial atau auto-generated yang tidak perlu diperhatikan]
\`\`\`

### 3. Pastikan Siap Di-review
- [ ] Branch up-to-date dengan main
- [ ] Tidak ada conflict yang belum diselesaikan
- [ ] Tests lulus
- [ ] Tidak ada debug code / console.log yang tertinggal
- [ ] Commit messages deskriptif

### 4. Tunjukkan, Jangan Ceritakan
Jika ada bagian kompleks: tambahkan komentar di kode (bukan dalam review description) yang menjelaskan kenapa, bukan apa.
`,
  },

  // ── 8. Safety Checkpoint ─────────────────────────────────────────────────────
  {
    id: 'sp-safety-checkpoint',
    name: 'Safety Checkpoint',
    slug: 'safety-checkpoint',
    description: 'Konfirmasi eksplisit sebelum operasi yang tidak bisa di-undo',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['safety', 'destructive', 'confirm', 'superpowers'],
    content: `---
name: safety-checkpoint
description: "WAJIB DIGUNAKAN: Sebelum melakukan operasi yang tidak bisa di-undo — hapus file/data, drop tabel, overwrite, push --force, atau deploy ke production"
---

# Safety Checkpoint

Berhenti sejenak. Operasi berisiko membutuhkan konfirmasi eksplisit — bukan asumsi bahwa user sudah tahu.

## Checklist Sebelum Eksekusi

Untuk setiap operasi berisiko, komunikasikan ke user:

1. **Apa yang akan dilakukan** — deskripsi operasi secara spesifik dan literal
2. **Data yang terpengaruh** — file apa, tabel apa, record apa, environment mana
3. **Apakah reversible?** — jika tidak, sebutkan dengan jelas
4. **Apakah ada backup?** — tanya atau verifikasi sebelum lanjut
5. **Konfirmasi eksplisit** — minta user memberikan konfirmasi sebelum eksekusi

## Template Pesan Konfirmasi

\`\`\`
⚠️ Operasi Berisiko

Saya akan [deskripsi operasi].

Yang terpengaruh:
- [item 1]
- [item 2]

Status reversibility: [bisa di-undo / TIDAK bisa di-undo]
Backup tersedia: [ya/tidak/belum dicek]

Ketik "ya" atau "lanjut" untuk konfirmasi.
\`\`\`

## Operasi yang SELALU Butuh Checkpoint

- Menghapus file atau direktori
- DROP TABLE / DELETE tanpa WHERE / TRUNCATE
- Overwrite file yang tidak ada di version control
- git push --force atau git reset --hard
- Deploy ke production / staging
- Mengubah konfigurasi server yang live
- Mengirim pesan/email/notifikasi ke external parties

## Pengecualian

Boleh tanpa checkpoint jika:
- User secara eksplisit sudah berkata "langsung [operasi], tidak perlu konfirmasi"
- Dalam konteks dry-run atau sandbox yang terisolasi
`,
  },

  // ── 9. Writing Skills ────────────────────────────────────────────────────────
  {
    id: 'sp-writing-skills',
    name: 'Writing Skills',
    slug: 'writing-skills',
    description: 'Cara menulis SKILL.md yang efektif untuk OpenClaw agents',
    agent: 'Agent Superpowers',
    agentEmoji: '⚡',
    category: 'Agent Superpowers',
    tags: ['meta', 'skill-creation', 'openclaw', 'superpowers'],
    content: `---
name: writing-skills
description: "WAJIB DIGUNAKAN: Saat diminta membuat skill baru, menulis SKILL.md, atau mendokumentasikan workflow baru untuk agent"
---

# Writing Skills

Skill yang baik bukan yang panjang — tapi yang jelas kapan digunakan dan apa yang harus dilakukan.

## Anatomi SKILL.md yang Efektif

\`\`\`yaml
---
name: nama-skill-kebab-case
description: "WAJIB DIGUNAKAN: [trigger condition yang spesifik dan aktif]"
---
\`\`\`

Diikuti oleh body markdown dengan instruksi.

## Aturan Menulis Description (Paling Kritis)

Description adalah trigger condition yang di-inject ke system prompt. Agent membacanya dan memutuskan kapan skill ini aktif.

**Aturan:**
- Mulai dengan "WAJIB DIGUNAKAN:" untuk memastikan agent serius
- Deskripsi TRIGGER, bukan deskripsi isi skill
- Spesifik: sebutkan kata kunci atau kondisi eksak
- Aktif: gunakan kalimat "Saat...", "Ketika...", "Sebelum..."

**Contoh buruk:**
> \`description: "Skill untuk debugging"\` — terlalu generik

**Contoh baik:**
> \`description: "WAJIB DIGUNAKAN: Saat ada error, bug, exception, atau behavior tidak sesuai ekspektasi"\`

## Aturan Menulis Body

1. **Mulai dengan konteks** — kenapa skill ini ada, masalah apa yang diselesaikan
2. **Tulis protokol yang bisa diikuti** — bukan opini, tapi langkah konkret
3. **Gunakan checklist** untuk verifikasi — agent bisa mencentang
4. **Sertakan contoh** jika ada yang ambigu
5. **Jangan terlalu panjang** — jika > 150 baris, pecah jadi beberapa skill

## Checklist Sebelum Publish Skill

- [ ] Description dimulai dengan "WAJIB DIGUNAKAN:"
- [ ] Trigger condition spesifik dan tidak ambigu
- [ ] Instruksi bisa diikuti tanpa penjelasan tambahan
- [ ] Tidak ada instruksi yang bertentangan satu sama lain
- [ ] Di-test dengan satu skenario nyata — apakah agent melakukan yang benar?

## Tip: Skill vs AGENTS.md

- **AGENTS.md**: aturan umum yang selalu aktif (startup ritual, memory management, personality)
- **SKILL.md**: workflow spesifik yang aktif hanya saat kondisi tertentu terpenuhi
`,
  },

]
