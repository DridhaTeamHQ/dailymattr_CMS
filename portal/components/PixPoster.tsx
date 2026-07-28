"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  Bookmark,
  Image as ImageIcon,
  MessageSquare,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { markPixHeadline } from "@/lib/pixHighlight";
import {
  PIX_ACTION_FILL,
  PIX_ACTION_RING,
  PIX_BRAND,
  PIX_BRAND_LIGHT,
  PIX_CHROME,
  PIX_GEOMETRY,
  PIX_LINES,
  PIX_PANEL,
  PIX_PILL_FILL,
  PIX_SLIDE2_VEIL,
  PIX_TYPE,
  filledPixPoints,
  type PixPlacement,
} from "@/lib/pix";
import { timeAgo } from "@/lib/store";
import type { ContentItem } from "@/lib/types";

/**
 * Pix poster, drawn to the format spec.
 *
 * Everything inside is laid out at the spec's own point values against a 375 pt
 * screen, then scaled to whatever width the container gives it. That way a
 * thumbnail in the QA grid and a full preview are the same artwork at different
 * magnifications, and every ratio in the spec survives.
 */

/** Placeholder engagement figures — the poster is a preview, not live data. */
const STATS = { likes: "1.2k", dislikes: "200", comments: 200 };

const titleCase = (s: string) =>
  s.replace(/-/g, " ").replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());

/**
 * Scales the fixed-size artwork to fill the available width.
 *
 * Measured synchronously before paint, then kept in step with a ResizeObserver.
 * The layout-effect pass matters: it means the poster is never blank waiting on
 * an observer callback, which a background tab may not deliver for a while.
 */
function useFit(designWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = (w: number) => {
      if (w > 0) setScale((s) => (s === w / designWidth ? s : w / designWidth));
    };

    measure(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [designWidth]);

  return { ref, scale };
}

function clamp(lines: number) {
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical" as const,
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}

/** Topic and timestamp pills — top 14, inset 14, pad 11 × 5. */
function Pills({ item }: { item: ContentItem }) {
  const { pillTop, pillInset, pillPadX, pillPadY } = PIX_CHROME;
  const base = {
    position: "absolute" as const,
    top: pillTop,
    padding: `${pillPadY}px ${pillPadX}px`,
    borderRadius: 999,
    background: PIX_PILL_FILL,
    color: "#FFFFFF",
    fontSize: PIX_TYPE.pill.size,
    lineHeight: 1.25,
    whiteSpace: "nowrap" as const,
    backdropFilter: "blur(6px)",
  };
  return (
    <>
      <span
        style={{
          ...base,
          left: pillInset,
          fontWeight: 600,
          letterSpacing: 0.3,
          fontFamily: "var(--font-inter)",
        }}
      >
        {titleCase(item.categorySlug ?? "India")}
      </span>
      <span
        style={{
          ...base,
          right: pillInset,
          fontWeight: 500,
          fontFamily: "var(--font-inter)",
        }}
      >
        {timeAgo(item.publishedAt ?? item.updatedAt)}
      </span>
    </>
  );
}

/**
 * Headline, then the 34 × 3 accent bar.
 *
 * Jakarta 800 with marked words in brandLight, per the format spec. The
 * builder canvas is set to match exactly, so the two previews on the editor
 * screen show one headline treatment rather than two.
 */
function Headline({ text }: { text: string }) {
  const { size, line, tracking, weight } = PIX_TYPE.headline;
  const bar = PIX_CHROME.accentBar;
  return (
    <>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-jakarta)",
          fontWeight: weight,
          fontSize: size,
          lineHeight: `${line}px`,
          letterSpacing: tracking,
          color: "#FFFFFF",
          ...clamp(PIX_LINES.headline),
        }}
      >
        {markPixHeadline(text).map((seg, i) => (
          <span key={i} style={seg.marked ? { color: PIX_BRAND_LIGHT } : undefined}>
            {seg.text}
          </span>
        ))}
      </p>
      <div
        style={{
          marginTop: bar.gap,
          width: bar.w,
          height: bar.h,
          borderRadius: bar.radius,
          background: PIX_BRAND,
        }}
      />
    </>
  );
}

