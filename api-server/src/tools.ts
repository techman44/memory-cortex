import { randomUUID } from "crypto";
import { getPool, vecLiteral, escapeIlike } from "./db.js";
import { embed, checkEmbeddingService } from "./embeddings.js";

// ══════════════════════════════════════════════════════════════
// Projects
// ══════════════════════════════════════════════════════════════

export async function registerProject(projectId: string, name?: string, projectPath?: string) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO projects (id, name, path, last_accessed_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET last_accessed_at = now(), name = COALESCE($2, projects.name), path = COALESCE($3, projects.path)`,
    [projectId, name || null, projectPath || null]
  );
}

export async function listProjects() {
  const { rows } = await getPool().query(
    `SELECT p.id, p.name, p.path, p.last_accessed_at,
       (SELECT count(*) FROM snapshots s WHERE s.project_id = p.id)::int as snapshot_count,
       (SELECT count(*) FROM todos t WHERE t.project_id = p.id AND t.status != 'done')::int as active_todos,
       (SELECT count(*) FROM notes n WHERE n.project_id = p.id)::int as note_count
     FROM projects p ORDER BY p.last_accessed_at DESC`
  );
  return rows;
}

// ══════════════════════════════════════════════════════════════
// Dedup helpers
// ══════════════════════════════════════════════════════════════

async function findSimilarNote(projectId: string, content: string, category: string): Promise<string | null> {
  try {
    const { rows } = await getPool().query(
      `SELECT id FROM notes
       WHERE project_id = $1 AND category = $2 AND similarity(content, $3) > 0.8
       ORDER BY similarity(content, $3) DESC LIMIT 1`,
      [projectId, category, content]
    );
    return rows[0]?.id || null;
  } catch {
    // pg_trgm fallback: exact match
    const { rows } = await getPool().query(
      `SELECT id FROM notes WHERE project_id = $1 AND category = $2 AND content = $3 LIMIT 1`,
      [projectId, category, content]
    );
    return rows[0]?.id || null;
  }
}

async function findSimilarInstruction(projectId: string, content: string): Promise<string | null> {
  try {
    const { rows } = await getPool().query(
      `SELECT id FROM instructions
       WHERE project_id = $1 AND active = true AND similarity(content, $2) > 0.8
       ORDER BY similarity(content, $2) DESC LIMIT 1`,
      [projectId, content]
    );
    return rows[0]?.id || null;
  } catch {
    const { rows } = await getPool().query(
      `SELECT id FROM instructions WHERE project_id = $1 AND active = true AND content = $2 LIMIT 1`,
      [projectId, content]
    );
    return rows[0]?.id || null;
  }
}

async function findSimilarErrorPattern(projectId: string, errorMessage: string): Promise<any | null> {
  try {
    const { rows } = await getPool().query(
      `SELECT id, attempted_fixes, occurrence_count FROM error_patterns
       WHERE project_id = $1 AND similarity(error_message, $2) > 0.7
       ORDER BY similarity(error_message, $2) DESC LIMIT 1`,
      [projectId, errorMessage]
    );
    return rows[0] || null;
  } catch {
    const { rows } = await getPool().query(
      `SELECT id, attempted_fixes, occurrence_count FROM error_patterns
       WHERE project_id = $1 AND error_message = $2 LIMIT 1`,
      [projectId, errorMessage]
    );
    return rows[0] || null;
  }
}

// ══════════════════════════════════════════════════════════════
// Snapshots
// ══════════════════════════════════════════════════════════════

export interface CreateSnapshotParams {
  summary: string;
  architecture_notes?: string;
  module_focus?: string;
  assumptions?: string[];
  constraints?: string[];
  file_paths?: string[];
  tags?: string[];
  session_id?: string;
}

export async function createSnapshot(projectId: string, params: CreateSnapshotParams) {
  const pool = getPool();
  const id = randomUUID();

  await pool.query(
    `INSERT INTO snapshots (id, project_id, summary, architecture_notes, module_focus, assumptions, constraints, file_paths, tags, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id, projectId,
      params.summary,
      params.architecture_notes || null,
      params.module_focus || null,
      params.assumptions || [],
      params.constraints || [],
      params.file_paths || [],
      params.tags || [],
      params.session_id || null,
    ]
  );

  const textsToEmbed: string[] = [];
  const types: string[] = [];
  if (params.summary) { textsToEmbed.push(params.summary); types.push("summary"); }
  if (params.architecture_notes) { textsToEmbed.push(params.architecture_notes); types.push("architecture"); }

  if (textsToEmbed.length > 0) {
    const vectors = await embed(textsToEmbed);
    if (vectors) {
      for (let i = 0; i < textsToEmbed.length; i++) {
        await pool.query(
          `INSERT INTO memory_embeddings (project_id, source_type, source_id, content_type, content_text, embedding, tags)
           VALUES ($1, 'snapshot', $2, $3, $4, $5::vector, $6)`,
          [projectId, id, types[i], textsToEmbed[i], vecLiteral(vectors[i]), params.tags || []]
        );
      }
    }
  }

  return { id, created_at: new Date().toISOString(), message: "Snapshot created and embedded" };
}

