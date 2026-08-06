# Built from the repository root, for the same lockfile reason as the server:
#
#   docker build -f web/Dockerfile .

# ---------------------------------------------------------------- dependencies

FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json yarn.lock ./
COPY server/package.json server/
COPY web/package.json web/

RUN yarn install --frozen-lockfile

# ---------------------------------------------------------------------- build

FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/web/node_modules web/node_modules
COPY package.json yarn.lock ./
COPY web web

WORKDIR /app/web

RUN yarn build

# -------------------------------------------------------------------- runtime

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/web/dist /usr/share/nginx/html

# A single-page app: any path that is not a real file has to fall through to
# index.html, or a refresh on /albums/<id> returns 404 from nginx before React
# ever sees the route. /api is proxied so the browser makes same-origin
# requests and no CORS configuration is needed.
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '' \
  '  client_max_body_size 0;' \
  '' \
  '  location /api/ {' \
  '    proxy_pass http://server:3001/;' \
  '    proxy_http_version 1.1;' \
  '    proxy_set_header Host $host;' \
  '    proxy_set_header X-Real-IP $remote_addr;' \
  '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
  '    proxy_set_header X-Forwarded-Proto $scheme;' \
  '    proxy_request_buffering off;' \
  '    proxy_read_timeout 600s;' \
  '  }' \
  '' \
  '  location / {' \
  '    try_files $uri $uri/ /index.html;' \
  '  }' \
  '}' \
  > /etc/nginx/conf.d/default.conf

EXPOSE 80
