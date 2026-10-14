# A party server: the phone app, the party API and rooms' media, plus (for signed-in people) the studio app on their own library.
# Build:  docker build -t doblaje-party .
# Run:    see docs/deployment.md (docker-compose.yml puts HTTPS and a domain in front of it).
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# only what the server needs (not the desktop shell and its Electron download)
RUN pnpm install --frozen-lockfile --filter @doblaje/server... --filter @doblaje/play... --filter @doblaje/web...
# the phone app (/play/) and the studio app (/studio/, behind sign-in)
RUN pnpm --filter @doblaje/play --filter @doblaje/web build

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
# the data folder belongs to the user the server runs as, so a new volume (which copies this folder's owner) is writable
RUN mkdir -p /data/models && chown -R node:node /data
VOLUME /data
EXPOSE 5177
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5177)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "apps/server/src/main.ts"]
