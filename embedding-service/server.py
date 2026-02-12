"""Lightweight embedding service using sentence-transformers."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-MiniLM-L6-v2"  # 384 dimensions, fast, good quality
model: SentenceTransformer | None = None


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dimensions: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    model = SentenceTransformer(MODEL_NAME)
    yield


app = FastAPI(title="MCP Embedding Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "loaded": model is not None}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if not req.texts:
        return EmbedResponse(embeddings=[], dimensions=384)
    vectors = model.encode(req.texts, normalize_embeddings=True)
    return EmbedResponse(
        embeddings=[v.tolist() for v in vectors],
        dimensions=vectors.shape[1],
    )
