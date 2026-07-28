"use client";

import { Moon, Search, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { ROLE_META } from "@/lib/types";
import { Avatar, Pill } from "./ui";

export default function Topbar() {
  const { user } = useAuth();
  const { resolved, toggle } = useTheme();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-50 mb-6 flex items-center justify-between gap-4 bg-canvas pt-4 md:pt-6 pb-3 transition-all">
      <div className="relative w-full max-w-sm">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
        />
        <input
          className="field !rounded-full !bg-card py-2.5 pl-10 shadow-(--shadow-soft)"
          placeholder="Search content…"
          onChange={() => {}}
        />
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
