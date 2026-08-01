"use client";

import { supabase } from "./supabase";

/**
 * Send a failure somewhere it can be found later.
 *
 * Everything here ended at console.error in a browser nobody is watching. When
 * a save failed at four in the afternoon, the first anyone heard was "it didn't
 * work" — never the message that would have identified it.
 *
 * Deliberately small. It is not a replacement for a real error service: there
 * is no grouping, no alerting, no release tracking. It turns a report into a
 * row with a message, a stack, a page and a person, which is the difference
 * between guessing and looking.
 *
 * Three rules, all learned from error reporters behaving badly:
 *
 *   - Never throw. A reporter that fails while reporting turns one broken thing
 *     into two, and the second one is invisible.
 *   - Never await at a call site. Reporting must not slow down or reorder the
 *     failure handling around it.
 *   - Never flood. A render loop can throw hundreds of times a second, and a
 *     table full of one message is as useless as an empty one.
 */

/** Identical messages inside this window are counted once. */
const DEDUPE_MS = 30_000;

/** Hard ceiling per page load, whatever happens. */
const MAX_PER_SESSION = 25;

/** Long enough to identify a fault, short enough not to store a novel. */
const MAX_STACK = 4_000;
const MAX_MESSAGE = 500;

const seen = new Map<string, number>();
let sent = 0;

type Kind = "error" | "rejection" | "boundary";

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err).slice(0, MAX_MESSAGE);
  } catch {
    return String(err);
  }
}

/**
 * Records a failure. Returns immediately; the write happens in the background.
 */
export function reportError(
  err: unknown,
  kind: Kind = "error",
  digest?: string
): void {
  try {
    if (typeof window === "undefined") return;
    if (sent >= MAX_PER_SESSION) return;

    const message = messageOf(err).slice(0, MAX_MESSAGE);
    if (!message) return;

    const now = Date.now();
    const last = seen.get(message);
    if (last && now - last < DEDUPE_MS) return;
    seen.set(message, now);
    sent++;

    const stack =
      err instanceof Error && err.stack ? err.stack.slice(0, MAX_STACK) : null;

    // Fire and forget. The catch is not optional: a failing insert here must
    // not surface as an unhandled rejection, which this very module listens
    // for — that is a loop, and it would fill the table with itself.
    void (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        await supabase.from("client_errors").insert({
          actor_id: user?.id ?? null,
          actor_email: user?.email ?? null,
          kind,
          message,
          stack,
          path: window.location.pathname + window.location.search,
          user_agent: navigator.userAgent.slice(0, 400),
          digest: digest ?? null,
        });
      } catch {
        /* reporting is best-effort, always */
      }
    })();
  } catch {
    /* and so is deciding whether to report */
  }
}

/**
 * Listens for the failures nothing else catches.
 *
 * `error` covers a thrown exception that reached the top; `unhandledrejection`
 * covers a promise nobody handled, which is where most of these actually live
 * in an app that awaits a database on every page.
 */
export function installErrorReporting(): () => void {
  if (typeof window === "undefined") return () => {};

  const onError = (e: ErrorEvent) => reportError(e.error ?? e.message, "error");
  const onRejection = (e: PromiseRejectionEvent) =>
    reportError(e.reason, "rejection");

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
