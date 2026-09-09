/* Sample audience figures for the analytics screens.
 *
 * NOTHING HERE IS MEASURED. The desk asked to see the reporting laid out
 * before the app emits most of these events — notification opens, opt-in,
 * swipe direction, AI taps, city and audio completion are not instrumented
 * yet. This module invents everything so the screens can be designed, argued
 * about and signed off now, then swapped for real queries one panel at a time.
 *
 * Two rules keep it honest:
 *
 *  - Every screen that renders this says on its face that it is sample data.
 *    A dashboard of invented numbers that looks measured gets acted on.
 *  - The numbers are deterministic. A seeded generator means the figure someone
 *    screenshots today matches tomorrow's, so reviewers argue about the layout
 *    rather than the churn — and the invariants below hold by construction.
 */

/** Deterministic PRNG. Same seed, same dashboard, every render. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260909);
/** Integer in [lo, hi]. */
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
/** One decimal, for rates and averages read as "16.7%". */
const dec = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 10) / 10;
/**
 * An unrounded multiplier. `dec` rounds to one decimal, which is right for a
 * percentage and wrong for a ratio below 0.1 — a comments rate of 0.012 rounds
 * to zero and empties the chart. Ratios keep their precision; the product is
 * what gets rounded.
 */
const frac = (lo: number, hi: number) => lo + rnd() * (hi - lo);

export const TIMEZONE = "Asia/Calcutta";

/**
 * The day's reading windows, as the desk asked for them.
 *
 * Unequal spans on purpose: the overnight bucket is six hours because almost
 * nothing happens in it, and splitting it would be five empty columns.
 */
export const TIME_SECTIONS = [
  "12am–6am",
  "6am–9am",
  "9am–12pm",
  "12pm–3pm",
  "3pm–6pm",
  "6pm–9pm",
  "9pm–12am",
] as const;

export type TimeSection = (typeof TIME_SECTIONS)[number];

/** Two commutes and a bedtime carry the day; the small hours barely register. */
const SECTION_WEIGHT: Record<TimeSection, number> = {
  "12am–6am": 0.04,
  "6am–9am": 0.22,
  "9am–12pm": 0.14,
  "12pm–3pm": 0.11,
  "3pm–6pm": 0.1,
  "6pm–9pm": 0.19,
  "9pm–12am": 0.2,
};

/**
 * How hard a reader works in each window, relative to the average.
 *
 * Independent of how many readers there are: the commutes are long stretches
 * with nothing else to do, the desk check is a glance.
 */
const SECTION_INTENSITY: Record<TimeSection, number> = {
  "12am–6am": 0.7,
  "6am–9am": 1.35,
  "9am–12pm": 0.85,
  "12pm–3pm": 0.95,
  "3pm–6pm": 0.8,
  "6pm–9pm": 1.25,
  "9pm–12am": 1.15,
};

/** ISO date `n` days before today (UTC-normalised so the set is stable). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso`, for the weekly publishing view. */
function weekOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

const isWeekend = (iso: string) => {
  const dow = new Date(iso + "T00:00:00Z").getUTCDay();
  return dow === 0 || dow === 6;
};

/* ────────────────────────────── reach ─────────────────────────────── */

/** How many days of day-by-window rows the tables carry. */
export const WINDOW_DAYS = 14;

export interface DayPoint {
  date: string;
  dau: number;
  sessions: number;
  cardsSwiped: number;
  rightSwipes: number;
  secondsPerUser: number;
}

/**
 * Daily totals to yesterday. Today is excluded — a part-day next to full ones
 * reads as a collapse in every chart that shows it.
 */
export const DAYS: DayPoint[] = Array.from({ length: 30 }, (_, k) => {
  const i = 30 - k;
  const date = daysAgo(i);
  // Weekends run quieter, and there is gentle growth so the trend arrow means
  // something. A flat line would give the generator away.
  const weekend = isWeekend(date) ? 0.82 : 1;
  const growth = 1 + (30 - i) * 0.006;
  const dau = Math.round(between(2600, 3100) * weekend * growth);
  const sessions = Math.round(dau * dec(1.4, 1.9));
  const cardsSwiped = Math.round(sessions * dec(7.5, 11.5));
  return {
    date,
    dau,
    sessions,
    cardsSwiped,
    rightSwipes: Math.round(cardsSwiped * frac(0.16, 0.24)),
    secondsPerUser: Math.round(dec(3.4, 6.2) * 60),
  };
});

