#!/usr/bin/env python3
"""Manage the staff portal's encrypted client data (the "vault").

The vault holds the client list encrypted under a random data key, and one copy of that
key per staff login, wrapped with a key derived from that person's password
(PBKDF2-SHA256, 600,000 rounds + AES-256-GCM). Since November 2026 the vault lives in the
private Supabase table `portal_vault` (readable only by portal staff signed in with their
authenticator code) — it is no longer inside the public portal.html.

A portal password must be the SAME as that person's Supabase login password, because the
portal uses one password for both steps.

ONE-TIME MOVE (run once, before merging the security branch):
  python3 tools/portal_vault.py migrate --user sohaib
      reads the old vault out of the live portal.html (git: origin/main), makes a NEW data
      key, sets new passwords for the logins you keep, re-encrypts comp/ty*.enc.json, and
      uploads the vault to Supabase. Old passwords and old copies in git history no longer
      open anything current.

DAY-TO-DAY:
  python3 tools/portal_vault.py extract --user sohaib --out clients.json
  python3 tools/portal_vault.py update  --user sohaib --data clients.json
  python3 tools/portal_vault.py passwd  --user sohaib [--target ubaid]
  python3 tools/portal_vault.py adduser --user sohaib --target staff3 --role staff --name "Staff 3" --email s3@...
  python3 tools/portal_vault.py rmuser  --user sohaib --target staff3

Keep any extracted clients.json OUT of the repo and delete it when done.
Needs: pip install cryptography
"""
import argparse, base64, datetime, getpass, glob, json, os, re, subprocess, sys, urllib.request, urllib.error
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RAW = "https://raw.githubusercontent.com/sohaibsaeed9/TAX/main/"
# Standalone mode: the script was downloaded on its own (no repo checkout, no git needed).
STANDALONE = not os.path.isdir(os.path.join(ROOT, ".git"))
SUPA_URL = "https://rscvtbhzygqnyjzgxmyh.supabase.co"
SUPA_KEY = "sb_publishable_EpqMmgUo5pObHDvcC24EMw_2FpX8Ttc"
ITER = 600000
LINE = re.compile(r"^var VAULT = (\{.*\});$", re.M)
MIN_PW = 12

b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode


# ── crypto ────────────────────────────────────────────────────────────────
def kek(password, salt, it):
    return PBKDF2HMAC(hashes.SHA256(), 32, salt, it).derive(password.encode())

def wrap(dk, password):
    salt, iv = os.urandom(16), os.urandom(12)
    return {"salt": b64(salt), "iv": b64(iv), "wk": b64(AESGCM(kek(password, salt, ITER)).encrypt(iv, dk, None))}

def unlock(vault, user, password):
    u = vault["users"].get(user)
    if not u: sys.exit("No such portal user: " + user)
    try:
        return AESGCM(kek(password, unb64(u["salt"]), vault["iter"])).decrypt(unb64(u["iv"]), unb64(u["wk"]), None)
    except Exception:
        sys.exit("Wrong password for %s." % user)

def decrypt_data(vault, dk):
    d = vault["data"]
    return json.loads(AESGCM(dk).decrypt(unb64(d["iv"]), unb64(d["ct"]), None))

def encrypt_data(dk, obj):
    iv = os.urandom(12)
    return {"iv": b64(iv), "ct": b64(AESGCM(dk).encrypt(iv, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), None))}

def new_password(target):
    while True:
        p1 = getpass.getpass("New password for %s (min %d characters): " % (target, MIN_PW))
        if len(p1) < MIN_PW: print("Too short."); continue
        if getpass.getpass("Repeat: ") != p1: print("Passwords do not match."); continue
        return p1


