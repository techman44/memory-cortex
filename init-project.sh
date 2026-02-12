#!/bin/bash
# MCP Memory Cortex — Initialize a project
# Writes CLAUDE.md and .mcp.json into a target project directory.
#
# Usage:
#   ./init-project.sh /path/to/your/project
#   ./init-project.sh   (uses current directory)

set -e

CORTEX_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_SERVER="$CORTEX_DIR/mcp-server/build/mcp-stdio.js"
TEMPLATE="$CORTEX_DIR/templates/CLAUDE.md"
MIGRATE_SCRIPT="$CORTEX_DIR/scripts/migrate-claude-md.py"

# Target project directory
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd)"

echo "==========================================="
echo "  MCP Memory Cortex — Project Init"
echo "==========================================="
echo ""
echo "  Cortex:  $CORTEX_DIR"
echo "  Target:  $TARGET"
echo ""

# ── Check prerequisites ────────────────────────────────────
if [ ! -f "$MCP_SERVER" ]; then
  echo "ERROR: MCP server not built. Run ./setup.sh first."
  exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: Template not found at $TEMPLATE"
  exit 1
fi

# ── Source env for ports/passwords ─────────────────────────
DB_PASSWORD="mcp_local_dev"
DB_PORT="41432"
EMBEDDING_PORT="41100"
API_PORT="41200"
UI_PORT="41300"
if [ -f "$CORTEX_DIR/.env" ]; then
  source "$CORTEX_DIR/.env" 2>/dev/null || true
fi

API_URL="http://localhost:${API_PORT}"

# ── Generate project ID from target path ───────────────────
PROJECT_ID=$(echo -n "$TARGET" | shasum -a 256 | cut -c1-12)
echo "  Project ID: $PROJECT_ID"
echo ""

# ── Handle existing CLAUDE.md ──────────────────────────────
CLAUDE_MD="$TARGET/CLAUDE.md"

if [ -f "$CLAUDE_MD" ]; then
  echo "-- Existing CLAUDE.md found --"
  echo ""

  if grep -q "Memory Cortex Protocol" "$CLAUDE_MD" 2>/dev/null; then
    echo "  Already contains Cortex protocol. Skipping."
    echo ""
  else
    FILESIZE=$(wc -c < "$CLAUDE_MD" | tr -d ' ')
    LINECOUNT=$(wc -l < "$CLAUDE_MD" | tr -d ' ')
    echo "  Found: ${LINECOUNT} lines, ${FILESIZE} bytes"
    echo ""

    head -8 "$CLAUDE_MD" | sed 's/^/    /'
    if [ "$LINECOUNT" -gt 8 ]; then
      echo "    ..."
    fi
    echo ""

    echo "  Options:"
    echo "    [m] Migrate content into Cortex, then replace with protocol (recommended)"
    echo "    [b] Backup only — save a copy, replace with protocol"
    echo "    [s] Skip — leave CLAUDE.md unchanged"
    echo ""
    read -p "  Choice [m/b/s]: " CHOICE

    case "$CHOICE" in
      m|M)
        BACKUP="$TARGET/CLAUDE.md.pre-cortex.$(date +%Y%m%d_%H%M%S)"
        cp "$CLAUDE_MD" "$BACKUP"
        echo "  Backup saved: $(basename $BACKUP)"
        echo ""

        echo "-- Migrating CLAUDE.md content into Cortex --"
        if python3 "$MIGRATE_SCRIPT" "$CLAUDE_MD" "$API_URL" "$PROJECT_ID"; then
          echo "  Migration complete"
        else
          echo "  Migration had issues (content saved as backup)"
        fi
        echo ""
        cp "$TEMPLATE" "$CLAUDE_MD"
        echo "  CLAUDE.md replaced with Cortex operating protocol"
        ;;
      b|B)
        BACKUP="$TARGET/CLAUDE.md.pre-cortex.$(date +%Y%m%d_%H%M%S)"
        cp "$CLAUDE_MD" "$BACKUP"
        echo "  Backup saved: $(basename $BACKUP)"
        cp "$TEMPLATE" "$CLAUDE_MD"
        echo "  CLAUDE.md replaced with Cortex operating protocol"
        ;;
      s|S|*)
        echo "  Skipping CLAUDE.md"
        ;;
    esac
  fi
else
  cp "$TEMPLATE" "$CLAUDE_MD"
  echo "  CLAUDE.md written (Cortex operating protocol)"
fi

echo ""

# ── .mcp.json ─────────────────────────────────────────────
MCP_JSON="$TARGET/.mcp.json"

MCP_CONFIG=$(cat << MCPEOF
{
  "mcpServers": {
    "memory-cortex": {
      "command": "node",
      "args": ["$MCP_SERVER"],
      "env": {
        "DATABASE_URL": "postgresql://mcp:${DB_PASSWORD}@localhost:${DB_PORT}/mcp_memory",
        "EMBEDDING_URL": "http://localhost:${EMBEDDING_PORT}",
        "MCP_PROJECT_ID": "$PROJECT_ID"
      }
    }
  }
}
MCPEOF
)

if [ -f "$MCP_JSON" ]; then
  if grep -q "memory-cortex" "$MCP_JSON" 2>/dev/null; then
    echo "  .mcp.json already has memory-cortex configured"
  else
    echo "-- Existing .mcp.json found --"
    echo "  Adding memory-cortex entry..."

    python3 -c "
import json
with open('$MCP_JSON') as f:
    cfg = json.load(f)
cfg.setdefault('mcpServers', {})['memory-cortex'] = {
    'command': 'node',
    'args': ['$MCP_SERVER'],
    'env': {
        'DATABASE_URL': 'postgresql://mcp:${DB_PASSWORD}@localhost:${DB_PORT}/mcp_memory',
        'EMBEDDING_URL': 'http://localhost:${EMBEDDING_PORT}',
        'MCP_PROJECT_ID': '$PROJECT_ID'
    }
}
with open('$MCP_JSON', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null && echo "  memory-cortex added to existing .mcp.json" || {
      echo "  Could not merge automatically. Add manually:"
      echo "$MCP_CONFIG" | sed 's/^/    /'
    }
  fi
else
  echo "$MCP_CONFIG" > "$MCP_JSON"
  echo "  .mcp.json written"
fi

# ── Register project with API ────────────────────────────────
PROJECT_NAME=$(basename "$TARGET")
echo "-- Registering project with Cortex API --"
python3 -c "
import json, urllib.request
data = json.dumps({'project_id': '$PROJECT_ID', 'name': '$PROJECT_NAME', 'path': '$TARGET'}).encode()
req = urllib.request.Request('$API_URL/api/projects', data=data, headers={'Content-Type': 'application/json'})
try:
    resp = urllib.request.urlopen(req, timeout=5)
    print('  Project registered: $PROJECT_NAME')
except Exception as e:
    print(f'  Could not register (API may be down): {e}')
" 2>/dev/null || echo "  Could not register project (API not reachable)"

echo ""
echo "==========================================="
echo "  Project initialized!"
echo "==========================================="
echo ""
echo "  Project ID: $PROJECT_ID"
echo ""
echo "  Next steps:"
echo "  1. Ensure Docker services are running:"
echo "     cd $CORTEX_DIR && docker compose up -d"
echo ""
echo "  2. Open the project in Claude Code:"
echo "     cd $TARGET && claude"
echo ""
echo "  Web UI:  http://localhost:${UI_PORT}"
echo "  API:     http://localhost:${API_PORT}"
echo ""
