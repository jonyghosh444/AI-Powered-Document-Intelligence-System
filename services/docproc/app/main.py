import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel, Field

for parent in Path(__file__).resolve().parents:
    env_file = parent / ".env"
    if env_file.is_file():
        load_dotenv(env_file)
        break

from app.embeddings import embed_texts
from app.errors import DocumentProcessError
from app.pipeline import run_pipeline, run_validation

app = FastAPI(title="AI-Powered Document Intelligence System")


class ProcessRequest(BaseModel):
    file_path: str
    filename: str = ""
    mime: str = ""
    document_id: str | None = None
    existing_invoices: list[dict] = Field(default_factory=list)


class ValidateRequest(BaseModel):
    extraction: dict
    document_id: str | None = None
    existing_invoices: list[dict] = Field(default_factory=list)


class EmbedRequest(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"ok": True, "provider": os.environ.get("EXTRACTION_PROVIDER", "fixture")}


@app.post("/process")
def process(body: ProcessRequest):
    try:
        return run_pipeline(body.file_path, body.mime, body.existing_invoices, body.document_id)
    except DocumentProcessError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "error": f"Unexpected processing error: {exc}"}


@app.post("/validate")
def validate(body: ValidateRequest):
    try:
        return run_validation(body.extraction, body.existing_invoices, body.document_id)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/embed")
def embed(body: EmbedRequest):
    vectors, backend = embed_texts([body.text or ""])
    return {"ok": True, "embedding": vectors[0], "backend": backend}
