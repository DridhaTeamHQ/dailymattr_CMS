/**
 * Analytics-only mode.
 *
 * With `NEXT_PUBLIC_ANALYTICS_ONLY=true` the Studio shows the audience
 * analytics and nothing else: the sidebar carries one entry, every other
 * route inside the studio sends you here, and signing in lands here rather
 * than on the dashboard. Unset or anything other than "true" and the full CMS
 * is back — no code change, which is the point of it being a flag.
 *
 * What it is *not* is a permission. Nothing is deleted and no route is
 * secured by this: the pages still exist, and a build with the flag off
 * serves them to whoever could reach them before. It hides the rest of the
 * product for a demo; it does not lock anyone out of it. Access is still the
 * job of `can.*` and the database's own policies.
 *
 * NEXT_PUBLIC_ because the sidebar and the layout that redirects are both
 * client components. That also means it is compiled into the bundle by
 * `next build` rather than read at boot — changing it on Railway takes a
 * rebuild, not a restart, and the Dockerfile has to pass it as a build arg
 * like the other four.
 */
export const ANALYTICS_ONLY =
  (process.env.NEXT_PUBLIC_ANALYTICS_ONLY ?? "").trim().toLowerCase() === "true";

/** The only page on offer in analytics-only mode. */
export const ANALYTICS_HOME = "/analytics/audience";

/** Where signing in lands, and what the sidebar logo points at. */
export const HOME = ANALYTICS_ONLY ? ANALYTICS_HOME : "/dashboard";

/**
 * True for a path the studio still serves under the current mode.
 *
 * Audience only — not the whole `/analytics` tree. The content analytics
 * screen ranks stories, which is the CMS's own reporting and part of what is
 * being hidden; the audience screen is the one this mode exists to show.
 */
export const allowedPath = (pathname: string): boolean =>
  !ANALYTICS_ONLY ||
  pathname === ANALYTICS_HOME ||
  pathname.startsWith(ANALYTICS_HOME + "/");
