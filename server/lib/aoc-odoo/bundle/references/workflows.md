# Odoo Workflow Methods Reference

Common business methods per model. Use `odoocli model methods <model> --search action` to discover methods not listed here.

## Before calling any method

```bash
# 1. Check current state
odoocli record read <model> <id> --fields state

# 2. Check access rights
odoocli debug access <model> --id <id>

# 3. Execute
odoocli method call <model> <method> --ids <id>

# 4. Verify
odoocli record read <model> <id> --fields state
```

## Sales (`sale.order`)

| Method | Action | Needs --confirm |
|---|---|---|
| `action_confirm` | Confirm quotation → sales order | no |
| `action_cancel` | Cancel sales order | yes |
| `action_draft` | Reset to quotation (draft) | no |
| `action_quotation_sent` | Mark quotation as sent | no |

Typical flow: `draft` → `action_confirm` → `sale` → `action_cancel` or `action_done`

## Purchase (`purchase.order`)

| Method | Action | Needs --confirm |
|---|---|---|
| `button_confirm` | Confirm RFQ → purchase order | no |
| `button_cancel` | Cancel PO | yes |
| `button_draft` | Reset to draft | no |
| `button_approve` | Approve PO (if approval required) | no |

Typical flow: `draft` → `button_confirm` → `purchase` → `button_cancel` or `done`

## Invoicing (`account.move`)

| Method | Action | Needs --confirm |
|---|---|---|
| `action_post` | Post/validate invoice or bill | no |
| `button_draft` | Reset to draft | no |
| `button_cancel` | Cancel posted entry | yes |

Typical flow: `draft` → `action_post` → `posted` → `button_cancel` → `cancel`

Types: `out_invoice` (customer invoice), `in_invoice` (vendor bill), `out_refund` (credit note), `in_refund` (debit note), `entry` (journal entry)

## Payments (`account.payment`)

| Method | Action | Needs --confirm |
|---|---|---|
| `action_post` | Post payment | no |
| `action_cancel` | Cancel payment | yes |
| `action_draft` | Reset to draft | no |

## Inventory (`stock.picking`)

| Method | Action | Needs --confirm |
|---|---|---|
| `button_validate` | Validate transfer | no |
| `action_cancel` | Cancel transfer | yes |
| `action_assign` | Check availability / reserve | no |

Picking types: incoming (receipts), outgoing (delivery), internal (internal transfer)

## Manufacturing (`mrp.production`)

| Method | Action | Needs --confirm |
|---|---|---|
| `button_mark_done` | Mark MO as done | no |
| `action_cancel` | Cancel MO | yes |
| `action_confirm` | Confirm MO | no |
| `action_assign` | Check component availability | no |

## HR — Leave (`hr.leave`)

| Method | Action | Needs --confirm |
|---|---|---|
| `action_approve` | Approve leave request | no |
| `action_refuse` | Refuse leave request | no |
| `action_draft` | Reset to draft | no |
| `action_confirm` | Submit for approval | no |

## HR — Expense (`hr.expense.sheet`)

| Method | Action | Needs --confirm |
|---|---|---|
| `action_submit_sheet` | Submit for approval | no |
| `approve_expense_sheets` | Approve expense report | no |
| `action_sheet_refuse` | Refuse expense report | no |

## Generic methods (available on most models)

| Method | Type | Description |
|---|---|---|
| `message_post` | messaging | Post a message in chatter |
| `message_subscribe` | messaging | Subscribe partners to notifications |
| `activity_schedule` | messaging | Schedule an activity |
| `copy` | crud | Duplicate record |
| `name_get` | crud | Get display name |
| `default_get` | introspection | Get default field values |

### Using message_post

```bash
odoocli method call sale.order message_post --ids 42 --kwargs '{"body": "Reviewed by agent", "message_type": "comment"}'
```

## Discovering methods for other models

```bash
# List all methods
odoocli model methods <model>

# Search for action methods
odoocli model methods <model> --search action
odoocli model methods <model> --search button
odoocli model methods <model> --search confirm
odoocli model methods <model> --search validate
```