# ── Supabase (REST, standard library only) ────────────────────────────────
def _req(method, path, body=None, token=None, extra=None):
    h = {"apikey": SUPA_KEY, "Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    if extra: h.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(SUPA_URL + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            t = resp.read().decode()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        sys.exit("Supabase error (%s %s): %s" % (e.code, path.split("?")[0], msg[:400]))

class Session:
    """Signs in with email + password, then completes the authenticator (TOTP) step."""
    def __init__(self, email, password):
        self.email = email
        r = _req("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password})
        self.token = r["access_token"]
        factors = [f for f in (r.get("user", {}).get("factors") or []) if f.get("factor_type") == "totp"]
        verified = [f for f in factors if f.get("status") == "verified"]
        for f in factors:
            if f.get("status") != "verified":
                _req("DELETE", "/auth/v1/factors/" + f["id"], token=self.token)
        if verified:
            fid = verified[0]["id"]
        else:
            print("\nTwo-step sign-in is not set up yet for %s. Setting it up now." % email)
            e = _req("POST", "/auth/v1/factors", {"factor_type": "totp", "friendly_name": "Vault tool"}, token=self.token)
            fid = e["id"]
            print("In your authenticator app, add an account using this key:\n   %s\nor this link:\n   %s\n" % (e["totp"]["secret"], e["totp"]["uri"]))
        for attempt in range(5):
            code = input("6-digit code from your authenticator app: ").strip().replace(" ", "")
            ch = _req("POST", "/auth/v1/factors/%s/challenge" % fid, {}, token=self.token)
            try:
                v = self._verify(fid, ch["id"], code)
                self.token = v["access_token"]; return
            except ValueError:
                print("That code is not correct.")
        sys.exit("Too many wrong codes.")

    def _verify(self, fid, cid, code):
        h = {"apikey": SUPA_KEY, "Content-Type": "application/json", "Authorization": "Bearer " + self.token}
        r = urllib.request.Request(SUPA_URL + "/auth/v1/factors/%s/verify" % fid, method="POST", headers=h,
                                   data=json.dumps({"challenge_id": cid, "code": code}).encode())
        try:
            with urllib.request.urlopen(r, timeout=60) as resp: return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (400, 422): raise ValueError()
            sys.exit("Supabase error: " + e.read().decode()[:300])

    def get_vault(self):
        rows = _req("GET", "/rest/v1/portal_vault?id=eq.1&select=vault", token=self.token)
        if not rows: sys.exit("No vault in Supabase yet (or this login is not portal staff). Run 'migrate' first.")
        return rows[0]["vault"]

    def put_vault(self, vault):
        _req("POST", "/rest/v1/portal_vault", {"id": 1, "vault": vault, "updated_by": self.email,
                                          "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()},
             token=self.token, extra={"Prefer": "resolution=merge-duplicates,return=minimal"})

    def set_own_password(self, pw):
        _req("PUT", "/auth/v1/user", {"password": pw}, token=self.token)


def login(email):
    return Session(email, getpass.getpass("Current online (Supabase) password for %s: " % email))


# ── commands ──────────────────────────────────────────────────────────────
def old_page_vault(path):
    if path:
        s = open(path, encoding="utf-8").read()
    elif STANDALONE:
        print("Downloading the live portal page from GitHub...")
        s = urllib.request.urlopen(RAW + "portal.html", timeout=120).read().decode("utf-8")
    else:
        subprocess.run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"], check=False)
        s = subprocess.run(["git", "-C", ROOT, "show", "origin/main:portal.html"], capture_output=True, text=True, encoding="utf-8").stdout
    m = LINE.search(s)
    if not m: sys.exit("The old embedded vault was not found (already migrated?). Use --page path/to/old/portal.html.")
    return json.loads(m.group(1))

def rekey_comp_files(old_dk, new_dk):
    if STANDALONE:
        for name in ["ty2026.enc.json"]:
            e = json.loads(urllib.request.urlopen(RAW + "comp/" + name, timeout=120).read().decode("utf-8"))
            raw = AESGCM(old_dk).decrypt(unb64(e["iv"]), unb64(e["ct"]), None)
            iv = os.urandom(12)
            e.update({"iv": b64(iv), "ct": b64(AESGCM(new_dk).encrypt(iv, raw, None))})
            out = os.path.join(os.getcwd(), name)
            json.dump(e, open(out, "w", encoding="utf-8"), separators=(",", ":"))
            print("Re-encrypted computation template saved as", out)
        return
    for f in glob.glob(os.path.join(ROOT, "comp", "*.enc.json")):
        e = json.load(open(f, encoding="utf-8"))
        raw = AESGCM(old_dk).decrypt(unb64(e["iv"]), unb64(e["ct"]), None)
        iv = os.urandom(12)
        e.update({"iv": b64(iv), "ct": b64(AESGCM(new_dk).encrypt(iv, raw, None))})
        json.dump(e, open(f, "w", encoding="utf-8"), separators=(",", ":"))
        print("Re-encrypted", os.path.relpath(f, ROOT))

def cmd_migrate(a):
    old = old_page_vault(a.page)
    print("Logins in the old vault:", ", ".join("%s (%s)" % (k, v["role"]) for k, v in old["users"].items()))
    old_dk = unlock(old, a.user, getpass.getpass("OLD portal password for %s: " % a.user))
    data = decrypt_data(old, old_dk)
    new_dk = os.urandom(32)
    vault = {"v": old.get("v", 1), "iter": ITER, "data": encrypt_data(new_dk, data), "users": {}}
    admin_email = None
    for k, u in old["users"].items():
        keep = k == a.user or input("Keep login '%s' (%s)? [y/N] " % (k, u["role"])).strip().lower() == "y"
        if not keep: print("  removed", k); continue
        email = (u.get("email") or input("  Supabase login email for %s: " % k)).strip().lower()
        if not email: sys.exit("Every login now needs an email (its Supabase account).")
        nu = {"role": u["role"], "name": u["name"], "email": email}
        if u.get("needsApproval"): nu["needsApproval"] = True
        print("  Choose %s's NEW password. It must also be set as their Supabase password." % k)
        pw = new_password(k)
        nu.update(wrap(new_dk, pw)); vault["users"][k] = nu
        if k == a.user: admin_email, admin_pw = email, pw
    s = login(admin_email)
    s.set_own_password(admin_pw)
    print("Your online password is now the same as your new portal password.")
    s.put_vault(vault)
    print("Vault uploaded to Supabase.")
    rekey_comp_files(old_dk, new_dk)
    if STANDALONE:
        print("\nDone. Send the file ty2026.enc.json (in this folder) to Claude, or upload it to the comp folder of the security-hardening branch on GitHub.")
    else:
        print("\nDone. Commit the changed comp/*.enc.json files on the security branch, then merge it.")
    others = [k for k in vault["users"] if k != a.user]
    if others:
        print("For", ", ".join(others) + ": in Supabase → Authentication → Users, create (or reset) their user with the same",
              "email and the new password you just chose, and make sure their email is in the staff table.")

def session_and_vault(a):
    email = a.email or input("Your Supabase login email: ").strip().lower()
    s = login(email)
    return s, s.get_vault()

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["migrate", "extract", "update", "passwd", "adduser", "rmuser"])
    ap.add_argument("--user", required=True, help="your portal login (used to unlock the vault)")
    ap.add_argument("--email", help="your Supabase login email (asked if omitted)")
    ap.add_argument("--page", help="migrate only: path to an old portal.html that still has the vault in it")
    ap.add_argument("--target"); ap.add_argument("--out"); ap.add_argument("--data")
    ap.add_argument("--role", choices=["admin", "reviewer", "staff"]); ap.add_argument("--name")
    ap.add_argument("--target-email", dest="target_email")
    a = ap.parse_args()
    if a.cmd == "migrate":
        return cmd_migrate(a)

    s, vault = session_and_vault(a)
    me = vault["users"].get(a.user) or sys.exit("No such portal user: " + a.user)
    dk = unlock(vault, a.user, getpass.getpass("Portal password for %s: " % a.user))
    if a.cmd == "extract":
        out = a.out or "clients.json"
        json.dump(decrypt_data(vault, dk), open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("Wrote", out, "- keep it out of the repo and delete it when done.")
    elif a.cmd == "update":
        obj = json.load(open(a.data, encoding="utf-8"))
        assert isinstance(obj.get("clients"), list) and isinstance(obj.get("filed"), list), "expects {clients:[...], filed:[...]}"
        vault["data"] = encrypt_data(dk, obj); s.put_vault(vault); print("Client data re-encrypted and uploaded.")
    elif a.cmd == "passwd":
        t = a.target or a.user
        if t not in vault["users"]: sys.exit("No such portal user: " + t)
        if t != a.user and me["role"] != "admin": sys.exit("Only an admin can change other users' passwords.")
        pw = new_password(t)
        vault["users"][t].update(wrap(dk, pw)); s.put_vault(vault)
        if t == a.user:
            s.set_own_password(pw); print("Password changed (portal and online).")
        else:
            print("Portal password changed for %s. Now set the SAME password for %s in Supabase → Authentication → Users."
                  % (t, vault["users"][t].get("email")))
    elif a.cmd == "adduser":
        if me["role"] != "admin": sys.exit("Admin only.")
        if not (a.target and a.role and a.name and a.target_email): sys.exit("--target, --role, --name and --target-email are required.")
        u = {"role": a.role, "name": a.name, "email": a.target_email.lower()}; u.update(wrap(dk, new_password(a.target)))
        vault["users"][a.target] = u; s.put_vault(vault)
        print("Added %s. Also: create their Supabase user with the same email and password, and add them to the staff table:" % a.target)
        print("  insert into public.staff (email, username, name, role) values ('%s','%s','%s','%s');"
              % (a.target_email.lower(), a.target, a.name.replace("'", "''"), a.role))
    elif a.cmd == "rmuser":
        if me["role"] != "admin": sys.exit("Admin only.")
        gone = vault["users"].pop(a.target, None) or sys.exit("No such portal user: " + a.target)
        s.put_vault(vault)
        print("Removed %s from the vault. To cut off access completely, also run in Supabase:" % a.target)
        print("  delete from public.staff where lower(email) = '%s';" % (gone.get("email") or "their-email"))
        print("and delete their user under Authentication → Users.")

if __name__ == "__main__":
    main()
