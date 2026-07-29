/**
 * Skeleton loading placeholders for every portal page.
 *
 * Each variant mirrors the real page's layout — same grid columns, card shapes,
 * spacing, and nesting — so the transition from skeleton to live content is
 * seamless. All bones share the `.skeleton-bone` shimmer class defined in
 * globals.css.
 */

/* ── Bone ────────────────────────────────────────────────────────────
   A single shimmer rectangle. Pass Tailwind dimension / rounding classes. */
function Bone({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`skeleton-bone ${className}`} style={style} />;
}

/**
 * A repeatable stand-in for Math.random(), keyed on position.
 *
 * Bones were sized with Math.random() during render, which is two bugs at once:
 * the server renders one set of widths and the client another, so React reports
 * a hydration mismatch and repaints; and every re-render reshuffles them, so a
 * loading skeleton twitches while it waits.
 *
 * The point of the variation is only that bones should not look mechanically
 * identical, and a hash of the index gives that while staying the same on both
 * sides of hydration and across renders.
 */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x); // 0 … 1
}

/* ── Shared section header placeholder ─────────────────────────────── */
function HeaderBone({ hasButton = true }: { hasButton?: boolean }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <Bone className="mb-2 h-7 w-56" />
        <Bone className="h-4 w-80" />
      </div>
      {hasButton && <Bone className="h-10 w-32 rounded-full" />}
    </div>
  );
}