export async function getSnapshots(projectId: string, limit = 20) {
  const { rows } = await getPool().query(
    "SELECT * FROM snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2",
    [projectId, limit]
  );
  return rows;
}

export async function getSnapshot(projectId: string, id: string) {
  const { rows } = await getPool().query(
    "SELECT * FROM snapshots WHERE id = $1 AND project_id = $2",
    [id, projectId]
  );
  return rows[0] || null;
}

export async function diffSnapshots(projectId: string, id1: string, id2: string) {
  const [s1, s2] = await Promise.all([getSnapshot(projectId, id1), getSnapshot(projectId, id2)]);
  if (!s1 || !s2) return { error: "One or both snapshots not found" };

  const diff: Record<string, { before: any; after: any }> = {};
  const fields = ["summary", "architecture_notes", "module_focus", "assumptions", "constraints", "file_paths", "tags"];
  for (const f of fields) {
    const v1 = JSON.stringify(s1[f]);
    const v2 = JSON.stringify(s2[f]);
    if (v1 !== v2) diff[f] = { before: s1[f], after: s2[f] };
  }

  return {
    older: { id: s1.id, created_at: s1.created_at },
    newer: { id: s2.id, created_at: s2.created_at },
    changes: diff,
    fields_changed: Object.keys(diff),
  };
}

// ══════════════════════════════════════════════════════════════
// Todos
// ══════════════════════════════════════════════════════════════

export interface TodoParams {
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  related_files?: string[];
  snapshot_id?: string;
  tags?: string[];
  blocked_reason?: string;
}

export async function addTodo(projectId: string, params: TodoParams) {
  const pool = getPool();
  const id = randomUUID();
  const status = params.status || "todo";

  await pool.query(
    `INSERT INTO todos (id, project_id, title, description, status, priority, related_files, snapshot_id, tags, blocked_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, projectId, params.title, params.description || null, status,
     params.priority || 0, params.related_files || [], params.snapshot_id || null,
     params.tags || [], params.blocked_reason || null]
  );

  const vectors = await embed([`Task: ${params.title}. ${params.description || ""}`]);
  if (vectors) {
    await pool.query(
      `INSERT INTO memory_embeddings (project_id, source_type, source_id, content_type, content_text, embedding, tags)
       VALUES ($1, 'todo', $2, 'task', $3, $4::vector, $5)`,
      [projectId, id, `${params.title}: ${params.description || ""}`, vecLiteral(vectors[0]), params.tags || []]
    );
  }

  return { id, title: params.title, status, message: "Todo created" };
}

export async function updateTodo(projectId: string, id: string, fields: Partial<TodoParams>) {
  const sets: string[] = [];
  const vals: any[] = [id, projectId];
  let idx = 3;

  const allowedFields = ["title", "description", "status", "priority", "related_files", "snapshot_id", "tags", "blocked_reason"];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && allowedFields.includes(key)) {
      sets.push(`${key} = $${idx}`);
      vals.push(val);
      idx++;
    }
  }

  if (sets.length === 0) return { message: "No fields to update" };

  await getPool().query(
    `UPDATE todos SET ${sets.join(", ")} WHERE id = $1 AND project_id = $2`, vals
  );
  return { id, updated: Object.keys(fields), message: "Todo updated" };
}

export async function completeTodo(projectId: string, id: string) {
  await getPool().query(
    `UPDATE todos SET status = 'done', completed_at = now() WHERE id = $1 AND project_id = $2`,
    [id, projectId]
  );
  return { id, message: "Todo completed" };
}

export async function deleteTodo(projectId: string, id: string) {
  const pool = getPool();
  await pool.query("DELETE FROM memory_embeddings WHERE source_type = 'todo' AND source_id = $1 AND project_id = $2", [id, projectId]);
  await pool.query("DELETE FROM todos WHERE id = $1 AND project_id = $2", [id, projectId]);
  return { id, message: "Todo deleted" };
}

export async function listTodos(projectId: string, status = "all", tags?: string[]) {
  let sql = `SELECT * FROM todos WHERE project_id = $1`;
  const vals: any[] = [projectId];
  let idx = 2;

  if (status !== "all") { sql += ` AND status = $${idx}`; vals.push(status); idx++; }
  if (tags?.length) { sql += ` AND tags && $${idx}`; vals.push(tags); idx++; }

  sql += ` ORDER BY priority DESC, created_at ASC`;

  const { rows } = await getPool().query(sql, vals);

  const board: Record<string, any[]> = { todo: [], in_progress: [], blocked: [], done: [] };
  rows.forEach((r: any) => board[r.status]?.push(r));
  return { board, total: rows.length };
}

// ══════════════════════════════════════════════════════════════
// Notes (with dedup)
// ══════════════════════════════════════════════════════════════

export interface NoteParams {
  content: string;
  category?: string;
  tags?: string[];
  related_files?: string[];
  snapshot_id?: string;
}

export async function addNote(projectId: string, params: NoteParams) {
  const pool = getPool();
  const category = params.category || "general";

  // Dedup: check for similar existing note
  const existingId = await findSimilarNote(projectId, params.content, category);
  if (existingId) {
    // Merge: update content and refresh timestamp
    await pool.query(
      `UPDATE notes SET content = $1, tags = $2, created_at = now() WHERE id = $3`,
      [params.content, params.tags || [], existingId]
    );
    // Update embedding
    const vectors = await embed([params.content]);
    if (vectors) {
      await pool.query(
        `UPDATE memory_embeddings SET content_text = $1, embedding = $2::vector, created_at = now()
         WHERE source_type = 'note' AND source_id = $3`,
        [params.content, vecLiteral(vectors[0]), existingId]
      );
    }
    return { id: existingId, category, message: "Note updated (merged with similar existing note)", deduplicated: true };
  }

  // New note
  const id = randomUUID();
  await pool.query(
    `INSERT INTO notes (id, project_id, content, category, tags, related_files, snapshot_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, projectId, params.content, category, params.tags || [], params.related_files || [], params.snapshot_id || null]
  );

  const vectors = await embed([params.content]);
  if (vectors) {
    const contentType = category === "decision" ? "decision" : category === "debug" ? "debug" : "note";
    await pool.query(
      `INSERT INTO memory_embeddings (project_id, source_type, source_id, content_type, content_text, embedding, tags)
       VALUES ($1, 'note', $2, $3, $4, $5::vector, $6)`,
      [projectId, id, contentType, params.content, vecLiteral(vectors[0]), params.tags || []]
    );
  }

  return { id, category, message: "Note saved and embedded" };
}

