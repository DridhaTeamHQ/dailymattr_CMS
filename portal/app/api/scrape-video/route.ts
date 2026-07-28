import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { success: false, error: "Valid video URL is required" },
        { status: 400 }
      );
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const isYoutube = url.includes("youtube.com") || url.includes("youtu.be");
    const isInstagram = url.includes("instagram.com");

    if (isYoutube) {
      let videoId = "";
      const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
      const beMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);

      if (shortsMatch) videoId = shortsMatch[1];
      else if (watchMatch) videoId = watchMatch[1];
      else if (beMatch) videoId = beMatch[1];

      if (videoId) {
        let title = `YouTube Short (${videoId})`;
        let author = "YouTube Creator";
        let coverUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        let durationSec = 60;
        let directMp4StreamUrl = "";
        const localFileName = `${videoId}.mp4`;
        const localFilePath = path.join(uploadsDir, localFileName);

        // Step 1: Fetch YouTube OEmbed for title, channel author & thumbnail
        try {
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
            { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
          );
          if (oembedRes.ok) {
            const oembed = await oembedRes.json();
            if (oembed.title) title = oembed.title;
            if (oembed.author_name) author = oembed.author_name;
            if (oembed.thumbnail_url) coverUrl = oembed.thumbnail_url;
          }
        } catch (e) {
          console.warn("OEmbed fetch skipped:", e);
        }

        // Step 2: Fetch YouTube webpage and extract direct MP4 stream URL from ytInitialPlayerResponse
        try {
          const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept-Language": "en-US,en;q=0.9",
            },
          });

          if (pageRes.ok) {
            const html = await pageRes.text();
            const jsonMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
            if (jsonMatch) {
              const playerResponse = JSON.parse(jsonMatch[1]);
              
              if (playerResponse.videoDetails) {
                if (playerResponse.videoDetails.title) title = playerResponse.videoDetails.title;
                if (playerResponse.videoDetails.author) author = playerResponse.videoDetails.author;
                if (playerResponse.videoDetails.lengthSeconds) {
                  durationSec = parseInt(playerResponse.videoDetails.lengthSeconds, 10);
                }
              }

              const formats = playerResponse.streamingData?.formats || [];
              const adaptiveFormats = playerResponse.streamingData?.adaptiveFormats || [];
              
              // Find format with direct url and mp4 container
              const mp4Format =
                formats.find((f: any) => f.url && f.mimeType?.includes("video/mp4")) ||
                formats.find((f: any) => f.url) ||
                adaptiveFormats.find((f: any) => f.url && f.mimeType?.includes("video/mp4")) ||
                adaptiveFormats.find((f: any) => f.url);

              if (mp4Format && mp4Format.url) {
                directMp4StreamUrl = mp4Format.url;
              }
            }
          }
        } catch (e) {
          console.warn("YouTube HTML extraction failed:", e);
        }

        // Step 3: Download the stream we actually found.
        //
        // There is deliberately no stock-video fallback here. This used to
        // download an unrelated clip and report success, so an editor could
        // publish stock footage believing they had scraped the source.
        let downloaded = false;
        if (directMp4StreamUrl) {
          try {
            const videoRes = await fetch(directMp4StreamUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            });
            if (videoRes.ok) {
              const buf = await videoRes.arrayBuffer();
              fs.writeFileSync(localFilePath, Buffer.from(buf));
              downloaded = fs.existsSync(localFilePath);
            }
          } catch (e) {
            console.warn("Video file write failed:", e);
          }
        }

        // Metadata is still worth having even when the stream is locked —
        // say so plainly rather than inventing a video.
        return NextResponse.json({
          success: true,
          url,
          title,
          videoUrl: downloaded ? `/api/media/${localFileName}` : null,
          coverUrl,
          durationSec: downloaded ? durationSec : null,
          uploader: author,
          isDownloaded: downloaded,
          notice: downloaded
            ? null
            : "Couldn't extract a playable stream — title and thumbnail imported. Add the video file yourself.",
        });
      }
    } else if (isInstagram) {
      // Instagram is not scraped. It previously returned a hardcoded stock
      // clip with success:true, which is worse than not supporting it.
      return NextResponse.json(
        {
          success: false,
          error:
            "Instagram isn't supported — download the reel and upload the file, or paste a direct video URL.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Please provide a valid YouTube Shorts or Instagram Reel link." },
      { status: 400 }
    );

  } catch (err: any) {
    console.error("Scrape route error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to download video" },
      { status: 500 }
    );
  }
}
