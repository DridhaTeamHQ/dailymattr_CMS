"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  AudioLines,
  BarChart3,
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
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    gate: "seeStats" as const,
  },
  { href: "/review", label: "Review", icon: ShieldCheck, gate: "review" as const },
  { href: "/users", label: "Users", icon: Users, gate: "manageUsers" as const },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <aside className="sticky top-4 md:top-6 mt-4 md:mt-6 z-40 flex h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] w-[86px] shrink-0 self-start flex-col items-center rounded-[2rem] bg-shell py-6 shadow-(--shadow-lift)">
      <Link href="/dashboard" className="mb-8 block" title="DailyMattr Studio">
        {/* Pinned to the brand blue rather than the accent token: dark mode
            lightens the accent for legibility on dark surfaces, which drops the
            white letter here to 2.97:1. The logo is the one place the colour
            should not follow the theme. */}
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#3979ff] text-lg font-extrabold text-white shadow-[0_8px_20px_rgba(57,121,255,0.5)]">
          M
        </div>
      </Link>

      {/* Scrolls only on short screens.
       *
       * The rail needs 644px for a super admin, who sees all nine entries, so
       * below a 692px viewport the content outgrew the fixed height and the
       * sign-out button was pushed clean out of the rounded shape and onto the
       * page behind it. A 1366x768 laptop sits right on that line.
       *
       * Applied by media query rather than always, because an overflow
       * container also clips its absolutely-positioned children sideways —
       * which is where the hover labels live. Above this height nothing needs
       * to scroll and the labels are unaffected; below it, a clipped label is
       * a far better trade than a sign-out button hanging off the end. The
       * native title attribute still names every item either way. */}
      <nav className="sidebar-nav flex flex-1 flex-col items-center gap-2 [@media(max-height:720px)]:min-h-0 [@media(max-height:720px)]:overflow-y-auto">
        {NAV.filter((n) => !n.gate || can[n.gate](user.role)).map((n) => {
          const active =
            pathname === n.href || pathname.startsWith(n.href + "/");
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              title={n.label}
              /* shrink-0 or the flex column squashes the icons to fit instead
                 of letting the nav scroll, which is the same crowding by a
                 different route. */
              className="group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
            >
              {active && (
                /* The sidebar is dark in both themes, so the active pill stays
                   light — that contrast is what marks the current page. */
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-2xl bg-white"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon
                size={19}
                className={`relative z-10 transition-colors ${
                  active ? "text-shell" : "text-white/45 group-hover:text-white"
                }`}
              />
              <span className="pointer-events-none absolute left-[58px] z-20 origin-left scale-90 rounded-lg bg-shell px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
                {n.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={logout}
        title="Sign out"
        className="mt-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white/45 transition-colors hover:bg-white/10 hover:text-white"
      >
        <LogOut size={18} />
      </button>
    </aside>
  );
}
