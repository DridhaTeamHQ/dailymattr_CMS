# Deploying DailyMattr Studio to Railway

Railway rather than Vercel for one concrete reason: the video import shells out
to Python and yt-dlp, and the downloader asks for `bv*+ba` — separate video and
audio streams — which needs ffmpeg to merge. Vercel has none of the three, and
caps function duration below this route's 180-second job timeout. Railway runs a
container, so all three are just installed.

## Setting it up

1. **New project → Deploy from GitHub repo**, pointed at `DridhaTeamHQ/dailymattr_CMS`.
2. **Settings → Root Directory: `portal`.** The app is not at the repository
   root. `railway.json` and `Dockerfile` both live in `portal/`, so Railway finds
   them once the root is set.
3. **Add the four variables** below before the first deploy.
4. **Settings → Networking → Generate Domain.**

## Variables

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ijnlvyctwgdvsedpejva.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key, Supabase → Project Settings → API |
| `NEXT_PUBLIC_NEWSSTUDIO_URL` | `https://ygxdrphajvrbjcaxhvcn.supabase.co` |
| `NEXT_PUBLIC_NEWSSTUDIO_ANON_KEY` | publishable key for the pipeline project |

These are read by `next build`, not at runtime — the values are compiled into the
browser bundle. Set them before the first build or you get a bundle that cannot
reach Supabase. They are publishable keys and are meant to be in the browser; RLS
is what protects the data.

`PYTHON_BIN` is already set to `python3` in the Dockerfile. Do not remove it: the
route defaults to `python`, which does not exist on Debian, and the failure reads
like a missing dependency rather than a wrong name.

## Resources

Give the service **at least 1 GB of memory**. `scrape-video` reads the downloaded
file into memory before uploading it, up to a 200 MB cap, and Node needs headroom
above that.

No volume is needed. Uploads go to Supabase Storage, and the downloader writes to
a temp directory it deletes afterwards.

## After deploying

Run the API suite against the deployed URL:

```bash
BASE=https://your-app.up.railway.app node scripts/test-api.mjs
```

42 checks: input validation, auth, SSRF refusal, path traversal, rate limiting.

## Known limits

**Rate limiting is per-instance and in memory.** `lib/rate-limit.ts` keeps its
counters in a `Map`, so every deploy resets them, and if the service is scaled to
more than one replica each replica enforces its own limits — the effective
ceiling multiplies by the replica count. Fine on a single instance; move the
counters to Postgres or Redis before scaling horizontally.

**yt-dlp needs updating.** YouTube and Instagram change their internals often and
yt-dlp is pinned at image build time, so imports start failing until the image is
rebuilt. Redeploying picks up the current version.

**Instagram may ask for cookies.** The route already reports this as
`needs_cookies` with a 403 rather than a generic failure.
