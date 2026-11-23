# syntax=docker/dockerfile:1
#
# Agent Party — 多人 AI 实时虚拟办公室

# ---------------------------------------------------------------------------------------------
# Stage 1: Build client (Vite) and bundle server (esbuild) into dist/.
# ---------------------------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --registry=${NPM_REGISTRY}

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------------------------
# Stage 2: Minimal production runtime.
# ---------------------------------------------------------------------------------------------
FROM node:24-alpine AS runtime

RUN apk add --no-cache curl

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4747 \
    AGENT_PARTY_DATA_DIR=/data \
    PUBLIC_URL="" \
    AUTO_IMPORT_CODEX_PETS=0

WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets/default-pets ./assets/default-pets

RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 4747
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4747/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "dist/server/index.js"]
