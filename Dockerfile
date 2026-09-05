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
RUN groupadd --system lnkz && useradd --system --gid lnkz --home-dir /app --shell /usr/sbin/nologin lnkz
COPY --from=build --chown=lnkz:lnkz /app/package.json /app/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --from=build --chown=lnkz:lnkz /app/dist ./dist
RUN mkdir -p /app/.data && chown lnkz:lnkz /app/.data
USER lnkz
EXPOSE 3100
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
