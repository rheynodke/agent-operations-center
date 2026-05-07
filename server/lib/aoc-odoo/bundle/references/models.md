# Odoo Model Reference

Common Odoo model name mappings. Use `odoocli model list --search <keyword>` to discover models not listed here, or to find custom module models.

## Sales

| Business concept | Model | Lines |
|---|---|---|
| Quotations / Sales orders | `sale.order` | `sale.order.line` |
| Sales teams | `crm.team` | — |
| Leads / Opportunities | `crm.lead` | — |

## Purchase

| Business concept | Model | Lines |
|---|---|---|
| RFQ / Purchase orders | `purchase.order` | `purchase.order.line` |
| Vendor pricelists | `product.supplierinfo` | — |

## Accounting

| Business concept | Model | Lines |
|---|---|---|
| Invoices / Bills / Credit notes | `account.move` | `account.move.line` |
| Payments | `account.payment` | — |
| Payment terms | `account.payment.term` | — |
| Journal entries | `account.move` (type=`entry`) | `account.move.line` |
| Journals | `account.journal` | — |
| Chart of accounts | `account.account` | — |
| Taxes | `account.tax` | — |
| Fiscal positions | `account.fiscal.position` | — |
| Bank statements | `account.bank.statement` | `account.bank.statement.line` |
| Reconciliation | `account.reconcile.model` | — |

## Inventory / Warehouse

| Business concept | Model | Lines |
|---|---|---|
| Inventory transfers (picking) | `stock.picking` | — |
| Stock moves | `stock.move` | `stock.move.line` |
| Warehouses | `stock.warehouse` | — |
| Stock locations | `stock.location` | — |
| Inventory adjustments | `stock.quant` | — |
| Lot / Serial numbers | `stock.lot` | — |
| Delivery orders | `stock.picking` (picking_type=outgoing) | — |
| Receipts | `stock.picking` (picking_type=incoming) | — |

## Manufacturing

| Business concept | Model | Lines |
|---|---|---|
| Manufacturing orders | `mrp.production` | — |
| Bill of Materials | `mrp.bom` | `mrp.bom.line` |
| Work orders | `mrp.workorder` | — |
| Work centers | `mrp.workcenter` | — |
| Routing | `mrp.routing.workcenter` | — |

## Products

| Business concept | Model | Notes |
|---|---|---|
| Product variants | `product.product` | Actual sellable/buyable item |
| Product templates | `product.template` | Groups variants |
| Product categories | `product.category` | — |
| Units of measure | `uom.uom` | — |
| Pricelists | `product.pricelist` | `product.pricelist.item` |

## Human Resources

| Business concept | Model | Lines |
|---|---|---|
| Employees | `hr.employee` | — |
| Departments | `hr.department` | — |
| Job positions | `hr.job` | — |
| Contracts | `hr.contract` | — |
| Leave requests | `hr.leave` | — |
| Leave allocations | `hr.leave.allocation` | — |
| Expense reports | `hr.expense.sheet` | `hr.expense` |
| Attendance | `hr.attendance` | — |
| Payslips | `hr.payslip` | `hr.payslip.line` |

## Project Management

| Business concept | Model |
|---|---|
| Projects | `project.project` |
| Tasks | `project.task` |
| Timesheets | `account.analytic.line` |

## Base / Settings

| Business concept | Model |
|---|---|
| Contacts / Partners | `res.partner` |
| Users | `res.users` |
| Companies | `res.company` |
| Currencies | `res.currency` |
| Countries | `res.country` |
| Languages | `res.lang` |
| Sequences | `ir.sequence` |
| Installed modules | `ir.module.module` |
| All models (meta) | `ir.model` |
| Access rights | `ir.model.access` |
| Record rules | `ir.rule` |
| System parameters | `ir.config_parameter` |
| Scheduled actions (cron) | `ir.cron` |

## Messaging / Activity

| Business concept | Model |
|---|---|
| Chatter messages | `mail.message` |
| Mail activities | `mail.activity` |
| Mail templates | `mail.template` |
| Followers | `mail.followers` |

## How to find custom module models

```bash
# List all models from a custom module
odoocli model list --module <custom_module_name>

# Search by keyword
odoocli model list --search <keyword>

# Get module info to see what it provides
odoocli module info <custom_module_name>
```
