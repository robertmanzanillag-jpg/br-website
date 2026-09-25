"""Inventory and import publicly shared non-Drive Black Room media.

Usage: python scripts/import-bank-external.py path/to/Black-Room-Database.xlsx [--download]

The inventory never includes High Voltage. Zoho's public API supplies an
unambiguous file listing. Downloads are opt-in because the source contains
many original-size files and Dropbox folders can exceed 20 GB. The public
Zoho download URLs work as image and HTML5 video sources in the site.
"""

import argparse
import concurrent.futures
import importlib.util
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "images" / "media"
CATALOG = ROOT / "public" / "data" / "bank-media-external.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; BlackRoomMediaImporter/2.0)",
    "Accept": "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
}


def workbook_sources(path):
    spec = importlib.util.spec_from_file_location("bank_import", ROOT / "scripts" / "import-bank-media.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return [
        source for source in module.read_sources(path)
        if "drive.google.com" not in source["sourceUrl"]
        and "high voltage" not in source["title"].casefold()
    ]


def request_json(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def zoho_resource(url):
    request = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8", "ignore")
    match = re.search(r'resourceId\s*=\s*"([a-zA-Z0-9]+)"', html)
    if not match:
        raise ValueError("Zoho link lacks a public resource ID")
    return match.group(1)


def zoho_records(resource_id):
    base = f"https://workdrive.zohoexternal.com/public/api/v1/files/{resource_id}/records"
    seen = set()
    offset = 0
    while True:
        query = urllib.parse.urlencode({"page[offset]": offset, "page[limit]": 100})
        records = request_json(f"{base}?{query}").get("data", [])
        if not records:
            break
        added = 0
        for item in records:
            file_id = item.get("id")
            if not file_id or file_id in seen:
                continue
            seen.add(file_id)
            added += 1
            yield item
        if len(records) < 100 or not added:
            break
        offset += len(records)


def zoho_collection(source):
    resource = zoho_resource(source["sourceUrl"])
    media = []
    for item in zoho_records(resource):
        attr = item.get("attributes", {})
        kind = attr.get("type")
        if kind not in ("image", "video"):
            continue
        name = attr.get("name") or item["id"]
        if "high voltage" in name.casefold():
            continue
        download = attr.get("download_url")
        if not download:
            continue
        record = {
            "type": kind,
            "title": name,
            "url": download,
            "sourceFileId": item["id"],
            "sourceProvider": "zoho",
        }
        if kind == "video" and attr.get("thumbnail_url"):
            record["poster"] = f"{attr['thumbnail_url']}?size=poster&version=1.0"
        if kind == "video":
            extension = Path(name).suffix.casefold()
            record["mimeType"] = {
                ".mov": "video/quicktime", ".mp4": "video/mp4",
                ".m4v": "video/x-m4v", ".webm": "video/webm",
            }.get(extension, "video/mp4")
        media.append(record)
    return {**source, "media": media} if media else None


def download_item(collection, item):
    # Public Zoho videos can be enormous MOV originals. Their public URL
    # already works in an HTML5 player, so local copies are unnecessary.
    if item["type"] != "image":
        return False
    file_id = item["sourceFileId"]
    folder = f"external-{collection['row']:02d}"
    path = OUTPUT / folder / f"{file_id}.jpg"
    if not path.exists():
        request = urllib.request.Request(item["url"], headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(request, timeout=120) as response:
            content_type = response.headers.get("Content-Type", "").lower()
            if not content_type.startswith("image/"):
                return False
            from PIL import Image
            image = Image.open(io.BytesIO(response.read()))
            image.thumbnail((1200, 1200))
            if image.mode in ("RGBA", "LA"):
                background = Image.new("RGB", image.size, "#121212")
                background.paste(image, mask=image.getchannel("A"))
                image = background
            elif image.mode != "RGB":
                image = image.convert("RGB")
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".part")
            try:
                image.save(temporary, format="JPEG", quality=80, optimize=True)
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
    item["url"] = f"/images/media/{folder}/{path.name}"
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--download", action="store_true", help="Create optimized local JPEGs (up to 1200 px)")
    args = parser.parse_args()
    collections = []
    for source in workbook_sources(args.workbook):
        url = source["sourceUrl"]
        if "workdrive.zohoexternal.com/external/" not in url:
            print(f"C{source['row']}: {source['title']}: external provider needs separate import")
            continue
        try:
            collection = zoho_collection(source)
            if not collection:
                print(f"C{source['row']}: no accessible media")
                continue
            photos = sum(item["type"] == "image" for item in collection["media"])
            videos = sum(item["type"] == "video" for item in collection["media"])
            print(f"C{source['row']}: {photos} photos, {videos} videos")
            if args.download:
                with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
                    images = [item for item in collection["media"] if item["type"] == "image"]
                    success = list(executor.map(lambda item: download_item(collection, item), images))
                collection["media"] = [item for item in collection["media"] if item["type"] == "video" or item["url"].startswith("/images/")]
                print(f"  downloaded {sum(success)} of {len(images)} images")
            collections.append(collection)
        except (OSError, ValueError, urllib.error.URLError) as error:
            print(f"C{source['row']}: unavailable: {error}", file=sys.stderr)
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(collections, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(collections)} collections to {CATALOG}")


if __name__ == "__main__":
    main()
