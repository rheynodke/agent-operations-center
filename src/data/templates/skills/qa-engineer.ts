// ─── QA Engineer Skill Templates ───────────────────────────────────────────────

import type { SkillTemplate } from '../types'

export const QA_ENGINEER_TEMPLATES: SkillTemplate[] = [

  {
    id: 'test-case-generator',
    name: 'Test Case Generator',
    slug: 'test-case-generator',
    description: 'Generate test case dari PRD — normal, negative, edge case (FR-07)',
    agent: 'Agent 5 — QA Engineer',
    agentEmoji: '🧪',
    category: 'QA Engineer',
    tags: ['qa', 'testing', 'test-case', 'google-docs', 'adlc'],
    content: `---
name: test-case-generator
description: "WAJIB DIGUNAKAN: Ketika diminta membuat test case, skenario test, atau dokumentasi QA dari PRD atau user stories."
---

# Test Case Generator Skill

Generate dokumen test case dari PRD mencakup normal, negative, dan edge case (FR-07).

## Kapan Digunakan

- PRD sudah final dan di-approve
- User menyebut "buat test case", "skenario test", "QA documentation"
- Sebelum Agent 5 mulai execution testing

## Instruksi

### 1. Parse User Stories

Dari setiap user story di PRD, extract:
- Acceptance criteria → jadi normal test scenario
- Boundary conditions → jadi edge case
- Hal yang TIDAK boleh terjadi → jadi negative test

### 2. Generate Test Cases

Untuk setiap test case:

\`\`\`
TC-[XX]: [Test Case Name]
Related US: US-[XX]
Type: NORMAL / NEGATIVE / EDGE / REGRESSION
Priority: HIGH / MEDIUM / LOW

Preconditions:
- [kondisi yang harus ada sebelum test]

Test Steps:
1. [langkah 1]
2. [langkah 2]
3. [langkah 3]

Expected Result:
- [apa yang seharusnya terjadi]

Pass Criteria:
- [ ] [kriteria pass yang measurable]
\`\`\`

### 3. Coverage Matrix

Buat matrix untuk memastikan coverage:

| User Story | Normal | Negative | Edge | Regression |
|-----------|--------|----------|------|-----------|
| US-01 | TC-01 | TC-02 | TC-03 | TC-04 |

### 4. Performance Test (jika diperlukan)

Jika NFR mencantumkan performance requirement:
- Response time test: simulasi X concurrent users
- Load test: ramp up ke Y users dalam Z menit
- Acceptance: P95 response < threshold

### 5. Simpan ke Google Docs

Buat dokumen "Test Case - [Nama Fitur] - [Tanggal]" di Google Docs.

### 6. Threshold Reminder

⚠️ Pipeline Production akan DITAHAN otomatis jika:
- Coverage < 80%
- Ada failed test yang unresolved
`,
  },

  {
    id: 'bug-reporter',
    name: 'Bug Reporter',
    slug: 'bug-reporter',
    description: 'Generate structured bug report dan buat task di Linear/Jira',
    agent: 'Agent 5 — QA Engineer',
    agentEmoji: '🧪',
    category: 'QA Engineer',
    tags: ['qa', 'bug', 'linear', 'jira', 'adlc'],
    content: `---
name: bug-reporter
description: "WAJIB DIGUNAKAN: Ketika menemukan bug, error di staging, atau test gagal — generate bug report terstruktur dan buat task di Linear/Jira."
---

# Bug Reporter Skill

Generate structured bug report dan buat task tracking setelah test execution (FR-08).

## Kapan Digunakan

- Test execution menemukan bug atau failure
- User melaporkan "ada bug", "error di staging", "test gagal"
- Coverage threshold tidak tercapai

## Instruksi

### 1. Identifikasi Bug

Kumpulkan informasi:
- Di mana bug terjadi? (screen/endpoint/module)
- Kapan terjadi? (steps to reproduce)
- Apa yang terjadi vs yang seharusnya?
- Severity: CRITICAL / HIGH / MEDIUM / LOW

### 2. Generate Bug Report

\`\`\`
BUG-[XX]: [Judul singkat yang deskriptif]
Date: [tanggal]
Reported by: QA Agent
Severity: CRITICAL / HIGH / MEDIUM / LOW
Status: OPEN

Related TC: TC-[XX]
Related US: US-[XX]

Environment:
- Staging URL: [url]
- Version/Branch: [info]
- Browser/Device: [info]

Steps to Reproduce:
1. [langkah 1]
2. [langkah 2]
3. [langkah 3]

Expected Result:
[apa yang seharusnya terjadi]

Actual Result:
[apa yang terjadi]

Impact:
[dampak ke user / bisnis]

Evidence:
- Screenshot: [link atau deskripsi]
- Log: [relevant error log]

Suggested Fix (opsional):
[hipotesis root cause dan kemungkinan fix]
\`\`\`

### 3. Buat Task di Linear/Jira

Jalankan script \`linear-create-task.sh\` dengan:
- Title: "BUG: [judul bug]"
- Priority sesuai severity
- Label: "bug", "qa-found"
- Assign ke Engineer terkait

### 4. Block Pipeline jika Critical

Jika ada bug CRITICAL atau SEVERITY HIGH yang unresolved:
- Notifikasi CTO via WhatsApp
- Block deployment ke Production
- Update test result report
`,
  },

]