/**
 * The most recent full day, which is what "today" means on a chart: today
 * itself is still running and would read as a collapse beside whole days.
 */
export const LATEST_DAY = DAYS[DAYS.length - 1].date;
export const LATEST_WEEK = weekOf(LATEST_DAY);

const latest = DAYS[DAYS.length - 1];
const previous = DAYS[DAYS.length - 2];

/**
 * The ordering is the point. A bug on this screen had weekly actives exceeding
 * the total user count — impossible, and it meant the two figures came from
 * different places. These are derived from one another so DAU <= WAU <= MAU
 * <= total holds by construction.
 */
const wau = Math.round(latest.dau * 3.1);
const mau = Math.round(wau * 2.4);
const totalUsers = Math.round(mau * 1.35);
const totalSessions = DAYS.reduce((a, d) => a + d.sessions, 0);

export const KPI = {
  totalUsers,
  wau,
  mau,
  dau: latest.dau,
  dauChange: Math.round(((latest.dau - previous.dau) / previous.dau) * 1000) / 10,
  totalSessions,
  /** Share of users who have ever played a Trax. */
  audioAdoption: dec(18, 27),
  audioUsersOverall: Math.round(totalUsers * frac(0.18, 0.27)),
  audioUsersToday: Math.round(latest.dau * frac(0.09, 0.16)),
  /** Mean length of a session, in seconds, across the window. */
  avgSessionSec: between(2400, 2700),
  /** And today's, which is what the header quotes. */
  avgSessionTodaySec: between(58, 82),
};

export const RATING = {
  score: 4.4,
  count: 1287,
  /** Five stars first. */
  histogram: [812, 271, 118, 52, 34],
};

/* ────────────────────── day × window tables ───────────────────────── */

export interface DauRow {
  day: string;
  /** Monday of that day's week. Carried on the row so the weekly view is a
   *  regroup rather than a second query. */
  week: string;
  section: TimeSection;
  registeredDau: number;
  /** Sessions opened in the window. An event, so unlike readers these add up. */
  sessions: number;
  cardsSwiped: number;
  rightSwipes: number;
  cardsPerActive: number;
  secondsPerActive: number;
}

/**
 * One row per day per window for the last WINDOW_DAYS days.
 *
 * Built by splitting each day's total across the windows with the weights
 * above, so a window column summed across the day lands back on the DAU that
 * day reported. The heatmap reads from this same table for the same reason —
 * the existing one was reported as possibly not reflecting the stats, and the
 * way to make two figures agree is to compute one from the other.
 */
export const DAU_ROWS: DauRow[] = DAYS.slice(-WINDOW_DAYS).flatMap((d) =>
  TIME_SECTIONS.map((section) => {
    const w = SECTION_WEIGHT[section] * (0.9 + rnd() * 0.2);
    const registeredDau = Math.round(d.dau * w);
    /* Cards get their own intensity on top of the window weight. Scaling both
       by the same number made cards-per-reader identical in every window —
       arithmetically inevitable, and wrong: a commuter works through a stack,
       someone checking at their desk reads one. */
    const cardsSwiped = Math.round(d.cardsSwiped * w * SECTION_INTENSITY[section] * (0.85 + rnd() * 0.3));
    return {
      day: d.date,
      week: weekOf(d.date),
      section,
      registeredDau,
      sessions: Math.round(d.sessions * w * (0.9 + rnd() * 0.2)),
      cardsSwiped,
      rightSwipes: Math.round(cardsSwiped * frac(0.16, 0.24)),
      cardsPerActive: registeredDau ? Math.round((cardsSwiped / registeredDau) * 100) / 100 : 0,
      secondsPerActive: registeredDau ? between(140, 620) : 0,
    };
  })
);

export interface InteractionRow {
  day: string;
  week: string;
  section: TimeSection;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  aiQuestions: number;
  sourceTaps: number;
}

