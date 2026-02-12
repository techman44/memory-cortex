# Memory Cortex Protocol

This project uses **MCP Memory Cortex** for persistent context. Do NOT store project knowledge in this file.

## Session Start (always do this first)
1. `get_project_brief` — load project identity
2. `session_sync` — restore working state (todos, notes, instructions, recent errors)
3. `get_recent_changes` with `since_hours: 48` — catch up on recent work

If `get_project_brief` returns no brief: explore the project, then call `set_project_brief`.

## During Work
- After an architectural decision: `add_note` category="decision"
- After debugging something non-obvious: `add_note` category="debug"
- After completing a milestone: `create_snapshot`
- When you encounter an error: `check_error_patterns` BEFORE attempting a fix
- After resolving an error: `log_error_pattern` with the root cause and resolution
- When the user gives a persistent instruction: `add_instruction`
- Before modifying a file you haven't seen: `get_file_context`

## Before Context Compression
1. `create_snapshot` with current state
2. `summarize_project` to verify state is captured

## After Context Compression
1. `get_project_brief` — re-orient
2. `session_sync` — restore state
3. `get_recent_changes` — catch up

## Rules
1. Never store project knowledge in this file — all data lives in Cortex
2. Always start sessions with the startup sequence
3. Save decisions as you make them — don't wait until session end
4. Check error patterns before attempting fixes
5. Use semantic search before making assumptions
