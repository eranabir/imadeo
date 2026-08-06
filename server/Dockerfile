# Built from the repository root, not from server/, because the Yarn
# workspace root holds the lockfile that pins both packages.
#
#   docker build -f server/Dockerfile .

# ---------------------------------------------------------------- dependencies

FROM node:22-alpine AS deps

WORKDIR /app

# Only the manifests, so a source edit does not invalidate the install layer.
COPY package.json yarn.lock ./
COPY server/package.json server/
COPY web/package.json web/

# Prisma's engines are built against glibc and need OpenSSL present even on
# Alpine; without these the client fails at generate time, not at runtime,
# which makes the error look like a build script problem instead.
RUN apk add --no-cache libc6-compat openssl \
 && yarn install --frozen-lockfile

# ---------------------------------------------------------------------- build

FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/server/node_modules server/node_modules
COPY package.json yarn.lock ./
COPY server server

WORKDIR /app/server

# `build` runs `prisma generate` first, emitting the client into
# src/generated/prisma before nest compiles against it.
RUN yarn build

# -------------------------------------------------------------------- runtime

FROM node:22-alpine AS runtime

WORKDIR /app/server

ENV NODE_ENV=production

# ffmpeg transcodes video and pulls poster frames; exiftool reads the metadata
# that the timeline groups by. Both are called as binaries, so they have to be
# in the image rather than in a package.
RUN apk add --no-cache libc6-compat openssl ffmpeg exiftool tini

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/src/generated ./src/generated
COPY --from=build /app/server/package.json ./package.json
COPY package.json /app/package.json

# The library lives here by default. It is a mount point, not storage baked
# into the image: point MEDIA_LOCATION somewhere else and bind that path in,
# and the whole library moves with it.
ENV MEDIA_LOCATION=/data
RUN mkdir -p /data

EXPOSE 3001

# Migrations run at boot rather than in the image, so a NAS that pulls a newer
# tag picks up its own schema changes without a separate step.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
