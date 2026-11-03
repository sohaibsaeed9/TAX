# Staff portal security — how it works and how to switch it on

## What changed (November 2026)

| Before | After |
|---|---|
| The encrypted client list sat inside `portal.html`, which anyone can download from this public repo and attack offline. | The encrypted client list is in the private Supabase table `portal_vault`. The public page contains no client data. |
| A password alone opened everything. | Two-step sign-in: password **and** a 6-digit code from an authenticator app. Supabase itself refuses every portal read/write without the code (`aal2`), so this cannot be skipped by editing the page. |
| Changing a password did not change the data key, so old passwords (still in git history) kept working. | The one-time `migrate` step creates a **new** data key. Old passwords and old copies in git history no longer open current data. |
| Client data stayed in the browser's storage after use. | On sign-out — or when the window is closed after everything has been saved online — client data is cleared from the browser. If the computer is offline, data is kept until it can be saved, so nothing is lost. |
| The Anthropic API key was stored in plain text in the browser. | Stored only encrypted; readable only while signed in. |
| — | Content-Security-Policy: the page may only talk to Supabase and Anthropic, and only load scripts from the two CDNs. The three CDN libraries are pinned to exact versions with integrity hashes. |

Users who leave: delete their row from `staff` and their Supabase user. Because the client list now lives behind Supabase, that alone stops them, even though they once knew the data key.

## Switching it on — do these in one sitting (about 20 minutes)

Do not make changes in the old portal between steps 1 and 5.

1. **Supabase → SQL Editor:** run `tools/supabase-security-upgrade.sql`.
   (From this moment the old portal shows "Offline – saving locally" until step 5.)
2. **Supabase → Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up".
   Multi-factor (TOTP) is on by default; check it is enabled under Authentication → Multi-Factor.
3. **On your computer**, in a checkout of the `security-hardening` branch:
   ```
   pip install cryptography
   python3 tools/portal_vault.py migrate --user sohaib
   ```
   It asks for your old portal password, which logins to keep (staff1 and staff2 have never been used online — answer **N** unless needed), a new password (12+ characters) for each kept login, and — the first time — sets up your authenticator app. It uploads the vault and re-encrypts `comp/*.enc.json`.
4. Commit and push the changed `comp/ty2026.enc.json` to the branch.
5. Merge the pull request. GitHub Pages updates within a minute or two.
6. For each other kept login (e.g. Ubaid): **Supabase → Authentication → Users → Add user** with their email and the new password from step 3 (tick "auto-confirm"), then in SQL Editor:
   ```sql
   insert into public.staff (email, username, name, role) values ('their@email', 'ubaid', 'Ubaid', 'reviewer');
   ```
   On their first sign-in the portal shows a QR code to scan with an authenticator app.

Sign in with your username (e.g. `sohaib`) or your full email address.

## Still recommended

- **Git history:** older commits still contain the old encrypted vault (protected by the old passwords). After step 5, either make the repository private (GitHub Pages from a private repo needs a paid plan) or replace the history with a single fresh commit. Do this only once everything above works.
- Set a monthly spending limit on the Anthropic API key.
- Keep office PCs updated, use a separate browser profile for the portal, and avoid unneeded browser extensions.
