"use client";

import {
  PIX_CHARS_PER_LINE,
  PIX_LINES,
  PIX_POINT_COUNT,
  PIX_POINT_MAX,
  PIX_TITLE_MAX,
  pixLines,
  pixPointsFromSummary,
} from "@/lib/pix";
import type { ImageSuggestion } from "@/lib/pixImageSearch";
import { COVERS, UploadError, uploadBlob } from "@/lib/storage";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Download,
  ImagePlus,
  Link2,
  Loader2,
  RotateCcw,
  Search,
  Zap,
} from "lucide-react";
import {
  EXPORT_LONG_EDGES,
  FILTER_NAMES,
  FILTER_PRESETS,
  IMAGE_DEFAULTS,
  IMAGE_PAN_LIMIT,
  LAYOUT_PRESETS,
  RATIOS,
  defaultComposerState,
  getHeadlineFamily,
  getLayout,
  getPreviewTextFamily,
  renderPoster,
  renderTextScreen,
  scaleForLongEdge,
  getPublisherFamily,
  setHeadlineFamily,
  setPreviewTextFamily,
  setPublisherFamily,
  type PixAssets,
  type PixComposerState,
  type PixFilter,
  type PixRatio,
  type PixTag,
} from "@/lib/pixComposer";

/**
 * Pix Post Builder, in the CMS.
 *
 * The writer composes the real 9:16 poster here instead of dropping a bare
 * cover image, then commits it — the exported PNG becomes the Pix cover.
 */

type PreviewMode = "poster" | "text";

const TAGS: [PixTag, string, string][] = [
  ["none", "None", "No badge"],
  ["trending", "🔥 Trending", "Trending with icon"],
  ["trending-text", "Trending", "Trending text only"],
  ["breaking", "⚡ Breaking", "Breaking with icon"],
  ["breaking-text", "Breaking", "Breaking text only"],
];

/** Renders the key points as the bullet list the Text screen draws. */
const asBullets = (points: string[]) =>
  points
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `• ${p}`)
    .join("\n\n");

/** Badge artwork, keyed by tag. */
const TAG_SRC: Record<Exclude<PixTag, "none">, string> = {
  trending: "/pix/trending.svg",
  "trending-text": "/pix/trending-text.svg",
  breaking: "/pix/breaking.svg",
  "breaking-text": "/pix/breaking-text.svg",
};

const FILTER_LABELS: Record<PixFilter, string> = {
  none: "None",
  vivid: "Vivid",
  bw: "B&W",
  warm: "Warm",
  cool: "Cool",
  faded: "Faded",
  soft: "Soft",
};

/**
 * Committing a poster writes two files to Storage.
 *
 * The master is a lossless PNG at the largest size this browser will actually
 * encode. It is the archive copy: nothing is thrown away, and it is what a
 * reprint or a re-crop should start from. Covers used to be squeezed into a
 * database column, which is why they were downgraded to 1x JPEG; that reason
 * is gone.
 *
 * The display copy exists because a library grid loads a dozen covers at once
 * and a dozen lossless posters is tens of megabytes. It is WebP at q0.94 and
 * design size — visually indistinguishable at the size anything renders it,
 * and around 250 KB.
 */
