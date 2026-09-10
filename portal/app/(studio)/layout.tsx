"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { useAuth } from "@/lib/auth";
import { ANALYTICS_HOME, allowedPath } from "@/lib/mode";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    /* Analytics-only mode: everything else in the studio sends you to the one
       page on offer. Presentation, not security — the routes are still there,
       and a build with the flag off serves them again. */
    if (!allowedPath(pathname)) router.replace(ANALYTICS_HOME);
  }, [ready, user, router, pathname]);

  /* Held on the spinner rather than flashing the page that is about to be
     redirected away from. */
  if (!ready || !user || !allowedPath(pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-3 border-line border-t-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1440px] items-start gap-6 px-4 pb-4 md:px-6 md:pb-6">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <Topbar />
        {/* Keyed so each route still animates in, but deliberately not wrapped
            in AnimatePresence.

            It was <AnimatePresence mode="wait"> with an exit animation, which
            holds the incoming page back until the outgoing one has finished
            leaving. Every page here early-returns a skeleton while its data
            loads, so the tree churns during a navigation — and an exit that
            gets interrupted never completes, so the next page is never mounted
            and the content area stays empty until a reload rebuilds the tree.

            A 0.32s slide on the way out is not worth a blank page. */}
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
