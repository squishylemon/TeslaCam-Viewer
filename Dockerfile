# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV TLS_DIR=/app/data/tls
# TeslaCam clips are bind-mounted here by docker-compose.
ENV TESLACAM_DIR=/data/TeslaCam

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/ensure-tls.mjs ./scripts/ensure-tls.mjs
COPY scripts/start.mjs ./scripts/start.mjs
COPY scripts/load-config-env.mjs ./scripts/load-config-env.mjs

EXPOSE 4321
CMD ["node", "scripts/start.mjs", "./dist/server/entry.mjs"]