/** Slide two — exactly three points over the blurred, veiled photograph. */
function Points({ points }: { points: string[] }) {
  const p = PIX_CHROME.points;
  return (
    <div
      style={{
        position: "absolute",
        left: p.inset,
        right: p.inset,
        top: p.edge,
        bottom: p.edge,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: p.gap,
      }}
    >
      {points.map((point, i) => (
        <div key={i} style={{ display: "flex", gap: 10 }}>
          <span
            style={{
              marginTop: p.markerOffset,
              width: p.marker,
              height: p.marker,
              borderRadius: 4,
              background: PIX_BRAND,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-inter)",
              fontWeight: PIX_TYPE.point.weight,
              fontSize: PIX_TYPE.point.size,
              lineHeight: `${PIX_TYPE.point.line}px`,
              color: "rgba(255, 255, 255, 0.94)",
              ...clamp(PIX_LINES.point),
            }}
          >
            {point}
          </span>
        </div>
      ))}
    </div>
  );
}

/** like · dislike · comment · save · share */
function Actions() {
  const a = PIX_CHROME.action;
  const icons = [ThumbsUp, ThumbsDown, MessageSquare, Bookmark, Share2];
  return (
    <div style={{ display: "flex", gap: a.gap, justifyContent: "center" }}>
      {icons.map((Icon, i) => (
        <span
          key={i}
          style={{
            position: "relative",
            width: a.size,
            height: a.size,
            borderRadius: 999,
            background: PIX_ACTION_FILL,
            border: `1px solid ${PIX_ACTION_RING}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFFFFF",
            backdropFilter: "blur(6px)",
            boxSizing: "border-box",
          }}
        >
          <Icon size={a.icon} strokeWidth={a.stroke} />
          {/* Comment badge: top −3, right −4, caps at 99+ */}
          {i === 2 && (
            <span
              style={{
                position: "absolute",
                top: -3,
                right: -4,
                minWidth: PIX_CHROME.badge,
                height: PIX_CHROME.badge,
                padding: "0 4px",
                borderRadius: 999,
                background: PIX_BRAND,
                color: "#FFFFFF",
                fontFamily: "var(--font-inter)",
                fontWeight: 700,
                fontSize: PIX_TYPE.badge.size,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
              }}
            >
              {STATS.comments > 99 ? "99+" : STATS.comments}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function Dots({
  slide,
  onSlide,
}: {
  slide: number;
  onSlide: (s: number) => void;
}) {
  const d = PIX_CHROME.dot;
  return (
    <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
      {[0, 1].map((s) => (
        <button
          key={s}
          type="button"
          aria-label={s === 0 ? "Cover slide" : "Key points slide"}
          onClick={(e) => {
            e.stopPropagation();
            onSlide(s);
          }}
          style={{
            width: slide === s ? d.active : d.size,
            height: d.size,
            borderRadius: 999,
            border: 0,
            padding: 0,
            cursor: "pointer",
            background:
              slide === s ? "#FFFFFF" : "rgba(255, 255, 255, 0.4)",
            transition: "width 180ms ease",
          }}
        />
      ))}
    </div>
  );
}

function Publisher({ item, opacity }: { item: ContentItem; opacity: number }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-inter)",
        fontWeight: 600,
        fontSize: PIX_TYPE.publisher.size,
        color: `rgba(255, 255, 255, ${opacity})`,
        whiteSpace: "nowrap",
      }}
    >
      {/* Credit the origin when there is one — every Pix should carry it. */}
      DailyMattr
      {item.sourceLinks[0]?.title ? ` · ${item.sourceLinks[0].title}` : ""}
      {item.state ? ` · ${item.state}` : ""}
    </span>
  );
}

/**
 * Phone bezel around a poster. The page placement has radius 0 by spec, so the
 * bezel is what rounds it off — it has to clip, or the square corners escape.
 */
export function PixBezel({
  item,
  placement = "list",
  size = "md",
  interactive = true,
}: {
  item: ContentItem;
  placement?: PixPlacement;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
}) {
  const pad = { sm: 4, md: 5, lg: 7 }[size];
  const inner = placement === "list" ? PIX_GEOMETRY.list.radius : 22;
  return (
    <div
      className="bg-[#1e1e26]"
      style={{ padding: pad, borderRadius: inner + pad }}
    >
      <div style={{ borderRadius: inner, overflow: "hidden" }}>
        <PixPoster
          item={item}
          placement={placement}
          interactive={interactive}
        />
      </div>
    </div>
  );
}

export function PixPoster({
  item,
  placement = "list",
  interactive = true,
}: {
  item: ContentItem;
  placement?: PixPlacement;
  /** Set false for a static thumbnail — the slide dots stop responding. */
  interactive?: boolean;
}) {
  const g = PIX_GEOMETRY[placement];
  const { ref, scale } = useFit(g.w);
  const [slide, setSlide] = useState(0);

  const points = filledPixPoints(item);
  const photoH = Math.round(g.h * g.photo);
  const onPoints = slide === 1 && points.length > 0;
  const isPage = placement === "page";

  return (
    <div
      ref={ref}
      style={{ aspectRatio: `${g.w} / ${g.h}`, borderRadius: g.radius }}
      className="relative w-full overflow-hidden"
    >
      {scale !== null && (
        <div
          style={{
            width: g.w,
            height: g.h,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            background: PIX_PANEL,
            borderRadius: g.radius,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Photograph — sits on the card colour, so the panel starts where it
              ends. On slide two it goes full bleed and carries the whole card. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              // Full bleed on slide two. Switched rather than animated —
              // transitioning height forces layout on every frame, and the
              // veil fading in already covers the change.
              height: onPoints ? "100%" : photoH,
              overflow: "hidden",
            }}
          >
            {item.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.coverUrl}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transition: "filter 260ms ease, transform 260ms ease",
                  ...(onPoints
                    ? { filter: "blur(14px)", transform: "scale(1.08)" }
                    : null),
                }}
              />
            ) : (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "linear-gradient(180deg, #223046, #0C111D)",
                  color: "rgba(255,255,255,0.22)",
                }}
              >
                <ImageIcon size={34} />
              </span>
            )}
            {/* Six-stop scrim over the lower ~72%, so the photo dissolves into
                the panel. Slide two has no panel to dissolve into — the veil
                does that job there. */}
            {!onPoints && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(to bottom, rgba(12,17,29,0) 28%, rgba(12,17,29,0.10) 44%, rgba(12,17,29,0.28) 58%, rgba(12,17,29,0.52) 72%, rgba(12,17,29,0.80) 86%, rgba(12,17,29,1) 100%)",
                }}
              />
            )}
          </div>

          {/* Slide two: 78% veil plus the topic wash, full bleed. */}
          {onPoints && (
            <>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: PIX_SLIDE2_VEIL,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(160deg, ${PIX_BRAND}22, transparent 62%)`,
                }}
              />
            </>
          )}

          <Pills item={item} />

          {/* Copy column — bottom-anchored on the list card, photo + 24 on the page. */}
          {!onPoints && (
            <div
              style={{
                position: "absolute",
                left: g.copyInset,
                right: g.copyInset,
                ...(isPage
                  ? { top: photoH + PIX_GEOMETRY.page.headlineTop }
                  : { bottom: PIX_GEOMETRY.list.headlineBottom }),
              }}
            >
              <Headline text={item.title} />
              {/* List card carries the publisher line in flow, 12 under the bar. */}
              {!isPage && (
                <div style={{ marginTop: 12 }}>
                  <Publisher item={item} opacity={0.72} />
                </div>
              )}
            </div>
          )}

          {onPoints && <Points points={points} />}

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: g.actionsBottom,
            }}
          >
            <Actions />
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: g.dotsBottom,
            }}
          >
            <Dots
              slide={slide}
              onSlide={(s) => interactive && setSlide(s)}
            />
          </div>

          {isPage && (
            <div
              style={{
                position: "absolute",
                left: PIX_GEOMETRY.page.publisherInset,
                bottom: PIX_GEOMETRY.page.publisherBottom,
              }}
            >
              <Publisher item={item} opacity={0.92} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
