"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "./supabase";
import type { CmsUser, Role } from "./types";

/**
 * Supabase Auth. The session is the source of truth; the CMS profile (role,
 * languages, states) is read from cms_users, whose id matches auth.uid().
 *
 * The role returned here only drives what the UI offers — the database enforces
 * the same rules through RLS and the publish trigger, so hiding a button is a
 * convenience, not the security boundary.
 */

interface AuthCtx {
  user: CmsUser | null;
  ready: boolean;
  login: (
    email: string,
    password: string,
    role: Role
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  loginWithGoogle: (
    role?: Role
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  ready: false,
  login: async () => ({ ok: false, error: "not ready" }),
  loginWithGoogle: async () => ({ ok: false, error: "not ready" }),
  logout: async () => {},
  refresh: async () => {},
});

async function loadProfile(
  userId: string,
  email?: string
): Promise<CmsUser | null> {
  const { data: byId } = await supabase
    .from("cms_users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (byId) {
    return {
      id: byId.id,
      email: byId.email,
      fullName: byId.full_name,
      role: byId.role,
      languages: byId.languages ?? [],
      states: byId.states ?? [],
      isActive: byId.is_active,
      avatarHue: byId.avatar_hue ?? 220,
    };
  }

  if (email) {
    const { data: byEmail } = await supabase
      .from("cms_users")
      .select("*")
      .ilike("email", email.trim())
      .maybeSingle();

    if (byEmail) {
      return {
        id: byEmail.id,
        email: byEmail.email,
        fullName: byEmail.full_name,
        role: byEmail.role,
        languages: byEmail.languages ?? [],
        states: byEmail.states ?? [],
        isActive: byEmail.is_active,
        avatarHue: byEmail.avatar_hue ?? 220,
      };
    }
  }

  return null;
}

/**
 * True when two profiles carry the same values.
 *
 * `onAuthStateChange` fires on every token refresh, and each fire re-reads the
 * profile and builds a fresh object. Handing that new reference to consumers
 * re-runs any effect that depends on `user` — which silently wiped the content
 * editor mid-edit, because its loader resets the item on every run. Comparing
 * by value lets the reference stay stable when nothing has really changed.
 */
function sameProfile(a: CmsUser, b: CmsUser): boolean {
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.fullName === b.fullName &&
    a.role === b.role &&
    a.isActive === b.isActive &&
    a.avatarHue === b.avatarHue &&
    a.languages.join() === b.languages.join() &&
    a.states.join() === b.states.join()
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CmsUser | null>(null);
  const [ready, setReady] = useState(false);

  const syncFromSession = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setUser(null);
      return;
    }

    /* Trust the server, not the copy in localStorage.
     *
     * `getSession()` reads the stored session and does not check it, so an
     * access token the server has stopped accepting still looks like a signed-
     * in user. Every query then goes out with a dead Bearer token and comes
     * back 401 — over and over, because nothing here treated that as a reason
     * to stop. The Studio sat on a screen that looked logged in and loaded
     * nothing, with the real answer only visible in the network tab.
     *
     * `getUser()` asks the server, so its error is the authoritative "this
     * session is finished". Signing out clears the stored token and drops the
     * editor on the login screen, which is both true and actionable. */
    const { data: userData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !userData?.user) {
      await supabase.auth.signOut().catch(() => {});
      setUser(null);
      return;
    }

    const authUser = userData.user;
    const userEmail = authUser?.email;

    let profile = await loadProfile(userId, userEmail);

    // If the account has no cms_users row yet (e.g. fresh Google OAuth signup), provision one.
    if (!profile && authUser) {
      let pendingRole: Role = "writer";
      if (typeof window !== "undefined") {
        const storedRole = localStorage.getItem("pending_oauth_role") as Role | null;
        if (
          storedRole &&
          ["super_admin", "chief_editor", "writer", "qa"].includes(storedRole)
        ) {
          pendingRole = storedRole;
        }
        localStorage.removeItem("pending_oauth_role");
      }

      const fullName =
        authUser.user_metadata?.full_name ||
        authUser.user_metadata?.name ||
        userEmail?.split("@")[0] ||
        "CMS Member";

      const { data: created, error: insertErr } = await supabase
        .from("cms_users")
        .insert({
          id: userId,
          email: userEmail ?? "",
          full_name: fullName,
          role: pendingRole,
          languages: ["en"],
          states: [],
          is_active: true,
          avatar_hue: Math.floor(Math.random() * 360),
        })
        .select("*")
        .maybeSingle();

      if (!insertErr && created) {
        profile = {
          id: created.id,
          email: created.email,
          fullName: created.full_name,
          role: created.role,
          languages: created.languages ?? [],
          states: created.states ?? [],
          isActive: created.is_active,
          avatarHue: created.avatar_hue ?? 220,
        };
      } else if (insertErr) {
        console.warn("CMS profile auto-provision note:", insertErr.message);
      }
    }

