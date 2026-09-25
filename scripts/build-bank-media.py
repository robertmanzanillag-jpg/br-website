"""Merge verified Drive and external Black Room media into the public catalog."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
OUTPUT = DATA / "bank-media.json"
SOURCES = (
    DATA / "bank-media-drive-full.json",
    DATA / "bank-media-external.json",
    DATA / "bank-media-dropbox.json",
)


def main():
    by_row = {}
    for source in SOURCES:
        if not source.exists():
            raise FileNotFoundError(f"Missing source catalog: {source}")
        for collection in json.loads(source.read_text(encoding="utf-8")):
            row = collection["row"]
            if row in (46, 47) or "high voltage" in collection["title"].lower():
                continue
            if row in by_row:
                raise ValueError(f"Duplicate source row C{row}")
            media = []
            seen = set()
            for item in collection["media"]:
                if item["url"] in seen:
                    continue
                seen.add(item["url"])
                for field in ("url", "poster"):
                    path = item.get(field, "")
                    if path.startswith("/") and not (ROOT / "public" / path.lstrip("/")).is_file():
                        raise FileNotFoundError(f"C{row}: {path}")
                media.append(item)
            if media:
                by_row[row] = {**collection, "media": media}
    if not by_row:
        raise ValueError("No media collections found")
    catalog = [by_row[row] for row in sorted(by_row)]
    OUTPUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(catalog)} collections and {sum(len(c['media']) for c in catalog)} items")


if __name__ == "__main__":
    main()
