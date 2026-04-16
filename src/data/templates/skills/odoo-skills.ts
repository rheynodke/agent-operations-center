// ─── Odoo Skills Skill Templates ──────────────────────────────────────────
// Uses aoc-connect.sh wrapper — credentials handled automatically by AOC
// Command format: aoc-connect.sh "<conn>" <command> <subcommand> [options]

import type { SkillTemplate } from '../types'

export const ODOO_SKILL_TEMPLATES: SkillTemplate[] = [

  {
    id: 'odoocli-core',
    name: 'OdooCLI (via AOC Connect)',
    slug: 'odoocli-core',
    description: 'Akses penuh Odoo ERP via aoc-connect.sh — CRUD, business methods, discovery, debug. Credentials dikelola otomatis oleh AOC.',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'erp', 'xmlrpc', 'aoc-connect', 'crud', 'dke'],
    content: `---
name: odoocli-core
description: "WAJIB DIGUNAKAN: ketika perlu akses data Odoo ERP — search records, CRUD operasi, inspect model/fields, execute business methods, atau debug relasi via XML-RPC. Covers semua module Odoo: sales, purchase, accounting, inventory, manufacturing, HR, project, timesheet, dan custom modules."
---

# OdooCLI — Odoo ERP Access via aoc-connect.sh

Interaksi dengan Odoo ERP instance via XML-RPC menggunakan \\\`aoc-connect.sh\\\` wrapper. Credentials dikelola otomatis — **JANGAN** hardcode URL, database, atau password.

<HARD-GATE>
SELALU gunakan aoc-connect.sh — JANGAN hardcode credentials atau URL.
SELALU discover fields sebelum create/write — JANGAN assume field names.
SELALU verify setelah write — baca kembali record yang baru dibuat/diupdate.
Delete dan destructive methods WAJIB --confirm dan tanya user dulu.
Bulk operations (>5 records) — konfirmasi dengan user dulu.
</HARD-GATE>

## Checklist

You MUST create a TodoWrite task for each item and complete them in order:

1. **Check Connection** — Jalankan \\\`check_connections.sh odoocli\\\` untuk list koneksi Odoo
2. **Discover** — Inspect model/fields sebelum query/write
3. **Execute** — Jalankan operasi (search/read/create/write/method)
4. **Verify** — Baca kembali hasil untuk konfirmasi
5. **Output** — Sampaikan hasil ke user dalam format markdown table

## Cek Koneksi

\\\`\\\`\\\`bash
check_connections.sh odoocli
\\\`\\\`\\\`

## Command Format

\\\`\\\`\\\`bash
aoc-connect.sh "<nama-connection>" <command> <subcommand> [options] [args]
\\\`\\\`\\\`

## 1. Authentication

\\\`\\\`\\\`bash
aoc-connect.sh "<conn>" auth test          # verify connection
aoc-connect.sh "<conn>" auth whoami        # current user info
\\\`\\\`\\\`

## 2. Discovery — Models, Fields, Methods

\\\`\\\`\\\`bash
# Find models
aoc-connect.sh "<conn>" model list --search "sale"
aoc-connect.sh "<conn>" model list --module sale

# Inspect fields (WAJIB sebelum create/write)
aoc-connect.sh "<conn>" model fields sale.order                    # all fields
aoc-connect.sh "<conn>" model fields sale.order --required         # mandatory only
aoc-connect.sh "<conn>" model fields sale.order --type many2one    # relationships
aoc-connect.sh "<conn>" model fields sale.order --stored           # exclude computed

# Discover methods
aoc-connect.sh "<conn>" model methods sale.order
aoc-connect.sh "<conn>" model methods sale.order --search confirm
\\\`\\\`\\\`

## 3. CRUD

\\\`\\\`\\\`bash
# Search
aoc-connect.sh "<conn>" record search sale.order --domain "[('state','=','draft')]" --fields name,state,partner_id --limit 20
aoc-connect.sh "<conn>" record search sale.order --domain "[('state','=','sale')]" --count
aoc-connect.sh "<conn>" record search sale.order --order "create_date desc" --limit 10

# Read
aoc-connect.sh "<conn>" record read sale.order 42 --fields name,state,amount_total
aoc-connect.sh "<conn>" record read sale.order 42,43,44

# Create (inspect required fields dulu!)
aoc-connect.sh "<conn>" model fields res.partner --required
aoc-connect.sh "<conn>" record create res.partner --values '{"name":"John Doe","email":"john@example.com"}'

# Update
aoc-connect.sh "<conn>" record write res.partner 42 --values '{"phone":"08123456789"}'

# Delete (tanya user dulu!)
aoc-connect.sh "<conn>" record delete res.partner 42 --confirm
\\\`\\\`\\\`

## 4. Business Methods

\\\`\\\`\\\`bash
# Execute method
aoc-connect.sh "<conn>" method call sale.order action_confirm --ids 42
aoc-connect.sh "<conn>" method call sale.order message_post --ids 42 --kwargs '{"body":"Reviewed by agent"}'
\\\`\\\`\\\`

| Model | Method | Action | --confirm |
|-------|--------|--------|-----------|
| \\\`sale.order\\\` | \\\`action_confirm\\\` | Confirm quotation → SO | no |
| \\\`sale.order\\\` | \\\`action_cancel\\\` | Cancel SO | yes |
| \\\`purchase.order\\\` | \\\`button_confirm\\\` | Confirm RFQ → PO | no |
| \\\`account.move\\\` | \\\`action_post\\\` | Post/validate invoice | no |
| \\\`stock.picking\\\` | \\\`button_validate\\\` | Validate transfer | no |
| \\\`account.payment\\\` | \\\`action_post\\\` | Post payment | no |
| \\\`hr.leave\\\` | \\\`action_approve\\\` | Approve leave | no |

## 5. Debug

\\\`\\\`\\\`bash
# Inspect record (all fields + values)
aoc-connect.sh "<conn>" debug inspect sale.order 42 --non-empty
aoc-connect.sh "<conn>" debug inspect sale.order 42 --resolve --non-empty

# Trace relational chain
aoc-connect.sh "<conn>" debug trace sale.order 42 --depth 2
aoc-connect.sh "<conn>" debug trace sale.order 42 --path order_line,picking_ids,invoice_ids

# Read chatter/logs
aoc-connect.sh "<conn>" debug log sale.order 42 --limit 10

# Check access rights
aoc-connect.sh "<conn>" debug access sale.order --id 42
\\\`\\\`\\\`

## Common Models

| Business concept | Model |
|-----------------|-------|
| Sales orders | \\\`sale.order\\\` / \\\`sale.order.line\\\` |
| Purchase orders | \\\`purchase.order\\\` / \\\`purchase.order.line\\\` |
| Invoices/Bills | \\\`account.move\\\` / \\\`account.move.line\\\` |
| Inventory transfers | \\\`stock.picking\\\` / \\\`stock.move\\\` |
| Products | \\\`product.product\\\` / \\\`product.template\\\` |
| Contacts/Customers | \\\`res.partner\\\` |
| Employees | \\\`hr.employee\\\` |
| Timesheets | \\\`account.analytic.line\\\` |
| Projects | \\\`project.project\\\` / \\\`project.task\\\` |
| Manufacturing | \\\`mrp.production\\\` |
| Payments | \\\`account.payment\\\` |
| Leads/CRM | \\\`crm.lead\\\` |

## Domain Syntax

\\\`\\\`\\\`
"[('state','=','draft')]"
"[('state','=','draft'),('partner_id','!=',False)]"
"[('amount_total','>',1000)]"
"[('name','ilike','keyword')]"
"['|',('name','ilike','test'),('amount_total','>',1000)]"
"[('date_order','>=','2026-01-01'),('date_order','<=','2026-12-31')]"
\\\`\\\`\\\`

**PENTING**: Gunakan \\\`False\\\` (capital F) bukan \\\`false\\\` untuk Python boolean di domain.

## Error Handling

| Code | Action |
|------|--------|
| \\\`AUTH_FAILED\\\` | Credentials expired — hubungi operator |
| \\\`CONNECTION_ERROR\\\` | Check URL/network |
| \\\`NOT_FOUND\\\` | Verify ID/model exists |
| \\\`ACCESS_DENIED\\\` | \\\`debug access <model>\\\` untuk cek rights |
| \\\`CONFIRM_REQUIRED\\\` | Add \\\`--confirm\\\` flag |
| \\\`INVALID_DOMAIN\\\` | Check domain syntax — Python syntax, bukan JSON |

Semua output dalam format JSON. Parse dan format ke markdown table untuk response ke user.
`,
  },

  {
    id: 'odoo-daily-check',
    name: 'Odoo Daily Check',
    slug: 'odoo-daily-check',
    description: 'Cek kesehatan project Odoo setiap pagi — overdue tasks, stale tasks, dan status timesheet hari ini via aoc-connect.sh',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'daily', 'insight', 'heartbeat', 'dke', 'aoc-connect'],
    content: `---
name: odoo-daily-check
description: "WAJIB DIGUNAKAN: Setiap pagi atau heartbeat harian — cek status project Odoo, overdue tasks, stale tasks, dan apakah timesheet sudah diisi hari ini."
---

# Odoo Daily Check

Cek kondisi harian Odoo menggunakan \\\`aoc-connect.sh\\\`. Credentials dikelola otomatis.

<HARD-GATE>
SELALU jalankan check_connections.sh odoocli dulu — jika tidak ada koneksi, informasikan ke user.
JANGAN hardcode credentials atau URL.
</HARD-GATE>

## Kapan Digunakan

- Heartbeat pagi (setiap hari kerja)
- User menyebut "cek odoo", "ada apa di odoo", "status project hari ini"
- Sebelum mulai kerja untuk tahu prioritas

## Instruksi

### 1. Cek Koneksi

\\\`\\\`\\\`bash
check_connections.sh odoocli
\\\`\\\`\\\`

Pilih koneksi yang sesuai (misalnya "DKE Odoo").

### 2. Cek Timesheet Hari Ini

\\\`\\\`\\\`bash
TODAY=$(date +%Y-%m-%d)
aoc-connect.sh "DKE Odoo" record search account.analytic.line \\
  --domain "[('employee_id.user_id','=',uid),('date','=','$TODAY')]" \\
  --fields name,unit_amount,task_id,project_id --limit 50
\\\`\\\`\\\`

### 3. Cek Overdue Tasks

\\\`\\\`\\\`bash
TODAY=$(date +%Y-%m-%d)
aoc-connect.sh "DKE Odoo" record search project.task \\
  --domain "[('user_ids.login','=','me'),('date_deadline','<','$TODAY'),('stage_id.closed','=',False)]" \\
  --fields name,date_deadline,project_id,stage_id --limit 20
\\\`\\\`\\\`

### 4. Cek Stale Tasks (>3 hari tidak update)

\\\`\\\`\\\`bash
STALE=$(date -d '3 days ago' +%Y-%m-%d 2>/dev/null || date -v-3d +%Y-%m-%d)
aoc-connect.sh "DKE Odoo" record search project.task \\
  --domain "[('user_ids.login','=','me'),('write_date','<','$STALE'),('stage_id.closed','=',False)]" \\
  --fields name,write_date,project_id,stage_id --limit 20
\\\`\\\`\\\`

### 5. Cek In-Progress Tasks

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" record search project.task \\
  --domain "[('user_ids.login','=','me'),('stage_id.name','ilike','progress')]" \\
  --fields name,project_id,stage_id,date_deadline --limit 20
\\\`\\\`\\\`

### 6. Format Ringkasan

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
`,
  },

  {
    id: 'odoo-timesheet-log',
    name: 'Odoo Timesheet Logger',
    slug: 'odoo-timesheet-log',
    description: 'Log jam kerja ke Odoo ketika user menyebut selesai mengerjakan sesuatu atau minta catat waktu — via aoc-connect.sh',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'timesheet', 'logging', 'dke', 'aoc-connect'],
    content: `---
name: odoo-timesheet-log
description: "WAJIB DIGUNAKAN: Ketika user menyebut selesai mengerjakan task, minta log jam, atau catat waktu kerja ke Odoo. Termasuk frasa seperti 'catat 2 jam', 'log ke odoo', 'timesheet', 'udah selesai X jam'."
---

# Odoo Timesheet Logger

Log jam kerja ke Odoo Timesheet menggunakan \\\`aoc-connect.sh\\\`. Credentials dikelola otomatis.

<HARD-GATE>
SELALU cek check_connections.sh odoocli dulu.
SELALU tanya task ID atau nama task sebelum log.
JANGAN log tanpa konfirmasi jam dan task dari user.
</HARD-GATE>

## Kapan Digunakan

- User menyebut "catat jam", "log timesheet", "udah kerja X jam"
- User bilang selesai mengerjakan sesuatu dan minta dicatat
- Akhir hari sebagai reminder untuk isi timesheet

## Instruksi

### 1. Cek Koneksi

\\\`\\\`\\\`bash
check_connections.sh odoocli
\\\`\\\`\\\`

### 2. Kumpulkan Informasi

Sebelum log, pastikan ada:
- **Task ID atau nama task** → apa yang dikerjakan?
- **Jumlah jam** → berapa lama? (bisa desimal: 1.5 = 1 jam 30 menit)
- **Deskripsi** → apa yang dilakukan?
- **Tanggal** → hari ini atau tanggal spesifik?

### 3. Cari Task Jika Belum Ada ID

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" record search project.task \\
  --domain "[('name','ilike','nama task')]" \\
  --fields name,project_id,stage_id --limit 10
\\\`\\\`\\\`

Tampilkan hasil dan minta user konfirmasi task yang dimaksud.

### 4. Dapatkan Employee ID

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" auth whoami
# Ambil user id, lalu cari employee_id
aoc-connect.sh "DKE Odoo" record search hr.employee \\
  --domain "[('user_id','=',USER_ID)]" \\
  --fields name,id --limit 1
\\\`\\\`\\\`

### 5. Dapatkan Project ID dari Task

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" record read project.task TASK_ID --fields name,project_id
\\\`\\\`\\\`

### 6. Log Timesheet

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" record create account.analytic.line \\
  --values '{"name":"Deskripsi singkat","unit_amount":JAM,"task_id":TASK_ID,"project_id":PROJECT_ID,"employee_id":EMP_ID,"date":"YYYY-MM-DD"}'
\\\`\\\`\\\`

### 7. Verifikasi

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" record read account.analytic.line NEW_ID \\
  --fields name,unit_amount,task_id,project_id,date
\\\`\\\`\\\`

Informasikan ke user: ✅ Timesheet dicatat: **X jam** untuk task "[nama]" — [tanggal]

### 8. Cek Summary Hari Ini

\\\`\\\`\\\`bash
TODAY=$(date +%Y-%m-%d)
aoc-connect.sh "DKE Odoo" record search account.analytic.line \\
  --domain "[('employee_id','=',EMP_ID),('date','=','$TODAY')]" \\
  --fields name,unit_amount,task_id --limit 50
\\\`\\\`\\\`

## Error Handling

- **Task tidak ditemukan** → Cari ulang atau tanya ID yang benar
- **Jam tidak valid** → Harus angka, bisa desimal (1.5 = 1 jam 30 menit)
- **Access denied** → \\\`aoc-connect.sh "<conn>" debug access account.analytic.line\\\`
`,
  },

  {
    id: 'odoo-task-manager',
    name: 'Odoo Task Manager',
    slug: 'odoo-task-manager',
    description: 'Cari, baca, update status/stage task di Odoo project — via aoc-connect.sh',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'task', 'project', 'update', 'stage', 'dke', 'aoc-connect'],
    content: `---
name: odoo-task-manager
description: "WAJIB DIGUNAKAN: Ketika user minta cari task, update status task, pindah stage, assign task, atau lihat detail task di Odoo project."
---

# Odoo Task Manager

Manage project tasks di Odoo menggunakan \\\`aoc-connect.sh\\\`. Credentials dikelola otomatis.

<HARD-GATE>
SELALU check_connections.sh odoocli dulu.
SELALU read task dulu sebelum write — verifikasi state sebelum update.
Tanya konfirmasi sebelum update stage atau assign ulang task.
</HARD-GATE>

## Kapan Digunakan

- User minta "cari task X", "update status task", "pindah ke done"
- User tanya "task apa yang lagi in progress"
- User minta assign task ke orang lain

## Instruksi

### 1. Cek Koneksi

\\\`\\\`\\\`bash
check_connections.sh odoocli
\\\`\\\`\\\`

### 2. Cari Tasks

\\\`\\\`\\\`bash
# My open tasks
aoc-connect.sh "DKE Odoo" record search project.task \\
  --domain "[('user_ids.login','=','me'),('stage_id.closed','=',False)]" \\
  --fields name,project_id,stage_id,date_deadline,priority --limit 20

# Search by name
aoc-connect.sh "DKE Odoo" record search project.task \\
  --domain "[('name','ilike','keyword')]" \\
  --fields name,project_id,stage_id,user_ids --limit 10

# Tasks by project
aoc-connect.sh "DKE Odoo" record search project.task \\
  --domain "[('project_id.name','ilike','project name')]" \\
  --fields name,stage_id,user_ids,date_deadline --limit 30
\\\`\\\`\\\`

### 3. Baca Detail Task

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" debug inspect project.task TASK_ID --non-empty --resolve
\\\`\\\`\\\`

### 4. Cari Available Stages

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" record search project.task.type \\
  --fields name,sequence --limit 20
\\\`\\\`\\\`

### 5. Update Stage Task

\\\`\\\`\\\`bash
# Tanya konfirmasi dulu ke user!
aoc-connect.sh "DKE Odoo" record write project.task TASK_ID \\
  --values '{"stage_id": STAGE_ID}'

# Verifikasi
aoc-connect.sh "DKE Odoo" record read project.task TASK_ID --fields name,stage_id
\\\`\\\`\\\`

### 6. Update Fields Lain

\\\`\\\`\\\`bash
# Set deadline
aoc-connect.sh "DKE Odoo" record write project.task TASK_ID \\
  --values '{"date_deadline": "2026-04-30"}'

# Set priority (0=normal, 1=high)
aoc-connect.sh "DKE Odoo" record write project.task TASK_ID \\
  --values '{"priority": "1"}'

# Update description
aoc-connect.sh "DKE Odoo" record write project.task TASK_ID \\
  --values '{"description": "<p>Update keterangan task</p>"}'
\\\`\\\`\\\`

### 7. Post Message ke Chatter

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" method call project.task message_post \\
  --ids TASK_ID \\
  --kwargs '{"body": "Progress update dari agent: sudah selesai bagian X"}'
\\\`\\\`\\\`

## Format Output

Tampilkan task list dalam format tabel:

| Task | Project | Stage | Deadline | Priority |
|------|---------|-------|----------|----------|
| [name] | [project] | [stage] | [date] | [normal/high] |
`,
  },

  {
    id: 'odoo-sales-monitor',
    name: 'Odoo Sales Monitor',
    slug: 'odoo-sales-monitor',
    description: 'Monitor quotations, sales orders, dan pipeline penjualan di Odoo via aoc-connect.sh',
    agent: 'Odoo — DKE Internal Tools',
    agentEmoji: '🟣',
    category: 'Odoo Skills',
    tags: ['odoo', 'odoocli', 'sales', 'quotation', 'pipeline', 'dke', 'aoc-connect'],
    content: `---
name: odoo-sales-monitor
description: "WAJIB DIGUNAKAN: Ketika user tanya status sales, pipeline penjualan, quotation, atau sales orders di Odoo."
---

# Odoo Sales Monitor

Monitor sales pipeline di Odoo menggunakan \\\`aoc-connect.sh\\\`. Credentials dikelola otomatis.

<HARD-GATE>
SELALU check_connections.sh odoocli dulu.
Untuk confirm/cancel order — tanya user dulu, gunakan --confirm untuk destructive actions.
</HARD-GATE>

## Kapan Digunakan

- User tanya "sales hari ini", "quotation pending", "SO yang belum dibayar"
- User minta konfirmasi atau cancel quotation
- Monitor pipeline penjualan

## Instruksi

### 1. Cek Koneksi

\\\`\\\`\\\`bash
check_connections.sh odoocli
\\\`\\\`\\\`

### 2. Lihat Draft Quotations

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" record search sale.order \\
  --domain "[('state','=','draft')]" \\
  --fields name,partner_id,amount_total,create_date --limit 20 \\
  --order "create_date desc"
\\\`\\\`\\\`

### 3. Lihat Confirmed Sales Orders

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" record search sale.order \\
  --domain "[('state','=','sale')]" \\
  --fields name,partner_id,amount_total,date_order --limit 20 \\
  --order "date_order desc"
\\\`\\\`\\\`

### 4. Sales Hari Ini

\\\`\\\`\\\`bash
TODAY=$(date +%Y-%m-%d)
aoc-connect.sh "DKE Odoo" record search sale.order \\
  --domain "[('date_order','>=','$TODAY 00:00:00'),('state','in',['sale','done'])]" \\
  --fields name,partner_id,amount_total,state --limit 50
\\\`\\\`\\\`

### 5. Detail Order

\\\`\\\`\\\`bash
aoc-connect.sh "DKE Odoo" debug inspect sale.order ORDER_ID --non-empty --resolve
\\\`\\\`\\\`

### 6. Konfirmasi Quotation (tanya user dulu!)

\\\`\\\`\\\`bash
# Check state dulu
aoc-connect.sh "DKE Odoo" record read sale.order ORDER_ID --fields name,state,amount_total

# Konfirmasi
aoc-connect.sh "DKE Odoo" method call sale.order action_confirm --ids ORDER_ID

# Verifikasi
aoc-connect.sh "DKE Odoo" record read sale.order ORDER_ID --fields name,state
\\\`\\\`\\\`

### 7. Pipeline Summary

\\\`\\\`\\\`bash
# Count per state
aoc-connect.sh "DKE Odoo" record search sale.order --domain "[('state','=','draft')]" --count
aoc-connect.sh "DKE Odoo" record search sale.order --domain "[('state','=','sale')]" --count
aoc-connect.sh "DKE Odoo" record search sale.order --domain "[('state','=','done')]" --count
\\\`\\\`\\\`

## Format Output

| Order | Customer | Total | Status | Date |
|-------|----------|-------|--------|------|
| [name] | [partner] | [amount] | [state] | [date] |
`,
  },

]
