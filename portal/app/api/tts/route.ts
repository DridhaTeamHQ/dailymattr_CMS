import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text") || "";
  const lang = searchParams.get("lang") || "en";

  if (!text.trim()) {
    return new NextResponse("Missing text parameter", { status: 400 });
  }

  try {
    const rawText = text.trim();
    // Split into chunks of max 170 characters at word boundaries (Google TTS 200-char limit)
    const chunks: string[] = [];
    let current = "";

    const words = rawText.split(/\s+/);
    for (const w of words) {
      if ((current + " " + w).length > 170) {
        if (current) chunks.push(current.trim());
        current = w;
      } else {
        current = current ? current + " " + w : w;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    // Limit to max 10 chunks (~1700 chars)
    const limitedChunks = chunks.slice(0, 10);

    // Fetch MP3 audio buffers for all chunks concurrently
    const audioBuffers = await Promise.all(
      limitedChunks.map(async (chunk) => {
        const query = encodeURIComponent(chunk);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${query}&tl=${lang}&client=tw-ob`;
        const res = await fetch(ttsUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        if (!res.ok) throw new Error("Upstream chunk TTS failed");
        return new Uint8Array(await res.arrayBuffer());
      })
    );

    // Concatenate all MP3 chunks into one seamless MP3 buffer
    const totalLength = audioBuffers.reduce((acc, b) => acc + b.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of audioBuffers) {
      combined.set(buf, offset);
      offset += buf.length;
    }

    return new NextResponse(combined.buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (err: any) {
    return new NextResponse("Error streaming TTS audio: " + err.message, {
      status: 500,
    });
  }
}
