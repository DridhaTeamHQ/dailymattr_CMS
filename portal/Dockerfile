# DailyMattr Studio.
#
# Debian rather than Alpine: this image has to carry ffmpeg and yt-dlp for the
# video import, and both are far better behaved on glibc. The image is larger,
# but "the deploy works" beats "the deploy is small".
#
# Build context is this folder (portal/), not the repository root.

# ── deps ────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` needs the lockfile; fall back for a checkout that lacks one.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── build ───────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are baked into the browser bundle by `next build`, so
# they must be present *here*, not just at runtime. Railway passes service
# variables to the build for each ARG declared below. Miss one and the build
# still succeeds — it just produces a bundle that cannot reach Supabase, which
# is why lib/supabase.ts throws loudly instead of failing quietly at runtime.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_NEWSSTUDIO_URL
ARG NEXT_PUBLIC_NEWSSTUDIO_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_NEWSSTUDIO_URL=$NEXT_PUBLIC_NEWSSTUDIO_URL \
    NEXT_PUBLIC_NEWSSTUDIO_ANON_KEY=$NEXT_PUBLIC_NEWSSTUDIO_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0
# The route defaults to `python`, which does not exist on Debian — only
# `python3`. Without this every import fails with "Python isn't available on
# the server", which reads like a missing dependency rather than a wrong name.
ENV PYTHON_BIN=python3

# ffmpeg is not optional: the downloader asks for `bv*+ba`, separate video and
# audio streams, and merging them into the mp4 is ffmpeg's job.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && apt-get purge -y python3-pip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Run as the node user rather than root.
RUN mkdir -p /app && chown -R node:node /app
USER node

# server.js does not carry public/ or .next/static — the docs are explicit that
# those are expected to come from a CDN — so they are copied in beside it.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Spawned by path at runtime, so file tracing never saw it.
COPY --from=builder --chown=node:node /app/scripts ./scripts

EXPOSE 3000
CMD ["node", "server.js"]
