"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Activity,
  Bell,
  BellRing,
  Check,
  ChevronRight,
  Clock,
  Gauge,
  Headphones,
  Layers,
  Minus,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";
import {
  AxisBarChart,
  BarList,
  Chip,
  DataTable,
  GhostButton,
  GroupedAxisChart,
  Heatmap,
  KpiCard,
  Panel,
  PillTabs,
  Segmented,
  Select,
  SplitBar,
  Stat,
} from "@/components/Charts";
import { SectionHeader } from "@/components/ui";
import { fmt } from "@/components/StatsStrip";
import { can, useAuth } from "@/lib/auth";
import {
  BY_CITY,
  BY_STATE,
  CATEGORIES,
  CATEGORY_ENGAGEMENT,
  CONTENT_TYPES,
  CONTENT_TYPE_LABEL,
  COVERAGE,
  DAU_ROWS,
  DAY_LABELS,
  EDITOR_ROWS,
  EDITORIAL,
  HEATMAP,
  INTERACTION_ROWS,
  KPI,
  LATEST_DAY,
  LATEST_WEEK,
  NOTIFICATIONS,
  NOTIFICATION_BY_SECTION,
  PRODUCTS,
  PRODUCT_ENGAGEMENT,
  PRODUCT_LABEL,
  PUBLISHING_ROWS,
  PUSH_SUMMARY,
  RATING,
  TIMEZONE,
  TIME_SECTIONS,
  TODAY,
  TOP_ITEMS,
  TRAX_ROWS,
  TRAX_TIME_ROWS,
  WINDOW_DAYS,
  type DauRow,
  type EditorRow,
  type InteractionRow,
  type ItemEngagement,
  type NotificationRow,
  type NotificationSectionRow,
  type ContentType,
  type Product,
  type ProductEngagement,
  type PublishingRow,
  type TimeSection,
  type TraxRow,
} from "@/lib/audienceDemo";

/* The audience side of analytics.
 *
 * The other analytics screen ranks content: which story landed. This one is
 * about the readers — how many, when, what they do with a card, whether a push
 * was worth sending, and who on the desk produced what.
 *
 * Every figure is invented. The desk asked to see the reporting laid out
 * before the app emits most of these events, so this is a layout under
 * discussion rather than a measurement. The banner says so at the top, each
 * section repeats what it cannot really know, and the last panel lists which
 * panels could be wired to real data today.
 */

type Tab = "dau" | "engagement" | "publishing";

const TABS: { key: Tab; label: string }[] = [
  { key: "dau", label: "DAU & time spent" },
  { key: "engagement", label: "Engagement" },
  { key: "publishing", label: "Publishing by category" },
];

/** "08-26 6am–9am". The year is dropped: every label carries it, so it is the
 *  one part that never distinguishes two ticks, and it is what tipped these
 *  into overlapping. */
const stamp = (day: string, section: string) => `${day.slice(5)} ${section}`;

/**
 * How the time series is cut.
 *
 * "Daily" is the latest full day split across its reading windows, not a
 * fortnight of one-bar-per-day: the question asked of a single day is when
 * inside it, and the run of days is what "Weekly" opens into.
 */
type Granularity = "daily" | "weekly" | "sections";

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "sections", label: "Time sections" },
];

/** Where each option starts. Daily opens straight into the latest day. */
const GRAIN_DRILL: Record<Granularity, Drill> = {
  daily: { week: LATEST_WEEK, day: LATEST_DAY },
  weekly: {},
  sections: {},
};

/** Every time series carries all three keys so a regroup needs no new query. */
interface TimeRow {
  day: string;
  week: string;
  section: TimeSection;
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

function collapse(map: Map<string, number[]>, how: "sum" | "mean") {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, xs]) => ({
      key,
      value: how === "mean" ? Math.round(mean(xs) * 100) / 100 : xs.reduce((a, b) => a + b, 0),
    }));
}

/**
 * One bar.
 *
 * `label` is what the axis says, which is shortened for the tick; `key` is the
 * ISO day or week behind it, kept so that clicking the bar can open it.
 */
interface Point {
  key: string;
  label: string;
  value: number;
}

/**
 * Regroups a day × window series to the chosen resolution.
 *
 * The two aggregations are separate on purpose. Windows within a day and days
 * within a week do not combine the same way: cards swiped add up in both, but
 * "active users" summed across a week is not weekly actives — it counts the
 * same returning reader every day — so those pass `week: "mean"` and the chart
 * reports an average day instead of a wrong total. Rates average too; only
 * counted events add.
 */
function bucket<T extends TimeRow>(
  rows: T[],
  g: Granularity,
  value: (r: T) => number,
  how: { day?: "sum" | "mean"; week?: "sum" | "mean" } = {}
): Point[] {
  const dayHow = how.day ?? "sum";
  const weekHow = how.week ?? "sum";

  if (g === "sections") {
    /* Inside a single opened day the date is on every tick and in the
       breadcrumb above, so the window alone is the label. */
    const oneDay = rows.every((r) => r.day === rows[0]?.day);
    return rows.map((r) => ({
      key: `${r.day} ${r.section}`,
      label: oneDay ? r.section : stamp(r.day, r.section),
      value: value(r),
    }));
  }

  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const list = byDay.get(r.day) ?? [];
    list.push(value(r));
    byDay.set(r.day, list);
  }

  if (g === "daily") {
    return collapse(byDay, dayHow).map((p) => ({ ...p, label: p.key.slice(5) }));
  }

  // Roll the daily figures up, so the week is built from whole days.
  const dayValue = new Map(collapse(byDay, dayHow).map((p) => [p.key, p.value]));
  const weekOfDay = new Map(rows.map((r) => [r.day, r.week]));
  const byWeek = new Map<string, number[]>();
  for (const [day, v] of dayValue) {
    const w = weekOfDay.get(day)!;
    const list = byWeek.get(w) ?? [];
    list.push(v);
    byWeek.set(w, list);
  }
  return collapse(byWeek, weekHow).map((p) => ({
    ...p,
    label: `w/c ${p.key.slice(5)}`,
  }));
}

/* ───────────────────────── drilling into a bar ─────────────────────────
 *
 * A week bar answers "how was the week" and immediately raises "which day",
 * so clicking one opens it: the week becomes seven days, and a day becomes
 * its seven reading windows. It is the same series regrouped and narrowed,
 * not another query — every row already carries day, week and window.
 */

