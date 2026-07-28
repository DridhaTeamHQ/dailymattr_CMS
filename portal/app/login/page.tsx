"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ROLE_META, type Role } from "@/lib/types";

const ROLES: Role[] = ["super_admin", "chief_editor", "writer", "qa"];

export default function LoginPage() {
  const { user, ready, login, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [role, setRole] = useState<Role>("writer");
  // Nothing is pre-filled: the sign-in page shouldn't publish who has accounts.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("error") === "auth-callback-failed") {
        setError("Google authentication failed or was cancelled. Please try again.");
      } else if (params.get("error") === "no-studio-profile") {
        setError(
          "That Google account has no Studio profile yet. Ask an admin to add your email in Team settings."
        );
      }
    }
  }, []);

  const pickRole = (r: Role) => {
    setRole(r);
    setError(null);
  };

  const handleGoogleSignIn = async () => {
    setGoogleBusy(true);
    setError(null);
    const res = await loginWithGoogle(role);
    if (!res.ok && res.error) {
      setError(res.error);
      setGoogleBusy(false);
    }
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
                      : "border-line bg-field hover:border-faint"
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

          <div className="mb-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleBusy || busy}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-line bg-white py-3 text-sm font-semibold text-ink shadow-sm transition-all hover:bg-slate-50 hover:border-faint disabled:opacity-60"
            >
              {googleBusy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/40 border-t-accent" />
              ) : (
                <>
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </>
              )}
            </button>
          </div>

          <div className="relative my-4 flex items-center justify-center text-[11px] font-semibold text-faint uppercase">
            <span className="w-full border-t border-line" />
            <span className="absolute bg-card px-2 tracking-wider">
              or use password
            </span>
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
              disabled={busy || googleBusy}
              className="btn-accent flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-60"
            >
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <>
                  Sign in with Password <ArrowRight size={15} />
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
