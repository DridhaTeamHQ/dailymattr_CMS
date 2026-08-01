"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
    // A render that failed hard enough to reach a boundary is the most useful
    // report there is, and it was going no further than this console.
    reportError(error, "boundary", error.digest);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="text-sm text-gray-500">{error?.message}</p>
      <button
        onClick={() => reset()}
        className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
      >
        Try again
      </button>
    </div>
  );
}
