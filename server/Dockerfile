# syntax=docker/dockerfile:1

# ---- Build: install all dependencies, compile TypeScript, then drop dev dependencies ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# npm leaves empty scope folders behind when pruning; remove them so only runtime deps remain.
RUN npm run build \
    && npm prune --omit=dev \
    && find node_modules -type d -empty -delete

# ---- Runtime: slim image with the compiled server and production dependencies only ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app

# The server runs as the unprivileged "node" user. Fly mounts volumes owned by root, so the
# entrypoint starts as root only to hand /data to "node", then drops privileges (see script).
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint-hoop
RUN chmod 0755 /usr/local/bin/docker-entrypoint-hoop \
    && mkdir -p /data \
    && chown node:node /data

# Application files stay root-owned (read-only for the server process).
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 8080
ENTRYPOINT ["docker-entrypoint-hoop"]
CMD ["node", "dist/index.js"]
