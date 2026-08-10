# Builds the browser client and serves it with Nginx. The API stays in the
# server container; /api is proxied there over Docker's private network.

FROM node:22-alpine AS deps

WORKDIR /src

COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases .yarn/releases
COPY server/package.json server/
COPY app/package.json app/
COPY mobile/package.json mobile/

RUN corepack enable && yarn install --immutable

FROM node:22-alpine AS build

WORKDIR /src

RUN corepack enable

COPY --from=deps /src/node_modules node_modules
COPY --from=deps /src/app/node_modules app/node_modules
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases .yarn/releases
COPY app app

WORKDIR /src/app

RUN yarn build

FROM nginx:1.27-alpine

COPY app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/app/dist /usr/share/nginx/html

EXPOSE 80
