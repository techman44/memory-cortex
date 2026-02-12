#!/bin/bash
# MCP Memory Cortex — Setup Script
# Builds the MCP stdio server locally and prepares Docker services.
set -e
cd "$(dirname "$0")"

echo "==========================================="
echo "  MCP Memory Cortex — Setup"
echo "==========================================="

# 1. Copy .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  Created .env from template"
fi

# 2. Build the MCP server locally (for Claude Code stdio transport)
echo ""
echo "-- Building MCP Server (local) --"
cd mcp-server
npm install
npx tsc
cd ..
echo "  MCP server built -> mcp-server/build/"

# 3. Sync source to api-server Docker context
echo ""
echo "-- Syncing API Server build context --"
./sync-api-server.sh
echo "  API server context synced"

# 4. Start Docker services
echo ""
echo "-- Starting Docker services --"
docker compose up -d --build

# Source ports for display
source .env 2>/dev/null || true

echo ""
echo "==========================================="
echo "  Setup Complete!"
echo "==========================================="
echo ""
echo "  Web UI:        http://localhost:${UI_PORT:-41300}"
echo "  API Server:    http://localhost:${API_PORT:-41200}"
echo "  Embedding Svc: http://localhost:${EMBEDDING_PORT:-41100}"
echo "  PostgreSQL:    localhost:${DB_PORT:-41432}"
echo ""
echo "  MCP Server:    mcp-server/build/mcp-stdio.js"
echo ""
echo "  NOTE: First run downloads the embedding model (~2 min)."
echo "  Run 'docker compose logs -f embedding-service' to watch."
echo ""
echo "-- Add to Claude Code --"
echo ""
echo "  Option A: CLI command"
echo "    claude mcp add memory-cortex -- node $(pwd)/mcp-server/build/mcp-stdio.js"
echo ""
echo "  Option B: Initialize a project (recommended):"
echo "    ./init-project.sh /path/to/your/project"
echo ""
