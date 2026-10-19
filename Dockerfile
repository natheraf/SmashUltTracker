FROM node:20.14.0-alpine AS builder
WORKDIR /app
# Install build tools for native modules
RUN apk add --no-cache --virtual .build-deps python3 make g++ musl-dev
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Clean up build dependencies
RUN apk del .build-deps

FROM node:20.14.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Install build tools required for native modules (better-sqlite3)
RUN apk add --no-cache --virtual .build-deps python3 make g++ musl-dev
COPY package*.json ./
RUN npm ci --omit=dev
# Remove build dependencies
RUN apk del .build-deps
COPY --from=builder /app/server ./server
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/seed ./seed
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server/fonts ./server/fonts
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
