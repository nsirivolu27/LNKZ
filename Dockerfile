FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json build.mjs ./
COPY src ./src
RUN pnpm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
RUN groupadd --system lnkz && useradd --system --gid lnkz --home-dir /app --shell /usr/sbin/nologin lnkz
COPY --from=build --chown=lnkz:lnkz /app/package.json /app/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --from=build --chown=lnkz:lnkz /app/dist ./dist
COPY scripts/container-entrypoint.sh /usr/local/bin/lnkz-entrypoint
RUN chmod 755 /usr/local/bin/lnkz-entrypoint
RUN mkdir -p /app/.data && chown lnkz:lnkz /app/.data
ENTRYPOINT ["/usr/local/bin/lnkz-entrypoint"]
EXPOSE 3100
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
