"""
yt-dlp worker for the Qix video importer.

Invoked by app/api/scrape-video/route.ts as:
    python scripts/scrape_video.py <url> <output_dir>

Writes a single JSON object to stdout and nothing else, so the route can parse
it directly. Progress and warnings go to stderr where they are logged but never
mixed into the result.
"""

import json
import os
import sys

# A Shorts/Reel is seconds long; anything past this is a stream or a full film
# that would fill the disk and never fit the 9:16 player.
MAX_DURATION_SEC = 20 * 60
# Bytes, not a "300M" string: the CLI parses suffixes but the Python API
# compares this against an int filesize directly.
MAX_FILESIZE = 300 * 1024 * 1024

SUPPORTED_EXTRACTORS = {"youtube", "youtube:shorts", "instagram", "instagram:story"}


def fail(message, code="error"):
    print(json.dumps({"success": False, "error": message, "code": code}))
    sys.exit(0)  # the route reads JSON, not the exit status


def scrape(url, output_dir):
    try:
        import yt_dlp
    except ImportError:
        fail(
            "yt-dlp is not installed on the server. Run: pip install yt-dlp",
            code="missing_dependency",
        )

    os.makedirs(output_dir, exist_ok=True)

    opts = {
        # Prefer an H.264/AAC mp4 pair so the file plays everywhere without a
        # re-encode; fall back to whatever single file the site offers.
        "format": "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/b",
        # Cap on `res`, which yt-dlp defines as the SMALLER dimension. A height
        # filter would read 720p portrait as 1280 and quietly downgrade every
        # vertical clip to 480p — the opposite of what a 9:16 feed wants.
        "format_sort": ["res:1080", "ext:mp4:m4a"],
        "merge_output_format": "mp4",
        "outtmpl": os.path.join(output_dir, "%(extractor_key)s-%(id)s.%(ext)s"),
        "max_filesize": MAX_FILESIZE,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "overwrites": True,
        "retries": 2,
        "socket_timeout": 20,
        # Never let a malformed link make yt-dlp crawl a whole channel.
        "playlist_items": "1",
        "logtostderr": True,
    }

    # Instagram serves an empty response to logged-out clients for most Reels,
    # so credentials have to come from somewhere. Both are opt-in via env:
    #   YTDLP_COOKIES_FILE        path to a Netscape cookies.txt export
    #   YTDLP_COOKIES_FROM_BROWSER  e.g. "chrome" — reads a logged-in profile
    cookie_file = os.environ.get("YTDLP_COOKIES_FILE", "").strip()
    if cookie_file and os.path.exists(cookie_file):
        opts["cookiefile"] = cookie_file

    from_browser = os.environ.get("YTDLP_COOKIES_FROM_BROWSER", "").strip()
    if from_browser and not cookie_file:
        # yt-dlp wants a tuple: (browser, profile, keyring, container)
        opts["cookiesfrombrowser"] = (from_browser.lower(), None, None, None)

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            # Probe first so an over-long video costs nothing to reject.
            info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist":
                entries = [e for e in (info.get("entries") or []) if e]
                if not entries:
                    fail("That link has no playable video.", code="not_found")
                info = entries[0]

            extractor = (info.get("extractor") or "").lower()
            if extractor not in SUPPORTED_EXTRACTORS:
                fail(
                    "Only YouTube and Instagram links can be imported.",
                    code="unsupported_site",
                )

            duration = info.get("duration") or 0
            if duration and duration > MAX_DURATION_SEC:
                mins = int(duration // 60)
                fail(
                    f"That video is {mins} minutes long. Import clips under "
                    f"{MAX_DURATION_SEC // 60} minutes.",
                    code="too_long",
                )

            if info.get("is_live"):
                fail("Live streams can't be imported.", code="is_live")

            downloaded = ydl.extract_info(url, download=True)
            if downloaded.get("_type") == "playlist":
                downloaded = [e for e in (downloaded.get("entries") or []) if e][0]

            path = downloaded.get("requested_downloads", [{}])[0].get("filepath")
            if not path or not os.path.exists(path):
                fail("The download finished but produced no file.", code="no_file")

            width = downloaded.get("width") or 0
            height = downloaded.get("height") or 0

            print(
                json.dumps(
                    {
                        "success": True,
                        "url": url,
                        "title": downloaded.get("title") or "",
                        "filename": os.path.basename(path),
                        "sizeBytes": os.path.getsize(path),
                        "coverUrl": downloaded.get("thumbnail") or "",
                        "durationSec": int(duration) if duration else None,
                        "uploader": downloaded.get("uploader")
                        or downloaded.get("channel")
                        or "",
                        "width": width,
                        "height": height,
                        "isVertical": bool(height and width and height > width),
                    }
                )
            )

    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - surface yt-dlp's own message
        text = str(e)
        # yt-dlp prefixes its own errors; strip it so the UI reads cleanly.
        text = text.replace("ERROR: ", "").strip()
        if "empty media response" in text or "rate-limit reached" in text:
            fail(
                "Instagram blocked this download. It only serves Reels to "
                "logged-in clients — set YTDLP_COOKIES_FILE to a cookies.txt "
                "export, or YTDLP_COOKIES_FROM_BROWSER=chrome.",
                code="needs_cookies",
            )
        if "Private video" in text or "login" in text.lower():
            fail("That video is private or needs a login.", code="private")
        if "Video unavailable" in text or "not available" in text.lower():
            fail("That video is unavailable or was removed.", code="unavailable")
        if "max_filesize" in text or "larger than" in text:
            fail("That video is too large to import.", code="too_large")
        fail(text[:300] or "Could not download that video.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        fail("No URL provided.", code="bad_request")
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.getcwd(), "public", "uploads")
    scrape(sys.argv[1], out)
