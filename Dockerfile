# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build (web + server)
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
WORKDIR /app

# Manifests first so the dependency layer is cached between source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages ./packages
RUN pnpm build

# Production-only dependencies for the server. Server has no workspace deps, so
# `--legacy` (pnpm 10 requires it, or inject-workspace-packages=true) is fine.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @dmark-hole/server --prod deploy --legacy /out \
    && rm -rf /out/dist /out/src /out/test

# ---------------------------------------------------------------------------
# Stage 2: slim runtime
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0 \
    WEB_DIST=/app/web

WORKDIR /app/server
COPY --from=build --chown=node:node /out/ ./
COPY --from=build --chown=node:node /app/packages/server/dist ./dist
COPY --from=build --chown=node:node /app/packages/web/dist /app/web

RUN mkdir -p /data && chown node:node /data
USER node

VOLUME /data
# 8080: web UI + API. 2525: built-in SMTP receiver (only if SMTP_ENABLED=true).
EXPOSE 8080 2525

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
