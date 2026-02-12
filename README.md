# MCP Memory Cortex

**Claude is brilliant. But it forgets everything.**

Every time the context window compresses, every time you start a new session — gone. The architectural decisions you talked through, the bugs you diagnosed together, the conventions you agreed on. You end up re-explaining your project from scratch, watching Claude rediscover things it already knew an hour ago.

Memory Cortex fixes this. It gives Claude a **real, persistent memory** backed by a PostgreSQL database with semantic search. Not a giant text file shoved into the context window — an actual structured memory layer that Claude queries on-demand, writes to as it works, and automatically recovers from after context compression.

The result: Claude remembers your project across sessions. It remembers *why* you chose JWT over sessions. It remembers that port 3000 is taken on your machine. It remembers the bug it fixed last Tuesday and won't re-introduce it. It picks up exactly where it left off, every time.

## How It Actually Works

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

The MCP server runs as a **local stdio process** alongside Claude Code — no cloud, no API keys, everything on your machine. The database, embedding service, API server, and web dashboard run in Docker.

### Two-Layer Memory

Memory Cortex stores knowledge in **two complementary layers** inside PostgreSQL:

**Structured layer (SQL)** — Snapshots, todos, notes, error patterns, instructions, and project briefs live in normalized tables. These are retrieved precisely by ID, status, category, tags, or time range. When Claude asks "what are my active tasks?" or "what changed in the last 48 hours?", this layer answers instantly.

**Semantic layer (pgvector)** — Every piece of stored knowledge also gets embedded into a 384-dimensional vector using `all-MiniLM-L6-v2`. This means Claude can search by *meaning*, not just keywords. Asking "how do we handle authentication?" surfaces relevant decisions, debug notes, and architecture snapshots — even if none of them contain the word "authentication". The vectors live in the same Postgres instance via `pgvector`, so there's no separate vector database to manage.

When Claude searches memory, it can use keyword matching (fast, exact), semantic similarity (fuzzy, meaning-based), or both in a hybrid query. The structured layer handles the day-to-day task tracking and state management; the semantic layer handles the "I vaguely remember we solved this before" moments.

**Graceful degradation**: If the embedding service goes down, everything except semantic search keeps working. Todos, snapshots, notes — all still fully functional. Search falls back to keyword-only. No crashes, no errors.

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

Here's the problem with stuffing project knowledge into CLAUDE.md: it gets loaded into *every single message*. A 3000-token CLAUDE.md means 3000 tokens of your context window are permanently occupied by static text — text that might be stale, that grows unbounded, and that Claude has to wade through whether it's relevant to the current task or not.

Cortex flips this. **CLAUDE.md contains zero project data.** It's purely a behavioral protocol — a ~200-token instruction set that tells Claude *how to use its memory*, not what to remember. The actual knowledge lives in the database, retrieved on-demand through targeted queries.

```
Traditional CLAUDE.md                    Cortex CLAUDE.md
─────────────────────                    ─────────────────
3000+ tokens, loaded every message       ~200 tokens, loaded every message

## Architecture                          On session start:
Express + PostgreSQL, gRPC...              → call get_project_brief
## Decisions                               → call session_sync
Chose JWT over sessions because...       Before changing APIs:
## Tasks                                   → call retrieve_memory
- Fix auth bug                           After decisions:
- Refactor middleware                      → call add_note
## Conventions                           Before fixing errors:
Always use snake_case...                   → call check_error_patterns
(grows forever, gets stale)              (stays small, knowledge stays current)
```

### Two-Tier Context Recovery

When Claude starts a session (or recovers from context compression), two tool calls reconstruct full project awareness:

**`get_project_brief`** — Returns the stable project identity: tech stack, module map, conventions, constraints. Think of it as the "what is this project" layer. This rarely changes and replaces the static "about" section of traditional CLAUDE.md files.

**`session_sync`** — Returns the latest snapshot, active todos, recent notes, active instructions, and recent error patterns. This is the "where were we" layer — everything Claude needs to pick up mid-task after a context reset.

Two calls, ~400 tokens, and Claude has the same awareness that would take 2000+ tokens of static text — except it's always current, never stale, and doesn't bloat the context window.

### Install into Any Project

```bash
./init-project.sh /path/to/your/project
```

This writes two files:
1. **CLAUDE.md** — The behavioral protocol (backs up any existing one)
2. **.mcp.json** — MCP server config pointing to the local stdio server

On the first session, Claude reads the protocol, discovers no brief exists yet, explores the codebase, and calls `set_project_brief` to bootstrap its own memory. From there, it builds knowledge organically as it works — saving decisions, logging errors, tracking tasks, snapshotting milestones. Every future session starts with full recall.

## What a Session Looks Like

With Cortex installed, Claude follows this cycle automatically — no manual prompting needed:

```
┌─ SESSION START ────────────────────────────────────────────┐
│  session_sync → full context restored in ~400 tokens       │
│  get_recent_changes → "here's what happened since last time│
├─ ACTIVE WORK ──────────────────────────────────────────────┤
│  add_note → captures decisions, debug insights as they     │
│             happen (not at session end when it's too late)  │
│  log_error_pattern → records what broke and how it was      │
│                      fixed so it never repeats              │
│  check_error_patterns → "have I seen this before?" (yes.)  │
│  add_todo / complete_todo → task tracking that persists     │
├─ MILESTONE ────────────────────────────────────────────────┤
│  create_snapshot → architectural state captured             │
├─ CONTEXT COMPRESSION ─────────────────────────────────────┤
│  (automatic) session_sync → recovers everything            │
│  Claude continues working as if nothing happened           │
├─ SESSION END ──────────────────────────────────────────────┤
│  create_snapshot → final state saved for next session       │
└────────────────────────────────────────────────────────────┘
```

The key insight: Claude saves knowledge **as it works**, not at the end of a session. Decisions are recorded the moment they're made. Errors are logged the moment they're diagnosed. If context compresses mid-session, nothing is lost — it was already in the database.

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
memory-cortex/
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
