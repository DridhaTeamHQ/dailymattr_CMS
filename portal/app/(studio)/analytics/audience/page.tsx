"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Activity,
  BarChart3,
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
  HourHeatmap,
  KpiCard,
  LineChart,
  Panel,
  PillTabs,
  Segmented,
  MultiSelect,
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
  EDITOR_ROWS,
  EDITORIAL,
  HEATMAP_DAYS,
  HOURLY_ROWS,
  HOUR_LABELS,
  KPI,
  DAYS,
  LATEST_DAY,
  LATEST_WEEK,
  NOTIFICATIONS,
  PRODUCTS,
  PRODUCT_ENGAGEMENT,
  PRODUCT_LABEL,
  PUBLISHING_ROWS,
  PUSH_BY_CATEGORY,
  PUSH_CATEGORIES,
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
  type ContentType,
  type Product,
  type ProductEngagement,
  type PushCategoryRow,
  type PublishingRow,
  type TimeSection,
  type TraxRow,
  REGION_STATES,
  REGION_CITIES,
  notificationSectionRowsFor,
  monthDay,
  regionsForScope,
  regionByKey,
  dauRowsForRegion,
  interactionRowsForRegion,
  publishingRowsForRegion,
  type Region,
  type RegionScope,
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

/** How far back the trend line looks. */
type TrendRange = "week" | "month";

const TREND_RANGES: { key: TrendRange; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

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
type Granularity = "overall" | "daily" | "weekly" | "sections";

/**
 * What the View switch offers.
 *
 * "Time sections" is not among them: every day already opens into its reading
 * windows when you click its bar, and the whole range cut by window was
 * 112 bars nobody read across. The window filter beside this control
 * is the way to ask about one window. "Overall" takes its place — the whole
 * range as a single figure, which is the comparison the region picker makes
 * worth having: one bar per state, no time axis in the way.
 */
const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
];