/** The bar that has been opened: a week, then a day inside it. */
interface Drill {
  week?: string;
  day?: string;
}

/** Which level a time chart is drawn at, and so what clicking a bar opens. */
type Level = "weekly" | "daily";

/**
 * The resolution actually drawn. Opening a week is a request to see its days,
 * so the drill outranks the granularity control until it is cleared.
 */
const drilledGrain = (g: Granularity, d: Drill): Granularity =>
  d.day ? "sections" : d.week ? "daily" : g;

/** Narrows a day × window series to the opened week or day. */
function scope<T extends { day: string; week: string }>(rows: T[], d: Drill) {
  if (d.day) return rows.filter((r) => r.day === d.day);
  if (d.week) return rows.filter((r) => r.week === d.week);
  return rows;
}

/** What every tab needs to draw itself: resolution, scope, and the way in. */
interface ViewState {
  grain: Granularity;
  drill: Drill;
  open: (level: Level, key: string) => void;
}

/** A chart at the finest resolution has nothing left to open. */
const levelOf = (g: Granularity): Level | null => (g === "sections" ? null : g);

/** Wires a bar click back to the day or week that produced the bar. */
const selector = (view: ViewState, points: Point[], level: Level | null) =>
  level ? (i: number) => view.open(level, points[i].key) : undefined;

/** What the bars actually report, said on the chart rather than in a doc. */
function grainNote(view: ViewState) {
  if (view.drill.day)
    return `One bar per reading window, inside ${view.drill.day}. Counted events are totalled.`;
  if (view.grain === "sections")
    return "One bar per reading window, for every day in range.";
  if (view.grain === "daily")
    return "One bar per day, summed across the reading windows.";
  return "One bar per week. Counted events are totalled; per-user figures and rates are averaged over the days in the week, because summing readers across days counts the same person more than once.";
}

const mmss = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
};

/**
 * The resolution controls above a time chart, the window filter beside them,
 * and the bar that has been opened inside them.
 *
 * A hook because two sections of this page carry their own set. Sharing one
 * would mean the View switch in the tabbed card silently moving the
 * notification chart three screens further down, which is the sort of thing
 * nobody notices until the number they screenshot is not the number they
 * meant.
 */
function useTimeView() {
  /* Daily by default: fourteen days times seven windows is ninety-eight bars,
     which answers "when in the day" at the cost of "how is the week going",
     and the latter is what people open the page for. */
  const [grain, setGrain] = useState<Granularity>("daily");
  /** Set by the View control and by clicking a bar; walked back from the breadcrumb. */
  const [drill, setDrill] = useState<Drill>(GRAIN_DRILL.daily);
  /** "all" keeps every window; picking one narrows the charts below it. */
  const [section, setSection] = useState<TimeSection | "all">("all");

  /* One object rather than four props, because it goes to every tab and the
     tabs only ever read it together. */
  const view = useMemo<ViewState>(
    () => ({
      grain: drilledGrain(grain, drill),
      drill,
      open: (level, key) =>
        setDrill((d) => (level === "weekly" ? { week: key } : { week: d.week, day: key })),
    }),
    [grain, drill]
  );

  /** Picking a resolution outright resets where you are inside it. */
  const chooseGrain = (g: Granularity) => {
    setGrain(g);
    setDrill(GRAIN_DRILL[g]);
  };

  /* Climbing out of the day is a request for the run of days above it, and
     "Daily" no longer means a fortnight of them, so the control steps up with
     the crumb rather than contradicting it. */
  const chooseDrill = (d: Drill) => {
    if (!d.week && !d.day && grain === "daily") setGrain("weekly");
    setDrill(d);
  };

  return { grain, chooseGrain, drill, chooseDrill, section, setSection, view };
}

