# Memory Cortex Protocol

This project uses **MCP Memory Cortex** for all persistent context. Do NOT store project knowledge in this file. This file contains only the operating protocol for how to acquire, maintain, and use project memory.

## Session Lifecycle

### On Session Start (ALWAYS do this first)
1. Call `get_project_brief` — loads foundational project identity (stack, modules, conventions, constraints)
2. Call `session_sync` — loads latest snapshot, active todos, recent notes
3. Call `get_recent_changes` with `since_hours: 48` — understand what evolved recently

If `get_project_brief` returns no brief, this is a new project. Perform initial discovery:
- Read the project's package.json, main config files, and directory structure
- Call `set_project_brief` with what you learn
- Call `create_snapshot` with the initial architectural overview
- Call `add_note` with category "architecture" for key structural observations

### During Active Work
- **After making an architectural decision** → `add_note` with category "decision"
- **After debugging something non-obvious** → `add_note` with category "debug"
- **After completing a milestone or significant change** → `create_snapshot`
- **When creating or discovering a task** → `add_todo`
- **When finishing a task** → `complete_todo`
- **When blocked** → `update_todo` with status "blocked" and blocked_reason

### Before Context Gets Large
When conversation is getting long or you sense compression may happen:
1. Call `create_snapshot` with current state
2. Call `summarize_project` to verify state is captured

