"use client";

import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ROLE_META } from "@/lib/types";
import { Avatar, Pill } from "./ui";

export default function Topbar() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <header className="mb-6 flex items-center justify-between gap-4">
      <div className="relative w-full max-w-sm">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
        />
        <input
          className="field !rounded-full !bg-white py-2.5 pl-10 shadow-(--shadow-soft)"
          placeholder="Search content…"
          onChange={() => {}}
        />
      </div>

      <div className="flex items-center gap-3">
        <Pill tone="accent">{ROLE_META[user.role].label}</Pill>
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
