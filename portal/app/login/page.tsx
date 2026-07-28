"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ROLE_META, type Role } from "@/lib/types";

const ROLES: Role[] = ["super_admin", "chief_editor", "writer", "qa"];

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const [role, setRole] = useState<Role>("writer");
  // Nothing is pre-filled: the sign-in page shouldn't publish who has accounts.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  const pickRole = (r: Role) => {
    setRole(r);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await login(email, password, role);
    if (res.ok) router.replace("/dashboard");
    else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* ambient backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-accent/12 blur-3xl" />
        <div className="absolute -right-40 -bottom-40 h-[480px] w-[480px] rounded-full bg-violet/10 blur-3xl" />
      </div>

      <div className="relative z-10 grid w-full max-w-4xl gap-8 md:grid-cols-[1.05fr_1fr]">
        {/* left: brand */}
        <motion.div
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
          className="hidden flex-col justify-center md:flex"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-shell text-xl font-extrabold text-white">
              M
            </div>
            <div>
              <div className="text-lg leading-tight font-extrabold">
                DailyMattr <span className="text-accent">Studio</span>
              </div>
              <div className="text-xs font-medium tracking-widest text-faint uppercase">
                Content Management
              </div>
            </div>
          </div>
          <h1 className="text-4xl leading-[1.08] font-extrabold tracking-tight">
            Read. Listen. Watch.
            <br />
            <span className="text-muted">You publish it all.</span>
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
            The uploading platform behind the DailyMattr app — curate NewsStudio
            articles, and craft Pix, Qix &amp; Trax with a QA-gated publishing
            flow.
          </p>
          <div className="mt-8 flex gap-2">
            {["Articles", "Pix", "Qix", "Trax"].map((t, i) => (
              <motion.span
                key={t}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.09 }}
                className="pill bg-card text-ink shadow-(--shadow-soft)"
              >
                {t}
              </motion.span>
            ))}
          </div>
        </motion.div>

        {/* right: form card */}
        <motion.div
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1], delay: 0.08 }}
          className="card p-8"
        >
          <h2 className="text-xl font-bold">Sign in to Studio</h2>
          <p className="mt-1 mb-6 text-sm text-muted">
            Access your role-based dashboard
          </p>

          <div className="label mb-2">Select your role</div>
          <div className="mb-5 grid grid-cols-2 gap-2">
            {ROLES.map((r) => {
              const active = role === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => pickRole(r)}
                  className={`relative rounded-2xl border px-3 py-2.5 text-left transition-all ${
                    active
                      ? "border-accent bg-tint shadow-[0_0_0_4px_rgba(57,121,255,0.10)]"
                      : "border-line bg-[#fafafc] hover:border-faint"
                  }`}
                >
                  <div
                    className={`text-[13px] font-bold ${active ? "text-accent" : ""}`}
                  >
                    {ROLE_META[r].label}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted">
                    {ROLE_META[r].blurb}
                  </div>
                </button>
              );
            })}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <div className="label mb-2">Email address</div>
              <div className="relative">
                <Mail
                  size={15}
                  className="absolute top-1/2 left-4 -translate-y-1/2 text-faint"
                />
                <input
                  className="field pl-10"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>
            <div>
              <div className="label mb-2">Password</div>
              <div className="relative">
                <Lock
                  size={15}
                  className="absolute top-1/2 left-4 -translate-y-1/2 text-faint"
                />
                <input
                  className="field pr-11 pl-10"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute top-1/2 right-3.5 -translate-y-1/2 text-faint hover:text-ink"
                  aria-label="Toggle password visibility"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-[13px] font-medium text-rose"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={busy}
              className="btn-accent flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-60"
            >
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <>
                  Sign in to Dashboard <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-faint">
            Trouble signing in? Ask a Studio administrator to check your access.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
