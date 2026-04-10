// ─── EM & System Architecture Skill Templates ──────────────────────────────────

import type { SkillTemplate } from '../types'

export const EM_ARCHITECTURE_TEMPLATES: SkillTemplate[] = [

  {
    id: 'feasibility-brief',
    name: 'Technical Feasibility Brief',
    slug: 'feasibility-brief',
    description: 'Generate Technical Feasibility Brief untuk approval CTO sebelum FSD dibuat',
    agent: 'Agent 3 — EM & System Architecture',
    agentEmoji: '🏗️',
    category: 'EM & System Architecture',
    tags: ['em', 'architecture', 'feasibility', 'cto', 'adlc'],
    content: `---
name: feasibility-brief
description: "WAJIB DIGUNAKAN: Ketika diminta technical feasibility, bisa dibangun tidak, constraint teknis, atau sebelum FSD dimulai — harus ada approval CTO dulu."
---

# Technical Feasibility Brief Skill

Generate Technical Feasibility Brief yang harus di-approve CTO sebelum FSD bisa dimulai (FR-05, FEASIBILITY RISK).

⚠️ **Hard Gate**: FSD tidak bisa digenerate tanpa CTO approval pada Brief ini.

## Kapan Digunakan

- PRD sudah di-approve CPO
- User menyebut "feasibility", "bisa dibangun?", "constraint teknis", "sebelum FSD"
- CTO meminta assessment sebelum development dimulai

## Instruksi

### 1. Kumpulkan Constraint Input dari CTO

Sebelum memulai, pastikan ada constraint dari CTO:
- [ ] Tech stack yang diperbolehkan (atau preferred)
- [ ] Security requirements (SOC2, GDPR, dll)
- [ ] Existing infrastructure yang harus diintegrasikan
- [ ] Regulatory constraints
- [ ] Timeline budget (rough: berapa sprint?)

Jika belum ada, **STOP dan tanya CTO** — Brief tidak bisa dimulai tanpa ini.

### 2. Assess Feasibility

Evaluasi 4 dimensi:

**Technical Constraint Assessment**
- Apakah solusi di PRD bisa diimplementasikan dengan tech stack yang diperbolehkan?
- Apa technical debt yang perlu dihandle dulu?
- Dependency eksternal apa yang diperlukan?

**Integration Assessment**
- API/service apa yang perlu diintegrasikan?
- Apakah ada existing system yang terpengaruh?
- Risk integrasi: LOW / MEDIUM / HIGH

**Complexity Estimate**
- Frontend complexity: LOW / MEDIUM / HIGH
- Backend complexity: LOW / MEDIUM / HIGH
- Infrastructure changes: YES (detail) / NO

**Technical Risks**
- R1: [risk] → [mitigation]
- R2: [risk] → [mitigation]

### 3. Generate Brief

---
**Technical Feasibility Brief**
Feature: [nama fitur dari PRD]
Date: [tanggal]
Status: PENDING CTO APPROVAL

**Verdict: FEASIBLE / FEASIBLE WITH CONDITIONS / NOT FEASIBLE**

**Recommended Tech Stack:**
- Frontend: [framework + rationale]
- Backend: [framework + rationale]
- Database: [db + rationale]
- Infrastructure: [changes needed]

**Constraint Assessment:**
[assessment per constraint dari CTO]

**Complexity Estimate:**
- Frontend: [LOW/MED/HIGH] — [brief reasoning]
- Backend: [LOW/MED/HIGH] — [brief reasoning]
- Estimated sprint: [X sprint]

**Technical Risks:**
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| [R1] | MED | HIGH | [mitigation] |

**Conditions (jika ada):**
[kondisi yang harus dipenuhi sebelum development]

Prepared by: EM & Architecture Agent
Requires: CTO Approval before FSD generation
---

### 4. Kirim ke CTO

Notifikasi CTO bahwa Brief sudah siap untuk di-review dan approve.
`,
  },

  {
    id: 'fsd-generator',
    name: 'FSD Generator',
    slug: 'fsd-generator',
    description: 'Generate Functional Specification Document ke Google Docs setelah CTO approve Brief',
    agent: 'Agent 3 — EM & System Architecture',
    agentEmoji: '🏗️',
    category: 'EM & System Architecture',
    tags: ['em', 'fsd', 'architecture', 'google-docs', 'adlc'],
    content: `---
name: fsd-generator
description: "WAJIB DIGUNAKAN: Ketika diminta membuat FSD, functional spec, arsitektur sistem, API contract, atau technical specification — hanya setelah CTO sudah approve Technical Feasibility Brief."
---

# FSD Generator Skill

Generate Functional Specification Document lengkap setelah Technical Feasibility Brief di-approve CTO (FR-05 Output 2).

⚠️ **Prerequisite**: CTO harus sudah approve Technical Feasibility Brief. Tanya konfirmasi jika belum jelas.

## Kapan Digunakan

- CTO sudah approve Feasibility Brief
- User menyebut "buat FSD", "functional spec", "arsitektur sistem", "technical spec"
- Agent 4 (SWE) membutuhkan FSD untuk mulai coding

## Instruksi

### 1. Verifikasi Prerequisite

Konfirmasi:
- [ ] PRD sudah di-approve CPO
- [ ] Prototype dari Agent 2 tersedia
- [ ] Technical Feasibility Brief sudah di-approve CTO
- [ ] Constraint CTO sudah jelas

### 2. Generate FSD dengan Struktur Ini

**1. System Architecture**
- High-level architecture diagram (describe component dan connection-nya dalam text)
- Component list: [nama] — [purpose] — [technology]
- Data flow: [bagaimana data bergerak antar component]

**2. Tech Stack Final**
| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Frontend | [tech] | [ver] | [alasan] |
| Backend | [tech] | [ver] | [alasan] |
| Database | [tech] | [ver] | [alasan] |

**3. API Contract**
Untuk setiap endpoint:
\`\`\`
POST /api/[resource]
Auth: Bearer JWT
Request: { field: type, required: bool }
Response 200: { data: {...}, meta: {...} }
Response 400: { error: string, code: string }
Response 401: { error: "Unauthorized" }
\`\`\`

**4. Database Schema**
Untuk setiap entity utama:
\`\`\`
Table: [nama]
- id: UUID PRIMARY KEY
- [field]: [type] NOT NULL
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
\`\`\`

**5. Code Standards**
- Naming convention: [camelCase/snake_case/etc]
- Folder structure: [struktur yang disepakati]
- Error handling pattern: [standard response format]
- Testing requirement: coverage minimum 80%

**6. Non-Functional Requirements**
- Performance: [target response time]
- Security: [auth method, data encryption]
- Scalability: [expected load]

### 3. Simpan ke Google Docs

Buat dokumen FSD di Google Docs:
- Title: "FSD - [Nama Fitur] - [Tanggal]"
- Share ke Engineering Team dan CTO

### 4. Handoff ke Agent 4

Notifikasi bahwa FSD sudah ready dan Agent 4 (SWE) bisa mulai coding.
`,
  },

]
