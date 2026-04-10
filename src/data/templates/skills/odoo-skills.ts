// ─── Odoo Skills Skill Templates ──────────────────────────────────────────
// Uses odoocli — Python CLI for Odoo 17 via XML-RPC
// Config: ~/.odoocli.toml | Session cache: ~/.odoocli-session.json
// Entry: odoocli [--profile PROFILE] COMMAND [SUBCOMMAND] [OPTIONS]

import type { SkillTemplate } from '../types'

export const ODOO_SKILL_TEMPLATES: SkillTemplate[] = [

  {
    id: 'odoo-daily-check',
    name: 'Odoo Daily Check',
    slug: 'odoo-daily-check',
    description: 'Cek kesehatan project Odoo setiap pagi — insight overdue, stale task, dan status timesheet hari ini',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'daily', 'insight', 'heartbeat', 'dke'],
    content: `---
name: odoo-daily-check
description: "WAJIB DIGUNAKAN: Setiap pagi atau heartbeat harian — cek status project Odoo, overdue tasks, stale tasks, dan apakah timesheet sudah diisi hari ini."
---

# Odoo Daily Check Skill
> **PREREQUISITE:** Baca \`../odoocli/SKILL.md\` untuk auth, config, command reference, dan pola penggunaan odoocli. Jalankan \`which odoocli\` untuk pastikan binary tersedia.


Cek kondisi project Odoo setiap pagi menggunakan \`odoocli insight daily\`.

## Kapan Digunakan

- Heartbeat pagi (setiap hari kerja)
- User menyebut "cek odoo", "ada apa di odoo", "status project hari ini"
- Sebelum mulai kerja untuk tahu prioritas

## Instruksi

### 1. Jalankan Daily Insight

\`\`\`bash
odoocli insight daily --my -j
\`\`\`

Output JSON berisi:
- \`timesheet_today\`: apakah sudah log jam hari ini?
- \`timesheet_yesterday\`: apakah kemarin ada yang lupa diisi?
- \`overdue_tasks\`: task yang sudah melewati deadline
- \`stale_tasks\`: task in-progress yang tidak diupdate > 3 hari
- \`in_progress_tasks\`: task yang sedang aktif dikerjakan

### 2. Analisa dan Prioritaskan

Berdasarkan hasil insight:

**Jika ada overdue tasks** → Flag ke user, tanya apakah masih relevan atau perlu reschedule

**Jika timesheet kosong** → Ingatkan user untuk log jam sebelum hari berakhir

**Jika ada stale tasks** → Tanyakan update status, apakah blocked atau selesai?

**Jika workload normal** → Tampilkan task-task in-progress untuk daily planning

### 3. Format Ringkasan

Sampaikan dalam format ringkas:

---
🟣 **Odoo Daily Check** — [hari, tanggal]

📋 **In Progress ([N] tasks):**
- [task name] — [project]

⚠️ **Overdue ([N] tasks):**
- [task name] — deadline [tanggal]

⏳ **Stale Tasks ([N] tasks, >3 hari tidak update):**
- [task name] — last update [tanggal]

⏱️ **Timesheet hari ini:** [Sudah diisi X jam / Belum ada log]
---

### 4. Jika Butuh Detail Task

\`\`\`bash
odoocli task view TASK_ID -j
\`\`\`

### 5. Cek Overdue Lebih Detail

\`\`\`bash
odoocli insight overdue --my -j
odoocli insight stale --days 3 --my -j
\`\`\`
`,
  },

  {
    id: 'odoo-timesheet-log',
    name: 'Odoo Timesheet Logger',
    slug: 'odoo-timesheet-log',
    description: 'Log jam kerja ke Odoo ketika user menyebut selesai mengerjakan sesuatu atau minta catat waktu',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'timesheet', 'logging', 'dke'],
    content: `---
name: odoo-timesheet-log
description: "WAJIB DIGUNAKAN: Ketika user menyebut selesai mengerjakan task, minta log jam, atau catat waktu kerja ke Odoo. Termasuk frasa seperti 'catat 2 jam', 'log ke odoo', 'timesheet', 'udah selesai X jam'."
---

# Odoo Timesheet Logger Skill
> **PREREQUISITE:** Baca \`../odoocli/SKILL.md\` untuk auth, config, command reference, dan pola penggunaan odoocli. Jalankan \`which odoocli\` untuk pastikan binary tersedia.


Log jam kerja ke Odoo Timesheet menggunakan \`odoocli timesheet log\`.

## Kapan Digunakan

- User menyebut "catat jam", "log timesheet", "udah kerja X jam"
- User bilang selesai mengerjakan sesuatu dan minta dicatat
- Akhir hari sebagai reminder untuk isi timesheet

## Instruksi

### 1. Kumpulkan Informasi yang Dibutuhkan

Sebelum log, pastikan ada:
- **Task ID atau nama task** → apa yang dikerjakan?
- **Jumlah jam** → berapa lama?
- **Deskripsi** → apa yang dilakukan (singkat)
- **Tanggal** → hari ini atau tanggal spesifik?

Jika informasi kurang, tanya ke user secara natural:
> "Mau log ke task mana? Dan sudah berapa jam?"

### 2. Cari Task Jika Belum Ada ID

Jika user menyebut nama task (bukan ID):
\`\`\`bash
odoocli task search "nama task" -j
\`\`\`

Tampilkan hasil dan minta user konfirmasi task yang dimaksud.

### 3. Cek Task Details (Opsional)

\`\`\`bash
odoocli task view TASK_ID -j
\`\`\`

Pastikan task ada di project yang benar.

### 4. Log Timesheet

\`\`\`bash
odoocli timesheet log \\
  --task-id TASK_ID \\
  --hours JAM \\
  --desc "Deskripsi singkat apa yang dikerjakan" \\
  --date YYYY-MM-DD
\`\`\`

Contoh:
\`\`\`bash
odoocli timesheet log --task-id 123 --hours 2.5 --desc "Fix bug login flow, testing" --date 2026-04-09
\`\`\`

### 5. Konfirmasi ke User

Setelah berhasil log:
> ✅ Timesheet dicatat: **2.5 jam** untuk task "[nama task]" — [tanggal]

### 6. Cek Summary Hari Ini

\`\`\`bash
odoocli timesheet list --today --my -j
\`\`\`

Informasikan total jam yang sudah dilog hari ini.

## Error Handling

- **Task tidak ditemukan** → Cari ulang atau tanya ID yang benar
- **Jam tidak valid** → Harus angka, bisa desimal (1.5 = 1 jam 30 menit)
- **Auth error** → Jalankan \`odoocli auth test\` untuk cek koneksi
`,
  },

  {
    id: 'odoo-task-update',
    name: 'Odoo Task Status Updater',
    slug: 'odoo-task-update',
    description: 'Update status/stage task di Odoo ketika progress berubah — in progress, done, review, dll',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'task', 'update', 'stage', 'dke'],
    content: `---
name: odoo-task-update
description: "WAJIB DIGUNAKAN: Ketika user menyebut progress task berubah — mulai kerjakan, selesai, perlu review, atau pindah stage. Frasa: 'task X selesai', 'pindahin ke done', 'mulai kerjakan', 'mark as done'."
---

# Odoo Task Status Updater Skill
> **PREREQUISITE:** Baca \`../odoocli/SKILL.md\` untuk auth, config, command reference, dan pola penggunaan odoocli. Jalankan \`which odoocli\` untuk pastikan binary tersedia.


Update stage/status task di Odoo menggunakan \`odoocli task update\`.

## Kapan Digunakan

- User bilang task selesai, mulai dikerjakan, atau perlu di-review
- User minta pindahkan task ke stage tertentu
- Update priority atau deadline task

## Instruksi

### 1. Identifikasi Task

Jika user menyebut nama task:
\`\`\`bash
odoocli task search "nama task" -j
\`\`\`

Konfirmasi task yang dimaksud sebelum update.

### 2. Cek Stage yang Tersedia

\`\`\`bash
odoocli stage list --project-id PROJECT_ID -j
\`\`\`

Stage umum di Odoo:
- Backlog / Todo
- In Progress
- Review / Testing
- Done / Closed

### 3. Update Stage

\`\`\`bash
odoocli task update TASK_ID --stage "Nama Stage"
\`\`\`

Atau gunakan stage-id:
\`\`\`bash
odoocli task update TASK_ID --stage-id STAGE_ID
\`\`\`

### 4. Update Lainnya (jika diminta)

Update deadline:
\`\`\`bash
odoocli task update TASK_ID --deadline YYYY-MM-DD
\`\`\`

Update priority (0=Normal, 1=High):
\`\`\`bash
odoocli task update TASK_ID --priority 1
\`\`\`

Update nama task:
\`\`\`bash
odoocli task update TASK_ID --name "Nama baru"
\`\`\`

### 5. Konfirmasi ke User

> ✅ Task "[nama]" dipindahkan ke stage **[stage]**

### 6. Jika Task Done — Ingatkan Timesheet

Jika user mark task sebagai Done, tanya:
> "Task sudah selesai! Mau langsung log jam untuk task ini?"

Lalu lanjut dengan skill \`odoo-timesheet-log\` jika ya.
`,
  },

  {
    id: 'odoo-task-create',
    name: 'Odoo Task Creator',
    slug: 'odoo-task-create',
    description: 'Buat task baru di Odoo dari instruksi user — dengan project, assignee, priority, dan deadline',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'task', 'create', 'dke'],
    content: `---
name: odoo-task-create
description: "WAJIB DIGUNAKAN: Ketika user minta buat task baru di Odoo, catat pekerjaan baru, atau delegate task ke orang lain. Frasa: 'buat task', 'tambahin task', 'create task di odoo', 'catat task baru'."
---

# Odoo Task Creator Skill
> **PREREQUISITE:** Baca \`../odoocli/SKILL.md\` untuk auth, config, command reference, dan pola penggunaan odoocli. Jalankan \`which odoocli\` untuk pastikan binary tersedia.


Buat task baru di Odoo menggunakan \`odoocli task create\`.

## Kapan Digunakan

- User minta buat task baru
- Ada pekerjaan baru yang perlu di-track
- User ingin assign task ke anggota tim

## Instruksi

### 1. Kumpulkan Informasi

Minimal yang dibutuhkan:
- **Nama task** (wajib)
- **Project** (wajib — tanya jika belum jelas)

Opsional tapi penting:
- Deskripsi / detail task
- Assignee (siapa yang kerjakan)
- Deadline
- Priority (normal/high)

### 2. Cek Project yang Tersedia

\`\`\`bash
odoocli project list -j
\`\`\`

Tampilkan daftar project, minta user pilih jika belum jelas.

### 3. Cek User ID Jika Ada Assignee

\`\`\`bash
odoocli user list -j
\`\`\`

Cari UID user yang akan di-assign.

### 4. Buat Task

\`\`\`bash
odoocli task create \\
  --project-id PROJECT_ID \\
  --name "Nama task yang jelas dan actionable" \\
  --description "Detail apa yang perlu dilakukan" \\
  --priority 0 \\
  --deadline YYYY-MM-DD \\
  --assign USER_ID
\`\`\`

### 5. Konfirmasi

Setelah berhasil:
> ✅ Task baru dibuat!
> 📋 **[nama task]** di project [nama project]
> 👤 Assign ke: [nama user]
> 📅 Deadline: [tanggal]
> 🔗 ID: [task_id]

### 6. Tawaran Log Awal

> "Mau langsung log beberapa jam untuk task ini, atau ada task lain yang perlu dibuat?"
`,
  },

  {
    id: 'odoo-project-status',
    name: 'Odoo Project Status Report',
    slug: 'odoo-project-status',
    description: 'Overview status semua task dalam sebuah project — progress, bottleneck, dan distribusi kerja',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'project', 'report', 'status', 'dke'],
    content: `---
name: odoo-project-status
description: "WAJIB DIGUNAKAN: Ketika user minta status project, overview pekerjaan tim, atau progress keseluruhan. Frasa: 'gimana status project X', 'overview project', 'progress tim', 'laporan project'."
---

# Odoo Project Status Report Skill
> **PREREQUISITE:** Baca \`../odoocli/SKILL.md\` untuk auth, config, command reference, dan pola penggunaan odoocli. Jalankan \`which odoocli\` untuk pastikan binary tersedia.


Generate status report project dari Odoo menggunakan odoocli.

## Kapan Digunakan

- User minta status atau overview project
- Sebelum meeting atau standup
- Untuk laporan ke stakeholder

## Instruksi

### 1. Identifikasi Project

Jika user tidak menyebut project spesifik:
\`\`\`bash
odoocli project list -j
\`\`\`

Tanya atau konfirmasi project mana.

### 2. Ambil Semua Task Project

\`\`\`bash
odoocli task list --project "Nama Project" --all -j
\`\`\`

### 3. Cek Insight Khusus Project

\`\`\`bash
odoocli insight overdue --project "Nama Project" -j
odoocli insight stale --project "Nama Project" --days 5 -j
odoocli insight unassigned --project "Nama Project" -j
\`\`\`

### 4. Cek Stage Distribution

\`\`\`bash
odoocli stage list --project-id PROJECT_ID -j
\`\`\`

Hitung berapa task di setiap stage.

### 5. Timesheet Summary Project

\`\`\`bash
odoocli timesheet summary --month -j
\`\`\`

### 6. Generate Report

Format report:

---
📊 **Project Status: [nama project]**
Dihasilkan: [tanggal]

**📋 Task Overview:**
| Stage | Jumlah Task |
|-------|-------------|
| Backlog | X |
| In Progress | X |
| Review | X |
| Done | X |
| **Total** | **X** |

**🔴 Perlu Perhatian:**
- Overdue: [N] tasks
- Stale (>5 hari): [N] tasks
- Unassigned: [N] tasks

**⚠️ Overdue Tasks:**
- [nama task] — deadline [tanggal], assign [user]

**⏳ Stale Tasks:**
- [nama task] — tidak update sejak [tanggal]

**⏱️ Total Jam Bulan Ini:** [X jam]

**💡 Rekomendasi:**
[analisa dan rekomendasi berdasarkan data]
---
`,
  },

  {
    id: 'odoo-timesheet-summary',
    name: 'Odoo Timesheet Weekly Summary',
    slug: 'odoo-timesheet-summary',
    description: 'Ringkasan timesheet mingguan/bulanan — jam per project, task, dan team member',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'timesheet', 'summary', 'weekly', 'dke'],
    content: `---
name: odoo-timesheet-summary
description: "WAJIB DIGUNAKAN: Ketika user minta ringkasan jam kerja, berapa jam minggu ini, summary timesheet, atau laporan waktu. Frasa: 'berapa jam minggu ini', 'summary timesheet', 'timesheet report', 'rekap jam'."
---

# Odoo Timesheet Weekly Summary Skill
> **PREREQUISITE:** Baca \`../odoocli/SKILL.md\` untuk auth, config, command reference, dan pola penggunaan odoocli. Jalankan \`which odoocli\` untuk pastikan binary tersedia.


Generate ringkasan timesheet dari Odoo menggunakan \`odoocli timesheet summary\`.

## Kapan Digunakan

- User minta summary jam kerja
- Akhir minggu untuk rekap
- Laporan ke manager atau klien
- Cek apakah jam sudah memenuhi target

## Instruksi

### 1. Tentukan Period

Tanya ke user:
- **Minggu ini** → pakai \`--week\`
- **Bulan ini** → pakai \`--month\`
- **Tanggal spesifik** → pakai \`--date YYYY-MM-DD\`

### 2. Pull Timesheet Data

**Summary minggu ini (saya):**
\`\`\`bash
odoocli timesheet summary --week --my -j
\`\`\`

**Summary bulan ini (saya):**
\`\`\`bash
odoocli timesheet summary --month --my -j
\`\`\`

**Detail entries minggu ini:**
\`\`\`bash
odoocli timesheet list --week --my -j
\`\`\`

**Summary untuk user lain (jika ada akses):**
\`\`\`bash
odoocli timesheet summary --week --user "nama.user" -j
\`\`\`

### 3. Hitung dan Analisa

Dari data yang didapat:
- Total jam keseluruhan
- Jam per project (distribusi)
- Jam per task terbesar
- Hari mana yang paling banyak/sedikit log
- Apakah ada hari yang kosong sama sekali?

### 4. Format Summary

---
⏱️ **Timesheet Summary — [Minggu/Bulan] [Periode]**

**Total: X jam Y menit**

**Per Project:**
| Project | Jam |
|---------|-----|
| [project 1] | X.X jam |
| [project 2] | X.X jam |

**Top 5 Tasks:**
| Task | Jam |
|------|-----|
| [task 1] | X.X jam |

**Per Hari:**
| Hari | Jam |
|------|-----|
| Senin | X.X |
| Selasa | X.X |

⚠️ **Gap:** [Hari/tanggal yang tidak ada timesheet]

💡 **Target 8 jam/hari:** [X hari tercapai dari Y hari kerja]
---

### 5. Tawaran Tindak Lanjut

Jika ada hari yang kosong:
> "Ada hari yang belum ada timesheetnya nih ([tanggal]). Mau diisi sekarang?"
`,
  },

  {
    id: 'odoo-task-search',
    name: 'Odoo Task Finder',
    slug: 'odoo-task-search',
    description: 'Cari dan tampilkan task di Odoo berdasarkan nama, project, stage, atau assignee',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'task', 'search', 'find', 'dke'],
    content: `---
name: odoo-task-search
description: "WAJIB DIGUNAKAN: Ketika user mencari task di Odoo, mau lihat daftar task, atau tanya 'task apa yang in progress'. Frasa: 'cari task', 'task mana yang', 'list task', 'ada task apa', 'tampilkan task'."
---

# Odoo Task Finder Skill
> **PREREQUISITE:** Baca \`../odoocli/SKILL.md\` untuk auth, config, command reference, dan pola penggunaan odoocli. Jalankan \`which odoocli\` untuk pastikan binary tersedia.


Cari dan tampilkan task di Odoo menggunakan \`odoocli task list\` dan \`odoocli task search\`.

## Kapan Digunakan

- User mau tahu daftar task yang ada
- User mencari task berdasarkan nama atau keyword
- User ingin lihat task per stage, project, atau assignee

## Instruksi

### 1. Identifikasi Filter yang Diinginkan

Tanya atau identifikasi dari konteks:
- **Project spesifik?** → pakai \`--project\`
- **Stage tertentu?** → pakai \`--stage\`
- **Punya saya?** → pakai \`--my\`
- **Keyword?** → pakai \`task search\`

### 2. Pilih Command yang Tepat

**Task saya yang aktif:**
\`\`\`bash
odoocli task list --my -j
\`\`\`

**Task dalam project tertentu:**
\`\`\`bash
odoocli task list --project "Nama Project" --all -j
\`\`\`

**Task berdasarkan stage:**
\`\`\`bash
odoocli task list --stage "In Progress" --project "Nama Project" -j
\`\`\`

**Cari berdasarkan keyword:**
\`\`\`bash
odoocli task search "keyword" -j
\`\`\`

**Task yang di-assign ke user tertentu:**
\`\`\`bash
odoocli task list --user "nama user" --project "Nama Project" -j
\`\`\`

### 3. View Detail Task

Jika user butuh detail satu task:
\`\`\`bash
odoocli task view TASK_ID -j
\`\`\`

### 4. Format Hasil

Tampilkan dalam format tabel yang mudah dibaca:

---
📋 **Task List — [filter yang dipakai]**

| ID | Task | Stage | Assignee | Deadline |
|----|------|-------|----------|----------|
| 123 | [nama task] | In Progress | [user] | [tanggal] |

Total: X task ditemukan
---

### 5. Tawaran Aksi Lanjutan

Setelah menampilkan list:
> "Mau update status salah satu task, atau log jam untuk task tertentu?"
`,
  },

  {
    id: 'odoo-stale-followup',
    name: 'Odoo Stale Task Follow-up',
    slug: 'odoo-stale-followup',
    description: 'Proactively follow up task yang tidak diupdate lebih dari N hari — untuk heartbeat atau morning check',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'stale', 'followup', 'heartbeat', 'dke'],
    content: `---
name: odoo-stale-followup
description: "WAJIB DIGUNAKAN: Pada heartbeat atau ketika user minta cek task yang terbengkalai, tidak diupdate lama, atau perlu follow up. Frasa: 'ada task yang terbengkalai', 'cek stale task', 'task yang lama tidak diupdate'."
---

# Odoo Stale Task Follow-up Skill
> **PREREQUISITE:** Baca \`../odoocli/SKILL.md\` untuk auth, config, command reference, dan pola penggunaan odoocli. Jalankan \`which odoocli\` untuk pastikan binary tersedia.


Identifikasi dan follow up task yang tidak diupdate lebih dari beberapa hari menggunakan \`odoocli insight stale\`.

## Kapan Digunakan

- Heartbeat mid-week (Rabu/Kamis untuk cek progress)
- User minta cek task yang stuck atau terbengkalai
- Weekly review untuk bersihkan backlog

## Instruksi

### 1. Ambil Stale Tasks

\`\`\`bash
# Task in-progress yang tidak diupdate >3 hari
odoocli insight stale --days 3 --my -j

# Lebih agresif: tidak diupdate >7 hari
odoocli insight stale --days 7 -j

# Per project
odoocli insight stale --days 3 --project "Nama Project" -j
\`\`\`

### 2. Analisa Setiap Stale Task

Untuk setiap task yang stale, view detailnya:
\`\`\`bash
odoocli task view TASK_ID -j
\`\`\`

Perhatikan:
- Sudah di stage mana?
- Siapa assignee-nya?
- Apa deskripsinya?
- Sudah berapa lama tidak diupdate?

### 3. Kategorisasi

Untuk setiap stale task, tentukan:
- **Masih aktif dikerjakan?** → Update stage jika perlu, log timesheet
- **Blocked?** → Flag ke user, perlu unblock dulu
- **Sebenarnya sudah selesai?** → Update ke Done
- **Tidak relevan lagi?** → Perlu di-archive atau closed

### 4. Sajikan Follow-up

---
⏳ **Stale Tasks Follow-up** — [tanggal]
Tasks yang tidak diupdate lebih dari [N] hari:

1. **[nama task]** (ID: [id]) — tidak diupdate [X] hari
   - Stage: [stage] | Project: [project]
   - Status: [analisa singkat]
   - **Aksi yang disarankan:** [update stage/timesheet/archive]

2. **[nama task]** (ID: [id]) — tidak diupdate [X] hari
   ...

**Pertanyaan untuk setiap task:**
Untuk task "[nama]" — ini masih in progress, sudah selesai, atau ada blocker?
---

### 5. Eksekusi Update Berdasarkan Jawaban User

Berdasarkan jawaban:
- Selesai → \`odoocli task update TASK_ID --stage "Done"\`
- Masih jalan → \`odoocli timesheet log ...\` jika ada jam
- Blocked → Catat di MEMORY.md sebagai blocker
- Tidak relevan → \`odoocli task update TASK_ID --stage "Cancelled"\` (jika ada)
`,
  },

  // ── 10. odoocli Reference ────────────────────────────────────────────────────
  {
    id: 'odoo-reference',
    name: 'odoocli — Odoo CLI Reference',
    slug: 'odoocli',
    description: 'Referensi lengkap cara menggunakan odoocli: auth, semua commands, output format, dan pola umum untuk interaksi dengan Odoo 17',
    agent: 'Odoo Skills',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoocli', 'odoo', 'reference', 'tool', 'dke', 'superpowers'],
    content: `---
name: odoocli
description: "WAJIB DIBACA: Sebelum menggunakan perintah odoocli apapun — baca skill ini untuk memahami setup, auth, command structure, dan pola penggunaan yang benar."
---

# odoocli — Odoo 17 CLI Reference

CLI tool untuk berinteraksi dengan Odoo 17 (Project Management & Timesheet) via XML-RPC.
Binary: \`odoocli\` (harus tersedia di PATH) | Protocol: XML-RPC

> **Prerequisite:** Pastikan \`odoocli\` bisa dieksekusi:
> \`\`\`bash
> which odoocli && odoocli --version
> \`\`\`
> Jika belum tersedia, install via pip: \`pip install odoocli\` atau sesuai instruksi deployment.

---

## Setup & Konfigurasi

### Config File
Lokasi: \`~/.odoocli.toml\` (dicari secara berurutan: CWD → home → \`~/.config/odoocli/\`)

\`\`\`toml
[default]
url      = "https://odoo.dke.co.id"
db       = "v17dke_production"
username = "nama@dke.co.id"
api_key  = "your-api-key"   # Prioritas utama, lebih aman dari password

[default.defaults]
project = "DKE Portal"      # Default project untuk commands yang butuh --project

[staging]
url      = "https://staging.dke.co.id"
db       = "v17dke_staging"
username = "nama@dke.co.id"
api_key  = "staging-api-key"
\`\`\`

**Session cache:** \`~/.odoocli-session.json\` — menyimpan UID per profile agar tidak re-auth setiap call.

### Environment Variables (override config)
| Env Var | Keterangan |
|---------|-----------|
| \`ODOOCLI_URL\` | URL Odoo instance |
| \`ODOOCLI_DB\` | Nama database |
| \`ODOOCLI_USERNAME\` | Login email/username |
| \`ODOOCLI_PASSWORD\` | Password |
| \`ODOOCLI_API_KEY\` | API key (prioritas atas password) |
| \`ODOOCLI_PROFILE\` | Profile name (default: "default") |
| \`ODOOCLI_CONFIG\` | Path config file custom |
| \`ODOOCLI_JSON=1\` | Force JSON output untuk semua commands |

---

## Authentication

### Setup awal (interaktif)
\`\`\`bash
odoocli auth login
# Prompt: URL → database → username → password/api_key → profile name
\`\`\`

### Verifikasi koneksi
\`\`\`bash
odoocli auth test        # Cek apakah bisa konek ke Odoo
odoocli auth whoami      # Lihat user yang sedang aktif
odoocli auth whoami -j   # JSON output
\`\`\`

### Ganti profile
\`\`\`bash
odoocli --profile staging task list --my
odoocli --profile default project list
\`\`\`

---

## Output Format

Semua commands punya dua mode output:

| Mode | Flag | Kapan Digunakan |
|------|------|----------------|
| Human-readable (table) | *(default)* | Untuk display ke user |
| JSON | \`-j\` atau \`--json\` | Untuk parsing programatik, agent decision-making |

\`\`\`bash
odoocli task list --my          # table yang mudah dibaca
odoocli task list --my -j       # JSON array of objects
ODOOCLI_JSON=1 odoocli task list --my  # force JSON via env
\`\`\`

---

## Command Reference

### auth — Autentikasi
\`\`\`bash
odoocli auth login                          # Setup interaktif
odoocli auth test                           # Cek koneksi
odoocli auth whoami [-j]                    # Info user aktif
\`\`\`

### project — Manajemen Project
\`\`\`bash
odoocli project list [--active|--all] [--limit N] [-j]
odoocli project view PROJECT_ID [-j]
odoocli project create --name "Nama" [--description "..."]
odoocli project update PROJECT_ID [--name] [--description] [--active|--archive]
\`\`\`

### task — Manajemen Task
\`\`\`bash
# List dengan berbagai filter
odoocli task list [-j]
odoocli task list --my [-j]                         # Task milik saya
odoocli task list --project "Nama Project" [-j]     # Per project
odoocli task list --stage "In Progress" [-j]        # Per stage
odoocli task list --user "nama.user" [-j]           # Per assignee
odoocli task list --all [-j]                        # Semua task (termasuk closed)
odoocli task list --limit 20 --order "deadline asc" [-j]

# Detail satu task
odoocli task view TASK_ID [-j]

# Cari berdasarkan keyword
odoocli task search "keyword pencarian" [--limit N] [-j]

# Buat task baru
odoocli task create \\
  --project-id PROJECT_ID \\
  --name "Judul task" \\
  --description "Detail apa yang dikerjakan" \\
  --priority 0|1 \\
  --deadline YYYY-MM-DD \\
  --assign USER_ID

# Update task
odoocli task update TASK_ID \\
  --name "Judul baru" \\
  --stage "Nama Stage" \\         # atau --stage-id N
  --priority 0|1 \\
  --deadline YYYY-MM-DD \\
  --description "Deskripsi baru"

# Assign user ke task
odoocli task assign TASK_ID --user-id UID [--add|--replace]
\`\`\`

### timesheet — Log Jam Kerja
\`\`\`bash
# List entries
odoocli timesheet list --my [-j]
odoocli timesheet list --today --my [-j]
odoocli timesheet list --week --my [-j]
odoocli timesheet list --month --my [-j]
odoocli timesheet list --project "Nama" --my [-j]
odoocli timesheet list --task-id TASK_ID [-j]
odoocli timesheet list --date YYYY-MM-DD [-j]

# Log jam baru
odoocli timesheet log \\
  --task-id TASK_ID \\
  --hours 2.5 \\                  # Desimal: 1.5 = 1 jam 30 menit
  --desc "Apa yang dikerjakan" \\
  --date YYYY-MM-DD              # Default: hari ini

# Update atau hapus entry
odoocli timesheet update ENTRY_ID [--hours] [--desc] [--date]
odoocli timesheet delete ENTRY_ID

# Summary
odoocli timesheet summary [--week|--month] [--my] [--user "nama"] [-j]
\`\`\`

### stage — Workflow Stages
\`\`\`bash
odoocli stage list [--project-id N] [-j]
# Contoh stages: Backlog, In Progress, Review, Done
\`\`\`

### user — Manajemen User
\`\`\`bash
odoocli user list [--limit N] [--active|--all] [-j]
odoocli user whoami [-j]
\`\`\`

### insight — Proactive Intelligence (⭐ Agent-Optimized)
\`\`\`bash
# Daily health check — IDEAL untuk heartbeat agent
odoocli insight daily [--user "nama"] [-j]
# Output JSON: timesheet_today, timesheet_yesterday, overdue_tasks, stale_tasks, in_progress_tasks

# Task overdue (melewati deadline)
odoocli insight overdue [--project "Nama"] [--my] [--limit N] [-j]

# Task stale (tidak diupdate N hari)
odoocli insight stale [--days N] [--project "Nama"] [--my] [--limit N] [-j]

# Task tanpa assignee
odoocli insight unassigned [--project "Nama"] [--limit N] [-j]
\`\`\`

### module & model — Inspeksi Odoo (Advanced)
\`\`\`bash
# List module yang terinstall
odoocli module list [--state installed] [--limit N] [-q "query"] [-j]
odoocli module info MODULE_NAME [-j]

# Inspeksi field model Odoo
odoocli model fields MODEL_NAME [-j]
odoocli model fields project.task [--type many2one] [--required] [-j]
# Model names: project.project, project.task, account.analytic.line, res.users
\`\`\`

---

## Pola Umum

### Cari ID dari nama
\`\`\`bash
# Cari project ID dari nama
odoocli project list -j | python3 -c "
import json,sys
for p in json.load(sys.stdin): print(p['id'], p['name'])
"

# Cari task ID dari keyword
odoocli task search "nama task" -j | python3 -c "
import json,sys
for t in json.load(sys.stdin): print(t['id'], t['name'])
"

# Cari user ID
odoocli user list -j | python3 -c "
import json,sys
for u in json.load(sys.stdin): print(u['id'], u['name'], u['login'])
"
\`\`\`

### Insight daily untuk heartbeat agent
\`\`\`bash
odoocli insight daily --my -j
\`\`\`
Output JSON structure:
\`\`\`json
{
  "timesheet_today": {"logged": true, "hours": 3.5, "entries": 2},
  "timesheet_yesterday": {"logged": false, "hours": 0, "entries": 0},
  "overdue_tasks": [{"id": 123, "name": "...", "deadline": "2026-04-01"}],
  "stale_tasks": [{"id": 456, "name": "...", "last_update": "2026-04-03"}],
  "in_progress_tasks": [{"id": 789, "name": "...", "stage": "In Progress", "project": "..."}]
}
\`\`\`

### Log timesheet dengan task search
\`\`\`bash
# Cari task dulu
TASK_ID=\$(odoocli task search "nama task" -j | python3 -c "
import json,sys; tasks=json.load(sys.stdin)
print(tasks[0]['id'] if tasks else '')
")

# Log jam
odoocli timesheet log --task-id \$TASK_ID --hours 2 --desc "Deskripsi pekerjaan"
\`\`\`

---

## Error Handling

| Error Type | Penyebab | Solusi |
|------------|---------|--------|
| \`AuthError\` | Credentials salah, token expired | \`odoocli auth login\` ulang |
| \`ConnectionError\` | Odoo tidak bisa diakses | Cek URL dan network |
| \`OdooError\` | XML-RPC error dari Odoo | Cek input (ID valid? field ada?) |

Semua error keluar via stderr + exit code 1. Gunakan \`-j\` untuk output JSON yang predictable di script.

---

## Skills Terkait

Skill spesifik yang menggunakan odoocli:
- \`odoo-daily-check\` — morning check via insight daily
- \`odoo-timesheet-log\` — log jam kerja
- \`odoo-task-update\` — update stage/status task
- \`odoo-task-create\` — buat task baru
- \`odoo-project-status\` — laporan status project
- \`odoo-timesheet-summary\` — ringkasan jam mingguan/bulanan
- \`odoo-task-search\` — cari dan tampilkan task
- \`odoo-stale-followup\` — follow up task yang terbengkalai
`,
  },

]