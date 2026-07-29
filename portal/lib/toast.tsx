"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Info, X } from "lucide-react";

/**
 * Action feedback.
 *
 * Most actions here save to a database and then look identical to a click that
 * did nothing — the row updates, the list refetches, and nothing says so. These
 * are the confirmations.
 *
 * Errors do not auto-dismiss. A success can be missed harmlessly; a failure that
 * vanishes after four seconds leaves someone believing work was saved when it
 * was not, which is the failure this whole thing exists to prevent.
 */

type Tone = "success" | "error" | "info";

type Toast = {
  id: number;
  tone: Tone;
  message: string;
  /** Extra context — the reason a save failed, usually. */
  detail?: string;
};

type ToastInput = string | { message: string; detail?: string };

interface ToastCtx {
  success: (t: ToastInput) => void;
  error: (t: ToastInput) => void;
  info: (t: ToastInput) => void;
  /** Runs `fn`, announcing either outcome. Returns false if it threw. */
  run: (
    fn: () => Promise<unknown>,
    messages: { success: string; error?: string }
  ) => Promise<boolean>;
}

const Ctx = createContext<ToastCtx | null>(null);

/** Long enough to read a sentence, short enough not to sit in the way. */
const DISMISS_MS = 4_000;

/** Beyond this the oldest goes, so a burst cannot fill the screen. */
const MAX_VISIBLE = 4;

const normalise = (t: ToastInput) =>
  typeof t === "string" ? { message: t } : t;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, input: ToastInput) => {
      const id = nextId.current++;
      const toast: Toast = { id, tone, ...normalise(input) };
      setToasts((list) => [...list, toast].slice(-MAX_VISIBLE));

      // Errors stay until dismissed. See the note at the top of the file.
      if (tone !== "error") {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), DISMISS_MS)
        );
      }
    },
    [dismiss]
  );

  // A timer firing after unmount would set state on a dead component.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastCtx>(
    () => ({
      success: (t) => push("success", t),
      error: (t) => push("error", t),
      info: (t) => push("info", t),
      run: async (fn, messages) => {
        try {
          await fn();
          push("success", messages.success);
          return true;
        } catch (e) {
          push("error", {
            message: messages.error ?? "That didn't save.",
            // The database's own wording is usually the useful part — a policy
            // refusal names the rule that stopped it.
            detail: e instanceof Error ? e.message : String(e),
          });
          return false;
        }
      },
    }),
    [push]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const TONE = {
  success: { icon: Check, cls: "text-mint", ring: "ring-mint/25" },
  error: { icon: AlertTriangle, cls: "text-rose", ring: "ring-rose/30" },
  info: { icon: Info, cls: "text-accent", ring: "ring-accent/25" },
} as const;

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    // pointer-events-none on the stack, auto on each toast: the column spans a
    // good part of the screen and must not swallow clicks meant for the page.
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      aria-live="polite"
      aria-relevant="additions"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const { icon: Icon, cls, ring } = TONE[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
              // Errors are announced immediately; a success can wait for a pause.
              role={t.tone === "error" ? "alert" : "status"}
              className={`card pointer-events-auto flex w-full max-w-sm items-start gap-3 p-3.5 shadow-(--shadow-lift) ring-1 ${ring}`}
            >
              <span className={`mt-px shrink-0 ${cls}`}>
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug font-semibold text-ink">
                  {t.message}
                </p>
                {t.detail && (
                  <p className="mt-0.5 text-[11px] leading-snug break-words text-muted">
                    {t.detail}
                  </p>
                )}
              </div>
              <button
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
                className="-m-1 shrink-0 rounded-lg p-1 text-faint transition-colors hover:bg-canvas hover:text-ink"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
