import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* Push a featured story to every reader who has the app installed.
 *
 * Server-side because Expo's push endpoint should not be called from a browser
 * with a list of everyone's device tokens in it. But deliberately *without* a
 * service-role key: the route builds a Supabase client from the editor's own
 * access token and calls a security-definer RPC, so who is allowed to broadcast
 * is decided by the database rather than by whatever this file believes. That
 * also means no new secret to store, rotate or leak.
 *
 * See supabase/migrations/15_push.sql — `app_push_audience` refuses anyone who
 * is not a chief editor or super admin, and `app_record_notification` writes a
 * row whose unique (source, content_id) makes a second broadcast of the same
 * story impossible rather than merely discouraged.
 */

const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";
/** Expo's documented maximum messages per request. */
const CHUNK = 100;

type Body = {
  source?: "cms" | "pipeline";
  contentId?: string;
  title?: string;
  body?: string;
};

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const { source, contentId, title, body } = payload;
  if (
    (source !== "cms" && source !== "pipeline") ||
    !contentId ||
    !title?.trim()
  ) {
    return NextResponse.json({ error: "Missing story details." }, { status: 400 });
  }

  // The editor's own session, not a privileged one.
  const db = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  });

  const { data: audience, error: audienceError } = await db.rpc("app_push_audience");
  if (audienceError) {
    // The RPC raises for anyone not allowed to broadcast; that is a 403, not a 500.
    const denied = /not allowed/i.test(audienceError.message);
    return NextResponse.json(
      { error: denied ? "You can't notify readers." : audienceError.message },
      { status: denied ? 403 : 500 },
    );
  }

  const tokens = ((audience ?? []) as { token: string }[])
    .map((r) => r.token)
    .filter(Boolean);

  if (tokens.length === 0) {
    return NextResponse.json(
      { error: "No reader has push enabled yet, so there is nobody to notify." },
      { status: 409 },
    );
  }

  /* Recorded *before* sending, not after.
   *
   * The unique constraint is what stops a story going out twice, and a push
   * cannot be recalled — so the claim has to be staked before the irreversible
   * part happens. Recording afterwards would leave a window where a double
   * click sends two broadcasts and only the second one fails to record. */
  const { error: recordError } = await db.rpc("app_record_notification", {
    p_source: source,
    p_content: contentId,
    p_title: title.trim(),
    p_recipients: tokens.length,
  });
  if (recordError) {
    const already = /duplicate key|unique/i.test(recordError.message);
    const denied = /not allowed/i.test(recordError.message);
    return NextResponse.json(
      {
        error: already
          ? "Readers have already been notified about this story."
          : denied
            ? "You can't notify readers."
            : recordError.message,
      },
      { status: already ? 409 : denied ? 403 : 500 },
    );
  }

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: title.trim(),
    body: (body ?? "").trim() || undefined,
    // What the app reads on tap to open the right story — see
    // addNotificationTapListener in the app's lib/notifications.
    data: { articleId: source === "cms" ? `cms:${contentId}` : contentId },
    channelId: "breaking",
  }));

  let delivered = 0;
  const failures: string[] = [];

  for (let i = 0; i < messages.length; i += CHUNK) {
    const slice = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(EXPO_PUSH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(slice),
      });
      const json = (await res.json()) as {
        data?: { status: string; message?: string }[];
        errors?: { message: string }[];
      };
      if (json.errors?.length) {
        failures.push(...json.errors.map((e) => e.message));
        continue;
      }
      for (const ticket of json.data ?? []) {
        if (ticket.status === "ok") delivered += 1;
        else if (ticket.message) failures.push(ticket.message);
      }
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }

  /* Partial success is the normal case, not an error: some tokens are always
     stale — an uninstall does not tell us. Reported honestly so the desk sees
     what actually landed rather than a reassuring total. */
  return NextResponse.json({
    sent: delivered,
    attempted: tokens.length,
    failed: failures.length,
    // A handful is useful for diagnosis; the whole list is noise.
    problems: failures.slice(0, 3),
  });
}