export default function AudiencePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("dau");
  /** The tabbed card's own resolution, window filter and opened bar. */
  const main = useTimeView();
  /** Notifications carry theirs, so the two sections cannot move each other. */
  const push = useTimeView();
  const [dauMetric, setDauMetric] = useState<
    "registeredDau" | "sessions" | "cardsSwiped" | "rightSwipes" | "secondsPerActive"
  >("registeredDau");
  const [interactionMetric, setInteractionMetric] = useState<
    "views" | "likes" | "comments" | "shares" | "saves" | "aiQuestions"
  >("likes");
  /** Publishing splits by product as well as by time. */
  const [contentType, setContentType] = useState<ContentType | "all">("all");
  /** Bumping this re-mounts the section, which is what "Refresh" means here. */
  const [nonce, setNonce] = useState(0);

  const section = main.section;

  /* Inlined per list rather than shared through a helper: a function defined
     in the component body is a new reference every render, so a memo that
     closed over one would either lie about its dependencies or never hit. */
  const dauRows = useMemo(
    () => (section === "all" ? DAU_ROWS : DAU_ROWS.filter((r) => r.section === section)),
    [section]
  );
  const interactionRows = useMemo(
    () =>
      section === "all"
        ? INTERACTION_ROWS
        : INTERACTION_ROWS.filter((r) => r.section === section),
    [section]
  );
  /** Notifications read their own window filter, not the tabbed card's. */
  const notificationSectionRows = useMemo(
    () =>
      push.section === "all"
        ? NOTIFICATION_BY_SECTION
        : NOTIFICATION_BY_SECTION.filter((r) => r.section === push.section),
    [push.section]
  );

  if (!user || !can.seeStats(user.role)) {
    return (
      <div className="card mt-6 p-6 text-sm text-muted">
        Audience figures are visible to chief editors and super admins only.
      </div>
    );
  }

  return (
    <>
      <SectionHeader
        title="Audience"
        sub="Reach, session quality, editorial contribution, notification performance and audio adoption, in one workspace."
      >
        <Link
          href="/analytics"
          className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs"
        >
          <ArrowLeft size={13} /> Content
        </Link>
      </SectionHeader>

      {/* Said once, at the top, where nobody scrolls past it. A dashboard of
          invented numbers that looks measured is the thing to avoid. */}
      <div className="card mb-5 flex items-start gap-3 border-l-4 !border-l-amber p-4">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber" />
        <p className="text-sm leading-relaxed">
          <span className="font-bold text-amber">Sample data. </span>
          Nothing on this page is measured. Most of these events are not sent by
          the app yet — this is the reporting laid out for sign-off before the
          tracking is built. What is real is listed at the bottom.
        </p>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="card mb-5 overflow-hidden p-0">
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_360px]">
          <div>
            <div className="mb-4 flex flex-wrap gap-2">
              <Chip tone="accent">Analytics</Chip>
              <Chip>Audience Intelligence Desk</Chip>
              <Chip>Timezone: {TIMEZONE}</Chip>
            </div>
            <h2 className="text-[26px] leading-tight font-extrabold sm:text-[30px]">
              Analytics framed like an executive
              <br className="hidden sm:block" /> newsroom control surface.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
              Track audience reach, session quality, editorial contribution,
              notification performance and audio adoption from one workspace
              designed for quick decisions.
            </p>
            {/* Counts both window filters, since the two sections carry one
                each — a chip reading "0" while a chart below is narrowed would
                be worse than no chip. */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip>
                Notification window:{" "}
                {push.section === "all" ? "Overall" : push.section}
              </Chip>
              <Chip>Audio scope: Overall</Chip>
              <Chip>
                Active filters:{" "}
                {(section === "all" ? 0 : 1) + (push.section === "all" ? 0 : 1)}
              </Chip>
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-line p-4">
                <div className="text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
                  Audio today
                </div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums">
                  {TODAY.audioRate}%
                </div>
                <p className="mt-1 text-[11px] leading-snug text-faint">
                  Adoption for today&apos;s audio-enabled sessions.
                </p>
              </div>
              <div className="rounded-2xl border border-line p-4">
                <div className="text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
                  Avg session
                </div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums">
                  {mmss(TODAY.avgSessionSec)}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-faint">
                  Time users stay active once a session starts.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-line p-4">
              <div className="min-w-0">
                <div className="text-[13px] font-bold">
                  Analytics workspace is current
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-faint">
                  Using the default overall reporting window for audience and
                  content performance.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNonce((n) => n + 1)}
                className="btn-accent ml-auto flex shrink-0 items-center gap-1.5 px-4 py-2 text-xs"
              >
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI row ───────────────────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Total users"
          value={KPI.totalUsers}
          icon={Users}
          tone="accent"
          hint="Audience footprint across the app."
        />
        <KpiCard
          label="Weekly active users"
          value={KPI.wau}
          icon={Activity}
          tone="violet"
          hint="Users returning inside the weekly window."
        />
        <KpiCard
          label="Total sessions"
          value={KPI.totalSessions}
          icon={Clock}
          tone="amber"
          hint="Overall session volume recorded."
        />
        <KpiCard
          label="Avg session duration"
          value={mmss(KPI.avgSessionSec)}
          icon={Gauge}
          tone="rose"
          hint="Average time users stay engaged per session."
        />
      </div>

      {/* ── Tabbed day × window analytics ─────────────────────────────── */}
      <div className="card mb-6 p-5" key={nonce}>
        <h2 className="text-sm font-bold">Daily and time-section analytics</h2>
        <p className="mt-1 mb-4 text-[12px] text-faint">
          {tab === "publishing"
            ? "Shows overall publishing history."
            : "Uses the performance window below; defaults to the last " +
              WINDOW_DAYS +
              " days."}{" "}
          Timezone: {TIMEZONE}.
        </p>

        <PillTabs tabs={TABS} value={tab} onChange={setTab} />

        <div className="mt-4 mb-3 flex flex-wrap items-center gap-3">
          {/* One resolution control for every tab in this card. Notifications
              have their own, down in their own section. */}
          <Segmented
            label="View"
            options={GRANULARITIES}
            value={main.grain}
            onChange={main.chooseGrain}
          />

          <Select
            label="Time section"
            value={section}
            onChange={main.setSection}
            options={[
              { key: "all" as const, label: "All sections" },
              ...TIME_SECTIONS.map((s) => ({ key: s, label: s })),
            ]}
          />

          {tab === "publishing" && (
            <Select
              label="Content type"
              value={contentType}
              onChange={setContentType}
              options={[
                { key: "all" as const, label: "All types" },
                ...CONTENT_TYPES.map((t) => ({ key: t, label: CONTENT_TYPE_LABEL[t] })),
              ]}
            />
          )}

          {tab === "dau" && (
            <Select
              label="Metric"
              value={dauMetric}
              onChange={setDauMetric}
              options={[
                { key: "registeredDau" as const, label: "Registered DAU" },
                { key: "sessions" as const, label: "Active sessions" },
                { key: "cardsSwiped" as const, label: "Cards swiped" },
                { key: "rightSwipes" as const, label: "Right swipes" },
                { key: "secondsPerActive" as const, label: "Seconds / active user" },
              ]}
            />
          )}

          {tab === "engagement" && (
            <Select
              label="Metric"
              value={interactionMetric}
              onChange={setInteractionMetric}
              options={[
                { key: "likes" as const, label: "Likes" },
                { key: "views" as const, label: "Views" },
                { key: "comments" as const, label: "Comments" },
                { key: "shares" as const, label: "Shares" },
                { key: "saves" as const, label: "Saves" },
                { key: "aiQuestions" as const, label: "AI questions" },
              ]}
            />
          )}

          <GhostButton onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={13} /> Refresh section
          </GhostButton>
        </div>

        <Breadcrumb drill={main.drill} onDrill={main.chooseDrill} />

        <p className="mb-4 text-[11px] text-faint">
          {grainNote(main.view)}
          {levelOf(main.view.grain) && " Click a bar to open it."}
        </p>

        {tab === "dau" && <DauTab rows={dauRows} metric={dauMetric} view={main.view} />}
        {tab === "engagement" && (
          <EngagementTab
            rows={interactionRows}
            metric={interactionMetric}
            view={main.view}
            section={section}
          />
        )}
        {tab === "publishing" && (
          <PublishingTab view={main.view} contentType={contentType} section={section} />
        )}
      </div>

      {/* ── Audience engagement ───────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
            Audience engagement
          </div>
          <h2 className="mt-1 text-xl font-extrabold">Today at a glance</h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Chip>Timezone: {TIMEZONE}</Chip>
          <GhostButton onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={13} /> Refresh
          </GhostButton>
        </div>
      </div>
      <p className="mb-4 text-[12px] text-faint">
        Behavioural analytics, editorial impact, notifications and audio
        listening in one reporting flow. Today is partial by definition — it is
        shown apart from the full days above rather than beside them.
      </p>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Active users" value={TODAY.activeUsers} icon={Users} tone="mint" />
        <Stat
          label="Total sessions (today)"
          value={TODAY.sessions}
          icon={Activity}
          tone="violet"
        />
        <Stat
          label="Audio adoption (today)"
          value={`${TODAY.audioRate}%`}
          icon={Headphones}
          tone="rose"
        />
        <Stat label="Latest DAU" value={TODAY.latestDau} icon={Layers} tone="amber" />
        <Stat
          label="Avg session (today)"
          value={mmss(TODAY.avgSessionSec)}
          hint={TODAY.date}
          icon={Gauge}
          tone="mint"
        />
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="When readers are here"
            note="Day of week against window, shaded by active devices. Read from the same rows as the DAU table above, so the two cannot disagree."
          >
            <Heatmap rows={HEATMAP} rowLabels={DAY_LABELS} colLabels={TIME_SECTIONS} />
          </Panel>
        </div>
        <Panel
          title="Rating spread"
          note="The average hides the shape. One-star reviews are the ones with text worth reading."
        >
          <BarList
            rows={RATING.histogram.map((n, i) => ({ name: `${5 - i} star`, value: n }))}
            tone="bg-mint"
            format={(n) =>
              `${Math.round((n / RATING.histogram.reduce((a, b) => a + b, 0)) * 100)}%`
            }
          />
          <p className="mt-3 text-[11px] text-faint">
            {RATING.score.toFixed(1)} average across {fmt(RATING.count)} ratings.
          </p>
        </Panel>
      </div>

      {/* Permission used to sit in this row. It moved down to the notification
          section, where the question it answers is being asked. */}
      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <Panel title="By state" note="Where readers open the app.">
          <BarList rows={BY_STATE.map((r) => ({ name: r.name, value: r.users }))} />
        </Panel>
        <Panel title="By city" note="Inferred, so treat the tail as noisy.">
          <BarList
            rows={BY_CITY.map((r) => ({ name: r.name, value: r.users }))}
            tone="bg-violet"
          />
        </Panel>
      </div>

      {/* ── Notifications ─────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
            Notifications
          </div>
          <h2 className="mt-1 text-xl font-extrabold">What was sent, and who opened it</h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Chip>Timezone: {TIMEZONE}</Chip>
          <GhostButton onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={13} /> Refresh
          </GhostButton>
        </div>
      </div>
      <p className="mb-4 text-[12px] text-faint">
        A push is the widest thing the desk does and the easiest to overuse, so
        it gets its own section rather than a tab beside the reading figures.
        Article and buzz notifications with delivery records only — custom
        pushes without recipient records are excluded, because a send with no
        denominator has no open rate.
      </p>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sent" value={PUSH_SUMMARY.sent} icon={Send} tone="accent" />
        <Stat label="Opened" value={PUSH_SUMMARY.opened} icon={BellRing} tone="mint" />
        <Stat
          label="Open rate"
          value={`${PUSH_SUMMARY.openRate}%`}
          hint="Of FCM-accepted recipients"
          icon={Gauge}
          tone="violet"
        />
        <Stat
          label="Broadcasts"
          value={NOTIFICATIONS.length}
          hint={`Last ${WINDOW_DAYS} days`}
          icon={Bell}
          tone="amber"
        />
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="Open rate by send time"
            note="Counted against the window a push went out in, not the one it was read in. Sent counts FCM-accepted recipients; the rate uses that same cohort and includes later opens."
          >
            <NotificationsSection rows={notificationSectionRows} push={push} />
          </Panel>
        </div>
        <Panel
          title="Notification permission"
          note="Undecided readers have never been asked, or dismissed the prompt."
        >
          <SplitBar
            parts={[
              { name: "On", value: PUSH_SUMMARY.optIn, tone: "bg-mint" },
              { name: "Off", value: PUSH_SUMMARY.denied, tone: "bg-rose" },
              { name: "Undecided", value: PUSH_SUMMARY.undecided, tone: "bg-faint" },
            ]}
          />
          <p className="mt-4 text-[11px] leading-snug text-faint">
            Opt-in rate unavailable: notification permission is not recorded, and
            holding an FCM token is not consent.
          </p>
        </Panel>
      </div>

      <div className="mb-6">
        <Panel
          title="Recent broadcasts"
          note="One row per send, newest first. The spread between a tight topical push and a broad one is the reason this is a list rather than an average."
        >
          <DataTable<NotificationRow>
            rows={scope(NOTIFICATIONS, push.drill)}
            rowKey={(r) => String(r.id)}
            maxHeight={420}
            /* A day with no send is the common case, not a failure — the desk
               does not broadcast every day, and it should not read as one. */
            empty="No push went out in this range."
            columns={[
              {
                key: "title",
                label: "Title",
                render: (r) => <span className="line-clamp-2">{r.title}</span>,
              },
              { key: "type", label: "Notification type", render: (r) => r.type },
              { key: "id", label: "Notification id", numeric: true, render: (r) => r.id },
              {
                key: "accepted",
                label: "FCM accepted",
                numeric: true,
                render: (r) => fmt(r.fcmAccepted),
              },
              { key: "opened", label: "Opened", numeric: true, render: (r) => fmt(r.opened) },
              {
                key: "rate",
                label: "Open rate (%)",
                numeric: true,
                render: (r) => r.openRate.toFixed(2),
              },
            ]}
          />
          <p className="mt-3 text-[12px] text-rose">
            Unavailable: the app never reports that a push was opened, so every
            open on this section is modelled. FCM accepted is the one column
            that could be real today.
          </p>
        </Panel>
      </div>

      {/* ── Editorial performance ─────────────────────────────────────── */}
      <div className="mb-2">
        <div className="text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
          Editorial performance
        </div>
        <h2 className="mt-1 text-xl font-extrabold">Who produced what</h2>
      </div>
      <p className="mb-4 text-[12px] text-faint">
        QA and chief editor output across articles, videos, audio, magazines and
        buzz.
      </p>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Published content"
          value={EDITORIAL.publishedContent}
          icon={Layers}
          tone="accent"
        />
        <Stat
          label="Content engagement"
          value={EDITORIAL.contentEngagement}
          icon={Activity}
          tone="mint"
        />
        <Stat
          label="Active QA reviewers"
          value={EDITORIAL.activeQa}
          icon={Users}
          tone="amber"
        />
        <Stat
          label="Active chief editors"
          value={EDITORIAL.activeChiefEditors}
          icon={Users}
          tone="violet"
        />
      </div>

      <div className="mb-6">
        <Panel
          title="QA performance"
          note="Publish throughput and the engagement those items drew. Ranked by volume — which is output, not quality, and the average per item beside it is the one that hints at the difference."
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {[
              ["Admins", fmt(EDITOR_ROWS.length)],
              ["Published", fmt(EDITORIAL.publishedContent)],
              ["Engagement", fmt(EDITORIAL.contentEngagement)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-line p-4">
                <div className="text-[11px] font-semibold text-faint">{label}</div>
                <div className="mt-1 text-xl font-extrabold tabular-nums">{value}</div>
              </div>
            ))}
          </div>

          <DataTable<EditorRow>
            rows={EDITOR_ROWS}
            rowKey={(r) => r.email}
            columns={[
              {
                key: "rank",
                label: "Rank",
                render: (r) => <span className="font-bold text-faint">#{r.rank}</span>,
              },
              {
                key: "editor",
                label: "Editor",
                render: (r) => (
                  <div className="min-w-0">
                    <div className="font-bold">{r.name}</div>
                    <div className="truncate text-[11px] text-faint">{r.email}</div>
                  </div>
                ),
              },
              {
                key: "published",
                label: "Published",
                numeric: true,
                render: (r) => fmt(r.published),
              },
              {
                key: "engagement",
                label: "Engagement",
                numeric: true,
                render: (r) => fmt(r.engagement),
              },
              {
                key: "avg",
                label: "Avg / item",
                numeric: true,
                render: (r) => r.avgPerItem.toFixed(1),
              },
              {
                key: "mix",
                label: "Best content mix",
                render: (r) => (
                  <span className="text-accent">
                    {r.mix.map((m) => `${m.type} (${fmt(m.count)})`).join(", ")}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      </div>

      {/* ── Coverage ──────────────────────────────────────────────────── */}
      <div className="mb-10">
        <Panel
          title="What is real, and what is not"
          note="Green means the event already exists in the database and only the query is missing. Grey means the app has to start sending something before the panel can be anything but a mock."
        >
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {COVERAGE.map((c) => (
              <div key={c.panel} className="flex items-start gap-2.5 py-1">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    c.measurable ? "bg-mint text-white" : "bg-canvas text-faint"
                  }`}
                >
                  {c.measurable ? <Check size={10} strokeWidth={3} /> : <Minus size={10} />}
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] font-bold">{c.panel}</div>
                  <div className="text-[11px] leading-snug text-faint">{c.note}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

/**
 * The way back out of an opened bar.
 *
 * A crumb rather than a back button: half the value of drilling in is knowing
 * where you have ended up, and the trail says both that and how to leave.
 */
function Breadcrumb({ drill, onDrill }: { drill: Drill; onDrill: (d: Drill) => void }) {
  if (!drill.week && !drill.day) return null;

  const link =
    "rounded-full border border-line px-2.5 py-1 font-bold transition-colors hover:border-accent hover:text-accent";
  const here = "rounded-full bg-accent px-2.5 py-1 font-bold text-white";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-faint">Opened:</span>
      <button className={link} onClick={() => onDrill({})}>
        All weeks
      </button>
      {drill.week && (
        <>
          <ChevronRight size={12} className="text-faint" />
          {drill.day ? (
            <button className={link} onClick={() => onDrill({ week: drill.week })}>
              w/c {drill.week}
            </button>
          ) : (
            <span className={here}>w/c {drill.week}</span>
          )}
        </>
      )}
      {drill.day && (
        <>
          <ChevronRight size={12} className="text-faint" />
          <span className={here}>{drill.day}</span>
        </>
      )}
    </div>
  );
}

/**
 * An opened bar can fall outside a series: publishing history runs months
 * back, while the reading window is a fortnight, so drilling into June on the
 * publishing tab and then switching tabs lands on a day nothing covers. An
 * empty axis would read as a collapse to zero, which is a different claim.
 */
function OutOfRange({ drill }: { drill: Drill }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[12px] text-muted">
      Nothing here for {drill.day ?? `the week of ${drill.week}`} — this series
      covers the last {WINDOW_DAYS} days, while publishing history runs further
      back. Step back up with the trail above.
    </div>
  );
}

/* ────────────────────────────── tabs ──────────────────────────────── */

const DAU_LABEL: Record<string, string> = {
  registeredDau: "Registered DAU",
  sessions: "Active sessions",
  cardsSwiped: "Cards swiped",
  rightSwipes: "Right swipes",
  secondsPerActive: "Seconds / active user",
};

/**
 * How each DAU measure combines.
 *
 * Readers are people, so they average across days rather than adding up;
 * swipes are events, so they add. Getting this wrong is how a dashboard ends
 * up claiming more weekly actives than it has users.
 */
const DAU_AGG: Record<string, { day?: "sum" | "mean"; week?: "sum" | "mean" }> = {
  registeredDau: { day: "sum", week: "mean" },
  // A session is an event, not a person, so unlike readers these add up.
  sessions: { day: "sum", week: "sum" },
  cardsSwiped: { day: "sum", week: "sum" },
  rightSwipes: { day: "sum", week: "sum" },
  secondsPerActive: { day: "mean", week: "mean" },
};

function DauTab({
  rows,
  metric,
  view,
}: {
  rows: DauRow[];
  metric: keyof Pick<
    DauRow,
    "registeredDau" | "sessions" | "cardsSwiped" | "rightSwipes" | "secondsPerActive"
  >;
  view: ViewState;
}) {
  /* The table follows the chart into the opened bar: reading a week off the
     chart and then hunting for it in a fortnight of rows is the thing the
     drill-down is meant to remove. */
  const shown = scope(rows, view.drill);
  const points = bucket(shown, view.grain, (r) => r[metric] as number, DAU_AGG[metric]);

  if (!shown.length) return <OutOfRange drill={view.drill} />;

  return (
    <>
      <p className="mb-3 text-[12px] text-faint">
        DAU counts registered users whose recorded session overlaps the time
        section. Sessions are counted where they opened, so a reader who comes
        back after lunch is one reader and two sessions.
      </p>
      <AxisBarChart
        labels={points.map((p) => p.label)}
        values={points.map((p) => p.value)}
        name={DAU_LABEL[metric]}
        onSelect={selector(view, points, levelOf(view.grain))}
      />
      <div className="mt-4">
        <DataTable<DauRow>
          rows={shown}
          rowKey={(r) => r.day + r.section}
          columns={[
            { key: "day", label: "Day", render: (r) => r.day },
            { key: "week", label: "Week", render: (r) => r.week },
            { key: "section", label: "Time section", render: (r) => r.section },
            {
              key: "dau",
              label: "Registered DAU",
              numeric: true,
              render: (r) => fmt(r.registeredDau),
            },
            {
              key: "sessions",
              label: "Active sessions",
              numeric: true,
              render: (r) => fmt(r.sessions),
            },
            {
              key: "cards",
              label: "Cards swiped",
              numeric: true,
              render: (r) => fmt(r.cardsSwiped),
            },
            {
              key: "perUser",
              label: "Cards / active user",
              numeric: true,
              render: (r) => (r.cardsPerActive ? r.cardsPerActive.toFixed(2) : "—"),
            },
            {
              key: "seconds",
              label: "Seconds / active user",
              numeric: true,
              render: (r) => (r.secondsPerActive ? r.secondsPerActive.toFixed(2) : "—"),
            },
          ]}
        />
      </div>
      <p className="mt-3 text-[12px] text-rose">
        Unavailable: right-swipe direction is not recorded — the figures in that
        column are modelled, not counted.
      </p>
    </>
  );
}

/**
 * Open rate over time, with the resolution controls it needs to be read.
 *
 * Carries its own View switch and window filter rather than borrowing the
 * tabbed card's, because it no longer sits inside that card: a control three
 * screens above a chart is a control nobody knows is on.
 */
function NotificationsSection({
  rows,
  push,
}: {
  rows: NotificationSectionRow[];
  push: ReturnType<typeof useTimeView>;
}) {
  const { view } = push;
  const shown = scope(rows, view.drill);
  /* Open rate is a ratio, so it is rebuilt from the summed numerator and
     denominator at each resolution rather than averaged. Averaging the rate of
     a 30k send with that of a 200 send would let the small one move the week. */
  const sent = bucket(shown, view.grain, (r) => r.sent);
  const opened = bucket(shown, view.grain, (r) => r.opened);
  const points = sent.map((p, i) => ({
    key: p.key,
    label: p.label,
    value: p.value ? Math.round((opened[i].value / p.value) * 1000) / 10 : 0,
  }));

  return (
    <>
      <div className="mt-3 mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          label="View"
          options={GRANULARITIES}
          value={push.grain}
          onChange={push.chooseGrain}
        />
        <Select
          label="Send window"
          value={push.section}
          onChange={push.setSection}
          options={[
            { key: "all" as const, label: "All windows" },
            ...TIME_SECTIONS.map((s) => ({ key: s, label: s })),
          ]}
        />
      </div>

      <Breadcrumb drill={push.drill} onDrill={push.chooseDrill} />

      <p className="mb-4 text-[11px] text-faint">
        {grainNote(view)}
        {levelOf(view.grain) && " Click a bar to open it."}
      </p>

      {shown.length ? (
        <AxisBarChart
          labels={points.map((p) => p.label)}
          values={points.map((p) => p.value)}
          name="Open rate (%)"
          format={(n) => `${Math.round(n * 100) / 100}`}
          onSelect={selector(view, points, levelOf(view.grain))}
        />
      ) : (
        <OutOfRange drill={view.drill} />
      )}
    </>
  );
}

const INTERACTION_LABEL: Record<string, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  aiQuestions: "AI questions",
};

/** Every deliberate tap, as against a view, which is only an open. */
const actionsOf = (p: ProductEngagement) => p.likes + p.comments + p.shares + p.saves;

function EngagementTab({
  rows,
  metric,
  view,
  section,
}: {
  rows: InteractionRow[];
  metric: keyof Pick<
    InteractionRow,
    "views" | "likes" | "comments" | "shares" | "saves" | "aiQuestions"
  >;
  view: ViewState;
  section: TimeSection | "all";
}) {
  /** Which product the panels at the bottom are about. */
  const [product, setProduct] = useState<Product>("article");

  const shown = scope(rows, view.drill);
  /* All of these are counted events, so they add at every resolution. */
  const points = bucket(shown, view.grain, (r) => r[metric] as number);

  const ranked = useMemo(
    () => [...PRODUCT_ENGAGEMENT].sort((a, b) => actionsOf(b) - actionsOf(a)),
    []
  );

  const categories = useMemo(
    () =>
      CATEGORY_ENGAGEMENT.filter((c) => c.product === product).sort(
        (a, b) => b.rate - a.rate
      ),
    [product]
  );

  const items = useMemo(
    () =>
      TOP_ITEMS.filter((i) => i.product === product).sort((a, b) => b.views - a.views),
    [product]
  );

  return (
    <>
      {shown.length ? (
        <>
          <p className="mb-3 text-[12px] text-faint">
            Likes, shares, comments and saves across every product. AI questions
            count user messages sent to the news and buzz chats.
          </p>
          <AxisBarChart
            labels={points.map((p) => p.label)}
            values={points.map((p) => p.value)}
            name={INTERACTION_LABEL[metric]}
            onSelect={selector(view, points, levelOf(view.grain))}
          />
          <div className="mt-4">
            <DataTable<InteractionRow>
              rows={shown}
              rowKey={(r) => r.day + r.section}
              columns={[
                { key: "day", label: "Day", render: (r) => r.day },
                { key: "week", label: "Week", render: (r) => r.week },
                { key: "section", label: "Time section", render: (r) => r.section },
                { key: "views", label: "Views", numeric: true, render: (r) => fmt(r.views) },
                { key: "likes", label: "Likes", numeric: true, render: (r) => fmt(r.likes) },
                {
                  key: "comments",
                  label: "Comments",
                  numeric: true,
                  render: (r) => fmt(r.comments),
                },
                { key: "shares", label: "Shares", numeric: true, render: (r) => fmt(r.shares) },
                { key: "saves", label: "Saves", numeric: true, render: (r) => fmt(r.saves) },
                {
                  key: "ai",
                  label: "AI questions",
                  numeric: true,
                  render: (r) => fmt(r.aiQuestions),
                },
                {
                  key: "src",
                  label: "Source taps",
                  numeric: true,
                  render: (r) => fmt(r.sourceTaps),
                },
              ]}
            />
          </div>
          <p className="mt-3 text-[12px] text-rose">
            Unavailable: no event fires on the sources or ask buttons — the AI
            columns are modelled.
          </p>
        </>
      ) : (
        <OutOfRange drill={view.drill} />
      )}

      {/* ── By product ──────────────────────────────────────────────── */}
      <div className="mt-7 border-t border-line pt-5">
        <h3 className="text-sm font-bold">Engagement by product</h3>
        <p className="mt-1 mb-4 text-[12px] text-faint">
          Whole-window totals, so these do not follow the opened bar above: how
          a product is doing is a question about the fortnight, not about
          Tuesday morning. Read the rate beside the total — Pix takes a fraction
          of the views and the most actions per view, and a ranking by total
          alone would only report how much of each the desk files.
        </p>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h4 className="mb-3 text-[12px] font-bold text-faint">
              Actions — likes, comments, shares, saves
            </h4>
            <BarList
              rows={ranked.map((p) => ({
                name: PRODUCT_LABEL[p.product],
                value: actionsOf(p),
              }))}
            />
          </div>
          <div>
            <h4 className="mb-3 text-[12px] font-bold text-faint">
              Actions per hundred views
            </h4>
            <BarList
              rows={[...PRODUCT_ENGAGEMENT]
                .sort((a, b) => b.rate - a.rate)
                .map((p) => ({ name: PRODUCT_LABEL[p.product], value: p.rate }))}
              tone="bg-mint"
              format={(n) => n.toFixed(1)}
            />
          </div>
        </div>

        <div className="mt-5">
          <DataTable<ProductEngagement>
            rows={ranked}
            rowKey={(r) => r.product}
            columns={[
              { key: "product", label: "Product", render: (r) => PRODUCT_LABEL[r.product] },
              { key: "views", label: "Views", numeric: true, render: (r) => fmt(r.views) },
              { key: "likes", label: "Likes", numeric: true, render: (r) => fmt(r.likes) },
              {
                key: "comments",
                label: "Comments",
                numeric: true,
                render: (r) => fmt(r.comments),
              },
              { key: "shares", label: "Shares", numeric: true, render: (r) => fmt(r.shares) },
              { key: "saves", label: "Saves", numeric: true, render: (r) => fmt(r.saves) },
              {
                key: "rate",
                label: "Per 100 views",
                numeric: true,
                render: (r) => r.rate.toFixed(1),
              },
            ]}
          />
        </div>
      </div>

      {/* ── Inside one product ──────────────────────────────────────── */}
      <div className="mt-7 border-t border-line pt-5">
        <h3 className="text-sm font-bold">Inside a product</h3>
        <p className="mt-1 mb-4 text-[12px] text-faint">
          Which category performs best, and which items carried it. Categories
          are ranked by rate rather than by volume: the biggest category is
          usually the one most was filed in, which says more about the desk than
          about the readers.
        </p>

        <PillTabs
          tabs={PRODUCTS.map((p) => ({ key: p, label: PRODUCT_LABEL[p] }))}
          value={product}
          onChange={setProduct}
        />

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <h4 className="mb-3 text-[12px] font-bold text-faint">
              Best categories · {PRODUCT_LABEL[product]}
            </h4>
            <BarList
              rows={categories.map((c) => ({ name: c.category, value: c.rate }))}
              tone="bg-violet"
              format={(n) => n.toFixed(1)}
            />
            <p className="mt-2 text-[11px] text-faint">
              Actions per hundred views. Categories nobody files under for this
              product are absent rather than shown as zero.
            </p>
          </div>
          <div>
            <h4 className="mb-3 text-[12px] font-bold text-faint">
              Where the views went · {PRODUCT_LABEL[product]}
            </h4>
            <BarList rows={categories.map((c) => ({ name: c.category, value: c.views }))} />
            <p className="mt-2 text-[11px] text-faint">
              The same categories by volume. A category high in one list and low
              in the other is the interesting one.
            </p>
          </div>
        </div>

        {product === "trax" ? (
          <TraxDetail view={view} section={section} />
        ) : (
          <div className="mt-5">
            <DataTable<ItemEngagement>
              rows={items}
              rowKey={(r) => String(r.id)}
              maxHeight={420}
              columns={[
                { key: "id", label: "Id", numeric: true, render: (r) => r.id },
                {
                  key: "title",
                  label: "Title",
                  render: (r) => <span className="line-clamp-2">{r.title}</span>,
                },
                { key: "category", label: "Category", render: (r) => r.category },
                { key: "views", label: "Views", numeric: true, render: (r) => fmt(r.views) },
                { key: "likes", label: "Likes", numeric: true, render: (r) => fmt(r.likes) },
                { key: "shares", label: "Shares", numeric: true, render: (r) => fmt(r.shares) },
                { key: "saves", label: "Saves", numeric: true, render: (r) => fmt(r.saves) },
                {
                  key: "rate",
                  label: "Per 100 views",
                  numeric: true,
                  render: (r) => r.rate.toFixed(1),
                },
              ]}
            />
          </div>
        )}
      </div>
    </>
  );
}

function PublishingTab({
  view,
  contentType,
  section,
}: {
  view: ViewState;
  contentType: ContentType | "all";
  section: TimeSection | "all";
}) {
  const rows = useMemo(
    () =>
      contentType === "all"
        ? PUBLISHING_ROWS
        : PUBLISHING_ROWS.filter((r) => r.contentType === contentType),
    [contentType]
  );

  const { drill } = view;
  const scoped = useMemo(() => scope(rows, drill), [rows, drill]);

  /* Publishing has no reading windows to fall into — an item is filed on a
     day, not at an hour — so its last level is "what went out", by product.
     Weeks and days above it behave like every other tab. */
  const weekly = !drill.day && view.grain === "weekly";
  const level: Level | null = drill.day ? null : weekly ? "weekly" : "daily";

  const points = useMemo<Point[]>(() => {
    if (drill.day) {
      const acc = new Map<string, number>();
      for (const r of scoped) acc.set(r.contentType, (acc.get(r.contentType) ?? 0) + r.count);
      return CONTENT_TYPES.filter((t) => acc.has(t)).map((t) => ({
        key: t,
        label: CONTENT_TYPE_LABEL[t],
        value: acc.get(t) ?? 0,
      }));
    }
    const acc = new Map<string, number>();
    for (const r of scoped) {
      const k = weekly ? r.week : r.day;
      acc.set(k, (acc.get(k) ?? 0) + r.count);
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        key,
        label: weekly ? `w/c ${key.slice(5)}` : key.slice(5),
        value,
      }));
  }, [scoped, weekly, drill.day]);

  const byCategory = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of scoped) acc[r.category] = (acc[r.category] ?? 0) + r.count;
    return CATEGORIES.map((name) => ({ name, value: acc[name] ?? 0 })).sort(
      (a, b) => b.value - a.value
    );
  }, [scoped]);

  const byType = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of PUBLISHING_ROWS) acc[r.contentType] = (acc[r.contentType] ?? 0) + r.count;
    return CONTENT_TYPES.map((t) => ({
      name: CONTENT_TYPE_LABEL[t],
      value: acc[t] ?? 0,
    })).sort((a, b) => b.value - a.value);
  }, []);

  const recent = useMemo(
    () => [...scoped].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 250),
    [scoped]
  );

  return (
    <>
      <p className="mb-3 text-[12px] text-faint">
        Publishing history,{" "}
        {drill.day ? "by product" : weekly ? "by week" : "by day"}. Counts every
        item that reached readers across all seven products.
        {section !== "all" && (
          <span className="text-amber">
            {" "}
            Time sections do not apply here — an item is filed on a day, not in a
            reading window, so this chart ignores that filter rather than
            returning nothing.
          </span>
        )}
      </p>
      <AxisBarChart
        labels={points.map((p) => p.label)}
        values={points.map((p) => p.value)}
        name="Published"
        onSelect={selector(view, points, level)}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-[12px] font-bold text-faint">By product</h3>
          <BarList rows={byType} />
          <p className="mt-2 text-[11px] text-faint">
            Always the whole library, so the split stays readable while the
            filter narrows everything else on the tab.
          </p>
        </div>
        <div>
          <h3 className="mb-3 text-[12px] font-bold text-faint">
            By category
            {contentType !== "all" && ` · ${CONTENT_TYPE_LABEL[contentType]} only`}
            {drill.day ? ` · ${drill.day}` : drill.week ? ` · w/c ${drill.week}` : ""}
          </h3>
          <BarList rows={byCategory} tone="bg-violet" />
        </div>
      </div>

      <div className="mt-5">
        <DataTable<PublishingRow>
          rows={recent}
          rowKey={(r, i) => `${r.day}-${r.contentType}-${r.category}-${i}`}
          columns={[
            { key: "day", label: "Day", render: (r) => r.day },
            { key: "week", label: "Week", render: (r) => r.week },
            {
              key: "type",
              label: "Content type",
              render: (r) => CONTENT_TYPE_LABEL[r.contentType],
            },
            { key: "category", label: "Category", render: (r) => r.category },
            {
              key: "count",
              label: "Published count",
              numeric: true,
              render: (r) => r.count,
            },
          ]}
        />
      </div>
    </>
  );
}

/**
 * Trax has a question the other products do not: whether anyone finished.
 *
 * It used to be a tab of its own for that reason. Folded in here instead —
 * "how is audio doing" is the same question as "how are articles doing", and
 * answering it two screens apart made them impossible to compare — with the
 * two columns only audio has kept rather than flattened away.
 */
function TraxDetail({ view, section }: { view: ViewState; section: TimeSection | "all" }) {
  const rows = useMemo(
    () =>
      section === "all"
        ? TRAX_TIME_ROWS
        : TRAX_TIME_ROWS.filter((r) => r.section === section),
    [section]
  );

  const shown = scope(rows, view.drill);
  const plays = bucket(shown, view.grain, (r) => r.plays);
  const completions = bucket(shown, view.grain, (r) => r.completions);

  if (!shown.length) return <OutOfRange drill={view.drill} />;

  return (
    <div className="mt-5">
      <p className="mb-3 text-[12px] text-faint">
        Listening over time, then per episode. A play is cheap; finishing one is
        the signal, so completions sit beside plays rather than under them.
        Audio skews to the commutes more sharply than reading does.
      </p>
      <GroupedAxisChart
        labels={plays.map((p) => p.label)}
        series={[
          { name: "Plays", tone: "fill-accent", values: plays.map((p) => p.value) },
          {
            name: "Completed",
            tone: "fill-mint",
            values: completions.map((p) => p.value),
          },
        ]}
        onSelect={selector(view, plays, levelOf(view.grain))}
      />
      <div className="mt-4">
        <DataTable<TraxRow>
          rows={TRAX_ROWS}
          rowKey={(r) => String(r.audioId)}
          columns={[
            { key: "id", label: "Audio id", numeric: true, render: (r) => r.audioId },
            { key: "title", label: "Title", render: (r) => r.title },
            { key: "views", label: "Plays", numeric: true, render: (r) => fmt(r.views) },
            { key: "likes", label: "Likes", numeric: true, render: (r) => fmt(r.likes) },
            { key: "shares", label: "Shares", numeric: true, render: (r) => fmt(r.shares) },
            { key: "saves", label: "Saves", numeric: true, render: (r) => fmt(r.saves) },
            {
              key: "completion",
              label: "Completion (%)",
              numeric: true,
              render: (r) => r.completion.toFixed(1),
            },
            {
              key: "listen",
              label: "Avg listen",
              numeric: true,
              render: (r) => mmss(r.avgListenSec),
            },
            {
              key: "engaged",
              label: "Engaged readers",
              numeric: true,
              render: (r) => fmt(r.engagedReaders),
            },
          ]}
        />
      </div>
      <p className="mt-3 text-[12px] text-rose">
        Unavailable: completion and listen length are not recorded — plays,
        likes and shares are the columns that could be real today.
      </p>
    </div>
  );
}
