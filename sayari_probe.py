#!/usr/bin/env python3
"""
sayari_probe.py — minimal connectivity + schema probe.

Run this FIRST (locally or anywhere with network + creds). It:
  1. confirms the SDK installs and the keys authenticate,
  2. shows the REAL method names on the client (so we don't guess), and
  3. resolves ONE entity and dumps the raw JSON so we can lock the field names.

Usage:
    pip install sayari
    export SAYARI_CLIENT_ID=...
    export SAYARI_CLIENT_SECRET=...
    python sayari_probe.py
"""
import json
import os
import sys


def main() -> None:
    cid = os.environ.get("SAYARI_CLIENT_ID")
    secret = os.environ.get("SAYARI_CLIENT_SECRET")
    if not cid or not secret:
        sys.exit("Set SAYARI_CLIENT_ID and SAYARI_CLIENT_SECRET first.")

    from sayari.client import Sayari
    client = Sayari(client_id=cid, client_secret=secret)
    print("✓ client built + authenticated\n")

    # What can this client actually do? (reveals real attribute/method names)
    print("Top-level client attributes:")
    print("  " + ", ".join(a for a in dir(client) if not a.startswith("_")))
    for grp in ("resolution", "entity"):
        obj = getattr(client, grp, None)
        if obj is not None:
            methods = [a for a in dir(obj) if not a.startswith("_")]
            print(f"  client.{grp}: {methods}")
    print()

    # Resolve one known entity from list_1 and dump the raw response.
    print("Resolving 'Sberbank' (RUS)...")
    try:
        res = client.resolution.resolution(name=["Sberbank"], country=["RUS"])
    except TypeError:
        # some SDK versions take singular args; fall back
        res = client.resolution.resolution(name="Sberbank")
    raw = res.model_dump() if hasattr(res, "model_dump") else (
        res.dict() if hasattr(res, "dict") else res)
    print(json.dumps(raw, indent=2, default=str)[:4000])


if __name__ == "__main__":
    main()
