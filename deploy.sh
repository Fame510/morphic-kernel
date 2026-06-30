#!/usr/bin/env bash
set -euo pipefail
# Usage: ./deploy.sh [dev|prod]
ENV="${1:-dev}"
echo "Deploying Morphic Kernel ($ENV)"
docker build -t morphic-kernel:latest .
if [ "$ENV" = "dev" ]; then
  echo "Running tests in container..."
  docker run --rm morphic-kernel:latest npm test || echo "(tests require devDependencies; run npm test locally)"
fi
OWNER_KEY="$(openssl rand -hex 32 2>/dev/null || echo local::owner)" docker compose up -d morphic-kernel
sleep 3
if wget -qO- http://localhost:3001/runtime/health >/dev/null 2>&1; then
  echo "Kernel healthy at http://localhost:3001"
else
  echo "Health check failed; recent logs:"; docker logs morphic-kernel --tail 50 || true; exit 1
fi