/**
 * What readers did, per window. Views are opens; the rest took a deliberate
 * tap. Comments run an order of magnitude below likes everywhere, so a short
 * comments bar is the shape of the thing, not a failure.
 */
export const INTERACTION_ROWS: InteractionRow[] = DAU_ROWS.map((r) => {
  const views = Math.round(r.cardsSwiped * frac(0.55, 0.8));
  return {
    day: r.day,
    week: r.week,
    section: r.section,
    views,
    likes: Math.round(views * frac(0.06, 0.11)),
    comments: Math.round(views * frac(0.004, 0.011)),
    shares: Math.round(views * frac(0.012, 0.028)),
    saves: Math.round(views * frac(0.02, 0.04)),
    // Two products behind one button: checking where a story came from, and
    // asking the model a question. Kept apart so one growing cannot hide the
    // other standing still.
    aiQuestions: Math.round(r.registeredDau * frac(0.03, 0.07)),
    sourceTaps: Math.round(r.registeredDau * frac(0.05, 0.1)),
  };
});

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Day-of-week × window, active devices, from the last seven days of rows. */
export const HEATMAP: number[][] = DAY_LABELS.map((_, dow) =>
  TIME_SECTIONS.map((s) => {
    const rows = DAU_ROWS.filter(
      (r) => (new Date(r.day + "T00:00:00Z").getUTCDay() + 6) % 7 === dow && r.section === s
    );
    return rows.length
      ? Math.round(rows.reduce((a, r) => a + r.registeredDau, 0) / rows.length)
      : 0;
  })
);

/* ───────────────────────── notifications ──────────────────────────── */

export type PushType = "article" | "buzz" | "custom";

export interface NotificationRow {
  id: number;
  title: string;
  type: PushType;
  sentAt: string;
  day: string;
  week: string;
  section: TimeSection;
  /** FCM accepted the recipient — the honest denominator. */
  fcmAccepted: number;
  opened: number;
  /** Percentage, stored so the table and any summary cannot disagree. */
  openRate: number;
}

const PUSH_TITLES: [string, PushType][] = [
  ["Rupee climbs to a three-month high against the dollar", "article"],
  ["Cabinet clears the new transport bill after a six-hour sitting", "article"],
  ["Monsoon arrives a week early in Kerala, IMD confirms", "buzz"],
  ["India chase 287 to level the series in Colombo", "buzz"],
  ["Metro Phase III gets central funding of Rs 4,200 crore", "article"],
  ["Two crore GST filings in a single day, a record", "buzz"],
  ["Wildfire warning issued for the Nilgiris through Sunday", "article"],
  ["Budget session opens on Monday: five things to watch", "custom"],
  ["Singapore open to chemical castration for sex offenders", "buzz"],
  ["Hyderabad Metro adds 40 trips on the Blue Line from today", "article"],
  ["SC to hear the NEET paper leak petitions on Thursday", "article"],
  ["Telangana declares a holiday for polling on the 14th", "buzz"],
];

/** Recent broadcasts, newest first. Twelve, so the table has a scroll. */
export const NOTIFICATIONS: NotificationRow[] = PUSH_TITLES.map(([title, type], i) => {
  const dayIdx = Math.floor(i / 2) + 1;
  const day = daysAgo(dayIdx);
  // Alternate a morning and an evening send so the by-window view has both.
  const section: TimeSection = i % 2 === 0 ? "6am–9am" : "6pm–9pm";
  const fcmAccepted = between(21000, 38000);
  // A tight, topical push beats a broad one — that spread is the reason to
  // show one rate per send rather than an average.
  const openRate = type === "custom" ? dec(3.1, 7.4) : dec(6.8, 21.4);
  return {
    id: 540 + i * 3,
    title,
    type,
    sentAt: `${day}T${section === "6am–9am" ? "07" : "19"}:15:00+05:30`,
    day,
    week: weekOf(day),
    section,
    fcmAccepted,
    opened: Math.round((fcmAccepted * openRate) / 100),
    openRate,
  };
});

const pushSent = NOTIFICATIONS.reduce((a, p) => a + p.fcmAccepted, 0);
const pushOpened = NOTIFICATIONS.reduce((a, p) => a + p.opened, 0);

