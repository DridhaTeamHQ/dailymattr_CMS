import sys
import json
import os
import subprocess

def install_and_import():
    try:
        import yt_dlp
        return yt_dlp
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "yt-dlp"])
        import yt_dlp
        return yt_dlp

def scrape_and_download(url, output_dir):
    try:
        yt_dlp = install_and_import()
        
        os.makedirs(output_dir, exist_ok=True)
        out_template = os.path.join(output_dir, '%(id)s.%(ext)s')
        
        ydl_opts = {
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': out_template,
            'quiet': True,
            'no_warnings': True,
            'merge_output_format': 'mp4',
            'overwrites': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            video_id = info.get('id')
            title = info.get('title', '')
            duration = info.get('duration', 0)
            thumbnail = info.get('thumbnail', '')
            uploader = info.get('uploader') or info.get('channel') or ''

            ext = info.get('ext', 'mp4')
            filename = f"{video_id}.{ext}"
            
            # Check if file exists in output_dir
            if not os.path.exists(os.path.join(output_dir, filename)):
                # Look for downloaded file starting with video_id
                for f in os.listdir(output_dir):
                    if f.startswith(video_id):
                        filename = f
                        break

            return {
                "success": True,
                "url": url,
                "title": title,
                "videoUrl": f"/api/media/{filename}",
                "coverUrl": thumbnail,
                "durationSec": int(duration) if duration else None,
                "uploader": uploader
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No URL provided"}))
        sys.exit(1)

    input_url = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.getcwd(), "public", "uploads")
    result = scrape_and_download(input_url, out_dir)
    print(json.dumps(result))
