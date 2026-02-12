# Memory Cortex Protocol — MANDATORY

This project uses **MCP Memory Cortex** as its single source of truth for all persistent context. Do NOT store project knowledge in this file. Do NOT skip any step below. These are not suggestions — they are hard requirements.

---

## BLOCKING PREREQUISITE — Session Startup

**You MUST call these three tools BEFORE doing ANY other work. No exceptions. No deferring. Do it first.**

1. `get_project_brief` — loads foundational project identity
2. `session_sync` — loads latest snapshot, active todos, recent notes
3. `get_recent_changes` with `since_hours: 48` — understand recent momentum

If `get_project_brief` returns empty, this is a new project. You MUST immediately:
- Read package.json, config files, and directory structure
- Call `set_project_brief` with what you learn
- Call `create_snapshot` with initial architectural overview
- Call `add_note` category="architecture" for key observations

**Do NOT proceed to any user task until startup is complete.**

---

## MANDATORY — Real-Time Persistence During Work

**Every significant thought, decision, or finding MUST be persisted to Cortex immediately. Do NOT batch. Do NOT wait. Context can compress at any time and anything not saved is lost forever.**

| When this happens | You MUST do this immediately |
|---|---|
| You make any architectural or design decision | `add_note` category="decision" — capture the what, why, and alternatives rejected |
| You formulate a plan (before implementing) | `add_note` category="decision" — persist the full plan BEFORE writing any code |
| You debug something non-obvious | `add_note` category="debug" — capture symptoms, root cause, and fix |
| You diagnose any error | `log_error_pattern` with error_message, root_cause, resolution, and file_paths |
| You are about to fix an error | `check_error_patterns` FIRST — it may already be solved |
| You discover or create a work item | `add_todo` with title, description, and tags |
| You finish a task | `complete_todo` immediately |
| You get blocked | `update_todo` with status="blocked" and blocked_reason |
| You complete a milestone or significant change | `create_snapshot` summarizing what was accomplished |
| You establish a new pattern or convention | `add_note` category="architecture" + `set_project_brief` if fundamental |
| You find a useful reference | `add_note` category="reference" |
| A major refactor or structural change is done | `create_snapshot` + update `set_project_brief` |

**If in doubt about whether something is worth saving — save it. Over-persistence is always better than lost context.**

---

## CRITICAL — Todo Tracking Is Non-Negotiable

**Todos are the heartbeat of your workflow. They are NOT optional. They are NOT "nice to have." Every piece of work you do MUST be tracked as a todo. If there is no todo, the work does not exist.**

### When the user gives you a task:

1. **IMMEDIATELY** call `add_todo` for the overall task — before you read a single file, before you write a single line of code
2. If the task has multiple steps, create a todo for EACH step
3. Call `update_todo` with `status="in_progress"` the MOMENT you start working on a step
4. Call `complete_todo` the MOMENT you finish a step — not later, not in a batch, NOW
5. If you get blocked, call `update_todo` with `status="blocked"` and `blocked_reason`

### The lifecycle of EVERY todo:

```
add_todo (status="todo")  →  update_todo (status="in_progress")  →  complete_todo (status="done")
```

**You MUST move every todo through ALL three stages. No skipping. No shortcuts.**

### What counts as a todo:

- Every user request (the parent task)
- Every implementation step within that request
- Every bug you find that needs fixing
- Every file that needs modification
- Every build/deploy step
- Every follow-up item you discover while working

### Examples of CORRECT behavior:

```
User: "Add a new API endpoint"

1. add_todo("Add new API endpoint for X")           → status: todo
2. update_todo(id, status="in_progress")             → you start working
3. add_todo("Write handler function in tools.ts")    → sub-task
4. update_todo(sub_id, status="in_progress")         → start sub-task
5. complete_todo(sub_id)                             → handler done
6. add_todo("Add route in api-server.ts")            → next sub-task
7. update_todo(sub2_id, status="in_progress")        → start it
8. complete_todo(sub2_id)                            → route done
9. add_todo("Build and deploy")                      → deploy step
10. update_todo(sub3_id, status="in_progress")       → deploying
11. complete_todo(sub3_id)                           → deployed
12. complete_todo(parent_id)                         → whole task done
```

### What FAILURE looks like (DO NOT DO THIS):

- Doing work without any todos → **UNACCEPTABLE**
- Creating a todo only after the work is done → **UNACCEPTABLE**
- Creating a todo but never moving it to in_progress → **UNACCEPTABLE**
- Finishing work but forgetting to complete_todo → **UNACCEPTABLE**
- Batching all todo updates at the end → **UNACCEPTABLE**

**The dashboard's Board tab is the user's window into what you're doing. If the board is empty while you're working, you have FAILED. The user should see tasks moving across the board in real-time as you work.**

---

## MANDATORY — Regular Snapshots

**You MUST call `create_snapshot` at these intervals, no exceptions:**

- After every milestone or significant code change
- Every ~10 messages in a long conversation
- Before any large or risky operation
- When you sense the conversation is getting long
- Before ending the session

When context feels large, also call `summarize_project` to verify state is fully captured.

---

## MANDATORY — After Every Git Commit

**Every commit MUST be followed by a `create_snapshot` that includes the commit hash and a summary of what changed. A commit without a Cortex snapshot is an INCOMPLETE change.**

After editing source code, the full sequence is:

1. Build the project
2. Sync any build contexts (e.g. `sync-api-server.sh`)
3. `git add` + `git commit` + `git push`
4. `create_snapshot` with commit hash and change summary — **immediately, not later**
5. Rebuild and restart any affected services (e.g. Docker containers)

**Steps 4 and 5 are EQUALLY mandatory. Never skip either. Never consider the work done until both are complete.**

---

## MANDATORY — After Context Compression

If you notice context may have been lost (conversation feels shorter, details are fuzzy):

1. `get_project_brief` — re-orient immediately
2. `session_sync` — restore working state
3. `get_recent_changes` — catch up on what happened

**Do NOT guess or assume. Re-load from Cortex.**

---

## MANDATORY — Query Before Acting

**You MUST consult Cortex memory before making changes. Never assume you already know.**

- **Before modifying any module's public interface** → `retrieve_memory` with the module name
- **Before suggesting a technology or pattern change** → `retrieve_memory` to check for stored decisions
- **Before touching a file you haven't seen this session** → `retrieve_memory` with the file path
- **When asked about project history** → `retrieve_memory` mode="semantic" with relevant terms
- **When uncertain about conventions** → `get_project_brief`
- **Before fixing any error** → `check_error_patterns`

---

## MANDATORY — Session End

**Before the session ends, you MUST:**

1. Call `create_snapshot` with a summary of everything accomplished
2. Mark all completed work with `complete_todo`
3. Log any unfinished items as todos with appropriate status

---

## Rules — Zero Tolerance

1. **NEVER store project knowledge in this file.** All project data lives in Cortex.
2. **NEVER skip the startup sequence.** You do not know the project state until Cortex tells you.
3. **NEVER wait to save decisions.** Persist immediately — context compression is unpredictable.
4. **NEVER assume past context.** Always query Cortex before making assumptions.
5. **NEVER end a session without a final snapshot.** Future-you depends on it.
6. **Tag everything consistently.** Use module names, feature names, and concern areas for retrieval.
7. **NEVER do work without a todo.** Every task gets an `add_todo` BEFORE work starts, `update_todo` to in_progress WHEN work starts, and `complete_todo` WHEN work finishes. No exceptions.
8. **NEVER persist a plan only in conversation.** Plans MUST be saved to Cortex via `add_note` category="decision" BEFORE implementation begins.