export const PUSH_SUMMARY = {
  sent: pushSent,
  opened: pushOpened,
  openRate: Math.round((pushOpened / pushSent) * 1000) / 10,
  /** Share of installs with notifications left on. */
  optIn: 63.8,
  denied: 21.4,
  undecided: 14.8,
};

export interface NotificationSectionRow {
  day: string;
  week: string;
  section: TimeSection;
  sent: number;
  opened: number;
  openRate: number;
}

/**
 * Open rate by the window the push was SENT in, per day. Windows with no send
 * are still present as zero rows — an absent bar and a zero bar mean different
 * things, and the desk asked for the grid.
 */
export const NOTIFICATION_BY_SECTION: NotificationSectionRow[] = Array.from(
  { length: WINDOW_DAYS },
  (_, k) => daysAgo(WINDOW_DAYS - k)
).flatMap((day) =>
  TIME_SECTIONS.map((section) => {
    const sends = NOTIFICATIONS.filter((n) => n.day === day && n.section === section);
    const sent = sends.reduce((a, n) => a + n.fcmAccepted, 0);
    const opened = sends.reduce((a, n) => a + n.opened, 0);
    return {
      day,
      week: weekOf(day),
      section,
      sent,
      opened,
      openRate: sent ? Math.round((opened / sent) * 1000) / 10 : 0,
    };
  })
);

/* ─────────────────────────── publishing ───────────────────────────── */

/**
 * Everything the desk files. Polls and live updates are low-volume but they
 * are separate products with their own workflow, so they get their own row
 * rather than being folded into "article" and disappearing.
 */
export type ContentType =
  | "article"
  | "buzz"
  | "video"
  | "audio"
  | "magazine"
  | "poll"
  | "live";

export const CONTENT_TYPES: ContentType[] = [
  "article",
  "buzz",
  "video",
  "audio",
  "magazine",
  "poll",
  "live",
];

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  article: "News article",
  buzz: "Buzz",
  video: "Video",
  audio: "Audio",
  magazine: "Magazine",
  poll: "Poll",
  live: "Live update",
};

export const CATEGORIES = [
  "National",
  "International",
  "Politics",
  "Business",
  "Finance",
  "Technology",
  "Science",
  "Sports",
  "Entertainment",
  "Spiritual",
  "Andhra Pradesh",
  "Telangana",
];

export interface PublishingRow {
  day: string;
  week: string;
  contentType: ContentType;
  category: string;
  count: number;
}

/**
 * Ninety days of what the desk put out, by type and category. Sparse on
 * purpose: most day × type × category cells are empty, as they are in life,
 * and the chart is a dense field of small bars rather than a smooth curve.
 */
export const PUBLISHING_ROWS: PublishingRow[] = Array.from({ length: 90 }, (_, k) => k).flatMap((k) => {
  const day = daysAgo(90 - k);
  const quiet = isWeekend(day) ? 0.55 : 1;
  // Output ramps up over the quarter as the desk grew.
  const ramp = 0.6 + (k / 90) * 0.7;
  const rows: PublishingRow[] = [];
  const slots = Math.round(between(4, 9) * quiet * ramp);
  for (let i = 0; i < slots; i++) {
    /* Weighted by hand rather than picked uniformly: a newsroom files buzz and
       articles all day and a poll once a week, and a flat draw would show
       seven equal bars, which is the one shape this chart must not invent. */
    const DRAW: ContentType[] = [
      "buzz", "buzz", "buzz", "buzz",
      "article", "article", "article",
      "video", "video",
      "audio",
      "magazine",
      "poll",
      "live",
    ];
    const contentType = DRAW[between(0, DRAW.length - 1)];
    const category = CATEGORIES[between(0, CATEGORIES.length - 1)];
    const existing = rows.find((r) => r.contentType === contentType && r.category === category);
    if (existing) existing.count += between(1, 3);
    else rows.push({ day, week: weekOf(day), contentType, category, count: between(1, 4) });
  }
  return rows;
});

/* ────────────────────────────── trax ──────────────────────────────── */

export interface TraxRow {
  audioId: number;
  title: string;
  views: number;
  likes: number;
  shares: number;
  saves: number;
  /** Share of plays that reached the end. */
  completion: number;
  avgListenSec: number;
  engagedReaders: number;
}

