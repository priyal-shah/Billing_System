# Builds the React app, then serves it with Caddy (automatic HTTPS + /api proxy to the backend).
# Build context is the project root (E:\Billing_System).

FROM node:22-alpine AS build
WORKDIR /src
COPY frontend_react/package.json frontend_react/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend_react/ ./
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
