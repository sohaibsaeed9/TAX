# Feature build status (keep this up to date)

Updated 23 Oct 2026.

## Decisions from Sohaib (answers to the gap report)
1. **Single notices store:** yes. `iris_notices` holds IRIS notices, manual notices and appeals.
2. **Letterhead phone:** +92-315-510-8858 (the portal's letter already prints "Phone: 051-2152700 / +92-315-510-8858"; confirm if the 051 landline should stay).
3. **Monthly sales-tax board:** keep it **separate** from the Return Register (its own page), because it is Sales Tax. Not inside `returns`.
4. **Bank statements:** mostly scanned PDFs, so F8 will need OCR (Tesseract.js, runs in the browser; accuracy must be checked on real statements).
5. **Order:** Phase 1 first (F1–F5), with F12 pulled forward after F4.

## Built
- **F1 + F2** (notices, appeals, limitation) on branch `feature/notices-appeals`, **draft PR #28, not merged**.
  Before it can go live: run `tools/supabase-notices-appeals.sql` in Supabase, then Sohaib reviews the PR.
  Then use the "Move them here" button on IRIS Notices to move the old Notice Tracker list.

## Next, in order
1. F4 dashboard additions (due ≤30 days, overdue count, appeal limitations, arrived since yesterday, weekly Monday checklist).
2. F5 calendar (.ics) export.
3. F3 "Draft adjournment" button (reply generator already exists).
4. F12 e-filing list match (reuse the CNIC/NTN/name matcher; also auto-mark filed in the Return Register).
5. F6 monthly sales-tax board (separate page) and F7 8B check.
6. Workbench: F8 (needs OCR), F13, F9, F10, then F11 and F14.

## Rules to keep following
Branch per feature, draft PR, screenshots at desktop and phone width, SQL in `tools/`, no client data in the repo, nothing merged until Sohaib agrees.