const TRAX_TITLES = [
  "People Pleaser",
  "How to Apologize",
  "Managing Expectations",
  "Take Criticism",
  "Say No",
  "Setting Boundaries",
  "Auroras",
  "Voyager",
  "Jet Airways",
  "Byju's",
  "How to Disagree",
  "Black Holes",
  "Amaron",
  "MRF",
  "Relaxo",
];

export const TRAX_ROWS: TraxRow[] = TRAX_TITLES.map((title, i) => {
  const views = between(180, 2400);
  return {
    audioId: 8 + i * 2,
    title,
    views,
    likes: Math.round(views * frac(0.05, 0.14)),
    shares: Math.round(views * frac(0.01, 0.04)),
    saves: Math.round(views * frac(0.02, 0.06)),
    completion: dec(31, 68),
    avgListenSec: between(84, 214),
    engagedReaders: Math.round(views * frac(0.3, 0.55)),
  };
});

export interface TraxTimeRow {
  day: string;
  week: string;
  section: TimeSection;
  plays: number;
  completions: number;
  likes: number;
  shares: number;
}

/**
 * Listening over time, so the Trax chart answers the same question as every
 * other tab: when. The per-episode table below it answers which.
 *
 * Audio skews later than reading — it is what people put on while doing
 * something else — so it uses its own weighting rather than the shared one.
 */
const AUDIO_WEIGHT: Record<TimeSection, number> = {
  "12am–6am": 0.06,
  "6am–9am": 0.24,
  "9am–12pm": 0.1,
  "12pm–3pm": 0.09,
  "3pm–6pm": 0.11,
  "6pm–9pm": 0.22,
  "9pm–12am": 0.18,
};

export const TRAX_TIME_ROWS: TraxTimeRow[] = DAYS.slice(-WINDOW_DAYS).flatMap((d) => {
  const dayPlays = Math.round(d.dau * frac(0.05, 0.11));
  return TIME_SECTIONS.map((section) => {
    const plays = Math.round(dayPlays * AUDIO_WEIGHT[section] * (0.85 + rnd() * 0.3));
    return {
      day: d.date,
      week: weekOf(d.date),
      section,
      plays,
      completions: Math.round(plays * frac(0.31, 0.68)),
      likes: Math.round(plays * frac(0.05, 0.14)),
      shares: Math.round(plays * frac(0.01, 0.04)),
    };
  });
});

export const AUDIO = {
  plays: TRAX_ROWS.reduce((a, r) => a + r.views, 0),
  completion:
    Math.round(
      (TRAX_ROWS.reduce((a, r) => a + r.completion, 0) / TRAX_ROWS.length) * 10
    ) / 10,
  avgListenSec: Math.round(
    TRAX_ROWS.reduce((a, r) => a + r.avgListenSec, 0) / TRAX_ROWS.length
  ),
  background: dec(41, 62),
};

/* ──────────────────── engagement, by what it is ───────────────────── */

/**
 * The desk's own products, which are not the same list as the publishing
 * types above. That list answers "what did we file", drawn from the workflow;
 * this one answers "what did readers do with it", and readers meet a Pix or a
 * Qix as a thing in its own right, not as an article with pictures.
 */
export type Product = "article" | "pix" | "qix" | "trax" | "buzz";

export const PRODUCTS: Product[] = ["article", "pix", "qix", "trax", "buzz"];

export const PRODUCT_LABEL: Record<Product, string> = {
  article: "Articles",
  pix: "Pix",
  qix: "Qix",
  trax: "Trax",
  buzz: "Buzz",
};

/**
 * How the card views split, and how hard each product is engaged with once
 * opened. The two are deliberately independent: Trax takes the fewest views
 * and Pix the most actions per view, which is the whole reason to show a rate
 * beside a total. A product that only ever showed totals would rank by how
 * much of it the desk files.
 */
