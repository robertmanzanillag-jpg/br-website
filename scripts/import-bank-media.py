"""Catalog complete public Drive collections from column C of the workbook.

Usage: python scripts/import-bank-media.py path/to/Black-Room-Database.xlsx
The importer skips unavailable collections. Photos and video posters use
public Drive thumbnail URLs, keeping the repository small. Public
embedded folder views expose the full listing, unlike the normal Drive page,
which embeds only the first 50 entries.
"""

import html
import json
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "public" / "data" / "bank-media-drive-full.json"
SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
AGENT = {"User-Agent": "Mozilla/5.0 (compatible; BlackRoomMediaImporter/1.0)"}
ENTRY = re.compile(r'<div class="flip-entry" id="entry-([^\"]+)".*?<div class="flip-entry-title">(.*?)</div>', re.S)
FOLDER_ID = re.compile(r"/drive/folders/([A-Za-z0-9_-]+)")
FILE_ID = re.compile(r"/file/d/([A-Za-z0-9_-]+)")


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


def drive_records(folder_id):
    """Return all public entries, including subfolders, from an embedded view."""
    url = f"https://drive.google.com/embeddedfolderview?id={folder_id}#list"
    request = urllib.request.Request(url, headers=AGENT)
    with urllib.request.urlopen(request, timeout=45) as response:
        page = response.read().decode("utf-8", "ignore")
    records = []
    for match in ENTRY.finditer(page):
        fragment = match.group(0)
        file_id = match.group(1)
        title = html.unescape(re.sub(r"<[^>]+>", "", match.group(2)))
        icon = re.search(r'drive-thirdparty\.googleusercontent\.com/16/type/([^" ]+)', fragment)
        mime = icon.group(1) if icon else ""
        if not mime and ('/drive/folders/' in fragment or 'alt="Folder"' in fragment):
            mime = "folder"
        records.append((file_id, title, mime))
    return records


def import_source(source):
    url = source["sourceUrl"]
    if source["row"] in (46, 47) or "HIGH VOLTAGE" in source["title"].upper():
        return None
    folder_match = FOLDER_ID.search(url)
    file_match = FILE_ID.search(url)
    if not folder_match and not file_match:
        return None
    records = []
    if file_match:
        # Some shared folder URLs in the workbook use /file/d/ instead of
        # /drive/folders/. Probe the folder view before treating them as files.
        try:
            records = drive_records(file_match.group(1))
        except (OSError, urllib.error.URLError, ValueError):
            records = []
    if records or folder_match:
        pending = [folder_match.group(1)] if folder_match else []
        seen_folders = set()
        while pending:
            folder_id = pending.pop()
            if folder_id in seen_folders:
                continue
            seen_folders.add(folder_id)
            try:
                folder_records = drive_records(folder_id)
            except (OSError, urllib.error.URLError, ValueError) as error:
                print(f"C{source['row']}: folder {folder_id} unavailable: {error}", flush=True)
                continue
            for record in folder_records:
                if record[2] == "folder":
                    pending.append(record[0])
                else:
                    records.append(record)
    elif file_match:
        records = [(file_match.group(1), source["title"], "video/mp4")]
    if not records:
        return None
    media = []
    for record in records:
        file_id, name, mime = record
        if not isinstance(file_id, str) or not isinstance(name, str) or not isinstance(mime, str):
            continue
        if mime.startswith("image/"):
            media.append({"type": "image", "title": name,
                          "url": f"https://drive.google.com/thumbnail?id={file_id}&sz=w1200"})
        elif mime.startswith("video/"):
            media.append({"type": "video", "title": name,
                          "url": f"https://drive.google.com/file/d/{file_id}/view",
                          "embedUrl": f"https://drive.google.com/file/d/{file_id}/preview",
                          "poster": f"https://drive.google.com/thumbnail?id={file_id}&sz=w640"})
    if not media:
        return None
    return {**source, "media": media}


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
