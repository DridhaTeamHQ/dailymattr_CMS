"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { useAuth } from "@/lib/auth";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) {
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
        <AnimatePresence mode="wait">
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}
