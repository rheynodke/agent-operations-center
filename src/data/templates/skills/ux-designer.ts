// ─── UI/UX Researcher & Designer Skill Templates ───────────────────────────────

import type { SkillTemplate } from '../types'

export const UX_DESIGNER_TEMPLATES: SkillTemplate[] = [

  {
    id: 'ux-research',
    name: 'UX Research & Behavioral Insight',
    slug: 'ux-research',
    description: 'Riset behavior user, cognitive bias, dan UX anti-pattern untuk enrichment PRD',
    agent: 'Agent 2 — UI/UX Researcher & Designer',
    agentEmoji: '🎨',
    category: 'UI/UX Researcher & Designer',
    tags: ['ux', 'research', 'behavior', 'design', 'adlc'],
    content: `---
name: ux-research
description: "WAJIB DIGUNAKAN: Ketika diminta analisa UX, riset behavior user, pattern desain, cognitive bias, atau evaluasi usability dari solusi yang diusulkan."
---

# UX Research & Behavioral Insight Skill

Memberikan behavioral insight untuk memperkuat PRD dan hypothesis (FR-03, kontribusi ke FR-01 Step 2 & 5).

## Kapan Digunakan

- PM Agent meminta enrichment hypothesis dari sisi behavioral
- User menyebut "UX research", "behavior user", "design pattern", "cognitive bias"
- Sebelum PRD dikunci (usability gate)

## Instruksi

### 1. Identifikasi Konteks

Dari PRD atau problem statement, identifikasi:
- User segment yang dituju
- Core task yang user perlu selesaikan
- Environment penggunaan (mobile/desktop, context of use)

### 2. Behavioral Analysis

**Cognitive Biases yang Relevan**
- Identify biases yang mungkin mempengaruhi behavior user (anchoring, status quo, loss aversion, etc.)
- Bagaimana bias ini berdampak ke adoption solusi yang diusulkan?

**Mental Model Mapping**
- Apa mental model user saat ini untuk problem ini?
- Apakah solusi yang diusulkan align atau clash dengan mental model mereka?

**UX Anti-Pattern Flags**
- Identifikasi anti-pattern yang sering terjadi untuk problem sejenis
- Beri warning eksplisit: "⚠️ Anti-pattern: [nama] — hindari karena [alasan]"

### 3. Proven Patterns

Rekomendasikan 2-3 proven UX pattern yang sesuai:
- Pattern name + referensi (Figma, Material Design, Apple HIG)
- Trade-off: kapan pattern ini works, kapan tidak
- Estimated implementation complexity (Low/Med/High)

### 4. Design Vocabulary Output

Format untuk PM Agent:
---
**UX Research Brief**
Problem: [problem statement]

🧠 Behavioral Insight: [cognitive bias yang relevan dan impaknya]

⚠️ Anti-patterns to Avoid:
- [anti-pattern 1]: [alasan]

✅ Recommended Patterns:
- [pattern 1]: [deskripsi + trade-off]
- [pattern 2]: [deskripsi + trade-off]

📊 Usability Risk Level: LOW / MEDIUM / HIGH
---
`,
  },

  {
    id: 'usability-test',
    name: 'Usability Testing Gate',
    slug: 'usability-test',
    description: 'Conduct task-based usability testing — hard gate sebelum PRD dikunci (FR-03)',
    agent: 'Agent 2 — UI/UX Researcher & Designer',
    agentEmoji: '🎨',
    category: 'UI/UX Researcher & Designer',
    tags: ['ux', 'usability', 'testing', 'quality-gate', 'adlc'],
    content: `---
name: usability-test
description: "WAJIB DIGUNAKAN: Ketika diminta usability testing, task completion test, atau validasi bahwa user bisa menggunakan solusi yang diusulkan sebelum PRD dikunci."
---

# Usability Testing Gate Skill

Conduct moderated task-based usability testing sebagai hard gate sebelum PRD dikunci (FR-03, USABILITY RISK).

⚠️ **Hard Gate**: PRD tidak boleh dikunci jika task completion rate < 80% untuk task utama.

## Kapan Digunakan

- Prototype dari Agent 2 sudah tersedia
- PM siap mengunci PRD
- User menyebut "usability test", "task completion", "test user"

## Instruksi

### 1. Setup Testing

Dari user stories PRD, extract task utama:
- Ubah setiap user story menjadi 1 concrete task untuk user
- Format: "Tolong lakukan: [task yang spesifik dan observable]"
- Siapkan lo-fi sketch atau prototype sebagai alat bantu visual

### 2. Conduct Testing (Moderated)

Untuk setiap task:
1. Bacakan task kepada participant — jangan jelaskan caranya
2. Observasi: di mana mereka berhenti? Di mana mereka confused?
3. Catat: friction points, confusion moments, error yang terjadi
4. Track: apakah task berhasil diselesaikan? (Ya / Ya dengan bantuan / Tidak)

### 3. Calculate Metrics

**Per Task:**
- Task Completion Rate = (berhasil tanpa bantuan / total participant) × 100%
- Time on Task (opsional)
- Error Count

**Overall:**
- Average Completion Rate semua task utama

### 4. Evaluate Gate

| Status | Condition | Action |
|--------|-----------|--------|
| ✅ PASS | Semua task utama ≥ 80% | PRD bisa dikunci |
| ⚠️ REVISE | Ada task < 80% | PM WAJIB revisi user story terkait |
| ❌ BLOCK | Majority task < 60% | PRD tidak bisa dikunci, butuh major redesign |

### 5. Report ke PM

---
**Usability Test Report**
Date: [tanggal]
Prototype version: [link]

| Task | User Story | Completion Rate | Status |
|------|-----------|----------------|--------|
| [task 1] | US-01 | X% | ✅/⚠️/❌ |

**Overall: PASS / REVISE / BLOCK**

Friction Points:
- [screen X]: user confused karena [alasan]

Rekomendasi revisi user story:
- US-XX: [revisi yang diperlukan]
---

Sign-off: UI/UX Researcher Agent [timestamp]
`,
  },

]