const MASTER_LONG_EDGES = [7680, 6144, 3840] as const;
const DISPLAY_SCALE = 1;
const DISPLAY_TYPE = "image/webp";
const DISPLAY_QUALITY = 0.94;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Data URLs and same-origin assets need no CORS dance; remote covers do,
    // or the canvas taints and export throws.
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src.slice(0, 60)}`));
    img.src = src;
  });
}

export default function PixComposer({
  headline,
  onHeadline,
  points,
  onPoints,
  source,
  onSource,
  coverUrl,
  onCommit,
  disabled,
}: {
  /** The Pix headline. Owned by the item — this is the only place it is typed. */
  headline: string;
  onHeadline: (value: string) => void;
  /** The three key points, likewise owned by the item. */
  points: string[];
  onPoints: (points: string[]) => void;
  /** Where the story came from — shown on the Pix and checked by QA. */
  source: { title: string; url: string } | null;
  onSource: (source: { title: string; url: string } | null) => void;
  coverUrl: string | null;
  /**
   * Called with the stored cover URL. `masterUrl` accompanies a committed
   * poster — the lossless original — and is null when the cover is just a
   * source photograph that has not been composed yet.
   */
  onCommit: (coverUrl: string, masterUrl: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<PixComposerState>(defaultComposerState);
  const [loaded, setLoaded] = useState<{
    src: string;
    img: HTMLImageElement;
  } | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [tagImages, setTagImages] = useState<Record<string, HTMLImageElement>>({});
  const [fontsReady, setFontsReady] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  /** The last poster this composer exported, so "saved" can be derived. */
  const [exported, setExported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which slide the canvas is showing: the poster or the Text screen. */
  const [previewMode, setPreviewMode] = useState<PreviewMode>("poster");
  /* Scrape & Build */
  const [articleUrl, setArticleUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState<string | null>(null);
  const [scrapeErr, setScrapeErr] = useState<string | null>(null);
  /** Headlines found on a listing page, for picking one to build from. */
  const [headlines, setHeadlines] = useState<
    { title: string; url: string }[] | null
  >(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  /* Image suggestions */
  const [suggestions, setSuggestions] = useState<ImageSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  /** Poster or Text screen — both are the same state, drawn differently. */
  const draw = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      st: PixComposerState,
      a: PixAssets,
      scale: number
    ) =>
      previewMode === "text"
        ? renderTextScreen(ctx, st, a, scale)
        : renderPoster(ctx, st, a, scale),
    [previewMode]
  );

  const setDraftKey = <K extends keyof PixComposerState>(
    k: K,
    v: PixComposerState[K]
  ) => setDraft((s) => ({ ...s, [k]: v }));

  // Derived rather than synced: an effect mirroring one prop into state just
  // buys an extra render and a stale-value window.
  const state: PixComposerState = useMemo(
    // The credit is the item's source, not composer state — it belongs to the
    // Pix, so it flows in here rather than being typed twice.
    () => ({ ...draft, headline, publisher: source?.title ?? "" }),
    [draft, headline, source?.title]
  );
  /**
   * The photograph being composed with. Seeded from the item's cover, but it
   * deliberately outlives it: once committed, the cover IS this poster, and
   * reloading that as the source would nest the poster inside itself.
   */
  const image = loaded?.img ?? null;
  const loadedSrc = loaded?.src ?? null;
  const titleLines = pixLines(headline, PIX_CHARS_PER_LINE.headlineList);
  const filledPoints = points.filter((p) => p.trim()).length;
  /** True while the item's cover is exactly what we last exported. */
  const committed = exported !== null && coverUrl === exported;

  // Chrome: logo and the two tag badges.
  useEffect(() => {
    let alive = true;
    loadImage("/pix/pix-logo.png")
      .then((img) => alive && setLogo(img))
      .catch(() => {});
    const keys = Object.keys(TAG_SRC) as (keyof typeof TAG_SRC)[];
    Promise.all(
      keys.map((k) => loadImage(TAG_SRC[k]).catch(() => null))
    ).then((images) => {
      if (!alive) return;
      const next: Record<string, HTMLImageElement> = {};
      keys.forEach((k, i) => {
        const img = images[i];
        if (img) next[k] = img;
      });
      setTagImages(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The headline is set in Roboto Serif — the canvas must wait for it, or the
  // first paint measures a fallback face and every line wraps wrong.
  useEffect(() => {
    let alive = true;
    const done = () => alive && setFontsReady(true);
    if (typeof document === "undefined" || !document.fonts) {
      done();
      return;
    }
    // next/font mints a hashed family name; take it from the CSS variable.
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-jakarta")
      .trim();
    if (resolved) setHeadlineFamily(resolved);
    const body = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-poppins")
      .trim();
    if (body) setPreviewTextFamily(body);
    const credit = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-inter")
      .trim();
    if (credit) setPublisherFamily(credit);

    const family = getHeadlineFamily();
    const textFamily = getPreviewTextFamily();
    Promise.all([
      document.fonts.load(`800 48px ${family}`),
      document.fonts.load(`800 64px ${family}`),
      document.fonts.load(`700 39px ${textFamily}`),
      // The credit draws at ~31px on a 9:16 poster; load it before first paint.
      document.fonts.load(`600 31px ${getPublisherFamily()}`),
    ])
      .then(done)
      .catch(done);
    return () => {
      alive = false;
    };
  }, []);

  // The cover the editor already holds becomes the poster's photograph —
  // unless it is a poster we just exported, or one we already loaded.
  useEffect(() => {
    if (!coverUrl || coverUrl === exported || coverUrl === loadedSrc) return;
    let alive = true;
    loadImage(coverUrl)
      .then((img) => {
        if (!alive) return;
        setLoaded({ src: coverUrl, img });
        setImgError(null);
      })
      .catch(() => {
        if (alive) setImgError("Couldn't load that image for the canvas.");
      });
    return () => {
      alive = false;
    };
  }, [coverUrl, exported, loadedSrc]);

  const assets: PixAssets = useMemo(
    () => ({
      image,
      logo,
      tag: state.tag === "none" ? null : (tagImages[state.tag] ?? null),
    }),
    [image, logo, tagImages, state.tag]
  );

  // Draw on every state change. Cheap enough at these sizes to do inline.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fontsReady) return;
    const L = getLayout(state);
    canvas.width = L.W;
    canvas.height = L.H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    draw(ctx, state, assets, 1);
  }, [state, assets, fontsReady, draw]);

  /* ── Drag to pan the photograph ── */
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image || disabled) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      ox: state.imageOffset.x,
      oy: state.imageOffset.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const canvas = canvasRef.current;
    if (!d || !canvas) return;
    // Convert screen pixels to canvas pixels so panning tracks the cursor.
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    setDraftKey("imageOffset", {
      x: d.ox + (e.clientX - d.x) * ratio,
      y: d.oy + (e.clientY - d.y) * ratio,
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  /** Puts pan, zoom, opacity and every filter value back to neutral. */
  const resetImageAndFilters = () =>
    setDraft((s) => ({ ...s, ...IMAGE_DEFAULTS }));

  /** Nudging any single value drops the preset chip — it no longer describes it. */
  const setAdjustment = (
    key:
      | "filterBrightness"
      | "filterContrast"
      | "filterSaturation"
      | "filterBlur",
    value: number
  ) => setDraft((s) => ({ ...s, [key]: value, filter: "none" }));

  const applyFilter = (name: PixFilter) => {
    const p = FILTER_PRESETS[name];
    setDraft((s) => ({
      ...s,
      filter: name,
      filterBrightness: p.brightness,
      filterContrast: p.contrast,
      filterSaturation: p.saturation,
      filterBlur: p.blur,
    }));
  };

  /**
   * Renders to a Blob at the largest of `targets` this browser will encode.
   *
   * An oversized canvas fails silently rather than throwing — toBlob hands back
   * null, or a couple of hundred bytes of nothing — so each tier is judged by
   * what actually came back, and the next one down is tried.
   */
  const renderBlob = useCallback(
    async (
      targets: readonly number[],
      type: string,
      quality?: number
    ): Promise<{ blob: Blob; width: number; height: number } | null> => {
      const L = getLayout(state);
      for (const target of targets) {
        const scale = scaleForLongEdge(target, L.W, L.H);
        const out = document.createElement("canvas");
        try {
          out.width = Math.round(L.W * scale);
          out.height = Math.round(L.H * scale);
          const ctx = out.getContext("2d");
          if (!ctx) continue;
          draw(ctx, state, assets, scale);
        } catch {
          continue; // allocation failed at this size — try smaller
        }

        const blob = await new Promise<Blob | null>((resolve) => {
          try {
            out.toBlob(resolve, type, quality);
          } catch {
            resolve(null);
          }
        });
        if (!blob || blob.size <= 2000) continue;
        return { blob, width: out.width, height: out.height };
      }
      return null;
    },
    [state, assets, draw]
  );

  /**
   * Commit uploads the poster and hands back URLs, rather than inlining a data
   * URL on the item. Two files: the lossless master, and the display copy the
   * grids load. See MASTER_LONG_EDGES above for why both exist.
   */
  const commit = async () => {
    setBusy(true);
    setImgError(null);
    setExportNote(null);
    try {
      const L = getLayout(state);
      const displayEdge = Math.max(L.W, L.H) * DISPLAY_SCALE;

      const master = await renderBlob(MASTER_LONG_EDGES, "image/png");
      const display = await renderBlob(
        [displayEdge],
        DISPLAY_TYPE,
        DISPLAY_QUALITY
      );

      if (!master || !display) {
        // Almost always a tainted canvas rather than a size problem: a
        // cross-origin photograph blocks reading the pixels back.
        setImgError(
          "Export blocked — that image is hosted elsewhere and won't allow reading it back. Upload the file instead."
        );
        return;
      }

      const [displayUrl, masterUrl] = await Promise.all([
        uploadBlob(COVERS, display.blob, "pix"),
        uploadBlob(COVERS, master.blob, "pix/master"),
      ]);

      setExported(displayUrl);
      onCommit(displayUrl, masterUrl);
      setExportNote(
        `Committed — master ${master.width} × ${master.height} PNG, ${Math.round(master.blob.size / 1024)} KB`
      );
    } catch (e) {
      setImgError(
        e instanceof UploadError
          ? `Upload failed: ${e.message}`
          : "Could not commit the poster."
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Download at the highest resolution this browser will actually encode,
   * stepping 8K → 6K → 4K.
   */
  const download = async () => {
    setBusy(true);
    setImgError(null);
    try {
      const out = await renderBlob(EXPORT_LONG_EDGES, "image/png");
      if (!out) {
        setImgError("This browser could not encode the poster at any size.");
        return;
      }
      const href = URL.createObjectURL(out.blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `pix-${state.ratio.replace(":", "x")}-${out.width}x${out.height}.png`;
      a.click();
      URL.revokeObjectURL(href);
      setExportNote(`Saved ${out.width} × ${out.height}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Scrape & Build — paste an article URL, get its headline and hero image.
   *
   * The image comes back through our own proxy and is inlined as a data URL,
   * so the poster stays exportable no matter where the photograph was hosted.
   */
  const scrapeAndBuild = async (override?: string) => {
    const url = (override ?? articleUrl).trim();
    if (!url || scraping) return;
    setScraping(true);
    setScrapeErr(null);
    setScrapeMsg(null);
    if (override) setHeadlines(null);

    try {
      const res = await fetch("/api/pix/scrape-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Scrape failed.");

      // The model writes the card copy; the publisher's own headline is the
      // fallback when writing was skipped or failed.
      const written: string[] | null = Array.isArray(data.points)
        ? data.points
        : null;

      const chosenHeadline = data.headline || data.title;
      if (chosenHeadline) onHeadline(chosenHeadline.slice(0, PIX_TITLE_MAX));
      // Every Pix carries where it came from.
      onSource({ title: new URL(url).hostname.replace(/^www\./, ""), url });

      // Without AI copy, fall back to the article's own sentences, split the
      // way the app does it — sentences of at least 25 characters.
      const scrapedPoints =
        written ??
        pixPointsFromSummary(data.articleText || data.detailText || "");

      if (scrapedPoints.length) {
        const filled = Array.from(
          { length: PIX_POINT_COUNT },
          (_, i) => (scrapedPoints[i] ?? "").slice(0, PIX_POINT_MAX)
        );
        onPoints(filled);
        // The Text screen takes the model's paragraph when there is one, and
        // otherwise mirrors the points as bullets the way it always has.
        setDraftKey("detailText", data.textSlide || asBullets(filled));
      }

      if (data.imageProxy) {
        // Stored as fetched — the bytes the publisher served, not a re-encode.
        const blob = await (await fetch(data.imageProxy)).blob();
        const stored = await uploadBlob(COVERS, blob, "source");
        setImgError(null);
        onCommit(stored, null);
        setScrapeMsg(
          written
            ? `Written from ${new URL(url).hostname} — check every fact before submitting.`
            : `Built from ${new URL(url).hostname}`
        );
      } else {
        setScrapeMsg("Headline scraped — no image on that page, add one below.");
      }
      // Writing is additive: say so when it was skipped, but keep the scrape.
      if (data.aiError) setScrapeErr(data.aiError);
    } catch (error) {
      setScrapeErr(
        error instanceof Error ? error.message : "Could not scrape that URL."
      );
    } finally {
      setScraping(false);
    }
  };

  /**
   * Image suggestions for the poster. Defaults to searching the headline, so
   * the writer gets usable photographs without typing anything.
   */
  const findImages = async (override?: string) => {
    const q = (override ?? searchQuery ?? "").trim() || state.headline.trim();
    if (!q || searching) return;
    setSearching(true);
    setSuggestions(null);
    setImgError(null);
    try {
      const res = await fetch(
        `/api/pix/images?q=${encodeURIComponent(q)}&max=12`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Image search failed.");
      setSuggestions(data.images ?? []);
    } catch (error) {
      setImgError(
        error instanceof Error ? error.message : "Image search failed."
      );
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  };

  /** Pulls a suggestion through the proxy and inlines it as the cover. */
  const applySuggestion = async (s: ImageSuggestion) => {
    setBusy(true);
    setImgError(null);
    try {
      const blob = await (await fetch(s.imageProxy)).blob();
      const stored = await uploadBlob(COVERS, blob, "source");
      onCommit(stored, null);
      setSuggestions(null);
    } catch {
      setImgError("That image could not be loaded — try another.");
    } finally {
      setBusy(false);
    }
  };

  /** Lists the headlines on a section or homepage, to pick one to build from. */
  const browseHeadlines = async () => {
    const url = articleUrl.trim();
    if (!url || scraping) return;
    setScraping(true);
    setScrapeErr(null);
    setScrapeMsg(null);
    setHeadlines(null);

    try {
      const res = await fetch("/api/pix/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Scrape failed.");
      const items = (data.items ?? []) as { title: string; url: string }[];
      setHeadlines(items);
      setScrapeMsg(
        items.length
          ? `${items.length} headlines — pick one to build`
          : "No headlines found on that page."
      );
    } catch (error) {
      setScrapeErr(
        error instanceof Error ? error.message : "Could not scrape that URL."
      );
    } finally {
      setScraping(false);
    }
  };

  /**
   * An upload becomes the cover immediately, so the poster and the CMS never
   * disagree about which photograph this Pix uses. The load effect picks the
   * stored URL up from `coverUrl` and redraws.
   *
   * The File goes to Storage as-is. Reading it into a data URL first and
   * re-encoding would lose detail before the poster is even composed.
   */
  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setImgError(null);
    try {
      const stored = await uploadBlob(COVERS, file, "source");
      onCommit(stored, null);
    } catch (e) {
      setImgError(
        e instanceof UploadError
          ? `Upload failed: ${e.message}`
          : "Could not upload that image."
      );
    } finally {
      setBusy(false);
    }
  };

  const L = LAYOUT_PRESETS[state.ratio];

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {/* ── Poster ── sticks to the top from the two-column breakpoint up, so
          every edit stays visible while scrolling the controls beside it. */}
      <div className="md:sticky md:top-4">
        {/* The two slides a reader swipes between. */}
        <div className="mb-2 flex items-center gap-1 rounded-full bg-canvas p-1">
          {(
            [
              ["poster", "Poster"],
              ["text", "Text"],
            ] as [PreviewMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setPreviewMode(m)}
              className={`flex-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
                previewMode === m
                  ? "bg-shell text-white"
                  : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          className="overflow-hidden rounded-2xl bg-[#050505] shadow-(--shadow-soft)"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`block w-full ${
              image && !disabled ? "cursor-grab active:cursor-grabbing" : ""
            }`}
            style={{ aspectRatio: `${L.W} / ${L.H}` }}
          />
        </div>
        <p className="mt-2 text-center text-[10px] text-faint tabular-nums">
          {exportNote ? (
            <span className="font-bold text-mint">{exportNote}</span>
          ) : (
            <>
              {L.W} × {L.H} · downloads up to 8K
              {image ? " · drag the poster to reframe" : ""}
            </>
          )}
        </p>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={commit}
            disabled={disabled || busy}
            className="btn-accent flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs disabled:opacity-40"
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : committed ? (
              <Check size={13} />
            ) : null}
            {committed ? "Saved as cover" : "Use as cover"}
          </button>
          <button
            type="button"
            onClick={download}
            title="Download PNG"
            className="btn-ghost flex h-[34px] w-[34px] shrink-0 items-center justify-center !p-0"
          >
            <Download size={14} />
          </button>
        </div>

        {imgError && (
          <p className="mt-2 text-[11px] font-semibold text-rose">{imgError}</p>
        )}
      </div>

      {/* ── Controls ── two tidy columns once there is room for them. */}
      <div className="grid content-start gap-4 xl:grid-cols-2">
        {/* Import from a URL. The fields below stay editable either way, so
            nothing is hidden behind a mode. */}
        <div className="rounded-2xl border border-line bg-canvas p-3 xl:col-span-2">
          <div className="mb-2 flex items-center gap-1.5">
            <Link2 size={13} className="text-accent" />
            <span className="label">Build from an article</span>
          </div>
          <div className="flex gap-2">
            <input
              className="field !bg-card text-xs"
              value={articleUrl}
              disabled={disabled || scraping}
              onChange={(e) => setArticleUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  scrapeAndBuild();
                }
              }}
              placeholder="https://example.com/article"
            />
            <button
              type="button"
              onClick={() => scrapeAndBuild()}
              disabled={disabled || scraping || !articleUrl.trim()}
              className="btn-primary flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-40"
            >
              {scraping ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Zap size={13} />
              )}
              {scraping ? "Scraping…" : "Scrape & Build"}
            </button>
          </div>
          <div className="mt-1.5 flex items-start justify-between gap-3">
            <p
              className={`text-[11px] font-semibold ${
                scrapeErr ? "text-rose" : scrapeMsg ? "text-mint" : "text-faint"
              }`}
            >
              {scrapeErr ??
                scrapeMsg ??
                "Pulls the headline and hero image straight onto the poster."}
            </p>
            <button
              type="button"
              onClick={browseHeadlines}
              disabled={disabled || scraping || !articleUrl.trim()}
              className="shrink-0 text-[11px] font-bold text-accent disabled:opacity-40"
            >
              Browse headlines
            </button>
          </div>

          {/* A section or homepage yields a list — pick one and build it. */}
          {headlines !== null && headlines.length > 0 && (
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl bg-card p-1.5">
              {headlines.map((h) => (
                <li key={h.url}>
                  <button
                    type="button"
                    onClick={() => scrapeAndBuild(h.url)}
                    disabled={disabled || scraping}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] leading-snug font-medium text-muted transition-colors hover:bg-tint hover:text-accent disabled:opacity-40"
                  >
                    {h.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Content — always editable, never behind a tab. */}
        <div className="xl:col-span-2 rounded-2xl border border-line bg-canvas p-3">
            <div className="space-y-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="label">Headline</div>
                  <span
                    className={`text-[10px] font-bold tabular-nums ${
                      titleLines > PIX_LINES.headline ? "text-rose" : "text-faint"
                    }`}
                  >
                    {headline.length}/{PIX_TITLE_MAX} · {titleLines}/
                    {PIX_LINES.headline} lines
                  </span>
                </div>
                <textarea
                  className="field min-h-16 resize-y !bg-card text-xs"
                  value={headline}
                  maxLength={PIX_TITLE_MAX}
                  disabled={disabled}
                  onChange={(e) => onHeadline(e.target.value)}
                  placeholder="Type your headline…"
                />
                <p className="mt-1 text-[11px] text-faint">
                  Wrap words in [brackets], (parens) or {"{braces}"} to paint the
                  accent behind them.
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="label">Key points</div>
                  <span
                    className={`text-[10px] font-bold tabular-nums ${
                      filledPoints === PIX_POINT_COUNT
                        ? "text-mint"
                        : "text-faint"
                    }`}
                  >
                    {filledPoints}/{PIX_POINT_COUNT}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {points.map((p, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span
                        className="mt-2 h-[7px] w-[7px] shrink-0 rounded-[4px]"
                        style={{ background: "var(--color-accent)" }}
                      />
                      <textarea
                        className="field min-h-9 resize-y !bg-card text-xs"
                        value={p}
                        maxLength={PIX_POINT_MAX}
                        disabled={disabled}
                        onChange={(e) => {
                          const next = [...points];
                          next[i] = e.target.value;
                          onPoints(next);
                        }}
                        placeholder={`Point ${i + 1}…`}
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-faint">
                  Scraping fills these from the article body. All three are
                  required before submitting for review.
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="label">Text slide</div>
                  <button
                    type="button"
                    disabled={disabled || filledPoints === 0}
                    onClick={() => setDraftKey("detailText", asBullets(points))}
                    className="flex items-center gap-1 text-[10px] font-bold text-accent disabled:opacity-40"
                  >
                    <RotateCcw size={10} /> Rebuild from key points
                  </button>
                </div>
                <textarea
                  className="field min-h-24 resize-y !bg-card text-xs"
                  value={state.detailText}
                  disabled={disabled}
                  onChange={(e) => setDraftKey("detailText", e.target.value)}
                  placeholder="• One point per line…"
                />
                <p className="mt-1 text-[11px] text-faint">
                  What the reader sees on the Text slide. Lines starting with
                  •, - or * render as bullets; scraping fills it from the key
                  points.
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="label">Source</div>
                  {!source && (
                    <span className="text-[10px] font-bold text-amber">
                      Required
                    </span>
                  )}
                </div>
                <div className="grid gap-1.5 sm:grid-cols-[130px_minmax(0,1fr)]">
                  <input
                    className="field !bg-card text-xs"
                    value={source?.title ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      onSource(
                        e.target.value || source?.url
                          ? { title: e.target.value, url: source?.url ?? "" }
                          : null
                      )
                    }
                    placeholder="Publisher"
                  />
                  <input
                    className="field !bg-card text-xs"
                    value={source?.url ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      onSource(
                        e.target.value || source?.title
                          ? { title: source?.title ?? "", url: e.target.value }
                          : null
                      )
                    }
                    placeholder="https://… the article this came from"
                  />
                </div>
                <p className="mt-1 text-[11px] text-faint">
                  Credited under the headline on the reader page. Scraping fills
                  it in automatically.
                </p>
              </div>
            </div>
        </div>

        <div className="xl:col-span-2">
          <div className="label mb-2">Photograph</div>
          <label
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-canvas px-4 py-3 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-accent ${
              disabled ? "pointer-events-none opacity-50" : ""
            }`}
          >
            <ImagePlus size={14} />
            {image ? "Replace image" : "Upload an image"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={disabled}
              onChange={(e) => onUpload(e.target.files?.[0])}
            />
          </label>

          {/* Image suggestions — Bing, Google or DuckDuckGo, whichever answers. */}
          <div className="mt-2 flex gap-2">
            <input
              className="field text-xs"
              value={searchQuery}
              disabled={disabled || searching}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  findImages();
                }
              }}
              placeholder={
                state.headline.trim()
                  ? "Search images — blank uses the headline"
                  : "Search images…"
              }
            />
            <button
              type="button"
              onClick={() => findImages()}
              disabled={
                disabled ||
                searching ||
                (!searchQuery.trim() && !state.headline.trim())
              }
              className="btn-ghost flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-40"
            >
              {searching ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Search size={13} />
              )}
              Suggest
            </button>
          </div>

          {suggestions !== null && (
            <div className="mt-2">
              {suggestions.length === 0 ? (
                <p className="text-[11px] font-semibold text-faint">
                  No images found — try different words.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={`${s.source}-${s.id}`}
                      type="button"
                      title={`${s.alt} · ${s.source}`}
                      disabled={disabled || busy}
                      onClick={() => applySuggestion(s)}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-canvas transition-all hover:border-accent disabled:opacity-40"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.preview}
                        alt={s.alt}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="label mb-2">Aspect ratio</div>
          <div className="grid grid-cols-4 gap-1.5">
            {RATIOS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={disabled}
                onClick={() =>
                  setDraft((s) => ({
                    ...s,
                    ratio: r as PixRatio,
                    // Pan offsets don't carry across ratios.
                    imageOffset: { x: 0, y: 0 },
                  }))
                }
                className={`rounded-xl border px-2 py-1.5 text-[11px] font-bold transition-colors ${
                  state.ratio === r
                    ? "border-accent bg-tint text-accent"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {LAYOUT_PRESETS[r].label}
                <span className="block text-[9px] font-medium text-faint">
                  {LAYOUT_PRESETS[r].sub}
                </span>
              </button>
            ))}
          </div>
        </div>

          <div>
            <div className="label mb-2">Tag badge</div>
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map(([t, label, title]) => (
                <button
                  key={t}
                  type="button"
                  title={title}
                  disabled={disabled}
                  onClick={() => setDraftKey("tag", t)}
                  className={`rounded-xl border px-2 py-1.5 text-[10px] font-bold transition-colors ${
                    state.tag === t
                      ? "border-accent bg-tint text-accent"
                      : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-2">Accent</div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={state.accent}
                disabled={disabled}
                onChange={(e) => setDraftKey("accent", e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-card p-1"
              />
              <span className="text-[11px] font-bold tabular-nums text-muted uppercase">
                {state.accent}
              </span>
            </div>
          </div>

        <div>
          <div className="label mb-2">Look</div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_NAMES.map((f) => (
              <button
                key={f}
                type="button"
                disabled={disabled}
                onClick={() => applyFilter(f)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${
                  state.filter === f
                    ? "border-accent bg-tint text-accent"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

        </div>

        <div className="xl:col-span-2">
          <div className="label mb-2">Adjustments</div>
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 2xl:grid-cols-3">
            <Slider
              label="Brightness"
              value={state.filterBrightness}
              min={0}
              max={200}
              disabled={disabled}
              onChange={(v) => setAdjustment("filterBrightness", v)}
              format={(v) => `${v}%`}
            />
            <Slider
              label="Contrast"
              value={state.filterContrast}
              min={0}
              max={200}
              disabled={disabled}
              onChange={(v) => setAdjustment("filterContrast", v)}
              format={(v) => `${v}%`}
            />
            <Slider
              label="Saturation"
              value={state.filterSaturation}
              min={0}
              max={200}
              disabled={disabled}
              onChange={(v) => setAdjustment("filterSaturation", v)}
              format={(v) => `${v}%`}
            />
            <Slider
              label="Blur"
              value={state.filterBlur}
              min={0}
              max={20}
              disabled={disabled}
              onChange={(v) => setAdjustment("filterBlur", v)}
              format={(v) => `${v}px`}
            />
            <Slider
              label="Zoom"
              value={state.imageZoom}
              min={100}
              max={260}
              disabled={disabled || !image}
              onChange={(v) => setDraftKey("imageZoom", v)}
              format={(v) => `${v}%`}
            />
            <Slider
              label="Opacity"
              value={state.overlayOpacity}
              min={0}
              max={100}
              disabled={disabled}
              onChange={(v) => setDraftKey("overlayOpacity", v)}
              format={(v) => `${v}%`}
            />
            <Slider
              label="Pan X"
              value={state.imageOffset.x}
              min={-IMAGE_PAN_LIMIT}
              max={IMAGE_PAN_LIMIT}
              disabled={disabled || !image}
              onChange={(v) =>
                setDraftKey("imageOffset", { ...state.imageOffset, x: v })
              }
              format={(v) => `${v}`}
            />
            <Slider
              label="Pan Y"
              value={state.imageOffset.y}
              min={-IMAGE_PAN_LIMIT}
              max={IMAGE_PAN_LIMIT}
              disabled={disabled || !image}
              onChange={(v) =>
                setDraftKey("imageOffset", { ...state.imageOffset, y: v })
              }
              format={(v) => `${v}`}
            />
            <Slider
              label="Headline size"
              value={state.fontSize}
              min={0}
              max={90}
              disabled={disabled}
              onChange={(v) => setDraftKey("fontSize", v)}
              format={(v) => (v === 0 ? "Auto" : `${v}px`)}
            />
          </div>

          <button
            type="button"
            onClick={resetImageAndFilters}
            disabled={disabled}
            className="btn-ghost mt-3 flex w-full items-center justify-center gap-1.5 py-2 text-xs disabled:opacity-40"
          >
            <RotateCcw size={13} /> Reset image &amp; filters
          </button>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="text-[10px] font-bold tabular-nums text-faint">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)] disabled:opacity-40"
      />
    </div>
  );
}
