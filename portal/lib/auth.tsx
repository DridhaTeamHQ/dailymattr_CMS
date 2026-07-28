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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CmsUser | null>(null);
  const [ready, setReady] = useState(false);

  const syncFromSession = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setUser(null);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const authUser = userData?.user;
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
    setUser(profile);
  }, []);

  useEffect(() => {
    let alive = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!alive) return;
        await syncFromSession(data.session?.user?.id);
      })
      .finally(() => {
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
      setUser(profile);
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
