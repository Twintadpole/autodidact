# Build context: the pool-service/ folder (see docker-compose.yml).

# ---- build: compile shared, server and the PWA ------------------------------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY client/src-pwa/package.json client/src-pwa/package-lock.json client/src-pwa/
RUN npm ci --ignore-scripts && npm ci --prefix client/src-pwa
COPY . .
RUN npm run build

# ---- runtime: production deps + compiled output only ------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server -w shared && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist/pwa client/dist
ENV CLIENT_DIST=/app/client/dist \
    PHOTO_DIR=/data/photos \
    PORT=3000
RUN mkdir -p /data/photos && chown node:node /data/photos
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