const PRODUCT_MIX: Record<Product, { share: number; pull: number }> = {
  article: { share: 0.4, pull: 0.85 },
  buzz: { share: 0.29, pull: 1.0 },
  // A picture is the cheapest thing in the app to like and the easiest to send on.
  pix: { share: 0.17, pull: 1.55 },
  // Answering is itself an interaction, so a Qix starts ahead.
  qix: { share: 0.09, pull: 1.3 },
  // Listening is long and quiet: few plays, and finishing one is the signal.
  trax: { share: 0.05, pull: 0.7 },
};

export interface ProductEngagement {
  product: Product;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** Actions per hundred views — the one number that compares products fairly. */
  rate: number;
}

const TOTAL_VIEWS = INTERACTION_ROWS.reduce((a, r) => a + r.views, 0);

export const PRODUCT_ENGAGEMENT: ProductEngagement[] = PRODUCTS.map((product) => {
  const { share, pull } = PRODUCT_MIX[product];
  const views = Math.round(TOTAL_VIEWS * share);
  const likes = Math.round(views * frac(0.06, 0.11) * pull);
  const comments = Math.round(views * frac(0.004, 0.011) * pull);
  const shares = Math.round(views * frac(0.012, 0.028) * pull);
  const saves = Math.round(views * frac(0.02, 0.04) * pull);
  const actions = likes + comments + shares + saves;
  return {
    product,
    views,
    likes,
    comments,
    shares,
    saves,
    rate: views ? Math.round((actions / views) * 1000) / 10 : 0,
  };
});

/**
 * Headline and the desk it came off, per product.
 *
 * The category is written down rather than drawn: a random pairing filed the
 * repo-rate story under Entertainment, and a table of sample rows nobody can
 * read straight is worse than no table.
 */
const ITEM_TITLES: Record<Product, [title: string, category: string][]> = {
  article: [
    ["Cabinet clears the metro extension to Shamshabad", "Telangana"],
    ["Monsoon session opens with the farm bill on the list", "Politics"],
    ["RBI holds the repo rate for a fourth meeting", "Finance"],
    ["Two states, one river, and a tribunal that has not met", "National"],
    ["The quiet return of the small-cap IPO", "Business"],
    ["Hyderabad's water table rose this year. Nobody agrees why", "Science"],
    ["A verdict twelve years in the writing", "National"],
    ["What the new labour codes change on the shop floor", "Business"],
  ],
  pix: [
    ["Six frames from the Godavari in flood", "Andhra Pradesh"],
    ["The city at 5am, before the horns", "Telangana"],
    ["Charminar, from the roof opposite", "Telangana"],
    ["Harvest, in nine pictures", "National"],
    ["What ₹100 buys at Monda Market", "Business"],
    ["The last single-screen theatres", "Entertainment"],
    ["Winter in the Araku valley", "Andhra Pradesh"],
    ["One street, four decades apart", "National"],
  ],
  qix: [
    ["How closely did you read the budget?", "Finance"],
    ["Name the river from one bend", "National"],
    ["Which of these five headlines is invented?", "International"],
    ["Test yourself on this week's verdicts", "Politics"],
    ["The cricket quiz nobody finishes", "Sports"],
    ["Spot the year from the photograph", "Entertainment"],
    ["Twelve questions on the Constitution", "Politics"],
    ["How well do you know your own city?", "Telangana"],
  ],
  buzz: [
    ["The metro map you have been reading wrong", "Telangana"],
    ["Why every biryani chain opened on the same road", "Business"],
    ["A founder, a fund, and a very short year", "Business"],
    ["The film everyone is quoting and nobody has seen", "Entertainment"],
    ["Ten minutes that changed the second innings", "Sports"],
    ["The pothole with its own postal address", "Telangana"],
    ["What the auto drivers know about the traffic model", "Science"],
    ["Nobody expected the third-day crowd", "Sports"],
  ],
  trax: [
    ["People Pleaser", "Spiritual"],
    ["How to Apologize", "Spiritual"],
    ["Managing Expectations", "Business"],
    ["Take Criticism", "Spiritual"],
    ["Say No", "Spiritual"],
    ["Setting Boundaries", "Spiritual"],
    ["Auroras", "Science"],
    ["Voyager", "Science"],
  ],
};

export interface CategoryEngagement {
  product: Product;
  category: string;
  views: number;
  /** Likes, comments, shares and saves together. */
  actions: number;
  /** Actions per hundred views. */
  rate: number;
}

