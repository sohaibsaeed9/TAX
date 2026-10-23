# IRIS notice extractor — where we left off

Updated 23 Oct 2026, end of day. Read this first when resuming.

## Done
- **Website (live on main, PR #27):** IRIS Notices page, IRIS Sync page, client profile "IRIS Correspondence" tab. Admin sees both pages, reviewer sees Notices only, staff neither.
- **Supabase:** `001_iris.sql` and `002_runner_lockdown.sql` have been run. Policies confirmed (`data_read`, `staff_read` use `is_portal_staff()`; `notices_read` limits the runner to `iris/`). Runner user `runner@saeedandcotax.com` exists and is in `public.staff` with role `runner`. Staff table currently has only `sohaib` (admin) and `runner`.
- **Office PC:** Python 3.14.6 installed. Runner folder at `C:\IRIS RUNNER` (venv built, Playwright Chromium installed). `config.json` filled in (key + runner password; never share it). IRIS login saved with `python iris_notices.py login` ("Session saved").

## Stopped at
`python import_existing.py --dry-run` failed twice, both environment problems on this PC:
1. It could not find the register, because OneDrive here is on D:. Fix: set `IRIS_OUT_DIR`.
2. `UnicodeDecodeError` reading the register (Windows reads files as cp1252, register is UTF-8). Fix: set `PYTHONUTF8=1`.
The register file itself exists (`Test-Path` returned True).

## To resume (office PC, PowerShell, check the first letter of each line before Enter)
```
cd "C:\IRIS RUNNER"
.venv\Scripts\activate
$env:IRIS_OUT_DIR="D:\OFFICE\OneDrive - S. Saeed and Co\S. SAEED AND CO - Saeed and Co\CORRESPONDENCES FOLDER\IRIS NOTICES"
$env:PYTHONUTF8="1"
python import_existing.py --dry-run
```
Expect `Register: N notices · to send: N (… with PDF)`. If right, run it without `--dry-run`.

## Then
1. Make the two settings permanent: `setx PYTHONUTF8 1`; and add `set "IRIS_OUT_DIR=<the path above>"` to `start_runner.bat` (before `call .venv\Scripts\activate.bat`), because the scheduled task does not see `$env:` settings.
2. `.\install_runner_windows.bat`; set Power → "plugged in, sleep after" to Never.
3. Portal → IRIS Sync → light should go green; run **Test, 2 per tab** on Inbox; check IRIS Notices.
4. Then Full scan one section a day (Inbox, Outbox, Completed Tasks); Quick weekly (optional pg_cron in `001_iris.sql`).
5. Mac: stop running the extractor by hand once the PC runner works.

## Open items (not blocking)
- Ubaid and other staff logins are not in the Supabase `staff` table (their sync says "This computer only").
- "Excel save button not working" — never reproduced; need to know which button and the message.
- Archive rule: the plan asks whether pre-2020 means tax year or due date (currently due date).
- Python 3.14 worked for the setup; if a package fails later, rebuild the venv with Python 3.12.