/** Where each option starts. Daily opens straight into the latest day. */
const GRAIN_DRILL: Record<Granularity, Drill> = {
  overall: {},
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

  /* One figure for the range, folded the same way a week is: windows into
     days by `dayHow`, then days into the whole by `weekHow`. Going straight
     from rows to a single number would sum actives across every day and call
     the result the audience, which is the same reader counted fourteen times. */
  if (g === "overall") {
    const days = collapse(byDay, dayHow).map((p) => p.value);
    if (!days.length) return [];
    return [
      {
        key: "overall",
        label: "Overall",
        value:
          weekHow === "mean"
            ? Math.round(mean(days) * 100) / 100
            : days.reduce((a, b) => a + b, 0),
      },
    ];
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
 * its eight reading windows. It is the same series regrouped and narrowed,
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
const levelOf = (g: Granularity): Level | null =>
  g === "sections" || g === "overall" ? null : g;

/** Wires a bar click back to the day or week that produced the bar. */
const selector = (view: ViewState, points: Point[], level: Level | null) =>
  level ? (i: number) => view.open(level, points[i].key) : undefined;

/** What the bars actually report, said on the chart rather than in a doc. */
function grainNote(view: ViewState) {
  if (view.drill.day)
    return `One bar per reading window, inside ${view.drill.day}. Counted events are totalled.`;
  if (view.grain === "overall")
    return "One figure for the whole range. Counted events are totalled; per-user figures and rates are averaged over the days, because summing readers across days counts the same person more than once.";
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
  /* Daily by default: fourteen days times eight windows is 112 bars,
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
  /* Its own control, not the tabbed card's: this panel sits above that card
     and answers a different question, and a toggle that silently moved a chart
     further down the page would be the sort of thing nobody notices. */
  const [trendRange, setTrendRange] = useState<TrendRange>("week");
  const trend = useMemo(
    () => DAYS.slice(trendRange === "week" ? -7 : -30),
    [trendRange]
  );
  /** The tabbed card's own resolution, window filter and opened bar. */
  const main = useTimeView();
  /** Notifications carry theirs, so the two sections cannot move each other. */
  const push = useTimeView();
  const [dauMetric, setDauMetric] = useState<DauMetricKey>("registeredDau");
  const [interactionMetric, setInteractionMetric] = useState<
    "views" | "likes" | "comments" | "shares" | "saves" | "aiQuestions"
  >("likes");
  /** Publishing splits by product as well as by time. */
  /* Pix by default rather than everything: the tab's chart is one product's
     categories, and "all products" sums seven shapes into one that is none of
     them. Pix is the one the desk files most deliberately by topic. */
  const [contentType, setContentType] = useState<ContentType | "all">("pix");
  /** Bumping this re-mounts the section, which is what "Refresh" means here. */
  const [nonce, setNonce] = useState(0);

  /* One region filter for the whole section. Empty is everywhere; one filters;
     two or more compare. Held here rather than per tab so switching tabs keeps
     the question you were asking. */
  const [regionScope, setRegionScope] = useState<RegionScope>("state");
  const [regionKeys, setRegionKeys] = useState<string[]>([]);

  const section = main.section;

  const regionSeries = useMemo(() => seriesFor(regionKeys), [regionKeys]);
  /* One selection narrows the whole section to that region. Two or more leave
     these on the national figures — the chart draws a series per region and the
     table steps aside, so what these feed is the axis and the labels. */
  const primaryRegion = regionKeys.length === 1 ? regionKeys[0] : null;

  /* bySection is module-level, so a memo can depend on it honestly — a helper
     defined in the component body would be a new reference every render, and
     the memo would either lie about its dependencies or never hit. */
  const dauRows = useMemo(
    () => bySection(dauRowsForRegion(primaryRegion), section),
    [section, primaryRegion]
  );
  const interactionRows = useMemo(
    () => bySection(interactionRowsForRegion(primaryRegion), section),
    [section, primaryRegion]
  );
  /* Notifications read their own window filter, not the tabbed card's — and
     their own region and topic, for the same reason: the two sections are
     screens apart, and a control in one silently moving a chart in the other
     is how a desk screenshots the wrong number. */
  const [pushRegion, setPushRegion] = useState<string | null>(null);
  const [pushCategory, setPushCategory] = useState<string | null>(null);

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
                {(section === "all" || tab === "publishing" ? 0 : 1) +
                  (push.section === "all" ? 0 : 1)}
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

      {/* ── The run of days ───────────────────────────────────────────
          Above the tabbed card on purpose: "is it going up" is the first
          question anyone asks of this page, and it wants a line rather than a
          tab, a window filter and a region picker in front of it. */}
      <div className="mb-6">
        <Panel
          title="Daily Active Users Trend"
          icon={BarChart3}
          right={
            <Segmented
              options={TREND_RANGES}
              value={trendRange}
              onChange={setTrendRange}
            />
          }
          note={`Active devices per day, ${
            trendRange === "week" ? "the last 7 days" : "the last 30 days"
          }. Everywhere, every window — the filters below belong to the card below.`}
        >
          <LineChart
            labels={trend.map((d) => monthDay(d.date))}
            series={[
              {
                name: "Active users",
                tone: "stroke-violet",
                values: trend.map((d) => d.dau),
              },
            ]}
          />
        </Panel>
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
          Timezone: {TIMEZONE}. The region filter below applies to every chart
          in this card.
        </p>

        <PillTabs tabs={TABS} value={tab} onChange={setTab} />

        <div className="mt-4 mb-3 flex flex-wrap items-center gap-3">
          {/* One resolution control for the two tabs that have a time axis.
              Notifications have their own, down in their own section.

              Publishing no longer draws one: its chart is categories across
              the bottom for a single product, so a control that chose between
              days and weeks would be choosing the shape of an axis that is
              not there. */}
          {tab !== "publishing" && (
            <Segmented
              label="View"
              options={GRANULARITIES}
              value={main.grain}
              onChange={main.chooseGrain}
            />
          )}

          {/* Publishing has no reading windows to filter by — an item is filed
              on a day, not at an hour — so the control is not offered there
              rather than offered and then ignored. The chosen window is kept,
              not cleared: coming back to the reading tabs should find the page
              where it was left. */}
          {tab !== "publishing" && (
            <Select
              label="Time section"
              value={section}
              onChange={main.setSection}
              options={[
                { key: "all" as const, label: "All sections" },
                ...TIME_SECTIONS.map((s) => ({ key: s, label: s })),
              ]}
            />
          )}

          {tab === "publishing" && (
            <Select
              label="Product"
              value={contentType}
              onChange={setContentType}
              options={[
                { key: "all" as const, label: "All products" },
                ...CONTENT_TYPES.map((t) => ({ key: t, label: CONTENT_TYPE_LABEL[t] })),
              ]}
            />
          )}

          {tab === "dau" && (
            <Select
              label="Metric"
              value={dauMetric}
              onChange={setDauMetric}
              /* Straight off the metric table, so the menu cannot drift from
                 what the chart actually draws. */
              options={(Object.keys(DAU_METRICS) as DauMetricKey[]).map((k) => ({
                key: k,
                label: DAU_METRICS[k].label,
              }))}
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

        <RegionFilter
          scope={regionScope}
          onScope={setRegionScope}
          keys={regionKeys}
          onKeys={setRegionKeys}
        />

        {/* The crumb walks back out of an opened week or day, so it belongs to
            the tabs that can open one. Publishing counts its whole range. */}
        {tab !== "publishing" && (
          <>
            <div className="mt-4">
              <Breadcrumb drill={main.drill} onDrill={main.chooseDrill} />
            </div>

            <p className="mb-4 text-[11px] text-faint">
              {grainNote(main.view)}
              {levelOf(main.view.grain) && " Click a bar to open it."}
            </p>
          </>
        )}

        {tab === "dau" && (
          <DauTab
            rows={dauRows}
            metric={dauMetric}
            view={main.view}
            series={regionSeries}
            sectionFilter={section}
          />
        )}
        {tab === "engagement" && (
          <EngagementTab
            rows={interactionRows}
            metric={interactionMetric}
            view={main.view}
            section={section}
            series={regionSeries}
          />
        )}
        {tab === "publishing" && (
          <PublishingTab
            contentType={contentType}
            series={regionSeries}
          />
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

      {/* Full width: twenty-four columns in two thirds of a row would have
          been a scrollbar wrapped around a grid nobody could read. */}
      <div className="mb-6">
        <Panel
          title="When readers are here"
          note={`Active devices by date and hour, newest day first, over the last ${HEATMAP_DAYS} days. Split out of the same window rows the DAU charts are drawn from, so an hour is part of its window rather than a second opinion about it.`}
        >
          <HourHeatmap rows={HOURLY_ROWS} colLabels={HOUR_LABELS} />
        </Panel>
      </div>

      {/* Permission used to sit in this row. It moved down to the notification
          section, where the question it answers is being asked. */}
      <div className="mb-6 grid gap-5 lg:grid-cols-3">
        <Panel title="By state" note="Where readers open the app.">
          <BarList rows={BY_STATE.map((r) => ({ name: r.name, value: r.users }))} />
        </Panel>
        <Panel title="By city" note="Inferred, so treat the tail as noisy.">
          <BarList
            rows={BY_CITY.map((r) => ({ name: r.name, value: r.users }))}
            tone="bg-violet"
          />
        </Panel>
        {/* Moved out of the heatmap's row when that went full width. */}
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

      {/* Three, not four. A "Pushes sent" tile counted the broadcasts, which
          the topic panel below now breaks down properly — and next to a
          recipient count in the millions a bare 12 asked to be misread. The
          Sent tile keeps its hint, since it is what the number is. */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Sent"
          value={PUSH_SUMMARY.sent}
          hint="Recipient devices, across every push"
          icon={Send}
          tone="accent"
        />
        <Stat label="Opened" value={PUSH_SUMMARY.opened} icon={BellRing} tone="mint" />
        <Stat
          label="Open rate"
          value={`${PUSH_SUMMARY.openRate}%`}
          hint="Of FCM-accepted recipients"
          icon={Gauge}
          tone="violet"
        />
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="Sent and opened, by send time"
            note="Counted against the window a push went out in, not the one it was read in. Sent counts FCM-accepted recipients; the rate uses that same cohort and includes later opens. These four controls narrow this chart only — the tiles above and the list below stay on everything."
          >
            <NotificationsSection
              push={push}
              region={pushRegion}
              onRegion={setPushRegion}
              category={pushCategory}
              onCategory={setPushCategory}
            />
          </Panel>
        </div>
        <Panel
          title="Notification permission"
          note="Every install is one or the other — a reader who has not turned notifications on is off."
        >
          <SplitBar
            parts={[
              { name: "On", value: PUSH_SUMMARY.optIn, tone: "bg-mint" },
              { name: "Off", value: PUSH_SUMMARY.denied, tone: "bg-rose" },
            ]}
          />
          <p className="mt-4 text-[11px] leading-snug text-faint">
            Opt-in rate unavailable: notification permission is not recorded, and
            holding an FCM token is not consent.
          </p>
        </Panel>
      </div>

      {/* ── By topic ─────────────────────────────────────────────────────
          Two questions the desk asks separately: what it is pushing, and what
          readers open. Both are drawn, side by side, because ranking topics by
          volume and reading that as performance is the easy mistake — the two
          orderings are free to disagree, and a topic pushed once a fortnight
          can out-open one pushed weekly. */}
      <div className="mb-6">
        <Panel
          title="Topics pushed, and topics opened"
          note={`Every push in the last ${WINDOW_DAYS} days, grouped by the topic it was filed under. The whole audience and every region — the controls above narrow the chart, not this.`}
        >
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
            <div>
              <h3 className="mb-3 text-[12px] font-bold text-faint">
                Pushes sent — distinct stories
              </h3>
              <BarList
                rows={PUSH_BY_CATEGORY.map((r) => ({ name: r.category, value: r.pushes }))}
              />
            </div>
            <div>
              <h3 className="mb-3 text-[12px] font-bold text-faint">
                Opened — readers who tapped through
              </h3>
              <BarList
                rows={PUSH_BY_CATEGORY.map((r) => ({ name: r.category, value: r.opened }))}
                tone="bg-mint"
              />
            </div>
          </div>

          <div className="mt-6">
            <DataTable<PushCategoryRow>
              rows={PUSH_BY_CATEGORY}
              rowKey={(r) => r.category}
              columns={[
                { key: "category", label: "Topic", render: (r) => r.category },
                { key: "pushes", label: "Pushes", numeric: true, render: (r) => r.pushes },
                {
                  key: "perDay",
                  label: "Per day",
                  numeric: true,
                  render: (r) => r.perDay.toFixed(2),
                },
                { key: "sent", label: "Sent", numeric: true, render: (r) => fmt(r.sent) },
                { key: "opened", label: "Opened", numeric: true, render: (r) => fmt(r.opened) },
                {
                  key: "rate",
                  label: "Open rate (%)",
                  numeric: true,
                  render: (r) => r.openRate.toFixed(2),
                },
              ]}
            />
          </div>
          <p className="mt-3 text-[11px] leading-snug text-faint">
            Per day is over the whole {WINDOW_DAYS}-day window, so a topic pushed
            once reads as {(1 / WINDOW_DAYS).toFixed(2)} rather than as a day
            with one push and thirteen without.
          </p>
        </Panel>
      </div>

      <div className="mb-6">
        <Panel
          title="Recent pushes"
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
              { key: "category", label: "Topic", render: (r) => r.category },
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

type DauMetricKey =
  | "registeredDau"
  | "sessions"
  | "avgCards"
  | "avgRightSwipes"
  | "avgTime";

/**
 * What each DAU measure is, and how it survives being regrouped.
 *
 * Readers are people, so they average across days rather than adding up;
 * events add. Getting that wrong is how a dashboard ends up claiming more
 * weekly actives than it has users.
 *
 * The three averages are per active user, not per window. A total swipe count
 * tracks how many people opened the app, which the DAU measure above already
 * says — the question a swipe count is asked in its place is whether the
 * people who came read much, and only a per-person figure answers that. They
 * average at every level for the same reason: an average of averages across
 * windows is close enough here, while adding them would report someone who
 * read twelve cards as having read seventy.
 *
 * `total` is separate from `agg` because the comparison panel reduces a whole
 * series to one number, and summing an average is meaningless — five regions'
 * average reading time does not add up to anything.
 */
const DAU_METRICS: Record<
  DauMetricKey,
  {
    label: string;
    value: (r: DauRow) => number;
    agg: { day?: "sum" | "mean"; week?: "sum" | "mean" };
    /** How a series collapses to one figure when regions are compared. */
    total: "sum" | "mean";
    format?: (n: number) => string;
    /** Said under the chart, where the axis cannot say it. */
    note?: string;
  }
> = {
  registeredDau: {
    label: "Registered DAU",
    value: (r) => r.registeredDau,
    agg: { day: "sum", week: "mean" },
    total: "sum",
  },
  sessions: {
    label: "Active sessions",
    // A session is an event, not a person, so unlike readers these add up.
    value: (r) => r.sessions,
    agg: { day: "sum", week: "sum" },
    total: "sum",
  },
  avgCards: {
    label: "Avg cards swiped",
    value: (r) => r.cardsPerActive,
    agg: { day: "mean", week: "mean" },
    total: "mean",
    format: (n) => (Math.round(n * 10) / 10).toString(),
    note: "Cards read by the average active user, not the total swiped.",
  },
  avgRightSwipes: {
    label: "Avg right swipes",
    /* Derived rather than stored: the rows carry the count and the readers it
       came from, and a ratio of the two is the only honest per-person figure.
       Guarded, because a window with no readers is a zero and not a hole. */
    value: (r) => (r.registeredDau ? r.rightSwipes / r.registeredDau : 0),
    agg: { day: "mean", week: "mean" },
    total: "mean",
    format: (n) => (Math.round(n * 100) / 100).toString(),
    note: "Right swipes by the average active user, not the total.",
  },
  avgTime: {
    label: "Avg time spent",
    value: (r) => r.secondsPerActive,
    agg: { day: "mean", week: "mean" },
    total: "mean",
    format: mmss,
    note: "Time the average active user spent reading.",
  },
};

/* ── Where the numbers are from ────────────────────────────────────────────
 *
 * One filter for the whole section, because the question "how is Kerala
 * doing" is not a question about one chart. Nothing selected is everywhere;
 * one is a filter; two or more is a comparison, which is why there is no
 * separate compare switch to find.
 */

/** Series colours, in the order regions are added. */
const REGION_TONES = [
  "fill-accent",
  "fill-violet",
  "fill-mint",
  "fill-amber",
  "fill-rose",
] as const;

/** Beyond five the bars are too thin to read and the legend wraps twice. */
const MAX_COMPARE = REGION_TONES.length;

interface RegionSeries {
  /** Null for the national figures. */
  key: string | null;
  name: string;
  tone: string;
}

/** What the section is currently showing: one entry, or one per region. */
function seriesFor(keys: string[]): RegionSeries[] {
  if (!keys.length) return [{ key: null, name: "Overall", tone: REGION_TONES[0] }];
  return keys.map((key, i) => ({
    key,
    name: regionByKey(key)?.name ?? key,
    tone: REGION_TONES[i % REGION_TONES.length],
  }));
}

/** The picker, and the sentence saying what it is doing. */
function RegionFilter({
  scope,
  onScope,
  keys,
  onKeys,
}: {
  scope: RegionScope;
  onScope: (s: RegionScope) => void;
  keys: string[];
  onKeys: (k: string[]) => void;
}) {
  const options = regionsForScope(scope);
  const tones = seriesFor(keys);
  const toneOf = (k: string) => tones.find((t) => t.key === k)?.tone ?? REGION_TONES[0];

  return (
    <div className="mt-4 rounded-2xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Region"
          options={[
            { key: "state" as const, label: "States" },
            { key: "city" as const, label: "Cities" },
          ]}
          value={scope}
          /* Selections are dropped on a scope change rather than carried:
             comparing Kerala with Bengaluru is a chart with no shared
             denominator, and quietly keeping half a selection is worse than
             asking for it again. */
          onChange={(s) => {
            onScope(s);
            onKeys([]);
          }}
        />
        {/* Thirty-six cities laid out as pills was three wrapped rows of chrome
            above every chart on the tab. The same choice folds into a menu,
            and the sentence beside it still says what the charts are doing. */}
        <MultiSelect
          label={scope === "state" ? "State" : "City"}
          options={options.map((r: Region) => ({
            key: r.key,
            label: r.name,
            hint: r.scope === "city" ? r.state : undefined,
          }))}
          selected={keys}
          onToggle={(k) =>
            onKeys(keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k])
          }
          onClear={() => onKeys([])}
          emptyLabel="Overall"
          toneOf={toneOf}
          max={MAX_COMPARE}
        />

        <span className="text-[11px] text-faint">
          {keys.length === 0
            ? `Showing everywhere. Pick one to filter, or up to ${MAX_COMPARE} to compare.`
            : keys.length === 1
              ? "Filtered to one " + scope + "."
              : `Comparing ${keys.length} ${scope === "state" ? "states" : "cities"}.`}
        </span>
      </div>

      {/* The picks stay visible with the menu shut, in their series colours,
          so the legend on the chart below has something to agree with. */}
      {keys.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKeys(keys.filter((x) => x !== k))}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] font-bold hover:bg-canvas"
            >
              <span
                className={`h-2 w-2 rounded-full ${toneOf(k).replace("fill-", "bg-")}`}
              />
              {regionByKey(k)?.name ?? k}
              <span className="text-faint">×</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onKeys([])}
            className="cursor-pointer text-[11px] font-bold text-accent"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

/** The same section filter the page applies, reused per region when comparing. */
function bySection<T extends { section: TimeSection }>(
  rows: T[],
  section: TimeSection | "all"
): T[] {
  return section === "all" ? rows : rows.filter((r) => r.section === section);
}

/**
 * The totals behind a comparison.
 *
 * The per-row table is dropped while comparing — five regions across a
 * fortnight of windows is a few hundred rows, and nobody reads that to answer
 * "which is bigger". This says it in one line each, with the share so the
 * ranking is not just a column of numbers to subtract by eye.
 */
function RegionTotals({
  series,
  label,
  totals,
  combine = "sum",
  format = fmt,
}: {
  series: RegionSeries[];
  label: string;
  totals: number[];
  /** How the figures were reduced, which decides whether a share is meaningful. */
  combine?: "sum" | "mean";
  format?: (n: number) => string;
}) {
  const sum = totals.reduce((a, b) => a + b, 0);
  const top = Math.max(...totals, 1);
  /* A share of a set of averages is nonsense — five regions' average reading
     time does not add to a whole that anyone owns a slice of. The bar still
     ranks them against the largest, which is the comparison that survives. */
  const shareable = combine === "sum";
  return (
    <div className="mt-4 rounded-2xl border border-line p-4">
      <div className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">
        {label} {combine === "mean" ? "across the period shown" : "over the period shown"}
      </div>
      <div className="space-y-2">
        {series.map((sr, i) => (
          <div key={sr.key ?? "all"} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${sr.tone.replace("fill-", "bg-")}`} />
            <span className="w-40 shrink-0 truncate text-[12px] font-semibold">
              {sr.name}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
              <span
                className={`block h-full rounded-full ${sr.tone.replace("fill-", "bg-")}`}
                style={{ width: `${(totals[i] / top) * 100}%` }}
              />
            </span>
            <span className="w-20 shrink-0 text-right text-[12px] font-extrabold tabular-nums">
              {format(totals[i])}
            </span>
            {shareable && (
              <span className="w-12 shrink-0 text-right text-[11px] text-faint tabular-nums">
                {sum ? `${Math.round((totals[i] / sum) * 100)}%` : "—"}
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-faint">
        {shareable
          ? "Share is of the regions being compared, not of the country."
          : "An average per region, so there is no share to take — the bars rank them against the largest."}
      </p>
    </div>
  );
}

/**
 * Collapses a day × window series to one row per day.
 *
 * The tables used to carry Day, Week and Time section beside every figure.
 * Week is the Monday of the Day next to it and never distinguished two rows;
 * the window did, which is why it cannot simply be deleted — six rows all
 * reading the same date, differing only in numbers nothing explains, is worse
 * than the column it replaced.
 *
 * So the rows are folded into days. Totals add and rates average, following
 * the same rule the charts use: readers and events add across the windows of a
 * day, while "cards per active user" and "seconds per active user" are already
 * per-person figures and averaging is the only thing that keeps them true.
 * Summing them would report a reader who spent six minutes as having spent
 * half an hour.
 *
 * The windows themselves are still there to be read — the View control opens
 * them, and that is the place for a question about them.
 */
function foldDays<T extends { day: string }>(
  rows: T[],
  sum: (keyof T)[],
  mean: (keyof T)[]
): T[] {
  const byDay = new Map<string, T[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const out = { ...group[0] } as T;
      for (const k of sum) {
        out[k] = group.reduce((a, r) => a + (r[k] as number), 0) as T[keyof T];
      }
      for (const k of mean) {
        const avg = group.reduce((a, r) => a + (r[k] as number), 0) / group.length;
        // Kept to two places: these are rates, and a rate printed to nine
        // decimals is noise pretending to be precision.
        out[k] = (Math.round(avg * 100) / 100) as T[keyof T];
      }
      return out;
    });
}

function DauTab({
  rows,
  metric,
  view,
  series,
  sectionFilter,
}: {
  rows: DauRow[];
  metric: DauMetricKey;
  view: ViewState;
  series: RegionSeries[];
  sectionFilter: TimeSection | "all";
}) {
  /* The table follows the chart into the opened bar: reading a week off the
     chart and then hunting for it in a fortnight of rows is the thing the
     drill-down is meant to remove. */
  const shown = scope(rows, view.drill);
  const m = DAU_METRICS[metric];
  const points = bucket(shown, view.grain, m.value, m.agg);

  /* Each region bucketed the same way as the chart above, so the bars line up
     against one axis and one set of labels. */
  const compare = series.length > 1;
  const grouped = compare
    ? series.map((s) => ({
        name: s.name,
        tone: s.tone,
        values: bucket(
          scope(bySection(dauRowsForRegion(s.key), sectionFilter), view.drill),
          view.grain,
          m.value,
          m.agg
        ).map((p) => p.value),
      }))
    : [];

  if (!shown.length) return <OutOfRange drill={view.drill} />;

  return (
    <>
      <p className="mb-3 text-[12px] text-faint">
        DAU counts registered users whose recorded session overlaps the time
        section. Sessions are counted where they opened, so a reader who comes
        back after lunch is one reader and two sessions.
      </p>
      {compare ? (
        <LineChart
          labels={points.map((p) => p.label)}
          series={grouped}
          format={m.format}
          valueFormat={m.format ?? ((n) => n.toLocaleString())}
          onSelect={selector(view, points, levelOf(view.grain))}
        />
      ) : (
        <LineChart
          labels={points.map((p) => p.label)}
          series={[
            {
              name: m.label,
              tone: "stroke-accent",
              values: points.map((p) => p.value),
            },
          ]}
          format={m.format}
          valueFormat={m.format ?? ((n) => n.toLocaleString())}
          onSelect={selector(view, points, levelOf(view.grain))}
        />
      )}
      {m.note && <p className="mt-2 text-[11px] text-faint">{m.note}</p>}
      {compare && (
        <RegionTotals
          series={series}
          label={m.label}
          combine={m.total}
          format={m.format}
          totals={grouped.map((g) =>
            g.values.length && m.total === "mean"
              ? g.values.reduce((a, b) => a + b, 0) / g.values.length
              : g.values.reduce((a, b) => a + b, 0)
          )}
        />
      )}
      {/* Dropped while comparing: the same fortnight of windows once per region
          is a few hundred rows, and the totals above already answer the
          question that made someone pick two regions. */}
      {!compare && (
      <div className="mt-4">
        <DataTable<DauRow>
          rows={foldDays(
            shown,
            ["registeredDau", "sessions", "cardsSwiped", "rightSwipes"],
            ["cardsPerActive", "secondsPerActive"]
          )}
          rowKey={(r) => r.day}
          columns={[
            { key: "day", label: "Day", render: (r) => r.day },
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
              label: "Avg cards swiped",
              numeric: true,
              render: (r) => (r.cardsPerActive ? r.cardsPerActive.toFixed(1) : "—"),
            },
            {
              key: "seconds",
              /* Named and written the way the chart says it. Reading "454" and
                 having to divide by sixty is work the column can do. */
              label: "Avg time spent",
              numeric: true,
              render: (r) => (r.secondsPerActive ? mmss(r.secondsPerActive) : "—"),
            },
          ]}
        />
      </div>
      )}
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
/** What the notification chart draws. */
type PushMetric = "both" | "rate";

const PUSH_METRICS: { key: PushMetric; label: string }[] = [
  { key: "both", label: "Sent & opened" },
  { key: "rate", label: "Open rate" },
];

function NotificationsSection({
  push,
  region,
  onRegion,
  category,
  onCategory,
}: {
  push: ReturnType<typeof useTimeView>;
  region: string | null;
  onRegion: (key: string | null) => void;
  category: string | null;
  onCategory: (name: string | null) => void;
}) {
  const { view } = push;
  const [metric, setMetric] = useState<PushMetric>("both");

  /* Rebuilt whenever the region or topic changes, then narrowed by the send
     window the same way it always was. */
  const rows = useMemo(() => {
    const base = notificationSectionRowsFor(region, category);
    return push.section === "all" ? base : base.filter((r) => r.section === push.section);
  }, [region, category, push.section]);

  const shown = scope(rows, view.drill);
  const sent = bucket(shown, view.grain, (r) => r.sent);
  const opened = bucket(shown, view.grain, (r) => r.opened);
  /* Open rate is a ratio, so it is rebuilt from the summed numerator and
     denominator at each resolution rather than averaged. Averaging the rate of
     a 30k send with that of a 200 send would let the small one move the week. */
  const points = sent.map((p, i) => ({
    key: p.key,
    label: p.label,
    value: p.value ? Math.round((opened[i].value / p.value) * 1000) / 10 : 0,
  }));

  const level = levelOf(view.grain);

  return (
    <>
      <div className="mt-3 mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          label="View"
          options={GRANULARITIES}
          value={push.grain}
          onChange={push.chooseGrain}
        />
        <Segmented
          label="Show"
          options={PUSH_METRICS}
          value={metric}
          onChange={setMetric}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select
          label="Send window"
          value={push.section}
          onChange={push.setSection}
          options={[
            { key: "all" as const, label: "All windows" },
            ...TIME_SECTIONS.map((s) => ({ key: s, label: s })),
          ]}
        />
        {/* One region at a time here, not the comparison the tabbed card
            offers: this chart already carries two series per tick, and three
            states times sent-and-opened is six bars fighting over one slot. */}
        <Select
          label="Region"
          value={region ?? "all"}
          onChange={(k) => onRegion(k === "all" ? null : k)}
          options={[
            { key: "all", label: "Everywhere" },
            ...REGION_STATES.map((r) => ({ key: r.key, label: r.name })),
            ...REGION_CITIES.map((r) => ({ key: r.key, label: `${r.name} (${r.state})` })),
          ]}
        />
        <Select
          label="Topic"
          value={category ?? "all"}
          onChange={(k) => onCategory(k === "all" ? null : k)}
          options={[
            { key: "all", label: "All topics" },
            ...PUSH_CATEGORIES.map((c) => ({ key: c, label: c })),
          ]}
        />
      </div>

      <Breadcrumb drill={push.drill} onDrill={push.chooseDrill} />

      <p className="mb-4 text-[11px] text-faint">
        {grainNote(view)}
        {level && " Click a bar to open it."}
        {region &&
          ` ${regionByKey(region)?.name ?? "This region"}'s share of each send, weighted by its share of installs.`}
      </p>

      {!shown.length ? (
        <OutOfRange drill={view.drill} />
      ) : metric === "both" ? (
        <LineChart
          labels={sent.map((p) => p.label)}
          series={[
            { name: "Sent", tone: "stroke-accent", values: sent.map((p) => p.value) },
            { name: "Opened", tone: "stroke-mint", values: opened.map((p) => p.value) },
          ]}
          onSelect={selector(view, sent, level)}
        />
      ) : (
        <LineChart
          labels={points.map((p) => p.label)}
          series={[
            {
              name: "Open rate (%)",
              tone: "stroke-violet",
              values: points.map((p) => p.value),
            },
          ]}
          format={(n) => `${Math.round(n * 100) / 100}`}
          valueFormat={(n) => `${Math.round(n * 100) / 100}`}
          onSelect={selector(view, points, level)}
        />
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
  series,
}: {
  rows: InteractionRow[];
  metric: keyof Pick<
    InteractionRow,
    "views" | "likes" | "comments" | "shares" | "saves" | "aiQuestions"
  >;
  view: ViewState;
  section: TimeSection | "all";
  series: RegionSeries[];
}) {
  /** Which product the panels at the bottom are about. */
  const [product, setProduct] = useState<Product>("article");

  const shown = scope(rows, view.drill);
  /* All of these are counted events, so they add at every resolution. */
  const points = bucket(shown, view.grain, (r) => r[metric] as number);

  const compare = series.length > 1;
  const grouped = compare
    ? series.map((sr) => ({
        name: sr.name,
        tone: sr.tone,
        values: bucket(
          scope(bySection(interactionRowsForRegion(sr.key), section), view.drill),
          view.grain,
          (r) => r[metric] as number
        ).map((pt) => pt.value),
      }))
    : [];

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
          {compare ? (
            <LineChart
              labels={points.map((p) => p.label)}
              series={grouped}
              onSelect={selector(view, points, levelOf(view.grain))}
            />
          ) : (
            <LineChart
              labels={points.map((p) => p.label)}
              series={[
                {
                  name: INTERACTION_LABEL[metric],
                  tone: "stroke-accent",
                  values: points.map((p) => p.value),
                },
              ]}
              onSelect={selector(view, points, levelOf(view.grain))}
            />
          )}
          {compare && (
            <RegionTotals
              series={series}
              label={INTERACTION_LABEL[metric]}
              totals={grouped.map((g) => g.values.reduce((a, b) => a + b, 0))}
            />
          )}
          {!compare && (
          <div className="mt-4">
            <DataTable<InteractionRow>
              /* All counted events, so every column adds across the day's
                 windows — there is no rate here to average. */
              rows={foldDays(
                shown,
                ["views", "likes", "comments", "shares", "saves", "aiQuestions", "sourceTaps"],
                []
              )}
              rowKey={(r) => r.day}
              columns={[
                { key: "day", label: "Day", render: (r) => r.day },
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
          )}
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

/**
 * What the desk published, by category, one product at a time.
 *
 * This drew a time axis — a bar per day or week, every product stacked into
 * one count. That answered "how much are we filing", which the tiles above
 * already say, and buried the question the tab is named for: what a product
 * is actually about. Categories across the bottom and one product at a time
 * answers it directly, and switching the product redraws the same axis so two
 * products can be compared by eye rather than by memory.
 *
 * It counts the whole range. There is no time axis left to open, so there is
 * nothing to drill into and no week or day to be scoped to.
 */
function PublishingTab({
  contentType,
  series,
}: {
  contentType: ContentType | "all";
  series: RegionSeries[];
}) {
  /* One region narrows the library to what was filed for it; several leave
     this on everything, because the comparison is drawn per region below. */
  const primaryRegion = series.length === 1 ? series[0].key : null;
  const scoped = useMemo(() => {
    const base = publishingRowsForRegion(primaryRegion);
    return contentType === "all"
      ? base
      : base.filter((r) => r.contentType === contentType);
  }, [contentType, primaryRegion]);

  const compare = series.length > 1;

  /* Nothing is filed to a city — content_items carries a state and no finer —
     so a city here is showing its state's output, and two cities in one state
     draw the same line. Better said out loud than left to be noticed. */
  const cityNames = series
    .map((sr) => (sr.key ? regionByKey(sr.key) : undefined))
    .filter((r) => r?.scope === "city");
  const cityNote = cityNames.length
    ? cityNames.length === 1
      ? `Filed for ${cityNames[0]!.state} — nothing is filed to a city, so ${cityNames[0]!.name} shows its state.`
      : "Nothing is filed to a city, so each city here shows its state — two cities in one state will match."
    : null;

  /** The same reduction as `points`, run once per region. */
  const countsFor = (key: string | null): Map<string, number> => {
    const base = publishingRowsForRegion(key);
    const filtered =
      contentType === "all" ? base : base.filter((r) => r.contentType === contentType);
    const acc = new Map<string, number>();
    for (const r of filtered) acc.set(r.category, (acc.get(r.category) ?? 0) + r.count);
    return acc;
  };

  /* Every category, in one fixed order, whether or not this product has
     anything in it. A product that has never been filed under Sports should
     show an empty column there rather than an axis that silently drops it —
     and the axis has to stay put as the product changes, or two products
     cannot be compared by flicking between them. */
  const points = useMemo<Point[]>(() => {
    const acc = new Map<string, number>();
    for (const r of scoped) acc.set(r.category, (acc.get(r.category) ?? 0) + r.count);
    return CATEGORIES.map((name) => ({
      key: name,
      label: name,
      value: acc.get(name) ?? 0,
    }));
  }, [scoped]);

  /* Clicking a bar in "By product" asks what that product is made of, which
     is the question the panel beside it already answers for everything. So it
     narrows that panel and nothing else — the chart above and the table below
     stay where they are, because the click was about the split, not a filter
     on the tab. Clicking it again puts it back. */
  const [picked, setPicked] = useState<ContentType | null>(null);

  /* The Content type dropdown has already narrowed the tab to one product, so
     picking a second one here could only ever produce an empty panel. The
     dropdown wins and the rows stop being clickable — the pick is remembered,
     not thrown away, and comes back when the dropdown goes to All types. */
  const focusType = contentType === "all" ? picked : null;

  const byCategory = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of scoped) {
      if (focusType && r.contentType !== focusType) continue;
      acc[r.category] = (acc[r.category] ?? 0) + r.count;
    }
    return CATEGORIES.map((name) => ({ name, value: acc[name] ?? 0 })).sort(
      (a, b) => b.value - a.value
    );
  }, [scoped, focusType]);

  const byType = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of PUBLISHING_ROWS) acc[r.contentType] = (acc[r.contentType] ?? 0) + r.count;
    return CONTENT_TYPES.map((t) => ({
      /* The product itself, not its label — the click has to come back as
         something the rows can be filtered by. */
      key: t,
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
        {contentType === "all"
          ? "Every product, by category, across the whole range."
          : `${CONTENT_TYPE_LABEL[contentType]} by category, across the whole range.`}{" "}
        Counts every item that reached readers. Switch product above to redraw
        the same axis.
      </p>
      {cityNote && (
        <p className="mb-3 text-[12px] text-amber">{cityNote}</p>
      )}
      {compare ? (
        <GroupedAxisChart
          labels={points.map((p) => p.label)}
          /* Keyed off the shared points so every region lines up against one
             axis — a region that filed nothing in a category contributes a
             zero rather than shifting the bars along. */
          series={series.map((sr) => {
            const acc = countsFor(sr.key);
            return {
              name: sr.name,
              tone: sr.tone,
              values: points.map((p) => acc.get(p.key) ?? 0),
            };
          })}
          height={320}
          valueLabels
          angledLabels
        />
      ) : (
        <AxisBarChart
          labels={points.map((p) => p.label)}
          values={points.map((p) => p.value)}
          name="Published"
          height={320}
          valueLabels
          angledLabels
        />
      )}
      {compare && (
        <RegionTotals
          series={series}
          label="Published"
          totals={series.map((sr) => {
            const acc = countsFor(sr.key);
            return points.reduce((a, p) => a + (acc.get(p.key) ?? 0), 0);
          })}
        />
      )}

      {/* Two rankings of the same library, so they need visible daylight
          between them — at gap-5 the right-hand labels read as a third column
          of the left-hand chart. */}
      <div className="mt-5 grid gap-8 lg:grid-cols-2 lg:gap-16">
        <div>
          <h3 className="mb-3 text-[12px] font-bold text-faint">By product</h3>
          <BarList
            rows={byType}
            onSelect={
              contentType === "all"
                ? (k) => setPicked((f) => (f === k ? null : (k as ContentType)))
                : undefined
            }
            selected={focusType}
          />
          <p className="mt-2 text-[11px] text-faint">
            Always the whole library, so the split stays readable while the
            filter narrows everything else on the tab.
            {contentType === "all" &&
              " Click a product to see what it is made of, beside."}
          </p>
        </div>
        <div>
          <h3 className="mb-3 flex flex-wrap items-center gap-2 text-[12px] font-bold text-faint">
            <span>
              By category
              {contentType !== "all" && ` · ${CONTENT_TYPE_LABEL[contentType]} only`}
            </span>
            {focusType && (
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="cursor-pointer rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-accent"
              >
                {CONTENT_TYPE_LABEL[focusType]} ×
              </button>
            )}
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
      <LineChart
        labels={plays.map((p) => p.label)}
        series={[
          { name: "Plays", tone: "stroke-accent", values: plays.map((p) => p.value) },
          {
            name: "Completed",
            tone: "stroke-mint",
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
