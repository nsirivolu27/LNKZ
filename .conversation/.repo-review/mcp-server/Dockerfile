# Two build stages so the runtime image carries no toolchain and no dev dependencies.
FROM node:22-alpine AS web-build
WORKDIR /workspace
COPY package.json package-lock.json index.html console.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build:web

FROM node:22-alpine AS server-build
WORKDIR /workspace/mcp-server
COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci
COPY mcp-server/tsconfig.json ./
COPY mcp-server/src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100 \
    WEB_DIST_DIR=/app/public \
    LNKZ_DB_FILE=/app/data/lnkz.db
WORKDIR /app
COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown -R node:node /app
COPY --from=server-build /workspace/mcp-server/dist ./dist
COPY --from=web-build /workspace/dist ./public
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=4s --start-period=8s \
  CMD wget -q -O - http://127.0.0.1:3100/health || exit 1
CMD ["node", "dist/server.js"]
