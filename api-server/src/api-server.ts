/**
 * REST API Server for the Web UI
 *
 * Runs inside Docker alongside postgres and embedding-service.
 * Exposes the same tool implementations as the MCP stdio server via HTTP.
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { checkDb } from "./db.js";
import { checkEmbeddingService } from "./embeddings.js";
import {
  registerProject,
  listProjects,
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
} from "./tools.js";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.API_PORT || "3100");

app.use(cors());
app.use(express.json({ limit: "5mb" }));

/** Extract project_id from query param or body. Falls back to 'default'. */
function pid(req: express.Request): string {
  return (req.query.project_id as string) || req.body?.project_id || "default";
}

// ── Health ────────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const db = await checkDb();
    const emb = await checkEmbeddingService();
    res.json({ status: "ok", db: db ? "connected" : "disconnected", embedding: emb ? "connected" : "unavailable" });
  } catch (err: any) {
    res.status(503).json({ status: "error", error: err.message });
  }
});

// ── Projects ─────────────────────────────────────────────────
app.get("/api/projects", async (_req, res) => {
  try { res.json(await listProjects()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { project_id, name, path } = req.body;
    if (!project_id) return res.status(400).json({ error: "project_id required" });
    await registerProject(project_id, name, path);
    res.json({ message: "Project registered", project_id });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/projects/:id", async (req, res) => {
  try { res.json(await deleteProject(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Stats ─────────────────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  try { res.json(await getStats(pid(req) !== "default" ? pid(req) : undefined)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Snapshots ─────────────────────────────────────────────────
app.get("/api/snapshots", async (req, res) => {
  try { res.json(await getSnapshots(pid(req), parseInt(req.query.limit as string) || 20)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get("/api/snapshots/:id", async (req, res) => {
  try {
    const snap = await getSnapshot(pid(req), req.params.id);
    if (!snap) return res.status(404).json({ error: "Not found" });
    res.json(snap);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/snapshots", async (req, res) => {
  try { res.json(await createSnapshot(pid(req), req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/snapshots/diff", async (req, res) => {
  try { res.json(await diffSnapshots(pid(req), req.body.id1, req.body.id2)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Todos ─────────────────────────────────────────────────────
app.get("/api/todos", async (req, res) => {
  try {
    const tags = req.query.tags ? (req.query.tags as string).split(",") : undefined;
    res.json(await listTodos(pid(req), req.query.status as string || "all", tags));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/todos", async (req, res) => {
  try { res.json(await addTodo(pid(req), req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/todos/:id", async (req, res) => {
  try { res.json(await updateTodo(pid(req), req.params.id, req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/todos/:id/complete", async (req, res) => {
  try { res.json(await completeTodo(pid(req), req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/todos/:id", async (req, res) => {
  try { res.json(await deleteTodo(pid(req), req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Notes ─────────────────────────────────────────────────────
app.get("/api/notes", async (req, res) => {
  try { res.json(await listNotes(pid(req), req.query.category as string, parseInt(req.query.limit as string) || 20)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/notes", async (req, res) => {
  try { res.json(await addNote(pid(req), req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/notes/:id", async (req, res) => {
  try { res.json(await deleteNote(pid(req), req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Search ────────────────────────────────────────────────────
app.post("/api/search", async (req, res) => {
  try { res.json(await retrieveMemory(pid(req), req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Project Summary & Session ─────────────────────────────────
app.get("/api/summary", async (req, res) => {
  try { res.json(await summarizeProject(pid(req), parseInt(req.query.depth as string) || 3)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get("/api/session", async (req, res) => {
  try { res.json(await sessionSync(pid(req))); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Prune ─────────────────────────────────────────────────────
app.post("/api/prune", async (req, res) => {
  try { res.json(await pruneMemory(pid(req), req.body.older_than_days, req.body.keep_tagged)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Project Brief ─────────────────────────────────────────────
app.get("/api/brief", async (req, res) => {
  try { res.json(await getProjectBrief(pid(req))); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/brief", async (req, res) => {
  try { res.json(await setProjectBrief(pid(req), req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Recent Changes ────────────────────────────────────────────
app.get("/api/changes", async (req, res) => {
  try { res.json(await getRecentChanges(pid(req), parseInt(req.query.hours as string) || 24)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Error Patterns ────────────────────────────────────────────
app.get("/api/errors", async (req, res) => {
  try { res.json(await listErrorPatterns(pid(req), parseInt(req.query.limit as string) || 50)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/errors", async (req, res) => {
  try { res.json(await logErrorPattern(pid(req), req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/errors/check", async (req, res) => {
  try { res.json(await checkErrorPatterns(pid(req), req.body.error_message, req.body.limit)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Instructions ──────────────────────────────────────────────
app.get("/api/instructions", async (req, res) => {
  try { res.json(await getInstructions(pid(req), req.query.category as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post("/api/instructions", async (req, res) => {
  try { res.json(await addInstruction(pid(req), req.body)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/instructions/:id", async (req, res) => {
  try { res.json(await removeInstruction(pid(req), req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── File Context ──────────────────────────────────────────────
app.get("/api/files/context", async (req, res) => {
  try { res.json(await getFileContext(pid(req), req.query.path as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[API Server] Running on :${PORT}`);
});
