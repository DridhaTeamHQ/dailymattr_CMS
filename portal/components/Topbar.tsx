"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Moon, Search, Sun, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { editorHref, quickSearch, type QuickHit } from "@/lib/db";
import { KIND_META, ROLE_META } from "@/lib/types";
import { Avatar, Pill, StatusPill } from "./ui";

export default function Topbar() {
  const { user } = useAuth();
  const { resolved, toggle } = useTheme();
  const router = useRouter();

  /* This box used to be `onChange={() => {}}` — a search-shaped decoration you
     could type a whole headline into and watch nothing happen. It now reaches
     across every kind the Studio holds, because the thing you cannot do from a
     section's own search is find a story when you have forgotten which section
     it was filed in. */
  const [query, setQuery] = useState("");
  /* The term is kept beside its results rather than in a second state.
     Results that arrived for "buda" must not be shown under "budapest" — and
     comparing the two is also what lets the effect avoid clearing state
     synchronously on every keystroke. */
  const [hits, setHits] = useState<{ term: string; rows: QuickHit[] }>({
    term: "",
    rows: [],
  });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const q = query.trim();

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    /* Cancelled by the flag as well as the timer: a slow request from two
       keystrokes ago must not overwrite the results of the current one. */
    let live = true;
    const t = setTimeout(() => {
      quickSearch(term)
        .then((rows) => {
          if (live) setHits({ term, rows });
        })
        .catch(() => {
          if (live) setHits({ term, rows: [] });
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  // Clicking anywhere else puts it away — including on the result you just took.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (!user) return null;

  const go = (h: QuickHit) => {
    setOpen(false);
    setQuery("");
    router.push(editorHref(h.kind, h.id));
  };

  const showing = open && q.length >= 2;
  // Results only count once they are the ones asked for.
  const ready = hits.term === q;

  return (
    <header className="sticky top-0 z-50 mb-6 flex items-center justify-between gap-4 bg-canvas pt-4 md:pt-6 pb-3 transition-all">
      <div ref={box} className="relative w-full max-w-sm">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
        />
        <input
          className="field !rounded-full !bg-card py-2.5 pr-10 pl-10 shadow-(--shadow-soft)"
          placeholder="Search content…"
          aria-label="Search all content"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            // Enter takes the first hit — the common case is one obvious match.
            if (e.key === "Enter" && ready && hits.rows[0]) go(hits.rows[0]);
          }}
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            aria-label="Clear search"
            title="Clear search"
            className="absolute top-1/2 right-4 -translate-y-1/2 text-faint transition-colors hover:text-ink"
          >
            <X size={14} />
          </button>
        )}

        {showing && (
          <div className="card absolute top-full right-0 left-0 mt-2 max-h-80 overflow-y-auto p-1.5 shadow-(--shadow-soft)">
            {!ready ? (
              <p className="px-3 py-4 text-center text-[12px] text-muted">
                Searching…
              </p>
            ) : hits.rows.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-muted">
                Nothing matches “{q}”
              </p>
            ) : (
              hits.rows.map((h) => (
                <Link
                  key={h.id}
                  href={editorHref(h.kind, h.id)}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-canvas"
                >
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[13px] font-bold">
                      {h.title}
                    </span>
                    <span className="text-[11px] text-faint">
                      {KIND_META[h.kind].label}
                    </span>
                  </span>
                  <StatusPill status={h.status} />
                </Link>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          title={resolved === "dark" ? "Switch to light" : "Switch to dark"}
          aria-label={resolved === "dark" ? "Switch to light" : "Switch to dark"}
          className="btn-ghost flex h-9 w-9 shrink-0 items-center justify-center !p-0"
        >
          {resolved === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <Pill tone="accent" >{ROLE_META[user.role].label}</Pill>
        <div className="card flex items-center gap-3 rounded-full! px-2 py-1.5 pr-4">
          <Avatar name={user.fullName} hue={user.avatarHue} size={32} />
          <div className="leading-tight">
            <div className="text-[13px] font-bold">{user.fullName}</div>
            <div className="text-[11px] text-muted">{user.email}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
