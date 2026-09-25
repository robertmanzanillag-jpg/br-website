"""Import web-sized Drive media from column C of the Black Room workbook.

Usage: python scripts/import-bank-media.py path/to/Black-Room-Database.xlsx
The importer skips unavailable collections and files already downloaded.
"""

import ast
import concurrent.futures
import json
import re
import sys
import urllib.error
import urllib.request
import warnings
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "images" / "media"
CATALOG = ROOT / "public" / "data" / "bank-media.json"
SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
IVD = re.compile(r"window\['_DRIVE_ivd'\] = ('(?:\\.|[^'])*')")
AGENT = {"User-Agent": "Mozilla/5.0 (compatible; BlackRoomMediaImporter/1.0)"}


def read_sources(workbook):
    with zipfile.ZipFile(workbook) as archive:
        strings = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        labels = ["".join(t.text or "" for t in item.iter(f"{{{SHEET_NS}}}t")) for item in strings]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        relationships = ET.fromstring(archive.read("xl/worksheets/_rels/sheet1.xml.rels"))
        targets = {item.get("Id"): item.get("Target") for item in relationships}
        values = {}
        for cell in sheet.iter(f"{{{SHEET_NS}}}c"):
            name = cell.get("r", "")
            if not re.fullmatch(r"C(?:[2-9]|[1-4][0-9]|5[01])", name):
                continue
            value = cell.find(f"{{{SHEET_NS}}}v")
            if value is not None:
                values[name] = labels[int(value.text)] if cell.get("t") == "s" else value.text
        sources = []
        for link in sheet.iter(f"{{{SHEET_NS}}}hyperlink"):
            cell = link.get("ref", "")
            if cell not in values:
                continue
            url = targets.get(link.get(f"{{{REL_NS}}}id"))
            if not url:
                continue
            label = re.split(r"https?://", values[cell], maxsplit=1)[0].strip(" :-\n")
            sources.append({"row": int(cell[1:]), "title": label or f"Media {cell}", "sourceUrl": url})
        return sorted(sources, key=lambda item: item["row"])


def drive_records(url):
    request = urllib.request.Request(url, headers=AGENT)
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8", "ignore")
    match = IVD.search(html)
    if not match:
        return []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        records = json.loads(ast.literal_eval(match.group(1)))[0]
    return [record for record in records if isinstance(record, list) and len(record) > 3]


def download_image(file_id, target):
    if target.exists():
        return True
    url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w1200"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=40) as response:
            if not response.headers.get("Content-Type", "").startswith("image/"):
                return False
            data = response.read()
        if not data:
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return True
    except (OSError, urllib.error.URLError):
        return False


def import_source(source):
    url = source["sourceUrl"]
    if "drive.google.com/drive/folders/" not in url:
        return None
    try:
        records = drive_records(url)
    except (OSError, urllib.error.URLError, ValueError):
        return None
    if not records:
        return None
    folder = f"bank-{source['row']:02d}"
    media = []
    images = []
    for record in records:
        file_id, name, mime = record[0], record[2], record[3]
        if not isinstance(file_id, str) or not isinstance(name, str) or not isinstance(mime, str):
            continue
        if mime.startswith("image/"):
            target = OUTPUT / folder / f"{file_id}.jpg"
            images.append((file_id, target))
            media.append({"type": "image", "title": name, "url": f"/images/media/{folder}/{file_id}.jpg"})
        elif mime.startswith("video/"):
            media.append({"type": "video", "title": name, "url": f"https://drive.google.com/file/d/{file_id}/view"})
    downloaded = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(download_image, file_id, target): file_id for file_id, target in images}
        for future in concurrent.futures.as_completed(futures):
            downloaded[futures[future]] = future.result()
    media = [item for item in media if item["type"] == "video" or downloaded.get(item["url"].split("/")[-1][:-4])]
    if not media:
        return None
    return {**source, "mayHaveMore": len(records) == 50, "media": media}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/import-bank-media.py workbook.xlsx")
    sources = read_sources(sys.argv[1])
    collections = []
    for source in sources:
        imported = import_source(source)
        if imported:
            collections.append(imported)
            print(f"C{source['row']}: {len(imported['media'])} items")
        else:
            print(f"C{source['row']}: unavailable or unsupported")
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(collections, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(collections)} collections to {CATALOG}")


if __name__ == "__main__":
    main()
