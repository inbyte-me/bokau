# A party server: rooms only (the phone app, the party API, the rooms' media), never the studio.
# Build:  docker build -t doblaje-party .
# Run:    see docs/deployment.md (docker-compose.yml puts HTTPS and a domain in front of it).
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# only what a party server needs (not the desktop shell and its Electron download)
RUN pnpm install --frozen-lockfile --filter @doblaje/server... --filter @doblaje/play...
# only the phone app is needed in a party server (the studio app is for the desktop)
RUN pnpm --filter @doblaje/play build

FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV DOBLAJE_MODE=party \
    HOST=0.0.0.0 \
    PORT=5177 \
    DOBLAJE_DATA=/data \
    DOBLAJE_MODELS=/data/models
VOLUME /data
EXPOSE 5177
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5177)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "apps/server/src/main.ts"]
