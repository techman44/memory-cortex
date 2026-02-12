# MCP Memory Cortex

A persistent mid-term memory system for AI-assisted coding workflows. Provides structured memory, task tracking, and session continuity that survives LLM context compressions.

## Architecture

```
Claude Code ──stdio──▶ MCP Server (Node.js)
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
               PostgreSQL  Embedding   API Server
               + pgvector  Service     (Express)
                            (MiniLM)       │
                                      Web UI ◀── Browser
```

**Key design**: The MCP server runs as a **local stdio process** launched by Claude Code (proper MCP protocol via `@modelcontextprotocol/sdk`). The API server runs in Docker alongside postgres/embeddings and serves the Web UI. Both share the same tool implementations.

## Quick Start

```bash
# Clone and run setup
chmod +x setup.sh
./setup.sh
```

This will:
1. Build the MCP stdio server locally (needed for Claude Code)
2. Sync source to the API server Docker context
3. Start all Docker services (postgres, embeddings, api, web-ui)

**First run** downloads the embedding model (~80MB, ~2 minutes). Watch with:
```bash
docker compose logs -f embedding-service
```

## Connect to Claude Code

### Recommended: Initialize your project
```bash
./init-project.sh /path/to/your/project
```

This writes two files into your project:

- **CLAUDE.md** — The behavioral protocol. Contains zero project data. Only instructions for how Claude should use Cortex to acquire, maintain, and use memory. Claude Code reads this on every session and after every context compression.
- **.mcp.json** — Server config pointing to the local MCP stdio server.

Claude will then automatically follow the Cortex protocol: querying for context on startup, saving decisions as they happen, creating snapshots at milestones, and recovering after compressions.

### Alternative: CLI only (no CLAUDE.md)
```bash
claude mcp add memory-cortex -- node /path/to/mcp-memory/mcp-server/build/mcp-stdio.js
```

This gives you the tools but without the behavioral contract. You'd need to manually tell Claude to use them.

### Verify
In Claude Code, run `/mcp` — you should see `memory-cortex: connected` with 20 tools listed.

## MCP Tools (20 total)

| Tool | Layer | Description |
|---|---|---|
| `get_project_brief` | **Foundational** | Get stable project identity: stack, modules, conventions, constraints |
| `set_project_brief` | **Foundational** | Set/update the foundational project description (singleton, overwrites) |
| `get_recent_changes` | **Evolutionary** | What changed in the last N hours: new snapshots, notes, tasks, completions |
| `session_sync` | **Recovery** | Reconstruct full working context from latest state |
| `create_snapshot` | **Capture** | Structured project state at a point in time |
| `retrieve_memory` | **Search** | Semantic/keyword/hybrid memory search |
| `add_todo` | **Tracking** | Create a tracked task with priority, tags, linked files |
| `update_todo` | **Tracking** | Modify task status, priority, or metadata |
| `complete_todo` | **Tracking** | Mark done with timestamp |
| `delete_todo` | **Tracking** | Remove task and its embeddings |
| `list_todos` | **Tracking** | Get kanban board state |
| `add_note` | **Capture** | Quick freeform memory (decisions, debug, architecture, reference) |
| `list_notes` | **Capture** | Browse notes by category |
| `delete_note` | **Capture** | Permanently remove a note and its embeddings |
| `log_error_pattern` | **Diagnostics** | Log an error with root cause and resolution (auto-deduplicates) |
| `check_error_patterns` | **Diagnostics** | Search for previously seen errors before attempting fixes |
| `list_error_patterns` | **Diagnostics** | List all logged error patterns for this project |
| `add_instruction` | **Directives** | Add a persistent directive (e.g. "always use bun", "never modify auth") |
| `get_instructions` | **Directives** | Get all active instructions for this project |
| `remove_instruction` | **Directives** | Deactivate an instruction (soft delete) |
| `get_file_context` | **Search** | Get all known context for a specific file across all tables |
| `summarize_project` | **Recovery** | Condensed state from snapshots + todos + notes |
| `prune_memory` | **Maintenance** | Remove stale entries, preserve tagged ones |
| `diff_snapshots` | **Search** | Compare two snapshots to see what changed |
| `delete_project` | **Management** | Permanently delete a project and all its data (cascading) |
| `system_status` | **Maintenance** | Health check and system stats |

## The Cortex Protocol — Zero-Knowledge CLAUDE.md

The key design principle: **CLAUDE.md contains NO project data.** It is purely a behavioral contract that tells Claude how to use Cortex as its memory layer.

