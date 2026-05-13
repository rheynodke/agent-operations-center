# Project / Task / Timesheet Playbook

## 1. Scope
- Models: `project.project`, `project.task`, `account.analytic.line` (timesheet entry).
- Modules: `project`, `hr_timesheet` (extends `account.analytic.line`).
- Tested for Odoo 16 / 17 / 18. Version differences flagged in §6.

## 2. Trigger Phrases
- ID: "timesheet", "jam kerja", "log time", "task/tugas saya/ku", "project saya/ku", "berapa jam hari ini", "lapor jam".
- EN: "my tasks", "my projects", "log hours", "logged time", "today's timesheet", "this week".

## 3. Pre-flight
After the standard pre-flight (`odoo-list.sh` → `odoo-whoami.sh`), capture from whoami output:
- `UID=<uid>`
- `TZ=<tz>`
- `EMP_ID=<employee_id>` (may be null if HR not installed)
- `TODAY=$(TZ="$TZ" date +%F)`

If `EMP_ID` is null and the user wants to **create** a timesheet entry, warn:
"Modul HR/employee belum terkait — saya tidak bisa attach `employee_id` saat log time. Lanjut tanpa employee_id?"

## 4. Default Scoping Rule
Every query in §5 filters `user_id = $UID` (or `user_ids` containing `$UID`, see §6).
Override only if the user explicitly says: "tim", "semua", "all", "everyone", "user X", "siapa saja".

For `project.project`, default uses an OR pattern: `user_id` OR `favorite_user_ids`.

## 5. Common Queries

### Intent: "total timesheet hari ini" / "berapa jam hari ini"
```bash
odoo.sh <conn> record search account.analytic.line \
  --domain "[('date','=','$TODAY'),('user_id','=',$UID)]" \
  --fields date,name,unit_amount,project_id,task_id
```
**Output shape:** array of `{id, date, name, unit_amount, project_id:[id,name], task_id:[id,name]}`.
**Aggregation:** total = `sum(unit_amount)`. Format: "Total: X.X jam (Y entri)" + breakdown per entry.

### Intent: "timesheet minggu ini"
```bash
WEEK_START=$(TZ="$TZ" date -v-monday +%F 2>/dev/null || date -d "monday -7 days" +%F)
WEEK_END=$(TZ="$TZ" date -v+sunday +%F 2>/dev/null || date -d "sunday" +%F)
odoo.sh <conn> record search account.analytic.line \
  --domain "[('date','>=','$WEEK_START'),('date','<=','$WEEK_END'),('user_id','=',$UID)]" \
  --fields date,name,unit_amount,project_id,task_id
```
**Aggregation:** weekly total + group by `date` for daily breakdown.

### Intent: "task aktif saya" / "tugas saya"
```bash
# Odoo 17+: user_ids (many2many)
odoo.sh <conn> record search project.task \
  --domain "[('user_ids','in',$UID),('stage_id.fold','=',False)]" \
  --fields name,project_id,stage_id,date_deadline,priority
```
If error mentions `user_ids` → fallback (Odoo ≤16):
```bash
odoo.sh <conn> record search project.task \
  --domain "[('user_id','=',$UID),('stage_id.fold','=',False)]" \
  --fields name,project_id,stage_id,date_deadline,priority
```

### Intent: "project saya"
```bash
odoo.sh <conn> record search project.project \
  --domain "['|',('user_id','=',$UID),('favorite_user_ids','in',$UID),('active','=',True)]" \
  --fields name,user_id,partner_id,date_start,date
```

### Intent: "log timesheet" / "tambah jam"
Pre-validation: user must supply task_id OR project_id, hours, description.
```bash
# resolve project from task if needed
odoo.sh <conn> record read project.task <task_id> --fields project_id,name

# create
odoo.sh <conn> record create account.analytic.line \
  --values "{\"date\":\"$TODAY\",\"name\":\"<deskripsi>\",\"unit_amount\":<jam>,\"project_id\":<project_id>,\"task_id\":<task_id>,\"user_id\":$UID,\"employee_id\":$EMP_ID}"

# verify
odoo.sh <conn> record read account.analytic.line <new_id>
```

### Intent: "timesheet terakhir" / "last timesheet" / "timesheet terakhir kapan"
```bash
odoo.sh <conn> record search account.analytic.line \
  --domain "[('user_id','=',$UID),('date','<=','$TODAY')]" \
  --fields date,name,unit_amount,project_id,task_id \
  --order "date desc, id desc" \
  --limit 1
```
**Output shape:** array (0 atau 1 element).
**Display:** "Timesheet terakhir kamu: <date> — <name> (<unit_amount> jam, project <project_id[1]>, task <task_id[1]>)".
**Note:** filter `date <= $TODAY` mencegah future-dated Time Off entries muncul (lihat §6 pitfall "future-dated"). Jika user spesifik minta "kerja terakhir" (bukan cuti), tambah `('task_id.name','!=','Time Off')` ke domain.

## 6. Common Pitfalls

### Pitfall: many2one/integer value diquote sebagai string
**Gejala:** `--domain "[('user_id','=','28')]"` returns `[]` even though data exists.
**Root cause:** Odoo XML-RPC parses `'28'` as a string; `user_id` is Many2one (int). Type mismatch returns no rows.
**Cara hindari:** for Many2one / Integer fields, value WITHOUT quotes: `('user_id','=',28)`. Quote only Char / Date / Selection.
**Reference:** session `agent:migi:main` 2026-05-07 turn 20.

### Pitfall: `--order` tanpa quote
**Gejala:** `--order date desc` → `Error: Got unexpected extra argument (desc)`.
**Cara hindari:** quote as a single argument: `--order "date desc"` or `--order "date DESC, id DESC"`.
**Reference:** same session, turn 22.