/**
 * Which category performs best, per product.
 *
 * Not every product covers every category — nobody files a Qix on Finance
 * most weeks — so each takes a subset. An empty row and a weak row mean
 * different things, and a grid padded with zeros would hide the difference.
 * Every category the product's own items sit in is always in the subset, so
 * the ranking can never omit one the table below it shows.
 */
export const CATEGORY_ENGAGEMENT: CategoryEngagement[] = PRODUCTS.flatMap((product) => {
  const parent = PRODUCT_ENGAGEMENT.find((p) => p.product === product)!;
  const filed = new Set(ITEM_TITLES[product].map(([, category]) => category));
  const covered = CATEGORIES.filter((c) => filed.has(c) || rnd() > 0.45);
  const weights = covered.map(() => 0.35 + rnd());
  const total = weights.reduce((a, b) => a + b, 0);
  return covered.map((category, i) => {
    const views = Math.round(parent.views * (weights[i] / total));
    // Around the product's own rate, wide enough that the ranking means
    // something and narrow enough that it stays the same product.
    const rate = Math.round(parent.rate * (0.62 + rnd() * 0.85) * 10) / 10;
    return { product, category, views, actions: Math.round((views * rate) / 100), rate };
  });
});

export interface ItemEngagement {
  product: Product;
  id: number;
  title: string;
  category: string;
  views: number;
  likes: number;
  shares: number;
  saves: number;
  rate: number;
}

/**
 * The best-performing items, per product — the "which one" that a rate by
 * category cannot answer. A long tail on purpose: the top item is worth
 * several of the eighth, which is what makes a ranking worth reading.
 */
export const TOP_ITEMS: ItemEngagement[] = PRODUCTS.flatMap((product, p) => {
  const parent = PRODUCT_ENGAGEMENT.find((x) => x.product === product)!;
  /* Drawn out of the product's own views rather than freely, or a Trax
     episode ends up with more plays than Trax has. These eight are the head
     of the catalogue, not all of it, so they take about half of it. */
  const weights = ITEM_TITLES[product].map((_, i) => (0.75 + rnd() * 0.5) / (1 + i * 0.55));
  const total = weights.reduce((a, b) => a + b, 0);
  const pool = parent.views * frac(0.34, 0.52);
  return ITEM_TITLES[product].map(([title, category], i) => {
    const views = Math.round((pool * weights[i]) / total);
    const rate = Math.round(parent.rate * (0.7 + rnd() * 0.8) * 10) / 10;
    const actions = Math.round((views * rate) / 100);
    return {
      product,
      id: 100 * (p + 1) + i * 3,
      title,
      category,
      views,
      likes: Math.round(actions * frac(0.6, 0.75)),
      shares: Math.round(actions * frac(0.08, 0.16)),
      saves: Math.round(actions * frac(0.12, 0.22)),
      rate,
    };
  });
});

/* ───────────────────────── audience & places ──────────────────────── */

export interface PlaceRow {
  name: string;
  users: number;
}

export const BY_STATE: PlaceRow[] = [
  "Telangana",
  "Andhra Pradesh",
  "Karnataka",
  "Maharashtra",
  "Tamil Nadu",
  "Delhi",
  "Uttar Pradesh",
  "West Bengal",
  "Kerala",
  "Gujarat",
].map((name, i) => ({
  name,
  users: Math.round(mau * (0.22 - i * 0.02) * (0.9 + rnd() * 0.2)),
}));

export const BY_CITY: PlaceRow[] = [
  "Hyderabad",
  "Bengaluru",
  "Vijayawada",
  "Mumbai",
  "Chennai",
  "New Delhi",
  "Visakhapatnam",
  "Pune",
  "Kolkata",
  "Kochi",
].map((name, i) => ({
  name,
  users: Math.round(mau * (0.17 - i * 0.016) * (0.9 + rnd() * 0.2)),
}));

/** Today's live strip. Small numbers, because today is only part-way through. */
export const TODAY = {
  activeUsers: between(40, 90),
  sessions: between(120, 190),
  audioRate: dec(0, 4),
  latestDau: Math.round(latest.dau * frac(0.02, 0.04)),
  avgSessionSec: KPI.avgSessionTodaySec,
  date: daysAgo(0),
};

