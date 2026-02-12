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
