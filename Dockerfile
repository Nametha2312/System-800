# ============================================================
# Dockerfile — BACKEND only (Node.js API)
# Used by Render backend web service (default Dockerfile)
# ============================================================

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Native build deps (for bcrypt, pg, etc.)
RUN apk add --no-cache python3 make g++

# Copy manifests first (better layer caching)
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install ALL deps (frontend needed so workspace installs cleanly)
RUN npm ci --workspace=backend --workspace=frontend

# Copy source
COPY . .

# Build backend only
RUN npm run build --workspace=backend

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

# Chromium for Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    dumb-init

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy manifests and install production deps only
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/backend/package*.json ./backend/
RUN npm ci --workspace=backend --omit=dev

# Copy compiled output
COPY --from=builder /app/backend/dist ./backend/dist

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/system/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "backend/dist/api/server.js"]