### After Context Compression
When you notice you may have lost context (conversation feels shorter, or you're unsure about details):
1. Call `get_project_brief` — re-orient on project fundamentals
2. Call `session_sync` — restore working state
3. Call `get_recent_changes` — catch up on recent momentum

### On Session End
1. Call `create_snapshot` with a summary of what was accomplished
2. Mark completed todos with `complete_todo`

## Query Triggers — When to Consult Memory

**Before modifying any module's public interface:**
→ Call `retrieve_memory` with the module name to check for constraints or decisions about its API.

**Before suggesting a technology or pattern change:**
→ Call `retrieve_memory` to check if there's a stored decision explaining the current choice.

**Before touching a file you haven't seen this session:**
→ Call `retrieve_memory` with the file path to check for known issues or context.

**When asked about project history or "why is it built this way":**
→ Call `retrieve_memory` with mode "semantic" and relevant terms.

**When uncertain about conventions or patterns:**
→ Call `get_project_brief` — conventions are stored there.

## Write Triggers — When to Save Memory

| Event | Action |
|---|---|
| Architectural decision made | `add_note` category="decision" |
| Bug found and diagnosed | `add_note` category="debug" |
| New pattern or convention established | `add_note` category="architecture" + update `set_project_brief` if fundamental |
| Useful reference discovered | `add_note` category="reference" |
| Milestone completed | `create_snapshot` + `complete_todo` |
| New work item identified | `add_todo` |
| Major refactor or structural change | `create_snapshot` + update `set_project_brief` |
| Before ending session | `create_snapshot` |

## Tool Quick Reference

| Tool | Purpose | When |
|---|---|---|
| `get_project_brief` | Stable project identity | Session start, re-orientation |
| `set_project_brief` | Update project identity | First discovery, architecture changes |
| `session_sync` | Full working context restore | Session start, post-compression |
| `get_recent_changes` | What evolved recently | Session start, catching up |
| `create_snapshot` | Capture point-in-time state | Milestones, pre-compression, session end |
| `retrieve_memory` | Search past knowledge | Before decisions, when uncertain |
| `add_note` | Quick freeform memory | Decisions, debug, architecture, references |
| `list_notes` | Browse notes by category | Reviewing stored knowledge |
| `delete_note` | Permanently remove a note | Cleaning up outdated notes |
| `add_todo` / `update_todo` / `complete_todo` / `delete_todo` | Task management | Throughout work |
| `list_todos` | Kanban board view | Checking task state |
| `log_error_pattern` | Log error with root cause/resolution | After diagnosing non-trivial errors |
| `check_error_patterns` | Search previously seen errors | BEFORE attempting to fix an error |
| `list_error_patterns` | List all error patterns | Reviewing error history |
| `add_instruction` / `get_instructions` / `remove_instruction` | Persistent directives | Rules like "always use bun" |
| `get_file_context` | All context for a specific file | Before modifying unfamiliar files |
| `summarize_project` | Condensed state overview | Pre-compression, status checks |
| `diff_snapshots` | Compare two points in time | Understanding evolution |
| `delete_project` | Cascading delete of all project data | Project cleanup (irreversible) |
| `prune_memory` | Clean old entries | Maintenance |
| `system_status` | Health check | Troubleshooting |

## Architecture

- **mcp-server/**: TypeScript MCP stdio server + Express API server source
- **api-server/**: Docker build context for API (copies of mcp-server/src — must sync after changes)
- **embedding-service/**: Python FastAPI with sentence-transformers (all-MiniLM-L6-v2, 384-dim)
- **web-ui/**: nginx SPA dashboard at port 41300
- **db/**: PostgreSQL + pgvector schema at port 41432
- Docker Compose orchestration, all services on 41xxx ports

## API Endpoints (api-server.ts)

- `GET /api/health` | `GET /api/projects` | `POST /api/projects` | `DELETE /api/projects/:id`
- `GET /api/stats`
- `GET /api/snapshots` | `GET /api/snapshots/:id` | `POST /api/snapshots` | `POST /api/snapshots/diff`
- `GET /api/todos` | `POST /api/todos` | `PATCH /api/todos/:id` | `POST /api/todos/:id/complete` | `DELETE /api/todos/:id`
- `GET /api/notes` | `POST /api/notes` | `DELETE /api/notes/:id`
- `POST /api/search`
- `GET /api/summary` | `GET /api/session`
- `POST /api/prune`
- `GET /api/brief` | `POST /api/brief`
- `GET /api/changes`
- `GET /api/errors` | `POST /api/errors` | `POST /api/errors/check`
- `GET /api/instructions` | `POST /api/instructions` | `DELETE /api/instructions/:id`
- `GET /api/files/context`

## DB Tables

projects, sessions, snapshots, todos, notes, memory_embeddings, project_brief, error_patterns, instructions

## Enum Values (must match DB CHECK constraints)

- **error_type**: build, runtime, type, test, dependency, config, network, general, other
- **instruction category**: general, build, style, workflow, constraint, security, testing, other
- **note category**: decision, debug, architecture, reference, general
- **todo status**: todo, in_progress, blocked, done

## Key Technical Details

- Project scoping via `project_id` (sha256 of absolute path, first 12 chars)
- Dedup via pg_trgm similarity (>0.8 for notes/instructions, >0.7 for errors)
- Embedding graceful fallback — structured ops work without embedding service
- Atomic upsert for project_brief via ON CONFLICT

## Build & Deploy Workflow

1. Edit source in `mcp-server/src/`
2. `cd mcp-server && npm run build` — compiles to `mcp-server/build/`
3. `./sync-api-server.sh` — copies changed files to `api-server/src/`
4. `docker compose build api-server && docker compose up -d api-server`
5. MCP stdio picks up changes on next session restart

## Ports (all 41xxx — do NOT change without asking)

| Service | Port |
|---|---|
| PostgreSQL | 41432 |
| Embedding Service | 41100 |
| API Server | 41200 |
| Web UI | 41300 |

## Important Rules

1. **Never store project knowledge in this file.** All project data lives in Cortex.
2. **Always start sessions with the startup sequence.** Don't assume you know the project state.
3. **Save decisions as you make them.** Don't wait until session end — context can compress at any time.
4. **Use semantic search before making assumptions.** Past-you may have already solved this problem.
5. **Keep snapshots focused.** Summarize what matters, not everything that happened.
6. **Tag consistently.** Use module names, feature names, and concern areas as tags for better retrieval.
