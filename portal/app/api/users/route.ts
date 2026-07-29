import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a login for a team member.
 *
 * Adding someone on the Team page used to write a cms_users profile and stop
 * there, because creating a Supabase Auth account needs the service-role key
 * and that cannot go anywhere near a browser. The result was a person with a
 * role, a name, an avatar — and "Invalid login credentials" when they tried to
 * sign in, because there was nothing to authenticate against.
 *
 * So the account is created here, on the server, where the key can live.
 *
 * Two separate identities are in play and both matter:
 *   - the caller's session, checked to make sure a super admin is asking
 *   - the service-role key, used only after that check passes
 * Skipping the first would turn this into an open account factory on a public
 * URL, which is worse than the problem it solves.
 */

const RULES = (ip: string) => [
  { key: `users-create:ip:${ip}:min`, limit: 5, windowMs: 60_000 },
  { key: `users-create:ip:${ip}:hr`, limit: 30, windowMs: 3_600_000 },
];

const ROLES = ["super_admin", "chief_editor", "writer", "qa"] as const;
type Role = (typeof ROLES)[number];

/** Supabase's own floor is 6; 10 is a more honest minimum for a shared tool. */
const MIN_PASSWORD = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const limited = rateLimit(RULES(clientIp(req)));
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limited.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  let body: { email?: unknown; fullName?: unknown; role?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const role = body.role as Role;
  const password = typeof body.password === "string" ? body.password : "";

  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: "That email address isn't valid." }, { status: 400 });
  if (!fullName)
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  if (!ROLES.includes(role))
    return NextResponse.json({ error: "Unknown role." }, { status: 400 });
  if (password.length < MIN_PASSWORD)
    return NextResponse.json(
      { error: `The password needs at least ${MIN_PASSWORD} characters.` },
      { status: 400 }
    );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Checked after the caller has been asked for a token and the body has been
  // validated, so an anonymous request cannot use this route to learn how the
  // server is configured. Deployments without the key keep working: the Team
  // page falls back to writing the profile alone and says the login is missing.
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json(
      {
        error:
          "Logins can't be created from here yet — SUPABASE_SERVICE_ROLE_KEY is not set on the server.",
        code: "not_configured",
      },
      { status: 501 }
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── is the caller allowed to do this? ─────────────────────────────
  const asCaller = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user: caller },
  } = await asCaller.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
  }

  // Read the role with the service key, not the caller's: the answer to "may
  // this person create accounts" must not be something the caller can shape.
  const { data: profile } = await admin
    .from("cms_users")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();

  // Mirrors can.manageUsers — super admins only.
  if (profile?.role !== "super_admin") {
    return NextResponse.json(
      { error: "Only a super administrator can add team members." },
      { status: 403 }
    );
  }

  // ── create the login ──────────────────────────────────────────────
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    // No mail server is configured, so an unconfirmed account could never
    // confirm itself and would refuse every sign-in.
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createErr) {
    const taken = /already (been )?registered|already exists/i.test(createErr.message);
    return NextResponse.json(
      {
        error: taken
          ? "Someone already has a login with that email address."
          : createErr.message,
      },
      { status: taken ? 409 : 502 }
    );
  }

  const newId = created.user?.id;
  if (!newId) {
    return NextResponse.json({ error: "The account came back empty." }, { status: 502 });
  }

  // The on_auth_user_created trigger has already made or adopted the profile;
  // this settles the role and name the administrator actually chose, whichever
  // path it took.
  const { error: profileErr } = await admin
    .from("cms_users")
    .update({ role, full_name: fullName, is_active: true })
    .eq("id", newId);

  if (profileErr) {
    return NextResponse.json(
      {
        error: `The login was created, but their role could not be set: ${profileErr.message}`,
        code: "role_not_set",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, id: newId, email });
}
