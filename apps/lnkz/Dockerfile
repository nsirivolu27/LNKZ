FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json build.mjs ./
COPY src ./src
RUN pnpm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/aws-rds-global-bundle.pem
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl \
  && curl --fail --silent --show-error --location \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    --output /etc/ssl/certs/aws-rds-global-bundle.pem \
  && apt-get purge --yes --auto-remove curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system lnkz \
  && useradd --system --gid lnkz --home-dir /app --shell /usr/sbin/nologin lnkz
COPY --from=build --chown=lnkz:lnkz /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --from=build --chown=lnkz:lnkz /app/dist ./dist
RUN mkdir -p /app/.data && chown lnkz:lnkz /app/.data
USER lnkz
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
