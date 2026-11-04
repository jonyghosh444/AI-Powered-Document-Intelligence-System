import hashlib
import math
import os
import re
import threading

_DIM = 384
_lock = threading.Lock()
_model = None
_backend_name = None


def embedding_dim() -> int:
    return _DIM


def backend_name() -> str:
    return _backend_name or os.environ.get("EMBED_BACKEND", "minilm")


def _hash_embed(text: str) -> list[float]:
    vector = [0.0] * _DIM
    tokens = re.findall(r"[a-z0-9]+", (text or "").lower())
    if not tokens:
        tokens = ["empty"]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "little") % _DIM
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


def _minilm():
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            from fastembed import TextEmbedding

            cache = os.environ.get("FASTEMBED_CACHE_PATH")
            kwargs = {"model_name": "sentence-transformers/all-MiniLM-L6-v2"}
            if cache:
                kwargs["cache_dir"] = cache
            _model = TextEmbedding(**kwargs)
        return _model


def embed_texts(texts: list[str]) -> tuple[list[list[float]], str]:
    global _backend_name
    requested = os.environ.get("EMBED_BACKEND", "minilm").strip().lower()
    cleaned = [text if text and text.strip() else "empty" for text in texts]
    if requested == "hash":
        _backend_name = "hash"
        return [_hash_embed(text) for text in cleaned], "hash"
    try:
        model = _minilm()
        vectors = [list(map(float, vector)) for vector in model.embed(cleaned)]
        _backend_name = "minilm"
        return vectors, "minilm"
    except Exception:
        _backend_name = "hash-fallback"
        return [_hash_embed(text) for text in cleaned], "hash-fallback"


def chunk_text(text: str, size: int = 800, overlap: int = 100, limit: int = 40) -> list[str]:
    body = (text or "").strip()
    if not body:
        return []
    chunks = []
    start = 0
    while start < len(body) and len(chunks) < limit:
        end = min(len(body), start + size)
        piece = body[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(body):
            break
        start = max(0, end - overlap)
    return chunks