/* ─────────────────────────── editorial ────────────────────────────── */

export interface EditorRow {
  rank: number;
  name: string;
  email: string;
  role: "qa" | "chief_editor";
  published: number;
  engagement: number;
  /** Engagement per published item. */
  avgPerItem: number;
  mix: { type: string; count: number }[];
}

const EDITORS: [string, string, EditorRow["role"]][] = [
  ["Sharon Dasari", "sharon@dridhatechnologies.com", "qa"],
  ["Sirish Meethal", "sirishmeethal94.st@gmail.com", "qa"],
  ["Jaydev Pittala", "jaydev@dridhatechnologies.com", "qa"],
  ["Ramesh Avancha", "avancharamesh530@gmail.com", "qa"],
  ["Nikita Rao", "nikita@dridhatechnologies.com", "qa"],
  ["Priya Menon", "priya@dridhatechnologies.com", "qa"],
  ["Aarav Mehta", "aarav@dridhatechnologies.com", "chief_editor"],
  ["Kavya Reddy", "kavya@dridhatechnologies.com", "chief_editor"],
];

const MIX_TYPES = ["Buzz", "News Article", "Video", "Audio", "Magazine"];

export const EDITOR_ROWS: EditorRow[] = EDITORS.map(([name, email, role], i) => {
  // Output is long-tailed: one person files most of it, then it falls away.
  const published = Math.round(7200 * Math.pow(0.42, i) + between(20, 90));
  const engagement = Math.round(published * frac(0.05, 1.9));
  const first = between(0, 4);
  let second = between(0, 4);
  if (second === first) second = (second + 1) % 5;
  return {
    rank: i + 1,
    name,
    email,
    role,
    published,
    engagement,
    avgPerItem: Math.round((engagement / published) * 10) / 10,
    mix: [
      { type: MIX_TYPES[first], count: Math.round(published * frac(0.55, 0.85)) },
      { type: MIX_TYPES[second], count: Math.round(published * frac(0.05, 0.3)) },
    ],
  };
})
  .sort((a, b) => b.published - a.published)
  .map((r, i) => ({ ...r, rank: i + 1 }));

export const EDITORIAL = {
  publishedContent: EDITOR_ROWS.reduce((a, r) => a + r.published, 0),
  contentEngagement: EDITOR_ROWS.reduce((a, r) => a + r.engagement, 0),
  activeQa: EDITOR_ROWS.filter((r) => r.role === "qa").length,
  activeChiefEditors: EDITOR_ROWS.filter((r) => r.role === "chief_editor").length,
};

/* ──────────────────────────── coverage ────────────────────────────── */

/**
 * Which panels are invented and which could be wired up today. Rendered on
 * the page so the gap is visible to whoever is reading it rather than only in
 * a spreadsheet. `measurable` means the event already exists in the database
 * and only the query is missing.
 */
export const COVERAGE: { panel: string; measurable: boolean; note: string }[] = [
  { panel: "Reach — DAU, WAU, MAU, sessions", measurable: true, note: "Sessions are recorded per device." },
  { panel: "Likes, comments, shares, saves by window", measurable: true, note: "Stored per item; only the time split is unqueried." },
  { panel: "Publishing by category, day and week", measurable: true, note: "Entirely derivable from content_items." },
  { panel: "Engagement by product and category", measurable: true, note: "content_stats carries the kind and category of every item." },
  { panel: "Editorial performance", measurable: true, note: "The audit log carries who published what." },
  { panel: "Store rating", measurable: true, note: "From the store APIs, not from us." },
  { panel: "Trax plays, likes, shares", measurable: true, note: "Counted. Completion and listen length are not." },
  { panel: "Notification opens", measurable: false, note: "The app never reports that a push was opened." },
  { panel: "Notification opt-in", measurable: false, note: "Permission state is never sent back; an FCM token is not consent." },
  { panel: "Right swipes", measurable: false, note: "Swipes are counted, not distinguished left from right." },
  { panel: "AI questions and source taps", measurable: false, note: "No event fires on either button." },
  { panel: "City", measurable: false, note: "Only the state is inferred today, from the request." },
];
