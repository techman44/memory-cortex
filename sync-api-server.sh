#!/bin/bash
# Sync mcp-server source into api-server Docker build context
set -e
cd "$(dirname "$0")"

mkdir -p api-server/src

cp mcp-server/package.json api-server/
cp mcp-server/tsconfig.json api-server/
cp mcp-server/src/db.ts api-server/src/
cp mcp-server/src/embeddings.ts api-server/src/
cp mcp-server/src/tools.ts api-server/src/
cp mcp-server/src/api-server.ts api-server/src/

echo "  API server build context synced"
