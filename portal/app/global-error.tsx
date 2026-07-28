"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
          <h2 className="text-xl font-bold">Something went wrong</h2>
          <p className="text-sm text-gray-500">{error.message}</p>
          <button
            onClick={() => reset()}
            className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
