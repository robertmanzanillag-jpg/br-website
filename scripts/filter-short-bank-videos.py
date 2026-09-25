"""Measure public MP4/MOV files and remove only verified videos shorter than 3s.

The default run is read-only. Pass --output to write a filtered copy of the
catalog. The optional --cache stores measured durations for repeat runs.
Unknown, inaccessible, or unsupported videos are retained and reported.
"""

import argparse
import concurrent.futures
import json
import re
import struct
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "public" / "data" / "bank-media.json"
CHUNK = 1024 * 1024
MAX_MOOV = 8 * CHUNK
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; BlackRoomDurationAudit/1.0)"}


def boxes(data, start=0, end=None):
    """Yield complete ISO BMFF box offsets within a byte buffer."""
    end = len(data) if end is None else min(end, len(data))
    pos = start
    while pos + 8 <= end:
        size = struct.unpack_from(">I", data, pos)[0]
        kind = data[pos + 4:pos + 8]
        header = 8
        if size == 1:
            if pos + 16 > end:
                return
            size = struct.unpack_from(">Q", data, pos + 8)[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            return
        yield pos, size, kind, header
        pos += size


def movie_duration(data):
    """Read moov/mvhd timescale and duration; return seconds or None."""
    for pos, size, kind, header in boxes(data):
        if kind != b"moov":
            continue
        for child, child_size, child_kind, child_header in boxes(data, pos + header, pos + size):
            if child_kind != b"mvhd":
                continue
            payload = child + child_header
            version = data[payload] if payload < len(data) else -1
            if version == 0 and payload + 20 <= child + child_size:
                timescale, duration = struct.unpack_from(">II", data, payload + 12)
            elif version == 1 and payload + 32 <= child + child_size:
                timescale = struct.unpack_from(">I", data, payload + 20)[0]
                duration = struct.unpack_from(">Q", data, payload + 24)[0]
            else:
                return None
            if timescale and duration not in (0, 0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF):
                return duration / timescale
    return None


def range_read(url, start, length):
    request = urllib.request.Request(url, headers={
        **HEADERS, "Range": f"bytes={start}-{start + length - 1}"
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(length)
        content_range = response.headers.get("Content-Range", "")
        match = re.search(r"/(\d+)$", content_range)
        total = int(match.group(1)) if match else None
        if response.status == 200 and start:
            raise ValueError("server ignored byte range")
        if response.status == 200 and not total:
            size = response.headers.get("Content-Length")
            total = int(size) if size and size.isdigit() else None
        if not data:
            raise ValueError("empty response")
        return data, total


def direct_url(item):
    url = item["url"]
    if item.get("sourceProvider") == "zoho":
        return url
    if item.get("sourceProvider") == "dropbox":
        return url.replace("raw=1", "dl=1")
    match = re.search(r"drive\.google\.com/file/d/([^/]+)", url)
    if match:
        return f"https://drive.google.com/uc?export=download&id={match.group(1)}"
    return url


def probe_duration(item):
    """Inspect MP4/MOV metadata through byte ranges, without whole downloads."""
    url = direct_url(item)
    data, total = range_read(url, 0, CHUNK)
    duration = movie_duration(data)
    if duration is not None:
        return duration
    if data[4:8] not in (b"ftyp", b"moov", b"wide", b"free"):
        raise ValueError("response is not an MP4/MOV file")
    if total is None or total <= len(data):
        raise ValueError("duration atom unavailable in initial range")
    # A moov atom commonly follows a large mdat. Walk top-level headers at
    # their declared offsets so only its metadata, not the movie, is read.
    offset = 0
    for _ in range(12):
        if offset + 16 <= len(data):
            header = data[offset:offset + 16]
        else:
            header, _ = range_read(url, offset, 16)
        size = struct.unpack_from(">I", header)[0]
        kind = header[4:8]
        if size == 1:
            size = struct.unpack_from(">Q", header, 8)[0]
        elif size == 0:
            size = total - offset
        if size < 8 or offset + size > total:
            break
        if kind == b"moov":
            if size > MAX_MOOV:
                raise ValueError("moov metadata exceeds probe limit")
            atom, _ = range_read(url, offset, size)
            duration = movie_duration(atom)
            if duration is not None:
                return duration
            break
        offset += size
        if offset >= total:
            break
    # Last chance for files whose first atom headers were unusual.
    tail, _ = range_read(url, max(0, total - MAX_MOOV), min(total, MAX_MOOV))
    duration = movie_duration(tail)
    if duration is not None:
        return duration
    raise ValueError("duration atom not found")


def zoho_api_duration(item):
    """Use public file metadata; verify near-threshold clips against container."""
    file_id = item.get("sourceFileId")
    if not file_id:
        raise ValueError("Zoho file ID unavailable")
    url = f"https://workdrive.zohoexternal.com/public/api/v1/files/{file_id}"
    request = urllib.request.Request(url, headers={**HEADERS, "Accept": "application/vnd.api+json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    stamp = (payload.get("data", {}).get("attributes", {})
             .get("meta_info", {}).get("metadata", {})
             .get("video_metadata", {}).get("duration"))
    if not isinstance(stamp, str) or not re.fullmatch(r"\d+:\d{2}:\d{2}", stamp):
        raise ValueError("Zoho duration unavailable")
    hours, minutes, seconds = map(int, stamp.split(":"))
    rounded_seconds = hours * 3600 + minutes * 60 + seconds
    if rounded_seconds <= 3:
        return probe_duration(item), "container"
    return float(rounded_seconds), "zoho_api_whole_second"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=CATALOG)
    parser.add_argument("--output", type=Path, help="Write filtered JSON; omitted means dry run")
    parser.add_argument("--cache", type=Path, default=ROOT / "scripts" / "bank-video-durations.json",
                        help="Duration manifest (defaults to scripts/bank-video-durations.json)")
    parser.add_argument("--drive-scan", type=Path,
                        help="Merge Drive get_video_info audit rows with durationMsMax")
    parser.add_argument("--probe", action="store_true", help="Fetch public video metadata")
    parser.add_argument("--zoho-api", action="store_true",
                        help="Use Zoho file metadata; container-check clips near 3s")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--provider", choices=("zoho", "dropbox", "drive"), action="append",
                        help="Probe only these providers; repeat for multiple providers")
    parser.add_argument("--limit", type=int, help="Probe at most this many new videos")
    parser.add_argument("--retry-errors", action="store_true",
                        help="Retry cache entries lacking a measured duration")
    parser.add_argument("--threshold", type=float, default=3.0)
    args = parser.parse_args()
    if args.threshold <= 0 or args.workers < 1:
        parser.error("threshold and workers must be positive")
    catalog = json.loads(args.input.read_text(encoding="utf-8"))
    videos = [item for collection in catalog for item in collection["media"] if item.get("type") == "video"]
    cache = json.loads(args.cache.read_text(encoding="utf-8")) if args.cache and args.cache.exists() else {}
    if args.drive_scan:
        drive_results = json.loads(args.drive_scan.read_text(encoding="utf-8"))
        by_id = {row["id"]: row for row in drive_results}
        for item in videos:
            match = re.search(r"drive\.google\.com/file/d/([^/]+)", item["url"])
            if not match or match.group(1) not in by_id:
                continue
            row = by_id[match.group(1)]
            duration_ms = row.get("durationMsMax")
            if row.get("status") == "ok" and isinstance(duration_ms, (int, float)) and duration_ms > 0:
                cache[item["url"]] = {"seconds": duration_ms / 1000}
            elif item["url"] not in cache:
                cache[item["url"]] = {"error": row.get("status", "duration unavailable")}
    def provider_of(item):
        return item.get("sourceProvider") or ("drive" if "drive.google.com" in item["url"] else "other")
    pending_by_url = {}
    for item in videos:
        result = cache.get(item["url"], {})
        needs_probe = item["url"] not in cache or (args.retry_errors and not isinstance(result.get("seconds"), (int, float)))
        if needs_probe and (not args.provider or provider_of(item) in args.provider):
            pending_by_url.setdefault(item["url"], item)
    pending = list(pending_by_url.values())
    if args.limit is not None:
        pending = pending[:args.limit]
    if args.probe and pending:
        def measure(item):
            try:
                if args.zoho_api and provider_of(item) == "zoho":
                    seconds, method = zoho_api_duration(item)
                    return item["url"], {"seconds": seconds, "method": method}
                return item["url"], {"seconds": probe_duration(item), "method": "container"}
            except (OSError, ValueError, urllib.error.URLError) as error:
                return item["url"], {"error": str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for index, (url, result) in enumerate(pool.map(measure, pending), 1):
                cache[url] = result
                if index % 100 == 0:
                    print(f"Probed {index}/{len(pending)}", flush=True)
                    if args.cache:
                        args.cache.parent.mkdir(parents=True, exist_ok=True)
                        args.cache.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.cache and (args.probe or args.drive_scan):
        args.cache.parent.mkdir(parents=True, exist_ok=True)
        args.cache.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    removed = []
    by_provider = Counter()
    for collection in catalog:
        kept = []
        for item in collection["media"]:
            if item.get("type") != "video":
                kept.append(item)
                continue
            result = cache.get(item["url"], {})
            seconds = result.get("seconds")
            provider = item.get("sourceProvider") or urllib.parse.urlsplit(item["url"]).hostname
            by_provider[(provider, "verified" if isinstance(seconds, (int, float)) else "unknown")] += 1
            if isinstance(seconds, (int, float)) and 0 <= seconds < args.threshold:
                removed.append((collection.get("row"), item["title"], round(seconds, 3)))
            else:
                kept.append(item)
        collection["media"] = kept
    verified = sum(value for (provider, state), value in by_provider.items() if state == "verified")
    print(f"Videos: {len(videos)}; verified: {verified}; unknown: {len(videos) - verified}; below {args.threshold:g}s: {len(removed)}")
    print("Coverage:", dict(sorted((f"{provider}/{state}", count) for (provider, state), count in by_provider.items())))
    for row, title, seconds in removed:
        print(f"REMOVE C{row}: {title} ({seconds:g}s)")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
