# syntax=docker/dockerfile:1

# ---- build: full dependency set + TypeScript compile -------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- deps: production dependencies only ---------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: small, non-root, no build tooling --------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
# Liveness probe (does not touch the database). Orchestrators should also use /api/v1/health/ready.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `node` directly (not `npm start`) so SIGTERM reaches the app and graceful shutdown runs.
CMD ["node", "dist/main.js"]
