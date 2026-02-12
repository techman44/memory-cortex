-- MCP Memory Cortex — Database Schema
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ══════════════════════════════════════════════════════════════
-- Projects Registry
-- ══════════════════════════════════════════════════════════════
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT,
    path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- Sessions
-- ══════════════════════════════════════════════════════════════
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL DEFAULT 'default',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    summary TEXT,
    snapshot_count INTEGER DEFAULT 0
);

CREATE INDEX idx_sessions_project ON sessions(project_id);

-- ══════════════════════════════════════════════════════════════
-- Snapshots
-- ══════════════════════════════════════════════════════════════
CREATE TABLE snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL DEFAULT 'default',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    summary TEXT NOT NULL,
    architecture_notes TEXT,
    module_focus TEXT,
    assumptions TEXT[] DEFAULT '{}',
    constraints TEXT[] DEFAULT '{}',
    file_paths TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    is_auto BOOLEAN DEFAULT false,
    parent_snapshot_id UUID REFERENCES snapshots(id) ON DELETE SET NULL
);

CREATE INDEX idx_snapshots_project ON snapshots(project_id);
CREATE INDEX idx_snapshots_created ON snapshots(created_at DESC);
CREATE INDEX idx_snapshots_tags ON snapshots USING GIN(tags);
CREATE INDEX idx_snapshots_session ON snapshots(session_id);

-- ══════════════════════════════════════════════════════════════
-- Todos
-- ══════════════════════════════════════════════════════════════
CREATE TABLE todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done')),
    priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 2),
    related_files TEXT[] DEFAULT '{}',
    snapshot_id UUID REFERENCES snapshots(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    tags TEXT[] DEFAULT '{}',
    blocked_reason TEXT
);

CREATE INDEX idx_todos_project ON todos(project_id);
CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_snapshot ON todos(snapshot_id);
CREATE INDEX idx_todos_tags ON todos USING GIN(tags);

-- ══════════════════════════════════════════════════════════════
-- Notes
-- ══════════════════════════════════════════════════════════════
CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL DEFAULT 'default',
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general'
        CHECK (category IN ('decision','debug','architecture','reference','general')),
    tags TEXT[] DEFAULT '{}',
    related_files TEXT[] DEFAULT '{}',
    snapshot_id UUID REFERENCES snapshots(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_project ON notes(project_id);
CREATE INDEX idx_notes_category ON notes(category);
CREATE INDEX idx_notes_tags ON notes USING GIN(tags);
CREATE INDEX idx_notes_created ON notes(created_at DESC);
CREATE INDEX idx_notes_content_trgm ON notes USING GIN(content gin_trgm_ops);

-- ══════════════════════════════════════════════════════════════
-- Memory Embeddings (semantic layer)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE memory_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL DEFAULT 'default',
    source_type TEXT NOT NULL CHECK (source_type IN ('snapshot','note','todo','error_pattern','instruction')),
    source_id UUID NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('summary','architecture','debug','note','decision','task','brief','error','instruction')),
    content_text TEXT NOT NULL,
    embedding vector(384),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    tags TEXT[] DEFAULT '{}'
);

CREATE INDEX idx_embeddings_project ON memory_embeddings(project_id);
CREATE INDEX idx_embeddings_source ON memory_embeddings(source_type, source_id);
CREATE INDEX idx_embeddings_type ON memory_embeddings(content_type);
CREATE INDEX idx_embeddings_vector ON memory_embeddings USING hnsw (embedding vector_cosine_ops);

-- ══════════════════════════════════════════════════════════════
-- Project Brief (foundational — one per project)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE project_brief (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL UNIQUE,
    project_name TEXT NOT NULL,
    tech_stack TEXT,
    module_map TEXT,
    conventions TEXT,
    critical_constraints TEXT,
    entry_points TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- Error Patterns (track recurring errors and resolutions)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE error_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL DEFAULT 'default',
    error_message TEXT NOT NULL,
    error_type TEXT DEFAULT 'general'
        CHECK (error_type IN ('build','runtime','type','test','dependency','config','network','general','other')),
    attempted_fixes TEXT[] DEFAULT '{}',
    root_cause TEXT,
    resolution TEXT,
    file_paths TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    occurrence_count INTEGER DEFAULT 1,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_errors_project ON error_patterns(project_id);
CREATE INDEX idx_errors_type ON error_patterns(error_type);
CREATE INDEX idx_errors_message_trgm ON error_patterns USING GIN(error_message gin_trgm_ops);

-- ══════════════════════════════════════════════════════════════
-- Instructions (persistent directives per project)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE instructions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL DEFAULT 'default',
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general'
        CHECK (category IN ('general','build','style','workflow','constraint','security','testing','other')),
    active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 2),
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_instructions_project ON instructions(project_id);
CREATE INDEX idx_instructions_active ON instructions(active);
CREATE INDEX idx_instructions_content_trgm ON instructions USING GIN(content gin_trgm_ops);

-- ══════════════════════════════════════════════════════════════
-- Triggers
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER todos_updated_at
    BEFORE UPDATE ON todos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION increment_session_snapshots()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.session_id IS NOT NULL THEN
        UPDATE sessions SET snapshot_count = snapshot_count + 1 WHERE id = NEW.session_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER snapshots_session_count
    AFTER INSERT ON snapshots
    FOR EACH ROW EXECUTE FUNCTION increment_session_snapshots();