export async function listNotes(projectId: string, category?: string, limit = 20) {
  let sql = "SELECT * FROM notes WHERE project_id = $1";
  const vals: any[] = [projectId];
  let idx = 2;
  if (category) { sql += ` AND category = $${idx}`; vals.push(category); idx++; }
  sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
  vals.push(limit);

  const { rows } = await getPool().query(sql, vals);
  return rows;
}

// ══════════════════════════════════════════════════════════════
// Memory Search (hybrid) — with ILIKE escaping fix
// ══════════════════════════════════════════════════════════════

export interface SearchParams {
  query: string;
  mode?: "semantic" | "keyword" | "hybrid";
  tags?: string[];
  limit?: number;
  content_type?: string;
}

export async function retrieveMemory(projectId: string, params: SearchParams) {
  const { query, mode = "hybrid", tags, limit = 5, content_type } = params;
  const results: any[] = [];

  // Semantic search
  if (mode === "semantic" || mode === "hybrid") {
    const vectors = await embed([query]);
    if (vectors) {
      let sql = `
        SELECT me.id, me.source_type, me.source_id, me.content_type, me.content_text,
               me.tags, me.created_at,
               1 - (me.embedding <=> $1::vector) AS similarity
        FROM memory_embeddings me WHERE me.project_id = $2`;
      const pArr: any[] = [vecLiteral(vectors[0]), projectId];
      let idx = 3;

      if (content_type) { sql += ` AND me.content_type = $${idx}`; pArr.push(content_type); idx++; }
      if (tags?.length) { sql += ` AND me.tags && $${idx}`; pArr.push(tags); idx++; }

      sql += ` ORDER BY me.embedding <=> $1::vector LIMIT $${idx}`;
      pArr.push(limit);

      const { rows } = await getPool().query(sql, pArr);
      results.push(...rows.map((r: any) => ({ ...r, search_mode: "semantic" })));
    }
  }

  // Keyword search — with ILIKE special chars escaped
  if (mode === "keyword" || mode === "hybrid") {
    const escaped = escapeIlike(query);
    let sql = `
      SELECT me.id, me.source_type, me.source_id, me.content_type, me.content_text,
             me.tags, me.created_at, 0::float AS similarity
      FROM memory_embeddings me WHERE me.project_id = $1 AND me.content_text ILIKE $2`;
    const pArr: any[] = [projectId, `%${escaped}%`];
    let idx = 3;

    if (content_type) { sql += ` AND me.content_type = $${idx}`; pArr.push(content_type); idx++; }
    if (tags?.length) { sql += ` AND me.tags && $${idx}`; pArr.push(tags); idx++; }

    sql += ` ORDER BY me.created_at DESC LIMIT $${idx}`;
    pArr.push(limit);

    const { rows } = await getPool().query(sql, pArr);
    results.push(...rows.map((r: any) => ({ ...r, search_mode: "keyword" })));
  }

  // Deduplicate for hybrid
  if (mode === "hybrid") {
    const seen = new Set<string>();
    return results.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, limit);
  }

  return results;
}

