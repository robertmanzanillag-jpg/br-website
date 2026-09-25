"""Merge verified Drive and external Black Room media into the public catalog."""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
OUTPUT = DATA / "bank-media.json"
DURATIONS = ROOT / "scripts" / "bank-video-durations.json"
PHOTO_EXCLUSIONS = ROOT / "scripts" / "bank-photo-exclusions.json"
SOURCES = (
    DATA / "bank-media-drive-full.json",
    DATA / "bank-media-external.json",
    DATA / "bank-media-dropbox.json",
)

# The spreadsheet separates some events into photo and video rows. Keep each
# edition together and use the short public-facing event/DJ name.
COLLECTIONS = (
    ("Stan Christ", (6,)),
    ("Shay De Castro", (9,)),
    ("Niotech", (14,)),
    ("Lokier", (17,)),
    ("Red Room", (18,)),
    ("Cadzow", (21,)),
    ("KX CHR & Briela", (22,)),
    ("Red Room 08", (23,)),
    ("Beebo", (24,)),
    ("Colosseum I", (26, 27)),
    ("Colosseum II", (29, 31)),
    ("Red Room 08/23", (32,)),
    ("Variance VIII", (34,)),
    ("Blood Feast", (35, 38)),
    ("Yacht Rave", (37,)),
    ("Tag Room", (39,)),
    ("II Anniversary Fest", (42, 43, 44)),
    ("BR Anniversary & Afters", (45,)),
    ("Variance Jan 31", (49,)),
    ("Red Room 07/02", (50,)),
    ("Red Room 21/02", (51,)),
)


def main():
    durations = json.loads(DURATIONS.read_text(encoding="utf-8"))
    excluded = json.loads(PHOTO_EXCLUSIONS.read_text(encoding="utf-8"))
    excluded_drive = set(excluded.get("driveFileIds", []))
    excluded_zoho = set(excluded.get("zohoFileIds", []))
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
                if item["type"] == "image":
                    drive_match = re.search(r"[?&]id=([^&]+)", item["url"])
                    drive_id = drive_match.group(1) if drive_match else None
                    zoho_id = item.get("sourceFileId") if item.get("sourceProvider") == "zoho" else None
                    if drive_id in excluded_drive:
                        continue
                    if zoho_id in excluded_zoho:
                        continue
                if (
                    item["type"] == "image"
                    and item.get("sourceProvider") == "zoho"
                    and item["title"].lower().endswith((".arw", ".heic"))
                ):
                    # Browsers cannot display the source RAW/HEIC download.
                    item = {
                        **item,
                        "url": f"https://previewengine-accl.zohoexternal.com/thumbnail/WD/{item['sourceFileId']}?size=poster&version=1.0",
                    }
                if item["url"] in seen:
                    continue
                if item["type"] == "video":
                    seconds = durations.get(item["url"], {}).get("seconds")
                    if isinstance(seconds, (int, float)) and 0 <= seconds < 3:
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
    mapped_rows = {row for _, rows in COLLECTIONS for row in rows}
    if set(by_row) != mapped_rows:
        raise ValueError(f"Unmapped source rows: {sorted(set(by_row) ^ mapped_rows)}")
    catalog = []
    for title, rows in COLLECTIONS:
        media = []
        seen = set()
        for row in rows:
            for item in by_row[row]["media"]:
                if item["url"] not in seen:
                    media.append(item)
                    seen.add(item["url"])
        media.sort(key=lambda item: item["type"] != "image")
        catalog.append({
            "row": rows[0],
            "rows": list(rows),
            "title": title,
            "sourceUrls": [by_row[row].get("sourceUrl") for row in rows if by_row[row].get("sourceUrl")],
            "media": media,
        })
    OUTPUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(catalog)} collections and {sum(len(c['media']) for c in catalog)} items")


if __name__ == "__main__":
    main()
