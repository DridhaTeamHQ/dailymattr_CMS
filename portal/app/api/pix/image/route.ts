import { USER_AGENT } from "@/lib/pixScrape";

/**
 * Same-origin proxy for scraped images.
 *
 * Without this the composer can draw a remote photograph but never export it —
 * the canvas is tainted the moment a cross-origin image is drawn, and
 * `toDataURL` throws. Serving the bytes from our own origin keeps it clean.
 */
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("url");
  if (!target) {
    return Response.json({ error: "Image URL is required." }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return Response.json({ error: "That is not a valid URL." }, { status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return Response.json(
      { error: "Only http and https image URLs are supported." },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(parsed, {
      headers: { "user-agent": USER_AGENT },
    });
    if (!response.ok) {
      return Response.json(
        { error: `Image source returned ${response.status}.` },
        { status: 502 }
      );
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      return Response.json(
        { error: "That URL did not return an image." },
        { status: 415 }
      );
    }

    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Image proxy failed.",
      },
      { status: 500 }
    );
  }
}
