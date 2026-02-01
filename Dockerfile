# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json tsup.config.ts ./
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S bentengroup && \
    adduser -S bentenuser -u 1001 -G bentengroup

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only (skip prepare scripts like husky)
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create storage directory with proper permissions
RUN mkdir -p /data/contexts && \
    chown -R bentenuser:bentengroup /data

# Switch to non-root user
USER bentenuser

# Environment variables
ENV NODE_ENV=production
ENV BEN_TEN_PORT=3456
ENV BEN_TEN_HOST=0.0.0.0
ENV BEN_TEN_STORAGE=/data

# Expose the server port
EXPOSE 3456

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3456/api/health || exit 1

# Start the server
CMD ["node", "dist/bin/ben-ten.js", "serve-http", \
     "--port", "3456", \
     "--host", "0.0.0.0", \
     "--storage", "/data"]
