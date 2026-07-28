"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

const KEY = "dailymattr-studio:theme";

interface ThemeCtx {
  choice: ThemeChoice;
  resolved: Resolved;
  setChoice: (c: ThemeChoice) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({
  choice: "system",
  resolved: "light",
  setChoice: () => {},
  toggle: () => {},
});

const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Applies the theme to <html>.
 *
 * `data-theme` drives this portal's own tokens; the `dark` class is what
 * shadcn's variant keys off. Both are set together so the two palettes can
 * never disagree about what a surface looks like.
 */
function apply(resolved: Resolved) {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<Resolved>("light");

  // Read the stored choice once, then keep <html> in step with it.
  useEffect(() => {
    const stored = window.localStorage.getItem(KEY) as ThemeChoice | null;
    const initial: ThemeChoice =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
    setChoiceState(initial);
  }, []);

  useEffect(() => {
    const next: Resolved =
      choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice;
    setResolved(next);
    apply(next);
  }, [choice]);

  // Following the OS only makes sense while the user hasn't chosen for
  // themselves, so the listener is only live on "system".
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next: Resolved = mq.matches ? "dark" : "light";
      setResolved(next);
      apply(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = useCallback((c: ThemeChoice) => {
    window.localStorage.setItem(KEY, c);
    setChoiceState(c);
  }, []);

  const toggle = useCallback(() => {
    setChoice(
      (choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice) ===
        "dark"
        ? "light"
        : "dark"
    );
  }, [choice, setChoice]);

  const value = useMemo(
    () => ({ choice, resolved, setChoice, toggle }),
    [choice, resolved, setChoice, toggle]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/**
 * Runs before paint so a dark-mode reload doesn't flash a white page. Inlined
 * in <head>; it reads the same key the provider writes.
 */
export const THEME_BOOTSTRAP = `(function(){try{var c=localStorage.getItem('${KEY}');var d=c==='dark'||((!c||c==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');r.classList.toggle('dark',d);}catch(e){}})();`;