### Pitfall: Login Odoo ≠ username chat (Telegram/Slack/dll)
**Gejala:** `record search res.users --domain "[('login','=','rheynoapria')]"` returns `[]`.
**Cara hindari:** NEVER guess login. Always run `odoo-whoami.sh <conn>` — it reads `odooUsername` from connection metadata.
**Reference:** turn 16.

### Pitfall: Date filter pakai TZ server, bukan user
**Gejala:** "timesheet hari ini" returns yesterday's / tomorrow's data.
**Root cause:** `date +%F` uses shell TZ (often UTC), not the user's TZ.
**Cara hindari:** always `TZ="$TZ" date +%F` where `$TZ` comes from `odoo-whoami.sh`.

### Pitfall: `user_ids` vs `user_id` di project.task
**Gejala:** `Invalid field 'user_id'` (Odoo 17+) or `Invalid field 'user_ids'` (≤16).
**Cara hindari:** when in doubt, `odoo.sh <conn> model fields project.task --type many2one,many2many | grep -i user`. Default try `user_ids` (17+), fallback `user_id`.

### Pitfall: Aggregate dari `--limit N` tanpa filter benar
**Gejala:** "Total = X jam" calculated from a `--limit 5` query without proper user/date filter — accidental match for first few rows.
**Cara hindari:** for aggregation, no `--limit`. Use `--count` for counts; fetch full result for sums. Always confirm filters before aggregating.
**Reference:** turn 28-30.

### Pitfall: Multiple connections assigned, none match user intent
**Gejala:** Agent memaksa query lewat connection generic (mis. an admin-shared production Odoo) padahal user nanya timesheet pribadi — hasilnya kosong, atau hanya muncul "Time Off" / vacation entries dari instance lain.
**Root cause:** Agent tidak memeriksa `description`/`name` connection sebelum memilih, atau hanya ada 1 connection yang scope-nya tidak sesuai intent.
**Cara hindari:** dari `odoo-list.sh`, cocokkan `description` atau `name` dengan intent user. Untuk timesheet/task/project, prefer connection yang nama atau description-nya memuat kata "task", "timesheet", "project", atau employee-specific. Kalau **tidak ada** connection yang cocok, JANGAN brute-force pakai connection lain — STOP dan minta user assign connection yang sesuai. Contoh respon: "Saya hanya melihat connection 'X' (deskripsi: ...). Untuk timesheet pribadi, mohon assign connection yang lebih spesifik (mis. 'My Tasks and Timesheet') lewat AOC dashboard."
**Reference:** previously-observed incident — agent picked an admin shared production connection for a personal-timesheet question and only got Time Off entries from an unrelated tenant.

### Pitfall: "Last timesheet" returns future-dated Time Off entries
**Gejala:** Query `record search account.analytic.line ... --order "date desc" --limit 1` mengembalikan entry tanggal masa depan (mis. 2026-05-27 padahal hari ini 2026-05-08), biasanya `name = "Time Off (X/Y)"`.
**Root cause:** Odoo izinkan create timesheet entry untuk tanggal apa pun. "Time Off" / vacation entries sering di-pre-create/schedule di masa depan untuk planned leave.
**Cara hindari:** untuk intent "last timesheet" / "timesheet terakhir", SELALU tambahkan `('date','<=','$TODAY')` ke domain. Untuk "kemarin" gunakan `('date','=','$YESTERDAY')`. Jika user ingin "actual work logged" (bukan cuti), tambah `('task_id.name','!=','Time Off')` atau exclude project bernama "Internal/Time Off" sesuai konvensi instance.
**Reference:** previously-observed incident — agent returned future-dated entries (e.g. 27 May while "today" was 8 May) and unrelated past Time Off entries, instead of the user's last actual work entry.

### Pitfall: Hallucinating helper script names
**Gejala:** Agent panggil `odoo-timesheet.sh`, `odoo-tasks.sh`, atau script lain yang tidak ada → exit code 127 / "command not found".
**Root cause:** Asumsi dari training data atau memory residual.
**Cara hindari:** SATU-SATUNYA helper script yang ada di skill ini adalah `odoo-list.sh`, `odoo.sh`, dan `odoo-whoami.sh`. Untuk operasi modul-spesifik, **selalu** lewat `odoo.sh <conn> <subcommand>` mengikuti command yang ada di playbook §5 ini. Jangan tebak path.

## 7. Override Patterns

| User says | Modification |
|---|---|
| "timesheet tim" / "semua orang" | Drop `user_id` filter; add `user_id` to `--fields`; group display by user. |
| "timesheet user X" | Resolve via `record search res.users --domain "[('name','ilike','X')]"`, replace `$UID` with the resolved id. |
| "bulan ini" | `MONTH_START=$(TZ=$TZ date +%Y-%m-01)`; compute month-end. |
| "tanggal Y sampai Z" | Use `('date','>=','Y')` and `('date','<=','Z')`. |
| "project P" | Add `('project_id.name','ilike','P')` to domain. |

## 8. Advanced / Custom

For requests outside §5, use this discovery starter:

```bash
# 1. Discover model
odoo.sh <conn> model list --search timesheet

# 2. Discover relevant fields
odoo.sh <conn> model fields account.analytic.line --required
odoo.sh <conn> model fields account.analytic.line --type many2one

# 3. Build domain — remember §6 pitfalls
```

Key models / fields:
- `account.analytic.line` — date, user_id, project_id, task_id, unit_amount, name, employee_id
- `project.task` — name, project_id, user_ids/user_id, stage_id, date_deadline, priority, kanban_state, parent_id
- `project.project` — name, user_id, partner_id, favorite_user_ids, task_count, allow_timesheets
