# syntax=docker/dockerfile:1.7
#
# Multi-target Dockerfile for AgentForge.
#
#   Build core (slim):       docker build --target core     -t agentforge-core     .
#   Build platform (full):   docker build --target platform -t agentforge-platform .
#
# Core image runs the agentforge-core CLI (SQLite, local executor, dashboard).
# Platform image runs agentforge with Docker/Postgres/OTel/worker modes.

# ── Stage: deps — install all workspace deps (for building) ─────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/platform/package.json ./packages/platform/
RUN npm ci

# ── Stage: build — compile TS + build dashboard React app + copy runtime assets
FROM deps AS build
COPY packages/core/src/dashboard/app/package.json packages/core/src/dashboard/app/package-lock.json* ./packages/core/src/dashboard/app/
RUN cd packages/core/src/dashboard/app && npm ci
COPY tsconfig.base.json tsconfig.json ./
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/platform/tsconfig.json ./packages/platform/
COPY scripts/ ./scripts/
COPY packages/core/src/ ./packages/core/src/
COPY packages/platform/src/ ./packages/platform/src/
# Root build script runs: dashboard SPA → tsc --build (composite project refs)
# → copy-build-assets.mjs (YAML/MD/JSON templates + SPA bundle into dist/).
# Mirrors what npm publish produces, so Docker and npm ship identical trees.
RUN npm run build

# ── Stage: core-deps — core-only production node_modules (slim) ─────────────
# Installs just agentforge-core's deps in isolation (no workspace hoisting,
# no platform-only deps like pg/dockerode/OTel SDK). Uses a standalone
# lockfile (packages/core/package-lock.json) so builds are deterministic.
FROM node:20-alpine AS core-deps
WORKDIR /app/packages/core
COPY packages/core/package.json ./package.json
COPY packages/core/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ── Stage: platform-deps — full workspace production node_modules ───────────
FROM node:20-alpine AS platform-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/platform/package.json ./packages/platform/
RUN npm ci --omit=dev && npm cache clean --force

# ── Target: core — slim image (agentforge-core CLI only) ────────────────────
FROM node:20-alpine AS core
WORKDIR /app
COPY --from=core-deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=core-deps /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist/ ./packages/core/dist/
COPY --from=build /app/packages/core/src/dashboard/dist/ ./packages/core/src/dashboard/dist/
COPY .agentforge/ ./.agentforge/
RUN mkdir -p /app/output
ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["node", "packages/core/dist/cli/index.js"]
CMD ["dashboard", "--host", "0.0.0.0"]

# ── Target: platform — full image (agentforge CLI + worker mode) ────────────
FROM platform-deps AS platform
COPY --from=build /app/packages/core/dist/ ./packages/core/dist/
COPY --from=build /app/packages/platform/dist/ ./packages/platform/dist/
COPY --from=build /app/packages/core/src/dashboard/dist/ ./packages/core/src/dashboard/dist/
COPY .agentforge/ ./.agentforge/
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
RUN mkdir -p /app/output
ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["dashboard"]
