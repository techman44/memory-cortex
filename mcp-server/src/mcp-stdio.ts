#!/usr/bin/env node
/**
 * MCP Memory Cortex — stdio transport server for Claude Code
 *
 * Uses the official @modelcontextprotocol/sdk with StdioServerTransport.
 * Claude Code launches this process and communicates via stdin/stdout JSON-RPC.
 *
 * IMPORTANT: Never use console.log() — it corrupts the JSON-RPC stream.
 * Use console.error() for debug logging (goes to stderr).
 */

import { createHash } from "crypto";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

import {
  registerProject,
  deleteProject,
  createSnapshot,
  getSnapshots,
  getSnapshot,
  diffSnapshots,
  addTodo,
  updateTodo,
  completeTodo,
  deleteTodo,
  listTodos,
  addNote,
  listNotes,
  deleteNote,
  listErrorPatterns,
  retrieveMemory,
  summarizeProject,
  sessionSync,
  pruneMemory,
  getStats,
  getProjectBrief,
  setProjectBrief,
  getRecentChanges,
  logErrorPattern,
  checkErrorPatterns,
  addInstruction,
  getInstructions,
  removeInstruction,
  getFileContext,
  getProjectIndex,
  getNote,
  getTodo,
  getErrorPattern,
} from "./tools.js";

dotenv.config();

// ── Resolve project identity ───────────────────────────────────
function resolveProjectId(): string {
  if (process.env.MCP_PROJECT_ID) return process.env.MCP_PROJECT_ID;
  const cwd = process.cwd();
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

const PROJECT_ID = resolveProjectId();

// ── Create MCP Server ───────────────────────────────────────────
const server = new McpServer({
  name: "memory-cortex",
  version: "1.0.0",
});

// ── Coercion helpers for LLM-friendly input ─────────────────────
// LLMs frequently pass numbers as strings ("1" instead of 1) and
// arrays as JSON strings ("[\"a\"]" instead of ["a"]). These helpers
// make zod schemas forgiving about those mistakes.
const coercedNumber = z.preprocess(
  (val) => (typeof val === "string" ? Number(val) : val),
  z.number()
);

function coercedStringArray() {
  return z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    },
    z.array(z.string())
  );
}

