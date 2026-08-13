# The API and worker image. The web client builds into its own Nginx container.
# Built from the repository root, not from server/, because the Yarn workspace
# root holds the lockfile that pins every package.
#
#   docker build -f server/Dockerfile .

# ---------------------------------------------------------------- dependencies

FROM node:22-alpine AS deps

WORKDIR /src

# This repository pins Yarn 4 through `packageManager`, and the release itself
# is committed under .yarn/releases. Copying it in means the build never
# reaches the network for a package manager, and never falls back to the Yarn 1
# shim that ships in the Node image — which cannot read this lockfile at all.
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases .yarn/releases

# Manifests only, so editing a source file does not invalidate the install layer.
COPY server/package.json server/
COPY app/package.json app/
COPY mobile/package.json mobile/

# Prisma's engines are built against glibc and need OpenSSL present even on
# Alpine; without these the client fails at generate time, not at runtime,
# which makes the error look like a build script problem instead.
RUN apk add --no-cache libc6-compat openssl \
 && corepack enable \
 && yarn install --immutable

# --------------------------------------------------------------- server build

FROM node:22-alpine AS build

WORKDIR /src

RUN apk add --no-cache libc6-compat openssl && corepack enable

# Yarn hoists the whole workspace into one tree at the root; there are no
# per-package node_modules directories to copy.
COPY --from=deps /src/node_modules node_modules
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases .yarn/releases
COPY server server

WORKDIR /src/server

# `build` runs `prisma generate` first, emitting the client into
# src/generated/prisma before nest compiles against it.
# Prisma validates its connection string while generating the client, although
# it never connects during this stage. Runtime configuration still comes from
# the Compose environment.
RUN DATABASE_URL=postgresql://imadeo:imadeo@postgres:5432/imadeo yarn build

# -------------------------------------------------------------------- runtime

FROM node:22-alpine AS runtime

WORKDIR /src/server

ENV NODE_ENV=production

# ffmpeg transcodes video and pulls poster frames; exiftool reads the metadata
# the timeline groups by. Both are invoked as binaries, so they have to be in
# the image rather than in a package.
RUN apk add --no-cache libc6-compat openssl ffmpeg exiftool postgresql16-client tini

# One hoisted tree at /src/node_modules; Node walks up from /src/server to
# find it, so the app needs no node_modules of its own.
COPY --from=build /src/node_modules /src/node_modules
COPY --from=build /src/server/dist ./dist
COPY --from=build /src/server/prisma ./prisma
COPY --from=build /src/server/prisma.config.ts ./prisma.config.ts
COPY --from=build /src/server/src/generated ./src/generated
COPY --from=build /src/server/package.json ./package.json
COPY package.json /src/package.json

# The library lives here by default. It is a mount point, not storage baked
# into the image: point MEDIA_LOCATION elsewhere and bind that path in, and
# the whole library moves with it.
ENV MEDIA_LOCATION=/data
RUN mkdir -p /data

EXPOSE 6666

# Migrations run at boot rather than at build time, so an existing install
# picks up its own schema changes when it pulls a newer tag.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node /src/node_modules/prisma/build/index.js migrate deploy && node dist/main"]