    // A signed-in account with no CMS profile (or a disabled one) drop session.
    if (!profile || !profile.isActive) {
      const isGoogleUser = authUser?.app_metadata?.provider === "google";
      await supabase.auth.signOut();
      setUser(null);

      if (isGoogleUser && !profile && typeof window !== "undefined") {
        const errorParams = new URLSearchParams(window.location.search);
        errorParams.set("error", "no-studio-profile");
        window.history.replaceState(null, "", `${window.location.pathname}?${errorParams.toString()}`);
      }
      return;
    }
    setUser((prev) => (prev && sameProfile(prev, profile) ? prev : profile));
  }, []);

  useEffect(() => {
    let alive = true;

    /* ── Fast boot ────────────────────────────────────────────────────
     *
     * `getSession()` reads the token cached in localStorage — it never
     * touches the network, so it returns in under 1 ms. That is enough
     * to render the shell (sidebar, topbar, and skeleton) immediately.
     *
     * `getUser()` is the authoritative check and runs in the background.
     * If the server says the session is dead, `syncFromSession` clears
     * the user and the next render lands on the login screen. The gap
     * between the two is invisible when the session is valid (the common
     * case) and only a brief flash when it is not (edge case: revoked
     * token).
     *
     * Previously both calls were sequential and blocking, which added
     * 1–3 s of spinner on every page load.
     */
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!alive) return;
        const uid = data.session?.user?.id;
        if (!uid) {
          setUser(null);
          setReady(true);
          return;
        }

        // Fast path: load the profile from the local session immediately
        // so the UI can render while the server check happens.
        const email = data.session?.user?.email;
        const profile = await loadProfile(uid, email);
        if (!alive) return;
        if (profile && profile.isActive) {
          setUser((prev) => (prev && sameProfile(prev, profile) ? prev : profile));
        }
        setReady(true);

        // Slow path: verify the session with the server in the background.
        // If it's invalid, syncFromSession will clear the user.
        syncFromSession(uid);
      })
      .catch(() => {
        if (alive) setReady(true);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      void syncFromSession(session?.user?.id);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [syncFromSession]);

  const login = useCallback(
    async (email: string, password: string, role: Role) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) return { ok: false as const, error: error.message };

      const profile = await loadProfile(data.user.id);
      if (!profile) {
        await supabase.auth.signOut();
        return {
          ok: false as const,
          error: "That account has no Studio profile yet — ask an admin to add you.",
        };
      }
      if (!profile.isActive) {
        await supabase.auth.signOut();
        return { ok: false as const, error: "That account has been deactivated." };
      }
      if (profile.role !== role) {
        await supabase.auth.signOut();
        return {
          ok: false as const,
          error: `This account signs in as ${profile.role.replace("_", " ")} — pick that role.`,
        };
      }
      setUser((prev) => (prev && sameProfile(prev, profile) ? prev : profile));
      return { ok: true as const };
    },
    []
  );

  const loginWithGoogle = useCallback(async (role?: Role) => {
    if (typeof window !== "undefined" && role) {
      localStorage.setItem("pending_oauth_role", role);
    }
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await syncFromSession(data.session?.user?.id);
  }, [syncFromSession]);

  const value = useMemo(
    () => ({ user, ready, login, loginWithGoogle, logout, refresh }),
    [user, ready, login, loginWithGoogle, logout, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const can = {
  publish: (r: Role) => r === "chief_editor" || r === "super_admin",
  review: (r: Role) => r === "qa" || r === "chief_editor" || r === "super_admin",
  /** QA approves NewsStudio articles into the app feed. */
  approveArticles: (r: Role) =>
    r === "qa" || r === "chief_editor" || r === "super_admin",
  curate: (r: Role) => r === "chief_editor" || r === "super_admin",
  manageUsers: (r: Role) => r === "super_admin",
  /**
   * See engagement numbers. Deliberately narrower than `review`: a writer
   * watching live like counts on their own work is a pressure nobody asked
   * for, and QA's job is whether a story is correct, not whether it did well.
   * The database agrees — the policies on content_reactions and
   * content_events name the same two roles, so hiding the panel is the
   * convenience and RLS is the boundary.
   */
  seeStats: (r: Role) => r === "chief_editor" || r === "super_admin",
  manageCategories: (r: Role) => r === "chief_editor" || r === "super_admin",
  editAny: (r: Role) => r === "chief_editor" || r === "super_admin",
  /**
   * Fix a submission during review rather than bouncing it back for a typo.
   * The database already permits this — content_update_reviewers covers the
   * same three roles — so this only decides whether the UI offers it.
   */
  editInReview: (r: Role) =>
    r === "qa" || r === "chief_editor" || r === "super_admin",
  /**
   * Rewrite the copy and photograph a NewsStudio article carries into the app.
   * Writers do the wordsmithing, QA and editors sign it off — everyone but a
   * reader, in practice. The pipeline database is never touched; the changes
   * are stored as overrides on article_selections.
   */
  editArticleCopy: (r: Role) =>
    r === "writer" || r === "qa" || r === "chief_editor" || r === "super_admin",
};
