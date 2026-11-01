#!/usr/bin/env python3
"""Check the memory-map site before it is published.

Three things a static page can get wrong without any test noticing:

  1. it loads something from another origin (a font, a script, a stylesheet),
     so the page depends on, and reports visits to, a third party;
  2. it links somewhere that is not ours;
  3. it carries an internal name -- a host, a mesh address, a private path --
     into a file anyone can fetch.

(The page's Content-Security-Policy against its inline scripts is
tools/check-kit.py's, the shared shell kit's check.)

Usage:  tools/check-site.py [--root .]      exit 0 clean, 1 with findings
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PUBLISHED = ("index.html", "css", "js", "data", "CNAME")
LINK_OK = re.compile(
    r"^https://((gpio|layout|power)\.hardware\.libre\.computer|memory\.software\.libre\.computer|"
    r"education\.libre\.computer|libre\.computer|www\.libre\.computer)(/|$)"
)
ASSET = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""")
CSS_URL = re.compile(r"""url\(\s*["']?([^"')]+)""")
INTERNAL = [
    (re.compile(r"mesh\.libretech\.co|libretech\.co\b"), "internal host name"),
    (re.compile(r"\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b"), "mesh address"),
    (re.compile(r"\b(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b"), "private address"),
    (re.compile(r"/home/|~/(git|local)\b"), "private path"),
    (re.compile(r"\bgit\.mesh\b|\bai100\b|\bs7-[a-z]+\b|\bslc\b"), "internal host"),
]


def published_files(root: Path):
    for name in PUBLISHED:
        p = root / name
        if p.is_file():
            yield p
        elif p.is_dir():
            yield from sorted(x for x in p.rglob("*") if x.is_file())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    root = Path(ap.parse_args().root)
    problems = []

    try:
        json.loads((root / "data/memory.json").read_text())
    except Exception as e:  # noqa: BLE001 -- any parse failure is the finding
        problems.append(f"data/memory.json: {e}")

    for f in published_files(root):
        rel = f.relative_to(root)
        text = f.read_text(errors="replace")
        for rx, what in INTERNAL:
            for m in rx.finditer(text):
                problems.append(f"{rel}: {what}: {m.group(0)!r}")
        refs = ASSET.findall(text) + (CSS_URL.findall(text) if f.suffix == ".css" else [])
        for ref in refs:
            if ref.startswith(("data:", "#", "mailto:")):
                continue
            if re.match(r"^[a-z]+://|^//", ref):
                # an <a href> to one of our sites is fine; anything loaded is not
                is_link = re.search(r"<a\b[^>]*href\s*=\s*[\"']" + re.escape(ref), text)
                if not is_link:
                    problems.append(f"{rel}: off-site asset {ref}")
                elif not LINK_OK.match(ref):
                    problems.append(f"{rel}: link outside our sites {ref}")
            elif not (root / ref.split("?")[0].split("#")[0]).exists() and f.suffix == ".html":
                problems.append(f"{rel}: missing local file {ref}")

    for p in problems:
        print(p)
    print(f"check-site: {len(problems)} finding(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
