# The application image: API, workers, and the built web client, in one
# container. Built from the repository root, not from server/, because the Yarn
# workspace root holds the lockfile that pins every package.
#
#   docker build -f server/Dockerfile .

# ---------------------------------------------------------------- dependencies

FROM node:22-alpine AS deps

WORKDIR /app

# This repository pins Yarn 4 through `packageManager`, and the release itself
# is committed under .yarn/releases. Copying it in means the build never
# reaches the network for a package manager, and never falls back to the Yarn 1
# shim that ships in the Node image — which cannot read this lockfile at all.
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases .yarn/releases

# Manifests only, so editing a source file does not invalidate the install layer.
COPY server/package.json server/
COPY web/package.json web/

# Prisma's engines are built against glibc and need OpenSSL present even on
# Alpine; without these the client fails at generate time, not at runtime,
# which makes the error look like a build script problem instead.
RUN apk add --no-cache libc6-compat openssl \
 && corepack enable \
 && yarn install --immutable

# --------------------------------------------------------------- server build

FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl && corepack enable

# Yarn hoists the whole workspace into one tree at the root; there are no
# per-package node_modules directories to copy.
COPY --from=deps /app/node_modules node_modules
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases .yarn/releases
COPY server server

WORKDIR /app/server

# `build` runs `prisma generate` first, emitting the client into
# src/generated/prisma before nest compiles against it.
RUN yarn build

# ------------------------------------------------------------------ web build

FROM node:22-alpine AS web

WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules node_modules
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases .yarn/releases
COPY web web

WORKDIR /app/web

RUN yarn build

# -------------------------------------------------------------------- runtime

FROM node:22-alpine AS runtime

WORKDIR /app/server

ENV NODE_ENV=production

# ffmpeg transcodes video and pulls poster frames; exiftool reads the metadata
# the timeline groups by. Both are invoked as binaries, so they have to be in
# the image rather than in a package.
RUN apk add --no-cache libc6-compat openssl ffmpeg exiftool tini

# One hoisted tree at /app/node_modules; Node walks up from /app/server to
# find it, so the app needs no node_modules of its own.
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/src/generated ./src/generated
COPY --from=build /app/server/package.json ./package.json
COPY package.json /app/package.json

# The client is served by the app itself, from dist/../www — one container
# rather than an app image plus a separate web server. main.ts mounts this
# directory only when it exists, so a source checkout still uses Vite.
COPY --from=web /app/web/dist ./www

# The library lives here by default. It is a mount point, not storage baked
# into the image: point MEDIA_LOCATION elsewhere and bind that path in, and
# the whole library moves with it.
ENV MEDIA_LOCATION=/data
RUN mkdir -p /data

EXPOSE 3001

# Migrations run at boot rather than at build time, so an existing install
# picks up its own schema changes when it pulls a newer tag.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main"]
