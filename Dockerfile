# Morphic Kernel runtime container
FROM node:20-alpine AS base
WORKDIR /app

# Install core deps first for layer caching.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

# Copy source.
COPY src/ ./src/
COPY wasm-runtime/ ./wasm-runtime/

# Runtime data dirs.
RUN mkdir -p .morphic_data .morphic_ledger modules

# Drop privileges.
RUN addgroup -g 1001 -S morphic && adduser -S morphic -u 1001 -G morphic \
 && chown -R morphic:morphic /app
USER morphic

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/runtime/health || exit 1

CMD ["node", "src/kernel.js"]
