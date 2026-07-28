"use client";

/**
 * The DailyMattr card look: a crisp image up top that dissolves into a colour
 * wash taken from the image itself.
 *
 * The wash is a heavily blurred, scaled copy of the same image sitting behind
 * everything — so the colour always matches the photo without reading pixels
 * through a canvas (which would taint on cross-origin news images).
 */
export default function NewsVisual({
  src,
  imageHeight = "58%",
  blur = "blur-2xl",
  priority = false,
  children,
}: {
  src: string;
  /** How much of the frame the sharp image occupies before it fades out. */
  imageHeight?: string;
  blur?: string;
  /** Set on the one visual that is the focus of the screen — the phone
   *  preview — so it is not deferred behind a grid of cards. */
  priority?: boolean;
  children?: React.ReactNode;
}) {
  const loading = priority ? undefined : ("lazy" as const);
  return (
    <>
      {/* colour wash */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        loading={loading}
        decoding="async"
        className={`pointer-events-none absolute inset-0 h-full w-full scale-150 object-cover ${blur}`}
      />
      {/* deepen the wash so white type stays readable */}
      <div className="pointer-events-none absolute inset-0 bg-black/35" />

      {/* sharp image, masked so it melts into the wash */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading={loading}
        decoding="async"
        className="pointer-events-none absolute inset-x-0 top-0 w-full object-cover"
        style={{
          height: imageHeight,
          WebkitMaskImage:
            "linear-gradient(to bottom, #000 55%, rgba(0,0,0,0.65) 78%, transparent 100%)",
          maskImage:
            "linear-gradient(to bottom, #000 55%, rgba(0,0,0,0.65) 78%, transparent 100%)",
        }}
      />

      {/* legibility scrim: light at the top for the pills, heavy at the base */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/55" />

      {children}
    </>
  );
}
