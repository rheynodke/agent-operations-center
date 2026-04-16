// ─── PM & Product Analyst Skill Templates ──────────────────────────────────────

import type { SkillTemplate } from '../types'

export const PM_ANALYST_TEMPLATES: SkillTemplate[] = [

  {
    id: 'market-research',
    name: 'Market Research',
    slug: 'market-research',
    description: 'Riset apakah fitur baru worth it — kompetitor, tren pasar, user sentiment',
    agent: 'Agent 1 — PM & Product Analyst',
    agentEmoji: '📊',
    category: 'PM & Product Analyst',
    tags: ['pm', 'research', 'competitor', 'adlc'],
    content: `---
name: market-research
description: "WAJIB DIGUNAKAN: Ketika diminta riset fitur baru, analisa kompetitor, market research, atau evaluasi apakah sebuah ide worth it dibangun."
---

# Market Research Skill

Skill ini memandu agent PM untuk melakukan discovery riset pasar sebelum PRD dibuat (FR-01 Step 1 & 2).

## Kapan Digunakan

- User menyebut "riset", "worth it", "kompetitor", "market research", "peluang fitur"
- Ada abstract problem baru yang perlu dievaluasi
- PA Agent mengirim laporan anomali yang perlu ditindaklanjuti

## Instruksi

Saat skill ini aktif:

1. **Identifikasi Problem** — Klarifikasi abstract problem yang akan diriset. Jika belum jelas, tanya ke user.

2. **Riset Kompetitor** — Cari minimal 5 kompetitor yang punya fitur serupa:
   - Fitur apa yang mereka punya?
   - Bagaimana implementasinya?
   - Apa kelemahan dan kelebihannya?

3. **Analisa Tren Pasar** — Identifikasi 3 tren pasar yang relevan dengan problem ini.

4. **User Sentiment** — Cari feedback user terkait problem ini (review, forum, social media).

5. **JTBD Framework** — Formulasikan Jobs-to-Be-Done: "When [situation], user wants to [motivation], so they can [outcome]."

6. **Output Ringkasan** — Buat laporan singkat:
   - Problem statement
   - Market opportunity
   - Kompetitor landscape
   - Rekomendasi: Build / Buy / Partner / Skip
   - Estimasi value vs effort (skala 1-10)

## Format Output

Sampaikan dalam format yang bisa langsung dimasukkan ke PRD. Tandai dengan: **[MARKET RESEARCH COMPLETE]** di akhir.
`,
  },

  {
    id: 'prd-generator',
    name: 'PRD Generator',
    slug: 'prd-generator',
    description: 'Generate PRD ke Google Docs dengan format standar ADLC (FR-01 Output)',
    agent: 'Agent 1 — PM & Product Analyst',
    agentEmoji: '📊',
    category: 'PM & Product Analyst',
    tags: ['pm', 'prd', 'google-docs', 'adlc'],
    content: `---
name: prd-generator
description: "WAJIB DIGUNAKAN: Ketika diminta membuat PRD, product requirements document, atau mendokumentasikan fitur yang akan dibangun."
---

# PRD Generator Skill

Generate Product Requirements Document ke Google Docs mengikuti standar ADLC Platform (FR-01 Output).

## Kapan Digunakan

- User menyebut "buat PRD", "tulis PRD", "product requirements", "dokumentasi fitur"
- Discovery sudah selesai dan stakeholder sudah approve ideasi solusi (post-Step 6)

## Instruksi

### 1. Kumpulkan Input

Pastikan kamu punya:
- [ ] Problem statement yang sudah divalidasi
- [ ] Solusi yang sudah dipilih stakeholder
- [ ] Target user/segment
- [ ] Success metrics yang ingin dicapai

Jika ada yang kurang, tanya ke user dulu.

### 2. Susun PRD dengan Struktur Ini

**Executive Summary**
- Problem statement (1 paragraf)
- Proposed solution (1 paragraf)
- Value Score: Expected Value (1-10) vs Effort (1-10) = Ratio
- Status: Draft

**Problem Statement**
- Context dan background
- Root cause
- Impact jika tidak diselesaikan

**User Stories**
Format: "Sebagai [user role], saya ingin [goal] agar [benefit]."
- US-XX: [user story]
  - Acceptance Criteria:
    - [ ] Kriteria 1
    - [ ] Kriteria 2

**Success Metrics (KR)**
- KR1: [metric] → target [angka] | [timeline]
- KR2: [metric] → target [angka] | [timeline]

**Out of Scope**
- [item yang tidak masuk scope v1]

**Risk & Mitigations**
- R1: [risk] (probability/impact) → [mitigation]

### 3. Simpan ke Google Docs

Setelah struktur PRD siap, buat dokumen baru di Google Docs menggunakan skill \`gws-docs\` dengan:
- Title: "PRD - [Nama Fitur] - [Tanggal]"
- Share ke CPO untuk approval

### 4. Notifikasi

Informasikan ke user bahwa PRD sudah dibuat dan menunggu approval CPO sebelum Agent 2 (UI/UX) bisa mulai.
`,
  },

  {
    id: 'pa-metrics-report',
    name: 'PA Metrics Analyzer',
    slug: 'pa-metrics-report',
    description: 'Analisa existing feature via Datadog/Mixpanel — keep, improve, atau takedown',
    agent: 'Agent 1 — PM & Product Analyst',
    agentEmoji: '📊',
    category: 'PM & Product Analyst',
    tags: ['pa', 'analytics', 'datadog', 'mixpanel', 'adlc'],
    content: `---
name: pa-metrics-report
description: "WAJIB DIGUNAKAN: Ketika diminta analisa performa fitur existing, cek metrics, ada anomali di Datadog atau Mixpanel, atau evaluasi apakah fitur patut dipertahankan."
---

# PA Metrics Analyzer Skill

Analisa existing feature menggunakan data Datadog dan Mixpanel untuk rekomendasi keep/improve/takedown (FR-02).

## Kapan Digunakan

- User menyebut "cek performa", "analisa fitur", "ada anomali", "metrics", "engagement drop"
- Heartbeat trigger jika anomali terdeteksi
- PA Adaptive Loop (FR-10) berjalan

## Instruksi

### 1. Tentukan Scope Analisa

Tanyakan atau identifikasi:
- Fitur mana yang akan dianalisa?
- Periode analisa (default: 30 hari terakhir)
- Baseline yang tersedia (pre-launch metrics)

### 2. Pull Data Metrics

Gunakan \`aoc-connect.sh\` untuk query analytics services yang terdaftar di AOC (jalankan \`check_connections.sh website\` untuk list koneksi). Data yang dibutuhkan:

**Engagement Metrics**
- Retention rate (D1, D7, D30)
- DAU/MAU ratio
- Session frequency per user

**Usability Proxy Metrics** ← CRITICAL untuk USABILITY RISK
- Time-on-task per flow
- Error rate per step
- Drop-off rate per screen
- Task completion rate

**Business Metrics**
- Revenue impact (jika ada)
- Support ticket volume terkait fitur ini
- NPS score delta

### 3. Bandingkan vs Baseline

Jika pre-launch baseline tersedia (FR-02):
- Retention actual vs target
- Engagement actual vs target
- Error rate actual vs ceiling

### 4. Generate Laporan

Format output:

---
**PA Report: [Nama Fitur]**
Periode: [tanggal] - [tanggal]

📈 Engagement: [status] | Retention D7: X% (target: Y%)
⚠️ Usability: Drop-off di screen [X]: Z% (threshold: 20%)
💡 Rekomendasi: **KEEP / IMPROVE / TAKEDOWN**

Alasan: [1-2 kalimat reasoning berdasarkan data]

Action Required: [apa yang perlu dilakukan jika IMPROVE/TAKEDOWN]
---

### 5. Jika Ada Anomali

Jika degradasi signifikan terdeteksi:
- Flag ke CPO dan UI/UX Researcher
- Opsi: trigger ulang Agent 1 discovery cycle
- Catat di MEMORY.md
`,
  },

  {
    id: 'pa-adaptive-loop',
    name: 'PA Adaptive Loop',
    slug: 'pa-adaptive-loop',
    description: 'Monitor existing features secara periodik via heartbeat — FR-10',
    agent: 'Agent 1 — PM & Product Analyst',
    agentEmoji: '📊',
    category: 'PM & Product Analyst',
    tags: ['pa', 'monitoring', 'heartbeat', 'fr-10', 'adlc'],
    content: `---
name: pa-adaptive-loop
description: "WAJIB DIGUNAKAN: Pada setiap heartbeat — monitor metrics existing features, deteksi anomali, dan flag ke CPO jika ada degradasi signifikan."
---

# PA Adaptive Loop — Ongoing Monitoring

Monitoring periodik existing features via heartbeat untuk deteksi anomali dini (FR-10).

## Instruksi Heartbeat

Saat skill ini aktif (dari HEARTBEAT.md):

### 1. Cek Anomali Metrics

Jalankan \`pa-metrics-check.sh\` atau query manual untuk setiap fitur aktif:
- Apakah ada metric yang turun > 20% dari baseline?
- Apakah ada error rate yang naik > threshold?
- Apakah ada usability proxy yang memburuk?

### 2. Evaluasi Threshold

| Metric | Alert Threshold |
|--------|----------------|
| Retention D7 | Drop > 15% dari baseline |
| Error rate | Naik > 10% dari baseline |
| Drop-off per screen | > 30% di satu screen |
| Task completion | < 80% |

### 3. Tindakan Berdasarkan Temuan

**Jika NORMAL** → Reply HEARTBEAT_OK

**Jika ADA ANOMALI MINOR** → Catat di MEMORY.md, monitor lebih ketat

**Jika ADA ANOMALI SIGNIFIKAN** →
1. Notifikasi CPO via WhatsApp (gunakan skill atau script notifikasi)
2. Sertakan: fitur terdampak, metric yang anomali, trend 7 hari
3. Tawarkan opsi: (a) deep analysis, (b) trigger re-discovery Agent 1
4. Log ke audit trail

### 4. Update Status

Catat hasil monitoring di \`memory/[tanggal]-pa-monitoring.md\`
`,
  },

]
