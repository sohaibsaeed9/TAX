# Feature gap report — staff portal

Audit date: 23 Oct 2026. Source: `portal.html` (main, after PR #27), `iris-module.js`, `tools/`, the computation/return-filing code merged in PRs #17–#26.
Nothing in this report has been built. Each PARTIAL / NEW item needs Sohaib's answer before any code is written.

Legend: **EXISTS** = covered, do not build · **PARTIAL** = extend the existing page · **NEW** = nothing like it exists.

## Summary

| # | Feature | Result | Where it lives / where it would go |
|---|---|---|---|
| F1 | Notices & appeals tracker | **PARTIAL** (two notice stores already) | `notices` page (manual, `sc_notices`) and `irisnotices` page (`iris_notices` table) |
| F2 | Appeal limitation calculator | **NEW** | no hits for limitation / ATIR / CIR(A) anywhere |
| F3 | Draft reply / adjournment .docx | **PARTIAL** (reply exists) | Notice Tracker → "Draft reply" (`ntOpenDraft`, `ntWord`) |
| F4 | Dashboard additions | **PARTIAL** | `dashboard` page |
| F5 | Calendar export (.ics) | **NEW** | none; would add to `deadlines` and `tasks` |
| F6 | Monthly sales-tax filing board | **NEW** (Return Register is annual) | would extend `returns` page |
| F7 | 8B minimum-payable check | **NEW** | would extend `tools` page |
| F8 | Bank statement → Dr/Cr ledger | **NEW** | would extend `tools` page |
| F9 | PDF desk (merge, stamp, page numbers) | **NEW** | would extend `tools` page |
| F10 | Certificates on letterhead | **NEW** | would extend `tools` page, reuse the existing house-format .docx builder |
| F11 | Accounts cleanup | **NEW** | would extend `tools` page |
| F12 | Return status match | **PARTIAL** | `returns` page + the client matcher already built for Filed returns |
| F13 | Rent & rental income | **NEW** | would extend `tools` page; feeds the Rental property step of Guided entry |
| F14 | SECP extract | **PARTIAL** | `secp` page (generators exist, no extraction) |

## What already exists, in detail

**Pages (`data-page`):** dashboard, clients, calculator, deadlines, tasks, notices, filing, irisnotices, irissync, returns, iris, secp, fees, invoices, comms, advisories, library, tools.

**Storage:** browser `localStorage` keys `sc_*` synced to Supabase `portal_data` (invoices, fees, tasks, notices, returns, comms, advisories, comp/filed). Supabase tables: `portal_data`, `portal_data_history`, `staff`, `iris_notices`, `iris_client_links`, `iris_jobs`, `iris_job_log`, `iris_runner`. Storage bucket `notices`.

### F1 Notices & appeals tracker — PARTIAL
- **Manual Notice Tracker** (`notices`): fields client, type (Amendment 122, Audit 177, Recovery 137, Penalty 182, Show Cause, Inquiry 176, Other), reference, date received, reply deadline, tax year, amount, notes, upload (PDF/photo → AI fills the form). Status is only **open / resolved**; filters All / Open / Overdue / Resolved. Overdue is derived from the deadline.
- **IRIS Notices** (`irisnotices`, from the runner): richer model — status New / In progress / Reply drafted / Submitted / Closed / Archived / Not our client; `internal_deadline`, `demand_amount`, `reply_draft`, due-date history ("date moved"), overdue and due-in-7-days badges, filters (section, tab, status, due, unmatched), PDF viewer, client mapping.
- **Missing vs the brief:** forum, order-served date (appeals), reference stage "Draft ready / In review", per-notice history log, "Appeals" and "Filed" filters, a progress strip.
- **Problem to decide first:** there are now two notice lists (`sc_notices` manual, `iris_notices` automatic). The brief says not to create a second list.
- **Proposal:** keep `iris_notices` as the single notices store. Add columns `kind` ('notice' | 'appeal'), `forum`, `order_date`, `stage`, `history jsonb`. Move manual entries into it (one-time import), and keep the Notice Tracker page as the manual-entry form on top of the same table. **Needs your OK.**

### F2 Appeal limitation calculator — NEW
No limitation logic exists. Would live inside the F1 notice/appeal record: forum + served date → last date to appeal, with the day-counts in one editable config (CIR(A) s.127 ITO 30 days; ATIR s.131 60; High Court s.133 90; CIR(A) s.45B STA 30; ATIR s.46 STA 60; manual). The page will show the note to confirm against the law in force.

### F3 Draft reply / adjournment — PARTIAL
- **Exists:** `ntOpenDraft` → AI drafts from the notice; `ntWord` downloads a .docx (docx.js 8.5.0 from CDN) in the house format: Tahoma 11, all black, letterhead in the header, full-page single border, A4 with margins 2000/1200/1200/1200, ref code left and date right, Re:/Sub: lines, numbered points, the closing block, "Enclosed: - As above".
- **Letterhead phone line currently reads:** `Phone: 051-2152700 / +92-315-510-8858 | Email: sohaib@saeedandcotax.com | Web: saeedandcotax.com`. The brief says the records show +92-315-510-8858 and +92-332-510-8858. **Which number do you want?**
- **Missing:** a dedicated **Draft adjournment** button (today you type "request adjournment" into the free-text instructions) and placeholders like `[ground 1]` without the AI.
- **Proposal:** add the adjournment button next to Draft reply, reusing `ntWord`. **Needs your OK.**

### F4 Dashboard — PARTIAL
- **Exists:** greeting, clock, next FBR deadline and days, Upcoming FBR Deadlines (4), Urgent Tasks, pending-changes card (admin), IRIS Payments summary, pins.
- **Missing:** due-in-30-days count, overall overdue count (only tasks today), appeal limitations ≤30 days, "came in since yesterday" (IRIS notices, manual), the weekly routine checklist that resets every Monday. (The existing "checklist" is the client document checklist in Quick Tools, not a routine.)

### F5 Calendar export — NEW
No .ics anywhere. Would add one button on Deadlines and Tasks, downloading all open items with a 2-day reminder.

### F6 Monthly sales-tax filing board — NEW
`returns` (Return Register) has year-level records only: Return Type (Income Tax, Sales Tax, Wealth Statement, WHT Statement), tax year, filing date, status Filed/Pending/Not applicable. No period, no authority (FBR/PRA/KPRA/SRB), no Ready / Data in / Awaiting data states, no 8B column. `deadlines` has the 18th-of-month sales-tax dates. **Proposal:** a "Monthly board" view inside the Return Register, same records plus `period` and `authority`. **Needs your OK.**

### F7 8B minimum payable — NEW
No "8B", no "further tax". The `calculator` page is income-tax slabs only. Would be a new card in Quick Tools.

### F8 Bank statement → ledger — NEW
Only a document checklist mentions bank statements. pdf.js and SheetJS are already loaded on demand (return-filing code), so no new library for text PDFs. Scanned statements would need OCR (Tesseract) — only if you confirm you receive scans.

### F9 PDF desk — NEW
No PDF merge/stamp ("merge" hits are data merging; "stamp" is a date helper). Needs pdf-lib from a CDN. SheetJS is present for sheets.

### F10 Certificates — NEW
Not present. The house-format .docx builder in F3 can be reused. Stamped PDF needs F9.

### F11 Accounts cleanup — NEW
Not present.

### F12 Return status match — PARTIAL
- **Exists:** Return Register (manual per client/year/type/status). Return Filing → Filed returns already matches uploaded Excel/PDF to clients by CNIC, then NTN, then close name (with review before saving), and checks workbook against IRIS return.
- **Missing:** compare the client register with the **e-filing list** (the FBR list of returns filed), pending list with an extension column, matched list, and "filed but not in register".
- **Proposal:** reuse the existing matcher; output goes to the Return Register page. **Needs your OK.**

### F13 Rent & rental income — NEW
Guided entry → Rental property takes annual rent per property. No agreement start date, yearly increase compounding, day-proration, or owner share.

### F14 SECP — PARTIAL
- **Exists:** `secp` page — SECP Compliance Suite: client select / manual entry, Form 29 (officer changes) and Form A (annual return/AGM) filing packages with due dates, fees, board resolution text, document lists, and tags.
- **Missing:** reading a Form A / Form 29 PDF to extract the shareholder list, transfers and next filing dates, with the paid-up capital check and same-name shareholders kept apart by CNIC.

## Questions for Sohaib (answer before any build)

1. **F1:** Make `iris_notices` the single notices store (extend with appeals fields, import the manual notices once)? Or keep the manual tracker separate?
2. **F3:** Which phone number on the letterhead: +92-315-510-8858 or +92-332-510-8858? And is a dedicated **Draft adjournment** button wanted?
3. **F6:** OK to add a Monthly board inside the Return Register (period + authority)? Which authorities do you file for most?
4. **F8:** Are bank statements usually text PDFs, or scans? (decides whether OCR is needed)
5. **Phase order:** the brief starts with Phase 1 (F1–F5). Confirm, or pick a different order.

## Not built, not committed to main
This report is on branch `docs/gap-report-and-status`. No feature code has been written.