// ══════════════════════════════════════════════════════════════
// Project Summarize
// ══════════════════════════════════════════════════════════════

export async function summarizeProject(projectId: string, depth = 3) {
  const pool = getPool();
  const [snapshots, activeTodos, recentNotes] = await Promise.all([
    pool.query(
      `SELECT summary, architecture_notes, module_focus, assumptions, constraints, tags, created_at
       FROM snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [projectId, depth]
    ),
    pool.query(
      `SELECT title, status, priority, tags, blocked_reason FROM todos
       WHERE project_id = $1 AND status != 'done' ORDER BY priority DESC`,
      [projectId]
    ),
    pool.query(
      `SELECT content, category, tags, created_at FROM notes
       WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [projectId]
    ),
  ]);

  return {
    latest_snapshots: snapshots.rows,
    active_todos: activeTodos.rows,
    recent_notes: recentNotes.rows,
    snapshot_count: snapshots.rows.length,
    active_todo_count: activeTodos.rows.length,
    generated_at: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════
// Session Sync (now includes instructions + recent errors)
// ══════════════════════════════════════════════════════════════

export async function sessionSync(projectId: string) {
  const pool = getPool();
  const [latestSnapshot, activeTodos, recentNotes, recentMemories, instructions, recentErrors] = await Promise.all([
    pool.query(
      `SELECT * FROM snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    ),
    pool.query(
      `SELECT * FROM todos WHERE project_id = $1 AND status != 'done' ORDER BY priority DESC, created_at ASC`,
      [projectId]
    ),
    pool.query(
      `SELECT * FROM notes WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [projectId]
    ),
    pool.query(
      `SELECT content_type, content_text, tags, created_at FROM memory_embeddings
       WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [projectId]
    ),
    pool.query(
      `SELECT * FROM instructions WHERE project_id = $1 AND active = true ORDER BY priority DESC, created_at ASC`,
      [projectId]
    ),
    pool.query(
      `SELECT error_message, error_type, resolution, occurrence_count, last_seen_at
       FROM error_patterns WHERE project_id = $1 ORDER BY last_seen_at DESC LIMIT 5`,
      [projectId]
    ),
  ]);

  return {
    snapshot: latestSnapshot.rows[0] || null,
    active_todos: activeTodos.rows,
    recent_notes: recentNotes.rows,
    recent_memories: recentMemories.rows,
    instructions: instructions.rows,
    recent_error_patterns: recentErrors.rows,
    synced_at: new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════
// Prune Memory
// ══════════════════════════════════════════════════════════════

export async function pruneMemory(projectId: string, olderThanDays: number, keepTagged: string[] = []) {
  let sql = `DELETE FROM memory_embeddings WHERE project_id = $1 AND created_at < now() - make_interval(days => $2)`;
  const vals: any[] = [projectId, olderThanDays];
  let idx = 3;

  if (keepTagged.length) {
    sql += ` AND NOT (tags && $${idx})`;
    vals.push(keepTagged);
  }

  const { rowCount } = await getPool().query(sql, vals);
  return { pruned: rowCount || 0, message: `Pruned ${rowCount} entries older than ${olderThanDays} days` };
}

// ══════════════════════════════════════════════════════════════
// Project Brief — atomic upsert via ON CONFLICT
// ══════════════════════════════════════════════════════════════

export interface ProjectBriefParams {
  project_name: string;
  tech_stack?: string;
  module_map?: string;
  conventions?: string;
  critical_constraints?: string;
  entry_points?: string;
}

export async function getProjectBrief(projectId: string) {
  const { rows } = await getPool().query(
    "SELECT * FROM project_brief WHERE project_id = $1", [projectId]
  );
  const brief = rows[0];

  if (!brief) {
    return {
      exists: false,
      message: "No project brief set. Use set_project_brief to establish foundational project context."
    };
  }

  const parts: string[] = [];
  parts.push(`Project: ${brief.project_name}`);
  if (brief.tech_stack) parts.push(`Stack: ${brief.tech_stack}`);
  if (brief.module_map) parts.push(`Modules: ${brief.module_map}`);
  if (brief.conventions) parts.push(`Conventions: ${brief.conventions}`);
  if (brief.critical_constraints) parts.push(`Constraints: ${brief.critical_constraints}`);
  if (brief.entry_points) parts.push(`Entry points: ${brief.entry_points}`);
  parts.push(`Last updated: ${brief.updated_at}`);

  return { exists: true, brief: parts.join("\n"), raw: brief };
}

export async function setProjectBrief(projectId: string, params: ProjectBriefParams) {
  const pool = getPool();

  // Atomic upsert
  await pool.query(
    `INSERT INTO project_brief (project_id, project_name, tech_stack, module_map, conventions, critical_constraints, entry_points)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (project_id) DO UPDATE SET
       project_name = $2, tech_stack = $3, module_map = $4, conventions = $5,
       critical_constraints = $6, entry_points = $7, updated_at = now()`,
    [
      projectId,
      params.project_name,
      params.tech_stack || null,
      params.module_map || null,
      params.conventions || null,
      params.critical_constraints || null,
      params.entry_points || null,
    ]
  );

  // Embed the brief for semantic retrieval
  const fullText = [
    params.project_name, params.tech_stack, params.module_map,
    params.conventions, params.critical_constraints, params.entry_points,
  ].filter(Boolean).join(". ");

  const vectors = await embed([fullText]);
  if (vectors) {
    // Remove old brief embeddings for this project, then insert
    await pool.query(
      "DELETE FROM memory_embeddings WHERE project_id = $1 AND content_type = 'brief'",
      [projectId]
    );
    await pool.query(
      `INSERT INTO memory_embeddings (project_id, source_type, source_id, content_type, content_text, embedding, tags)
       VALUES ($1, 'snapshot', gen_random_uuid(), 'brief', $2, $3::vector, $4)`,
      [projectId, fullText, vecLiteral(vectors[0]), ["project-brief"]]
    );
  }

  return { message: "Project brief updated", project_name: params.project_name };
}

// ══════════════════════════════════════════════════════════════
// Recent Changes — fixed: parameterized interval
// ══════════════════════════════════════════════════════════════

export async function getRecentChanges(projectId: string, sinceHours = 24) {
  const pool = getPool();
  const hours = Math.max(1, Math.floor(sinceHours));

  const timeQueries = await Promise.all([
    pool.query(
      `SELECT summary, module_focus, tags, created_at
       FROM snapshots WHERE project_id = $1 AND created_at > now() - make_interval(hours => $2)
       ORDER BY created_at DESC LIMIT 10`,
      [projectId, hours]
    ),
    pool.query(
      `SELECT title, status, priority, tags, created_at
       FROM todos WHERE project_id = $1 AND created_at > now() - make_interval(hours => $2)
       ORDER BY created_at DESC LIMIT 10`,
      [projectId, hours]
    ),
    pool.query(
      `SELECT content, category, tags, created_at
       FROM notes WHERE project_id = $1 AND created_at > now() - make_interval(hours => $2)
       ORDER BY created_at DESC LIMIT 10`,
      [projectId, hours]
    ),
    pool.query(
      `SELECT title, completed_at
       FROM todos WHERE project_id = $1 AND completed_at > now() - make_interval(hours => $2)
       ORDER BY completed_at DESC LIMIT 10`,
      [projectId, hours]
    ),
  ]);

  let [snapshots, todos, notes, completedTodos] = timeQueries;
  const hasTimeResults = timeQueries.some(q => q.rows.length > 0);
  let fallback = false;

  if (!hasTimeResults) {
    fallback = true;
    [snapshots, todos, notes, completedTodos] = await Promise.all([
      pool.query(
        `SELECT summary, module_focus, tags, created_at
         FROM snapshots WHERE project_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [projectId]
      ),
      pool.query(
        `SELECT title, status, priority, tags, created_at
         FROM todos WHERE project_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [projectId]
      ),
      pool.query(
        `SELECT content, category, tags, created_at
         FROM notes WHERE project_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [projectId]
      ),
      pool.query(
        `SELECT title, completed_at
         FROM todos WHERE project_id = $1 AND completed_at IS NOT NULL
         ORDER BY completed_at DESC LIMIT 5`,
        [projectId]
      ),
    ]);
  }

  const parts: string[] = [];
  if (fallback) {
    parts.push(`No changes in last ${sinceHours}h. Last recorded activity:`);
  } else {
    parts.push(`Changes in last ${sinceHours}h:`);
  }

  if (snapshots.rows.length) {
    parts.push(`\n${snapshots.rows.length} snapshot(s):`);
    snapshots.rows.forEach((s: any) =>
      parts.push(`  - ${s.summary}${s.module_focus ? ` [${s.module_focus}]` : ""}`)
    );
  }
  if (notes.rows.length) {
    parts.push(`\n${notes.rows.length} note(s):`);
    notes.rows.forEach((n: any) =>
      parts.push(`  - [${n.category}] ${n.content.substring(0, 120)}${n.content.length > 120 ? "..." : ""}`)
    );
  }
  if (todos.rows.length) {
    parts.push(`\n${todos.rows.length} new task(s):`);
    todos.rows.forEach((t: any) => parts.push(`  - [${t.status}] ${t.title}`));
  }
  if (completedTodos.rows.length) {
    parts.push(`\n${completedTodos.rows.length} completed:`);
    completedTodos.rows.forEach((t: any) => parts.push(`  - done: ${t.title}`));
  }

  const hasChanges = snapshots.rows.length + notes.rows.length + todos.rows.length + completedTodos.rows.length > 0;
  if (!hasChanges) parts.push("  No activity recorded for this project.");

  return {
    narrative: parts.join("\n"),
    since_hours: sinceHours,
    counts: {
      snapshots: snapshots.rows.length,
      notes: notes.rows.length,
      new_todos: todos.rows.length,
      completed: completedTodos.rows.length,
    },
    raw: {
      snapshots: snapshots.rows,
      notes: notes.rows,
      new_todos: todos.rows,
      completed: completedTodos.rows,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// Error Patterns (with dedup)
// ══════════════════════════════════════════════════════════════

export interface ErrorPatternParams {
  error_message: string;
  error_type?: string;
  attempted_fixes?: string[];
  root_cause?: string;
  resolution?: string;
  file_paths?: string[];
  tags?: string[];
}

export async function logErrorPattern(projectId: string, params: ErrorPatternParams) {
  const pool = getPool();

  // Dedup: check for existing similar error
  const existing = await findSimilarErrorPattern(projectId, params.error_message);
  if (existing) {
    const mergedFixes = [...new Set([...(existing.attempted_fixes || []), ...(params.attempted_fixes || [])])];
    await pool.query(
      `UPDATE error_patterns SET
         occurrence_count = occurrence_count + 1,
         last_seen_at = now(),
         attempted_fixes = $1,
         root_cause = COALESCE($2, root_cause),
         resolution = COALESCE($3, resolution),
         file_paths = COALESCE($4, file_paths)
       WHERE id = $5`,
      [mergedFixes, params.root_cause || null, params.resolution || null, params.file_paths || null, existing.id]
    );

    // Update embedding if resolution provided
    if (params.resolution) {
      const text = `Error: ${params.error_message}. Cause: ${params.root_cause || "unknown"}. Fix: ${params.resolution}`;
      const vectors = await embed([text]);
      if (vectors) {
        await pool.query(
          `UPDATE memory_embeddings SET content_text = $1, embedding = $2::vector, created_at = now()
           WHERE source_type = 'error_pattern' AND source_id = $3`,
          [text, vecLiteral(vectors[0]), existing.id]
        );
      }
    }

    return {
      id: existing.id,
      occurrence_count: existing.occurrence_count + 1,
      message: "Error pattern updated (occurrence incremented)",
      deduplicated: true,
    };
  }

  // New pattern
  const id = randomUUID();
  await pool.query(
    `INSERT INTO error_patterns (id, project_id, error_message, error_type, attempted_fixes, root_cause, resolution, file_paths, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, projectId, params.error_message, params.error_type || "general",
     params.attempted_fixes || [], params.root_cause || null,
     params.resolution || null, params.file_paths || [], params.tags || []]
  );

  // Embed
  const text = `Error: ${params.error_message}. ${params.root_cause || ""} ${params.resolution || ""}`.trim();
  const vectors = await embed([text]);
  if (vectors) {
    await pool.query(
      `INSERT INTO memory_embeddings (project_id, source_type, source_id, content_type, content_text, embedding, tags)
       VALUES ($1, 'error_pattern', $2, 'error', $3, $4::vector, $5)`,
      [projectId, id, text, vecLiteral(vectors[0]), params.tags || []]
    );
  }

  return { id, message: "Error pattern logged" };
}

export async function checkErrorPatterns(projectId: string, errorMessage: string, limit = 3) {
  const pool = getPool();
  const results: any[] = [];
  const seenIds = new Set<string>();

  // Text similarity search (trigram)
  try {
    const { rows } = await pool.query(
      `SELECT *, similarity(error_message, $2) as match_score
       FROM error_patterns
       WHERE project_id = $1 AND similarity(error_message, $2) > 0.3
       ORDER BY similarity(error_message, $2) DESC LIMIT $3`,
      [projectId, errorMessage, limit]
    );
    for (const r of rows) { results.push({ ...r, match_type: "text" }); seenIds.add(r.id); }
  } catch {
    // Fallback: ILIKE
    const escaped = escapeIlike(errorMessage.substring(0, 100));
    const { rows } = await pool.query(
      `SELECT *, 0::float as match_score FROM error_patterns
       WHERE project_id = $1 AND error_message ILIKE $2
       ORDER BY last_seen_at DESC LIMIT $3`,
      [projectId, `%${escaped}%`, limit]
    );
    for (const r of rows) { results.push({ ...r, match_type: "keyword" }); seenIds.add(r.id); }
  }

  // Semantic search for remaining slots
  if (results.length < limit) {
    const vectors = await embed([errorMessage]);
    if (vectors) {
      const { rows } = await pool.query(
        `SELECT me.source_id, me.content_text, 1 - (me.embedding <=> $1::vector) AS match_score
         FROM memory_embeddings me
         WHERE me.project_id = $2 AND me.content_type = 'error'
         ORDER BY me.embedding <=> $1::vector LIMIT $3`,
        [vecLiteral(vectors[0]), projectId, limit]
      );
      for (const r of rows) {
        if (seenIds.has(r.source_id)) continue;
        const { rows: [pattern] } = await pool.query(
          "SELECT * FROM error_patterns WHERE id = $1", [r.source_id]
        );
        if (pattern) {
          results.push({ ...pattern, match_score: r.match_score, match_type: "semantic" });
          seenIds.add(pattern.id);
        }
      }
    }
  }

  return {
    patterns: results.slice(0, limit),
    message: results.length > 0
      ? `Found ${results.length} matching error pattern(s). Check resolutions before attempting fixes.`
      : "No matching error patterns found.",
  };
}

// ══════════════════════════════════════════════════════════════
// Instructions (with dedup)
// ══════════════════════════════════════════════════════════════

export interface InstructionParams {
  content: string;
  category?: string;
  priority?: number;
  tags?: string[];
}

export async function addInstruction(projectId: string, params: InstructionParams) {
  const pool = getPool();
  const category = params.category || "general";

  // Dedup
  const existingId = await findSimilarInstruction(projectId, params.content);
  if (existingId) {
    return { id: existingId, message: "Similar instruction already exists", deduplicated: true };
  }

  const id = randomUUID();
  await pool.query(
    `INSERT INTO instructions (id, project_id, content, category, priority, tags)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, projectId, params.content, category, params.priority || 0, params.tags || []]
  );

  const vectors = await embed([params.content]);
  if (vectors) {
    await pool.query(
      `INSERT INTO memory_embeddings (project_id, source_type, source_id, content_type, content_text, embedding, tags)
       VALUES ($1, 'instruction', $2, 'instruction', $3, $4::vector, $5)`,
      [projectId, id, params.content, vecLiteral(vectors[0]), params.tags || []]
    );
  }

  return { id, category, message: "Instruction added" };
}

export async function getInstructions(projectId: string, category?: string) {
  let sql = `SELECT * FROM instructions WHERE project_id = $1 AND active = true`;
  const vals: any[] = [projectId];
  if (category) { sql += ` AND category = $2`; vals.push(category); }
  sql += ` ORDER BY priority DESC, created_at ASC`;

  const { rows } = await getPool().query(sql, vals);
  return rows;
}

export async function removeInstruction(projectId: string, id: string) {
  await getPool().query(
    `UPDATE instructions SET active = false WHERE id = $1 AND project_id = $2`,
    [id, projectId]
  );
  return { id, message: "Instruction deactivated" };
}

// ══════════════════════════════════════════════════════════════
// File Context (cross-table query by file path)
// ══════════════════════════════════════════════════════════════

export async function getFileContext(projectId: string, filePath: string) {
  const pool = getPool();
  const [notes, todos, errors, snapshots] = await Promise.all([
    pool.query(
      `SELECT id, content, category, tags, created_at FROM notes
       WHERE project_id = $1 AND $2 = ANY(related_files)
       ORDER BY created_at DESC LIMIT 10`,
      [projectId, filePath]
    ),
    pool.query(
      `SELECT id, title, description, status, priority, tags FROM todos
       WHERE project_id = $1 AND $2 = ANY(related_files) AND status != 'done'
       ORDER BY priority DESC`,
      [projectId, filePath]
    ),
    pool.query(
      `SELECT id, error_message, error_type, resolution, occurrence_count FROM error_patterns
       WHERE project_id = $1 AND $2 = ANY(file_paths)
       ORDER BY last_seen_at DESC LIMIT 5`,
      [projectId, filePath]
    ),
    pool.query(
      `SELECT id, summary, module_focus, created_at FROM snapshots
       WHERE project_id = $1 AND $2 = ANY(file_paths)
       ORDER BY created_at DESC LIMIT 3`,
      [projectId, filePath]
    ),
  ]);

  return {
    file: filePath,
    notes: notes.rows,
    active_todos: todos.rows,
    error_patterns: errors.rows,
    recent_snapshots: snapshots.rows,
    has_context: notes.rows.length + todos.rows.length + errors.rows.length + snapshots.rows.length > 0,
  };
}

// ══════════════════════════════════════════════════════════════
// Delete Note
// ══════════════════════════════════════════════════════════════

export async function deleteNote(projectId: string, id: string) {
  const pool = getPool();
  await pool.query("DELETE FROM memory_embeddings WHERE source_type = 'note' AND source_id = $1 AND project_id = $2", [id, projectId]);
  const { rowCount } = await pool.query("DELETE FROM notes WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) return { id, message: "Note not found" };
  return { id, message: "Note deleted" };
}

// ══════════════════════════════════════════════════════════════
// List Error Patterns
// ══════════════════════════════════════════════════════════════

export async function listErrorPatterns(projectId: string, limit = 50) {
  const { rows } = await getPool().query(
    `SELECT * FROM error_patterns WHERE project_id = $1 ORDER BY last_seen_at DESC LIMIT $2`,
    [projectId, limit]
  );
  return rows;
}

// ══════════════════════════════════════════════════════════════
// Delete Project (cascading)
// ══════════════════════════════════════════════════════════════

export async function deleteProject(projectId: string) {
  const pool = getPool();
  const counts: Record<string, number> = {};

  // Order: embeddings first, then tables with FKs to snapshots, then snapshots, sessions, project
  const deletes: [string, string][] = [
    ["memory_embeddings", "DELETE FROM memory_embeddings WHERE project_id = $1"],
    ["todos", "DELETE FROM todos WHERE project_id = $1"],
    ["notes", "DELETE FROM notes WHERE project_id = $1"],
    ["error_patterns", "DELETE FROM error_patterns WHERE project_id = $1"],
    ["instructions", "DELETE FROM instructions WHERE project_id = $1"],
    ["project_brief", "DELETE FROM project_brief WHERE project_id = $1"],
    ["snapshots", "DELETE FROM snapshots WHERE project_id = $1"],
    ["sessions", "DELETE FROM sessions WHERE project_id = $1"],
    ["projects", "DELETE FROM projects WHERE id = $1"],
  ];

  for (const [table, sql] of deletes) {
    const { rowCount } = await pool.query(sql, [projectId]);
    counts[table] = rowCount || 0;
  }

  return {
    project_id: projectId,
    deleted: counts,
    message: `Project ${projectId} and all associated data deleted`,
  };
}

// ══════════════════════════════════════════════════════════════
// Stats
// ══════════════════════════════════════════════════════════════

export async function getStats(projectId?: string) {
  const pool = getPool();
  const w = projectId ? " WHERE project_id = $1" : "";
  const p = projectId ? [projectId] : [];
  const instrWhere = projectId ? " WHERE project_id = $1 AND active = true" : " WHERE active = true";

  const [snapCount, todoCount, noteCount, memCount, errCount, instrCount] = await Promise.all([
    pool.query(`SELECT count(*)::int as count FROM snapshots${w}`, p),
    pool.query(`SELECT status, count(*)::int as count FROM todos${w} GROUP BY status`, p),
    pool.query(`SELECT count(*)::int as count FROM notes${w}`, p),
    pool.query(`SELECT count(*)::int as count FROM memory_embeddings${w}`, p),
    pool.query(`SELECT count(*)::int as count FROM error_patterns${w}`, p),
    pool.query(`SELECT count(*)::int as count FROM instructions${instrWhere}`, p),
  ]);

  const embOk = await checkEmbeddingService();

  return {
    snapshots: snapCount.rows[0].count,
    todos: todoCount.rows.reduce((acc: any, r: any) => { acc[r.status] = r.count; return acc; }, {}),
    notes: noteCount.rows[0].count,
    memories: memCount.rows[0].count,
    error_patterns: errCount.rows[0].count,
    instructions: instrCount.rows[0].count,
    embedding_service: embOk ? "connected" : "unavailable",
  };
}
