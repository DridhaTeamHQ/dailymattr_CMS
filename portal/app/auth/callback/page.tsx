"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // Check if session is already active or gets established by Supabase client
    const checkAuth = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (mounted) setErrorMsg(error.message);
        return;
      }
      if (data.session && mounted) {
        router.replace("/dashboard");
      }
    };

    checkAuth();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && mounted) {
        router.replace("/dashboard");
      }
    });

    // Fallback timeout in case auth fails or is cancelled
    const timeout = setTimeout(() => {
      if (mounted && !user) {
        supabase.auth.getSession().then(({ data }) => {
          if (!data.session) {
            router.replace("/login?error=auth-callback-failed");
          }
        });
      }
    }, 6000);

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router, user]);

  useEffect(() => {
    if (ready && user) {
      router.replace("/dashboard");
    }
  }, [ready, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafc] p-6">
      <div className="card flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        {errorMsg ? (
          <>
            <p className="text-sm font-medium text-rose">{errorMsg}</p>
            <button
              onClick={() => router.replace("/login")}
              className="btn-accent px-4 py-2 text-xs"
            >
              Return to Login
            </button>
          </>
        ) : (
          <>
            <div className="h-9 w-9 animate-spin rounded-full border-3 border-accent border-t-transparent" />
            <div>
              <p className="font-bold text-ink">Completing Google Sign In</p>
              <p className="mt-1 text-xs text-muted">
                Setting up your Studio session...
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
