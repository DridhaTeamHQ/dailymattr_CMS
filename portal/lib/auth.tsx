"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEMO_PASSWORD } from "./mock";
import { getUsers } from "./store";
import type { CmsUser, Role } from "./types";

const SESSION_KEY = "dailymattr-cms:session";

interface AuthCtx {
  user: CmsUser | null;
  ready: boolean;
  login: (
    email: string,
    password: string,
    role: Role
  ) => { ok: true } | { ok: false; error: string };
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  ready: false,
  login: () => ({ ok: false, error: "not ready" }),
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CmsUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) {
        const { userId } = JSON.parse(raw) as { userId: string };
        const u = getUsers().find((x) => x.id === userId && x.isActive);
        if (u) setUser(u);
      }
    } catch {
      /* fresh session */
    }
    setReady(true);
  }, []);

  const login = useCallback(
    (email: string, password: string, role: Role) => {
      const u = getUsers().find(
        (x) => x.email.toLowerCase() === email.trim().toLowerCase()
      );
      if (!u || !u.isActive)
        return { ok: false as const, error: "No active account with that email." };
      if (u.role !== role)
        return {
          ok: false as const,
          error: `This account is registered as ${u.role.replace("_", " ")}, not the selected role.`,
        };
      if (password !== DEMO_PASSWORD)
        return { ok: false as const, error: "Incorrect password. (Demo: mattr123)" };
      window.localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: u.id }));
      setUser(u);
      return { ok: true as const };
    },
    []
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem(SESSION_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, logout }),
    [user, ready, login, logout]
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
};
