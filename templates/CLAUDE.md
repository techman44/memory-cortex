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

### During Active Work — Todos

**Every piece of work MUST be tracked as a todo. No exceptions. If there is no todo, the work does not exist.**

When the user gives you a task:
1. **IMMEDIATELY** call `add_todo` for the overall task — before reading files, before writing code
2. If the task has multiple steps, call `add_todo` for EACH step
3. Call `update_todo` with `status="in_progress"` the MOMENT you start working on a step
4. Call `complete_todo` the MOMENT you finish a step — not later, not in a batch, NOW
5. If you get blocked, call `update_todo` with `status="blocked"` and `blocked_reason`

Every todo MUST pass through all three stages: `todo` → `in_progress` → `done`. The dashboard Board tab is the user's window into your work. If it's empty while you're working, you have failed.

### During Active Work — Notes and Memory

- **After making an architectural decision** → `add_note` with category "decision"
- **After debugging something non-obvious** → `add_note` with category "debug"
- **Before implementing a plan** → `add_note` category="decision" with the full plan: goals, steps, rationale, open questions. If large, also `create_snapshot`. Plans MUST be persisted BEFORE code is written.
- **After completing a milestone or significant change** → `create_snapshot`
- **After diagnosing an error** → `log_error_pattern` with root cause and resolution
- **Before fixing an error** → `check_error_patterns` to see if it's been solved before

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

**Before fixing any error:**
→ Call `check_error_patterns` — a known resolution may already exist.

## Write Triggers — When to Save Memory

| Event | Action |
|---|---|
| Architectural decision made | `add_note` category="decision" |
| Bug found and diagnosed | `log_error_pattern` with root cause and resolution |
| New pattern or convention established | `add_note` category="architecture" + update `set_project_brief` if fundamental |
| Useful reference discovered | `add_note` category="reference" |
| Plan created or finalized | `add_note` category="decision" with full plan. Also `create_snapshot` if large. |
| Code committed to git | `create_snapshot` with commit hash and change summary — immediately after push |
| Milestone completed | `create_snapshot` + `complete_todo` |
| New work item identified | `add_todo` |
| Major refactor or structural change | `create_snapshot` + update `set_project_brief` |
| Before ending session | `create_snapshot` |

## Important Rules

1. **Never store project knowledge in this file.** All project data lives in Cortex.
2. **Always start sessions with the startup sequence.** Don't assume you know the project state.
3. **Save decisions as you make them.** Don't wait until session end — context can compress at any time.
4. **Use semantic search before making assumptions.** Past-you may have already solved this problem.
5. **Keep snapshots focused.** Summarize what matters, not everything that happened.
6. **Tag consistently.** Use module names, feature names, and concern areas as tags for better retrieval.
7. **Never do work without a todo.** Every task gets `add_todo` BEFORE work starts, `update_todo` to in_progress WHEN it starts, and `complete_todo` WHEN it finishes. No exceptions.
8. **Never persist a plan only in conversation.** Plans MUST be saved to Cortex via `add_note` category="decision" BEFORE implementation begins.