Traditional approach (breaks down at scale):
```markdown
# CLAUDE.md — 3000+ tokens loaded every message
## Architecture
Express + PostgreSQL, gRPC between services...
## Decisions
Chose JWT over sessions because...
## Tasks
- Fix auth bug
- Refactor middleware
```

Cortex approach (~200 tokens loaded every message):
```markdown
# CLAUDE.md — operating protocol only
On session start: call get_project_brief + session_sync
Before changing APIs: call retrieve_memory
After decisions: call add_note with category "decision"
...
```

The project knowledge lives in the database. Claude retrieves it on-demand through targeted tool calls instead of carrying it in every message.

### Two-Tier Retrieval

**Foundational (stable):** `get_project_brief` returns the project identity — tech stack, module structure, conventions, constraints. This rarely changes. It replaces the static "about this project" section of CLAUDE.md.

**Evolutionary (changing):** `get_recent_changes` returns what happened recently — new snapshots, decisions, task changes. This is the "what did I miss" view that catches Claude up after a gap.

Together, two tool calls (~400 tokens total) give Claude the same awareness that would require 2000+ tokens of static CLAUDE.md content, with the critical advantage that it's always current.

### Install into a project

```bash
./init-project.sh /path/to/your/project
```

This will:
1. Back up any existing CLAUDE.md
2. Write the Cortex operating protocol as the new CLAUDE.md
3. Create/update .mcp.json with the memory-cortex MCP server config

On the first Claude Code session in that project, Claude will:
1. Read the CLAUDE.md → learn the Cortex protocol
2. Call `get_project_brief` → find no brief exists (new project)
3. Explore the codebase → call `set_project_brief` to establish foundational context
4. Start building memory from there

## Recommended Workflow

```
Session Start     →  session_sync (restore context)
Coding            →  add_note for decisions, debug findings
Milestone         →  create_snapshot (capture architecture state)
Task Tracking     →  add_todo / update_todo / complete_todo
Pre-Compression   →  summarize_project (condense before context shrinks)
Session End       →  create_snapshot (final state capture)
Next Session      →  session_sync (picks up where you left off)
```

## Web UI

Open **http://localhost:41300** for:

- **Board** — Kanban with drag-and-drop (Todo / In Progress / Blocked / Done)
- **Timeline** — Chronological snapshot history
- **Notes** — Browse and create notes by category
- **Search** — Semantic, keyword, or hybrid memory search
- **System** — Service health, database stats

## Services

| Service | Port | Description |
|---|---|---|
| Web UI | 41300 | Browser dashboard |
| API Server | 41200 | REST API for Web UI |
| Embedding Service | 41100 | all-MiniLM-L6-v2 (384d) |
| PostgreSQL | 41432 | Data store + pgvector |
| MCP Server | stdio | Launched by Claude Code |

## Storage Design

**Structured layer (SQL)**: snapshots, todos, notes, sessions — precise retrieval by ID, status, tags, time.

**Semantic layer (pgvector)**: embedded summaries, architecture notes, decisions, task descriptions — meaning-based retrieval via cosine similarity.

**Graceful degradation**: If the embedding service is down, all structured operations (CRUD on todos, snapshots, notes) continue working. Semantic search returns empty results with no errors.

## Configuration

Copy `.env.example` to `.env` and customize:

```bash
DB_PASSWORD=mcp_local_dev    # PostgreSQL password
DB_PORT=41432                 # Host port for postgres
EMBEDDING_PORT=41100          # Host port for embedding service
API_PORT=41200                # Host port for API server
UI_PORT=41300                 # Host port for web UI
```

## Data Management

```bash
# Reset everything
docker compose down -v
./setup.sh

# Just restart services
docker compose restart

# View logs
docker compose logs -f api-server
```

## Project Structure

```
mcp-memory/
├── setup.sh                  # One-command setup (build + Docker)
├── init-project.sh           # Initialize any project with Cortex
├── templates/
│   └── CLAUDE.md             # Behavioral protocol template
├── docker-compose.yml
├── .env.example
├── mcp-server/               # Shared TypeScript source
│   ├── src/
│   │   ├── mcp-stdio.ts      # MCP server (Claude Code stdio)
│   │   ├── api-server.ts     # REST API (Web UI)
│   │   ├── tools.ts          # Shared tool implementations
│   │   ├── db.ts             # Database connection
│   │   └── embeddings.ts     # Embedding client
│   ├── package.json
│   └── tsconfig.json
├── api-server/               # Docker build context (synced from mcp-server)
│   └── Dockerfile
├── embedding-service/
│   ├── Dockerfile
│   └── server.py
├── web-ui/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── index.html
└── db/
    └── init.sql
```
