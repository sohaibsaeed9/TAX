#!/usr/bin/env python3
"""Encrypt / decrypt the client data embedded in portal.html.

The page holds `var VAULT = {...};` with the client list encrypted under a random
data key, and one copy of that key per staff login, wrapped with a key derived
from that user's password (PBKDF2-SHA256 + AES-256-GCM). No password or plaintext
client data is stored in the repo.

  python3 tools/portal_vault.py extract  --user sohaib --out clients.json
  python3 tools/portal_vault.py update   --user sohaib --data clients.json
  python3 tools/portal_vault.py passwd   --user sohaib --target ubaid
  python3 tools/portal_vault.py adduser  --user sohaib --target staff3 --role staff --name "Staff 3"
  python3 tools/portal_vault.py rmuser   --user sohaib --target staff3

Keep any extracted clients.json OUT of the repo and delete it when done.
"""
import argparse, base64, getpass, json, os, re, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

PAGE = os.path.join(os.path.dirname(__file__), "..", "portal.html")
ITER = 600000
LINE = re.compile(r"^var VAULT = (\{.*\});$", re.M)

b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode

def kek(password, salt, it):
    return PBKDF2HMAC(hashes.SHA256(), 32, salt, it).derive(password.encode())

def wrap(dk, password):
    salt, iv = os.urandom(16), os.urandom(12)
    return {"salt": b64(salt), "iv": b64(iv), "wk": b64(AESGCM(kek(password, salt, ITER)).encrypt(iv, dk, None))}

def load():
    s = open(PAGE, encoding="utf-8").read()
    m = LINE.search(s)
    if not m: sys.exit("VAULT line not found in portal.html")
    return s, json.loads(m.group(1))

def save(s, vault):
    s = LINE.sub(lambda _: "var VAULT = " + json.dumps(vault, separators=(",", ":")) + ";", s, count=1)
    open(PAGE, "w", encoding="utf-8").write(s)

def unlock(vault, user, password=None):
    u = vault["users"].get(user)
    if not u: sys.exit("No such user: " + user)
    password = password or getpass.getpass("Password for %s: " % user)
    try:
        return AESGCM(kek(password, unb64(u["salt"]), vault["iter"])).decrypt(unb64(u["iv"]), unb64(u["wk"]), None)
    except Exception:
        sys.exit("Wrong password.")

def decrypt_data(vault, dk):
    d = vault["data"]
    return json.loads(AESGCM(dk).decrypt(unb64(d["iv"]), unb64(d["ct"]), None))

def encrypt_data(dk, obj):
    iv = os.urandom(12)
    return {"iv": b64(iv), "ct": b64(AESGCM(dk).encrypt(iv, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), None))}

def new_password(target):
    p1 = getpass.getpass("New password for %s: " % target)
    if len(p1) < 10: sys.exit("Use at least 10 characters.")
    if getpass.getpass("Repeat: ") != p1: sys.exit("Passwords do not match.")
    return p1

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["extract", "update", "passwd", "adduser", "rmuser"])
    ap.add_argument("--user", required=True, help="login used to unlock the vault")
    ap.add_argument("--target"); ap.add_argument("--out"); ap.add_argument("--data")
    ap.add_argument("--role", choices=["admin", "reviewer", "staff"]); ap.add_argument("--name")
    a = ap.parse_args()
    s, vault = load()
    dk = unlock(vault, a.user)
    if a.cmd == "extract":
        json.dump(decrypt_data(vault, dk), open(a.out or "clients.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("Wrote", a.out or "clients.json", "- keep it out of the repo.")
    elif a.cmd == "update":
        obj = json.load(open(a.data, encoding="utf-8"))
        assert isinstance(obj.get("clients"), list) and isinstance(obj.get("filed"), list), "expects {clients:[...], filed:[...]}"
        vault["data"] = encrypt_data(dk, obj); save(s, vault); print("Client data re-encrypted.")
    elif a.cmd == "passwd":
        t = a.target or a.user
        if t != a.user and vault["users"][a.user]["role"] != "admin": sys.exit("Only an admin can change other users' passwords.")
        vault["users"][t].update(wrap(dk, new_password(t))); save(s, vault); print("Password changed for", t)
    elif a.cmd == "adduser":
        if vault["users"][a.user]["role"] != "admin": sys.exit("Admin only.")
        if not (a.target and a.role and a.name): sys.exit("--target, --role and --name are required.")
        u = {"role": a.role, "name": a.name}; u.update(wrap(dk, new_password(a.target)))
        vault["users"][a.target] = u; save(s, vault); print("Added", a.target)
    elif a.cmd == "rmuser":
        if vault["users"][a.user]["role"] != "admin": sys.exit("Admin only.")
        vault["users"].pop(a.target, None); save(s, vault)
        print("Removed", a.target, "- note: they knew the data key; re-key by extracting and updating with a new vault if needed.")

if __name__ == "__main__":
    main()
