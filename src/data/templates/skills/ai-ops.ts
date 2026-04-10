// ─── AI Ops Skill Templates ─────────────────────────────────────────────────────

import type { SkillTemplate } from '../types'

export const AI_OPS_TEMPLATES: SkillTemplate[] = [

  {
    id: 'checkpoint-notifier',
    name: 'Checkpoint & Approval Notifier',
    slug: 'checkpoint-notifier',
    description: 'Notifikasi checkpoint approval ke stakeholder via WhatsApp/Slack (FR-12)',
    agent: 'AI Ops — Cross Agent',
    agentEmoji: '⚙️',
    category: 'AI Ops',
    tags: ['ops', 'approval', 'whatsapp', 'checkpoint', 'fr-12', 'adlc'],
    content: `---
name: checkpoint-notifier
description: "WAJIB DIGUNAKAN: Setiap kali butuh approval dari stakeholder (CPO, CTO, Tech Lead) sebelum melanjutkan ke tahap berikutnya dalam pipeline ADLC."
---

# Checkpoint & Approval Notifier Skill

Mengirim notifikasi checkpoint ke stakeholder yang tepat dan menunggu approval sebelum melanjutkan (FR-12, Human-in-the-Loop).

## ADLC Checkpoint Map

| Dari | Ke | Approver | Channel |
|------|-----|---------|---------|
| Agent 1 PRD selesai | Agent 2 mulai | CPO | WhatsApp |
| Agent 2 Prototype selesai | Agent 3 mulai FSD | CPO | WhatsApp |
| Agent 3 Feasibility Brief | FSD generation | CTO | WhatsApp |
| Agent 3 FSD selesai | Agent 4 coding | CTO | WhatsApp |
| Agent 4 PR ready | Merge ke repo | Tech Lead | GitHub + WhatsApp |
| Agent 5 Test selesai | Go-live Production | CTO | WhatsApp + Slack |
| Agent 6 User Guide | Kirim ke users | [reviewer] | WhatsApp |

## Instruksi

### 1. Identifikasi Checkpoint

Tentukan:
- Stage apa yang baru selesai?
- Siapa approver yang tepat?
- Apa yang perlu di-approve? (dokumen/link apa yang perlu dicek)

### 2. Kirim Notifikasi

Format pesan WhatsApp/Slack:

---
🔔 *ADLC Approval Required*

*Stage:* [nama stage yang selesai]
*Feature:* [nama fitur]
*Completed by:* Agent [X] — [nama agent]

*What to review:*
[link ke dokumen/PR yang perlu di-review]

*What's needed:*
[apa yang perlu di-approve / keputusan apa yang perlu dibuat]

*SLA:* Approval diperlukan dalam [X jam] agar pipeline tidak tertahan.

*To approve:* Reply OK atau approve via dashboard AOC.

⚠️ Pipeline akan tertahan hingga approval diberikan.
---

Gunakan script \`whatsapp-notify.sh\` atau \`slack-alert.sh\` untuk kirim.

### 3. Monitor Approval

- Cek status approval setiap [X jam]
- Jika belum di-approve dalam SLA: eskalasi ke atasan
- Log: siapa yang approve, kapan, catatan apa yang diberikan

### 4. Setelah Approved

- Update status di audit log
- Notifikasi agent berikutnya bahwa mereka bisa mulai
- Catat di MEMORY.md
`,
  },

  {
    id: 'daily-briefing',
    name: 'Daily Briefing',
    slug: 'daily-briefing',
    description: 'Ringkasan harian status semua agent ADLC, pending approvals, dan blockers',
    agent: 'AI Ops — Cross Agent',
    agentEmoji: '⚙️',
    category: 'AI Ops',
    tags: ['ops', 'briefing', 'daily', 'adlc'],
    content: `---
name: daily-briefing
description: "WAJIB DIGUNAKAN: Ketika diminta briefing harian, summary progress hari ini, atau status semua agent ADLC."
---

# Daily Briefing Skill

Ringkasan harian status pipeline ADLC — apa yang sedang berjalan, apa yang blocked, apa yang butuh attention.

## Kapan Digunakan

- User menyebut "briefing", "summary hari ini", "status agent", "progress ADLC"
- Pagi hari sebagai kickoff harian
- Sebelum standup meeting

## Instruksi

Buat ringkasan dengan format ini:

---
📋 *ADLC Daily Briefing*
[Hari], [Tanggal]

**🚦 Pipeline Status**
| Feature | Stage | Status | Blocked? |
|---------|-------|--------|----------|
| [fitur] | Agent [X] | [status] | [Ya/Tidak] |

**⏳ Pending Approvals**
- [dokumen] → menunggu approval [person] sejak [X jam]
- [dokumen] → menunggu approval [person] sejak [X jam]

**⚠️ Blockers**
- [blocker 1]: [deskripsi dan impact]

**✅ Selesai Kemarin**
- [deliverable 1]: [fitur X PRD di-approve CPO]
- [deliverable 2]: [fitur Y FSD selesai]

**📅 Agenda Hari Ini**
- Agent [X] melanjutkan [task]
- Menunggu approval [person] untuk [dokumen]
- [review/meeting yang perlu dilakukan]

**💰 Cost Update**
- Cost minggu ini: $[X]
- Trending: ↑ / ↓ / → vs minggu lalu
---

Data diambil dari audit log dan status agent aktif.
`,
  },

]
