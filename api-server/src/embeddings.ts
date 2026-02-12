const EMBEDDING_URL = process.env.EMBEDDING_URL || process.env.MCP_EMBEDDING_URL
  || "http://localhost:41100";

let embeddingAvailable: boolean | null = null;

export async function checkEmbeddingService(): Promise<boolean> {
  try {
    const res = await fetch(`${EMBEDDING_URL}/health`, { signal: AbortSignal.timeout(3000) });
    embeddingAvailable = res.ok;
    return embeddingAvailable;
  } catch {
    embeddingAvailable = false;
    return false;
  }
}

export async function embed(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];

  // Check availability on first call or if previously failed
  if (embeddingAvailable === null || embeddingAvailable === false) {
    await checkEmbeddingService();
  }

  if (!embeddingAvailable) {
    return null; // Graceful fallback — structured ops still work
  }

  try {
    const res = await fetch(`${EMBEDDING_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.embeddings;
  } catch {
    embeddingAvailable = false;
    return null;
  }
}
