import pg from "pg";
const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(databaseUrl?: string): pg.Pool {
  if (!pool) {
    const url = databaseUrl || process.env.DATABASE_URL || process.env.MCP_DATABASE_URL
      || "postgresql://mcp:mcp_local_dev@localhost:41432/mcp_memory";
    pool = new Pool({ connectionString: url, max: 10 });
  }
  return pool;
}

export async function checkDb(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export function vecLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** Escape ILIKE special characters so user input is treated as literal text. */
export function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}
