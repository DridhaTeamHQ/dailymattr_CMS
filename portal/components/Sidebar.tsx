"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Newspaper,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { can, useAuth } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/content/articles", label: "Articles", icon: Newspaper },
  { href: "/content/pix", label: "Pix", icon: ImageIcon },
  { href: "/content/qix", label: "Qix", icon: Clapperboard },
  { href: "/content/trax", label: "Trax", icon: AudioLines },
  { href: "/review", label: "Review", icon: ShieldCheck, gate: "review" as const },
  { href: "/users", label: "Users", icon: Users, gate: "manageUsers" as const },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <aside className="sticky top-4 md:top-6 mt-4 md:mt-6 z-40 flex h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] w-[86px] shrink-0 self-start flex-col items-center rounded-[2rem] bg-ink py-6 shadow-(--shadow-lift)">
      <Link href="/dashboard" className="mb-8 block" title="DailyMattr Studio">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-lg font-extrabold text-white shadow-[0_8px_20px_rgba(57,121,255,0.5)]">
          M
        </div>
      </Link>

      <nav className="flex flex-1 flex-col items-center gap-2">
        {NAV.filter((n) => !n.gate || can[n.gate](user.role)).map((n) => {
          const active =
            pathname === n.href || pathname.startsWith(n.href + "/");
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              title={n.label}
              className="group relative flex h-11 w-11 items-center justify-center rounded-2xl"
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-2xl bg-white"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon
                size={19}
                className={`relative z-10 transition-colors ${
                  active
                    ? "text-ink"
                    : "text-white/45 group-hover:text-white"
                }`}
              />
              <span className="pointer-events-none absolute left-[58px] z-20 origin-left scale-90 rounded-lg bg-ink px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
                {n.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={logout}
        title="Sign out"
        className="mt-4 flex h-11 w-11 items-center justify-center rounded-2xl text-white/45 transition-colors hover:bg-white/10 hover:text-white"
      >
        <LogOut size={18} />
      </button>
    </aside>
  );
}