// ── Helper: wrap tool result as MCP text content ────────────────
function textResult(data: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

// ══════════════════════════════════════════════════════════════
// Tool: create_snapshot
// ══════════════════════════════════════════════════════════════
server.tool(
  "create_snapshot",
  "Capture structured project state. Use at milestones, before context compression, or after major architectural changes.",
  {
    summary: z.string().describe("High-level project state summary"),
    architecture_notes: z.string().optional().describe("Current architectural decisions, patterns, tech stack details"),
    module_focus: z.string().optional().describe("Current module or area of active development"),
    assumptions: coercedStringArray().optional().describe("Active assumptions the code relies on"),
    constraints: coercedStringArray().optional().describe("Known constraints or limitations"),
    file_paths: coercedStringArray().optional().describe("Key file paths relevant to current work"),
    tags: coercedStringArray().optional().describe("Categorization tags"),
  },
  async (params) => {
    try { return textResult(await createSnapshot(PROJECT_ID, params)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: retrieve_memory
// ══════════════════════════════════════════════════════════════
server.tool(
  "retrieve_memory",
  "Search stored memory using semantic similarity, keyword matching, or hybrid. Use to recall past decisions, architecture context, or debug notes.",
  {
    query: z.string().describe("What to search for — question, concept, or keyword"),
    mode: z.enum(["semantic", "keyword", "hybrid"]).optional().describe("Search mode (default: hybrid)"),
    tags: coercedStringArray().optional().describe("Filter by tags"),
    limit: coercedNumber.optional().describe("Max results (default 5)"),
    content_type: z.enum(["summary", "architecture", "debug", "note", "decision", "task", "error", "instruction"]).optional().describe("Filter by content category"),
  },
  async (params) => {
    try { return textResult(await retrieveMemory(PROJECT_ID, params)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: add_todo
// ══════════════════════════════════════════════════════════════
server.tool(
  "add_todo",
  "Create a tracked task with priority, tags, and linked files.",
  {
    title: z.string().describe("Task title — clear and actionable"),
    description: z.string().optional().describe("Detailed task description"),
    status: z.enum(["todo", "in_progress", "blocked", "done"]).optional().describe("Initial status (default: todo)"),
    priority: coercedNumber.pipe(z.number().min(0).max(2)).optional().describe("0=normal, 1=high, 2=critical"),
    related_files: coercedStringArray().optional().describe("File paths related to this task"),
    snapshot_id: z.string().optional().describe("Link to a specific snapshot"),
    tags: coercedStringArray().optional().describe("Categorization tags"),
    blocked_reason: z.string().optional().describe("Why this task is blocked"),
  },
  async (params) => {
    try { return textResult(await addTodo(PROJECT_ID, params)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: update_todo
// ══════════════════════════════════════════════════════════════
server.tool(
  "update_todo",
  "Modify a task's status, description, priority, or other fields.",
  {
    id: z.string().describe("UUID of the todo to update"),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
    priority: coercedNumber.pipe(z.number().min(0).max(2)).optional(),
    related_files: coercedStringArray().optional(),
    snapshot_id: z.string().optional(),
    tags: coercedStringArray().optional(),
    blocked_reason: z.string().optional(),
  },
  async (params) => {
    try {
      const { id, ...fields } = params;
      return textResult(await updateTodo(PROJECT_ID, id, fields));
    } catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: complete_todo
// ══════════════════════════════════════════════════════════════
server.tool(
  "complete_todo",
  "Mark a task as done and record completion timestamp.",
  { id: z.string().describe("UUID of the todo to complete") },
  async ({ id }) => {
    try { return textResult(await completeTodo(PROJECT_ID, id)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: delete_todo
// ══════════════════════════════════════════════════════════════
server.tool(
  "delete_todo",
  "Permanently remove a task and its embeddings.",
  { id: z.string().describe("UUID of the todo to delete") },
  async ({ id }) => {
    try { return textResult(await deleteTodo(PROJECT_ID, id)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: list_todos
// ══════════════════════════════════════════════════════════════
server.tool(
  "list_todos",
  "Return tasks grouped by status (kanban board view). Default excludes done tasks for efficiency.",
  {
    status: z.enum(["active", "todo", "in_progress", "blocked", "done", "all"]).optional().describe("Filter: 'active' (default, excludes done), specific status, or 'all'"),
    tags: coercedStringArray().optional().describe("Filter by tags"),
  },
  async (params) => {
    try { return textResult(await listTodos(PROJECT_ID, params.status, params.tags)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: add_note
// ══════════════════════════════════════════════════════════════
server.tool(
  "add_note",
  "Save freeform memory. Automatically deduplicates — similar existing notes are updated instead of duplicated.",
  {
    content: z.string().describe("The note content"),
    category: z.enum(["decision", "debug", "architecture", "reference", "general"]).optional().describe("Note category (default: general)"),
    tags: coercedStringArray().optional().describe("Tags for filtering"),
    related_files: coercedStringArray().optional().describe("Related file paths"),
    snapshot_id: z.string().optional().describe("Link to a snapshot"),
  },
  async (params) => {
    try { return textResult(await addNote(PROJECT_ID, params)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: list_notes
// ══════════════════════════════════════════════════════════════
server.tool(
  "list_notes",
  "List recent notes, optionally filtered by category.",
  {
    category: z.enum(["decision", "debug", "architecture", "reference", "general"]).optional(),
    limit: coercedNumber.optional().describe("Max results (default 20)"),
  },
  async (params) => {
    try { return textResult(await listNotes(PROJECT_ID, params.category, params.limit)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: summarize_project
// ══════════════════════════════════════════════════════════════
server.tool(
  "summarize_project",
  "Condensed project state from latest snapshots, active todos, and recent notes.",
  { depth: coercedNumber.optional().describe("Number of recent snapshots to include (default 3)") },
  async (params) => {
    try { return textResult(await summarizeProject(PROJECT_ID, params.depth)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: session_sync
// ══════════════════════════════════════════════════════════════
server.tool(
  "session_sync",
  "Restore full working context: latest snapshot + active todos + recent notes + active instructions + recent error patterns. Call at session start.",
  {},
  async () => {
    try { return textResult(await sessionSync(PROJECT_ID)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: prune_memory
// ══════════════════════════════════════════════════════════════
server.tool(
  "prune_memory",
  "Remove stale memory entries older than N days. Entries with specified tags are preserved.",
  {
    older_than_days: coercedNumber.describe("Remove entries older than this many days"),
    keep_tagged: coercedStringArray().optional().describe("Preserve entries with any of these tags"),
  },
  async (params) => {
    try { return textResult(await pruneMemory(PROJECT_ID, params.older_than_days, params.keep_tagged)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: diff_snapshots
// ══════════════════════════════════════════════════════════════
server.tool(
  "diff_snapshots",
  "Compare two snapshots to see what changed between them.",
  {
    snapshot_id_1: z.string().describe("UUID of the older snapshot"),
    snapshot_id_2: z.string().describe("UUID of the newer snapshot"),
  },
  async ({ snapshot_id_1, snapshot_id_2 }) => {
    try { return textResult(await diffSnapshots(PROJECT_ID, snapshot_id_1, snapshot_id_2)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: get_project_brief
// ══════════════════════════════════════════════════════════════
server.tool(
  "get_project_brief",
  "Get foundational project identity: tech stack, modules, conventions, constraints. Call on session start to orient yourself.",
  {},
  async () => {
    try { return textResult(await getProjectBrief(PROJECT_ID)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: set_project_brief
// ══════════════════════════════════════════════════════════════
server.tool(
  "set_project_brief",
  "Set or update foundational project description. One brief per project (overwrites previous).",
  {
    project_name: z.string().describe("Name of the project"),
    tech_stack: z.string().optional().describe("Languages, frameworks, databases, key dependencies"),
    module_map: z.string().optional().describe("Main modules/services and how they connect"),
    conventions: z.string().optional().describe("Coding conventions, naming patterns, file structure rules"),
    critical_constraints: z.string().optional().describe("Hard constraints: performance, compatibility, security"),
    entry_points: z.string().optional().describe("Key entry points: main files, config, test/build commands"),
  },
  async (params) => {
    try { return textResult(await setProjectBrief(PROJECT_ID, params)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: get_recent_changes
// ══════════════════════════════════════════════════════════════
server.tool(
  "get_recent_changes",
  "What evolved recently: new snapshots, notes, tasks, completions. Use to understand recent momentum.",
  { since_hours: coercedNumber.optional().describe("Look back this many hours (default 24)") },
  async (params) => {
    try { return textResult(await getRecentChanges(PROJECT_ID, params.since_hours)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: system_status
// ══════════════════════════════════════════════════════════════
server.tool(
  "system_status",
  "Check health and stats of the Memory Cortex system.",
  {},
  async () => {
    try { return textResult(await getStats(PROJECT_ID)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: log_error_pattern
// ══════════════════════════════════════════════════════════════
server.tool(
  "log_error_pattern",
  "Log an error with its root cause and resolution. Automatically deduplicates — repeated errors increment the occurrence count. Use after diagnosing any non-trivial error.",
  {
    error_message: z.string().describe("The error message or pattern"),
    error_type: z.enum(["build", "runtime", "type", "test", "dependency", "config", "network", "general", "other"]).optional().describe("Error category (default: general)"),
    attempted_fixes: coercedStringArray().optional().describe("What was tried (including failed attempts)"),
    root_cause: z.string().optional().describe("What actually caused the error"),
    resolution: z.string().optional().describe("What fixed it"),
    file_paths: coercedStringArray().optional().describe("Files involved"),
    tags: coercedStringArray().optional().describe("Tags"),
  },
  async (params) => {
    try { return textResult(await logErrorPattern(PROJECT_ID, params)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: check_error_patterns
// ══════════════════════════════════════════════════════════════
server.tool(
  "check_error_patterns",
  "Search for previously seen errors matching this message. Call BEFORE attempting to fix an error — a known resolution may already exist.",
  {
    error_message: z.string().describe("The error message to look up"),
    limit: coercedNumber.optional().describe("Max results (default 3)"),
  },
  async (params) => {
    try { return textResult(await checkErrorPatterns(PROJECT_ID, params.error_message, params.limit)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: add_instruction
// ══════════════════════════════════════════════════════════════
server.tool(
  "add_instruction",
  "Add a persistent directive for this project. Instructions are loaded on every session sync. Use for rules like 'always use bun', 'never modify auth module without asking'.",
  {
    content: z.string().describe("The instruction text"),
    category: z.enum(["general", "build", "style", "workflow", "constraint", "security", "testing", "other"]).optional().describe("Category (default: general)"),
    priority: coercedNumber.pipe(z.number().min(0).max(2)).optional().describe("0=normal, 1=high, 2=critical"),
    tags: coercedStringArray().optional().describe("Tags"),
  },
  async (params) => {
    try { return textResult(await addInstruction(PROJECT_ID, params)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: get_instructions
// ══════════════════════════════════════════════════════════════
server.tool(
  "get_instructions",
  "Get all active instructions for this project.",
  { category: z.enum(["general", "build", "style", "workflow", "constraint", "security", "testing", "other"]).optional() },
  async (params) => {
    try { return textResult(await getInstructions(PROJECT_ID, params.category)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: remove_instruction
// ══════════════════════════════════════════════════════════════
server.tool(
  "remove_instruction",
  "Deactivate an instruction (soft delete).",
  { id: z.string().describe("UUID of the instruction to remove") },
  async ({ id }) => {
    try { return textResult(await removeInstruction(PROJECT_ID, id)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: get_file_context
// ══════════════════════════════════════════════════════════════
server.tool(
  "get_file_context",
  "Get all known context for a specific file: notes, todos, error patterns, and snapshots that reference it.",
  { file_path: z.string().describe("The file path to look up") },
  async ({ file_path }) => {
    try { return textResult(await getFileContext(PROJECT_ID, file_path)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: delete_note
// ══════════════════════════════════════════════════════════════
server.tool(
  "delete_note",
  "Permanently delete a note and its embeddings.",
  { id: z.string().describe("UUID of the note to delete") },
  async ({ id }) => {
    try { return textResult(await deleteNote(PROJECT_ID, id)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: list_error_patterns
// ══════════════════════════════════════════════════════════════
server.tool(
  "list_error_patterns",
  "List all logged error patterns for this project, ordered by most recently seen.",
  { limit: coercedNumber.optional().describe("Max results (default 50)") },
  async (params) => {
    try { return textResult(await listErrorPatterns(PROJECT_ID, params.limit)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: get_project_index
// ══════════════════════════════════════════════════════════════
server.tool(
  "get_project_index",
  "Lightweight project catalog (~800 tokens). Returns counts, active todos (title+status), recent snapshot summaries, notes grouped by category (one-line each), error patterns, and active instructions — all with IDs for on-demand detail fetching. Use at session start instead of session_sync for context-efficient loading.",
  {},
  async () => {
    try { return textResult(await getProjectIndex(PROJECT_ID)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: get_note
// ══════════════════════════════════════════════════════════════
server.tool(
  "get_note",
  "Fetch full note details by UUID. Use after get_project_index to load specific notes on demand.",
  { id: z.string().describe("UUID of the note to fetch") },
  async ({ id }) => {
    try {
      const note = await getNote(PROJECT_ID, id);
      if (!note) return errorResult("Note not found");
      return textResult(note);
    } catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: get_todo
// ══════════════════════════════════════════════════════════════
server.tool(
  "get_todo",
  "Fetch full todo details by UUID. Use after get_project_index to load specific todos on demand.",
  { id: z.string().describe("UUID of the todo to fetch") },
  async ({ id }) => {
    try {
      const todo = await getTodo(PROJECT_ID, id);
      if (!todo) return errorResult("Todo not found");
      return textResult(todo);
    } catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: get_error_pattern
// ══════════════════════════════════════════════════════════════
server.tool(
  "get_error_pattern",
  "Fetch full error pattern details by UUID. Use after get_project_index to load specific error patterns on demand.",
  { id: z.string().describe("UUID of the error pattern to fetch") },
  async ({ id }) => {
    try {
      const pattern = await getErrorPattern(PROJECT_ID, id);
      if (!pattern) return errorResult("Error pattern not found");
      return textResult(pattern);
    } catch (e: any) { return errorResult(e.message); }
  }
);

// ══════════════════════════════════════════════════════════════
// Tool: delete_project
// ══════════════════════════════════════════════════════════════
server.tool(
  "delete_project",
  "Permanently delete a project and ALL its data (snapshots, notes, todos, errors, instructions, embeddings, brief). This is irreversible.",
  { project_id: z.string().describe("ID of the project to delete") },
  async ({ project_id }) => {
    try { return textResult(await deleteProject(project_id)); }
    catch (e: any) { return errorResult(e.message); }
  }
);

// ── Connect stdio transport and start ───────────────────────
async function main() {
  console.error(`[MCP Memory Cortex] Starting stdio transport...`);
  console.error(`[MCP Memory Cortex] Project ID: ${PROJECT_ID}`);

  // Register this project in the database
  try {
    await registerProject(PROJECT_ID, path.basename(process.cwd()), process.cwd());
    console.error(`[MCP Memory Cortex] Project registered.`);
  } catch (e: any) {
    console.error(`[MCP Memory Cortex] Warning: could not register project: ${e.message}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP Memory Cortex] Connected and ready.");
}

main().catch((err) => {
  console.error("[MCP Memory Cortex] Fatal error:", err);
  process.exit(1);
});
