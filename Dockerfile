# Build Stage 1: Build Client (Vite Frontend)
FROM node:22-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Build Stage 2: Build Server (Node.js Backend)
FROM node:22-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Production Runtime Stage
FROM node:22-alpine AS runner
WORKDIR /app

# Install native dependencies for better-sqlite3
RUN apk add --no-co-cache python3 make g++

COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --only=production

COPY --from=server-builder /app/server/dist ./dist
COPY --from=client-builder /app/client/dist /app/client/dist

ENV PORT=3000
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/uploads

EXPOSE 3000

VOLUME ["/app/data", "/app/uploads"]

CMD ["node", "dist/index.js"]