/* ── Pill-style tab bar skeleton ───────────────────────────────────── */
function TabBarBone({ count = 3 }: { count?: number }) {
  return (
    <div className="mb-5 flex w-fit items-center gap-1 rounded-full bg-card p-1 shadow-(--shadow-soft)">
      {Array.from({ length: count }).map((_, i) => (
        <Bone
          key={i}
          className={`h-9 rounded-full ${i === 0 ? "w-28" : i === 1 ? "w-24" : "w-20"}`}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DASHBOARD
   4 stat cards → chart+format area → activity list → featured articles
   ═══════════════════════════════════════════════════════════════════ */
export function DashboardSkeleton() {
  return (
    <div>
      <HeaderBone />

      {/* stat cards — grid-cols-2 xl:grid-cols-4 */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <Bone className="h-10 w-10 rounded-2xl" />
              <Bone className="h-4 w-4 rounded-full" />
            </div>
            <Bone className="mb-2 h-8 w-16" />
            <Bone className="mb-2 h-4 w-24" />
            <Bone className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>

      {/* chart + activity — xl:grid-cols-[1.5fr_1fr] */}
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        {/* chart card */}
        <div className="card space-y-6 p-6">
          <Bone className="h-5 w-40" />
          <Bone className="h-48 w-full" />
          <div className="border-t border-line pt-6">
            <Bone className="mb-3 h-5 w-36" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Bone className="h-4 w-12" />
                  <Bone className="h-4 flex-1" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* activity list */}
        <div className="card flex flex-col p-6">
          <div className="mb-4 flex items-center justify-between">
            <Bone className="h-5 w-32" />
            <Bone className="h-4 w-16" />
          </div>
          <div className="space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl p-2.5">
                <Bone className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Bone className="h-3.5 w-full" />
                  <Bone className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* featured in app section */}
      <div className="card mt-6 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Bone className="mb-1 h-5 w-36" />
            <Bone className="h-3.5 w-56" />
          </div>
          <Bone className="h-9 w-32 rounded-full" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4 rounded-2xl border border-line p-3">
              <Bone className="h-20 w-28 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <Bone className="h-5 w-16 rounded-full" />
                  <Bone className="h-5 w-14 rounded-full" />
                </div>
                <Bone className="h-3.5 w-full" />
                <Bone className="h-3 w-3/4" />
                <Bone className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CONTENT LIST — Pix / Qix / Trax
   Header → pill tabs → 5-col grid of 9:16 poster cards
   ═══════════════════════════════════════════════════════════════════ */
export function ContentListSkeleton() {
  return (
    <div className="pb-10">
      <HeaderBone />

      {/* pill tab bar (All · Awaiting QA · App feed) */}
      <TabBarBone count={3} />

      {/* 5-column poster card grid — same as grid-cols-2 sm:3 lg:4 xl:5 */}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="mx-auto flex w-full max-w-[210px] flex-col gap-2">
            {/* 9:16 poster frame */}
            <Bone className="w-full rounded-[26px]" style={{ aspectRatio: "9/16" }} />
            {/* action buttons row */}
            <div className="flex items-center gap-1.5">
              <Bone className="h-[26px] flex-1 rounded-full" />
              <Bone className="h-[26px] flex-1 rounded-full" />
            </div>
            {/* status pill */}
            <div className="flex justify-center">
              <Bone className="h-5 w-16 rounded-full" />
            </div>
            {/* author line */}
            <Bone className="mx-auto h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ARTICLES
   Header → pill tabs → search → 4-col article card grid
   ═══════════════════════════════════════════════════════════════════ */
export function ArticlesSkeleton() {
  return (
    <div>
      <HeaderBone />

      {/* pill tabs (NewsStudio · Written in Studio · App feed) */}
      <TabBarBone count={3} />

      {/* search bar */}
      <div className="relative mb-4 max-w-sm">
        <Bone className="h-10 w-full rounded-full" />
      </div>

      {/* article card grid — sm:2 xl:3 2xl:4 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            {/* image */}
            <Bone className="h-36 w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Bone className="h-3.5 w-4/5" />
              <Bone className="h-3 w-full" />
              <Bone className="h-3 w-2/3" />
              <div className="flex items-center justify-between pt-1">
                <Bone className="h-3 w-20" />
                <Bone className="h-3 w-16" />
              </div>
              <div className="flex gap-2 pt-1">
                <Bone className="h-5 w-16 rounded-full" />
                <Bone className="h-5 w-12 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   REVIEW QUEUE
   Header + pill → card rows with thumbnail + status + action buttons
   Approved section below
   ═══════════════════════════════════════════════════════════════════ */
export function ReviewSkeleton() {
  return (
    <div>
      {/* header with pill "X waiting" */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Bone className="mb-2 h-7 w-40" />
          <Bone className="h-4 w-72" />
        </div>
        <Bone className="h-6 w-20 rounded-full" />
      </div>

      {/* queue rows */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card flex flex-wrap items-center gap-4 p-4">
            {/* thumbnail (pix frame or cover) */}
            <Bone className="h-[120px] w-[120px] shrink-0 rounded-[26px]" style={{ aspectRatio: "9/16" }} />
            {/* content */}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Bone className="h-5 w-10 rounded-full" />
                <Bone className="h-5 w-16 rounded-full" />
              </div>
              <Bone className="h-4 w-3/5" />
              <div className="flex items-center gap-2">
                <Bone className="h-3 w-20" />
                <Bone className="h-3 w-24" />
              </div>
            </div>
            {/* action buttons */}
            <div className="flex items-center gap-2">
              <Bone className="h-9 w-24 rounded-full" />
              <Bone className="h-9 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>

      {/* approved section heading */}
      <Bone className="mt-8 mb-3 h-5 w-56" />

      {/* approved rows */}
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card flex flex-wrap items-center gap-4 p-4">
            <Bone className="h-[120px] w-[120px] shrink-0 rounded-[26px]" style={{ aspectRatio: "9/16" }} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Bone className="h-5 w-10 rounded-full" />
                <Bone className="h-5 w-16 rounded-full" />
              </div>
              <Bone className="h-4 w-3/5" />
              <Bone className="h-3 w-28" />
            </div>
            <Bone className="h-9 w-32 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ACTIVITY LOG
   Back link → header + dropdown → day-grouped card list
   ═══════════════════════════════════════════════════════════════════ */
export function ActivitySkeleton() {
  return (
    <div className="max-w-3xl">
      {/* back button */}
      <Bone className="mb-5 h-9 w-40 rounded-full" />

      {/* header with filter dropdown */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Bone className="mb-2 h-7 w-28" />
          <Bone className="h-4 w-72" />
        </div>
        <Bone className="h-10 w-36 rounded-2xl" />
      </div>

      {/* day groups */}
      {[6, 4].map((count, gi) => (
        <section key={gi} className="mb-6">
          {/* day label */}
          <Bone className="mb-2 h-3 w-16" />
          {/* card with divider rows */}
          <div className="card divide-y divide-line overflow-hidden">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <Bone className="h-[34px] w-[34px] shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Bone className="h-3.5 w-full" />
                  <div className="flex items-center gap-2">
                    <Bone className="h-5 w-14 rounded-full" />
                    <Bone className="h-3 w-16" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   USERS / TEAM
   Header → 4 stat totals → pill tabs → performance cards grid
   ═══════════════════════════════════════════════════════════════════ */
export function UsersSkeleton() {
  return (
    <div>
      <HeaderBone />

      {/* newsroom totals — grid-cols-2 lg:grid-cols-4 */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card px-5 py-4">
            <Bone className="mb-1.5 h-7 w-14" />
            <Bone className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* pill tab bar (Performance · Roles & access) */}
      <div className="mb-5 flex w-fit items-center gap-1 rounded-full bg-card p-1 shadow-(--shadow-soft)">
        <Bone className="h-9 w-32 rounded-full" />
        <Bone className="h-9 w-32 rounded-full" />
      </div>

      {/* team chart placeholder */}
      <div className="card mb-4 p-6">
        <Bone className="mb-3 h-5 w-40" />
        <Bone className="h-40 w-full" />
      </div>

      {/* performance cards — md:2 2xl:3 */}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-5">
            {/* avatar + name */}
            <div className="mb-4 flex items-center gap-3">
              <Bone className="h-10 w-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Bone className="h-4 w-28" />
                <Bone className="h-3 w-20" />
              </div>
            </div>
            {/* bar chart area */}
            <div className="flex items-end gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Bone
                  key={j}
                  className="flex-1"
                  style={{ height: `${20 + jitter(j + 1) * 40}px` }}
                />
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Bone className="h-3 w-12" />
              <Bone className="h-3 w-12" />
              <Bone className="h-3 w-12" />
              <Bone className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SETTINGS / CATEGORIES
   max-w-2xl → header → card with input + category pills → info card
   ═══════════════════════════════════════════════════════════════════ */
export function SettingsSkeleton() {
  return (
    <div className="max-w-2xl">
      <HeaderBone hasButton={false} />

      {/* categories card */}
      <div className="card p-6">
        <Bone className="mb-4 h-5 w-24" />

        {/* add input row */}
        <div className="mb-5 flex gap-2">
          <Bone className="h-10 flex-1 rounded-2xl" />
          <Bone className="h-10 w-20 rounded-full" />
        </div>

        {/* category pills wrapped */}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Bone
              key={i}
              className="h-9 rounded-full"
              style={{ width: `${60 + jitter(i + 7) * 50}px` }}
            />
          ))}
        </div>
      </div>

      {/* info card */}
      <div className="card mt-6 p-6">
        <Bone className="mb-2 h-5 w-44" />
        <div className="space-y-2">
          <Bone className="h-3.5 w-full" />
          <Bone className="h-3.5 w-full" />
          <Bone className="h-3.5 w-3/4" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Bone key={i} className="h-5 w-24 rounded-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
