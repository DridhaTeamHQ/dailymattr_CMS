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
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  ready: false,
  login: async () => ({ ok: false, error: "not ready" }),
  logout: async () => {},
  refresh: async () => {},
});

async function loadProfile(userId: string): Promise<CmsUser | null> {
  const { data, error } = await supabase
    .from("cms_users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
    languages: data.languages ?? [],
    states: data.states ?? [],
    isActive: data.is_active,
    avatarHue: data.avatar_hue ?? 220,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CmsUser | null>(null);
  const [ready, setReady] = useState(false);

  const syncFromSession = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setUser(null);
      return;
    }
    const profile = await loadProfile(userId);
    // A signed-in account with no CMS profile (or a disabled one) has no
    // business in the Studio — drop the session rather than show a broken shell.
    if (!profile || !profile.isActive) {
      await supabase.auth.signOut();
      setUser(null);
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
      // The role picker is a shortcut, not a second credential — but a mismatch
      // usually means the wrong tile was tapped, so say so plainly.
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

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await syncFromSession(data.session?.user?.id);
  }, [syncFromSession]);

  const value = useMemo(
    () => ({ user, ready, login, logout, refresh }),
    [user, ready, login, logout, refresh]
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
};
