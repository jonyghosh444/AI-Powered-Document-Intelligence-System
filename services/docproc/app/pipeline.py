from pathlib import Path

from app.embeddings import chunk_text, embed_texts
from app.errors import DocumentProcessError
from app.extract import extract_fields, prompt_version
from app.parsers import combined_text, parse_file
from app.validate import validate_extraction


def _summary(extraction: dict) -> str:
    def val(field: str) -> str:
        raw = extraction.get(field) or {}
        value = raw.get("value") if isinstance(raw, dict) else raw
        return "" if value is None else str(value)

    parts = [
        f"Invoice {val('invoice_number')}",
        f"supplier {val('supplier_name')}",
        f"customer {val('customer_name')}",
        f"total {val('total')} {val('currency')}",
    ]
    return " ".join(part for part in parts if not part.endswith(" "))


def run_pipeline(file_path: str, mime: str, existing_invoices: list[dict] | None = None, document_id: str | None = None) -> dict:
    path = Path(file_path)
    if not path.is_file():
        raise DocumentProcessError("File does not exist")
    _assert_storage_path(path)
    pages = parse_file(path, mime)
    text = combined_text(pages)
    extraction, provider, model = extract_fields(text)
    validation = validate_extraction(extraction, existing_invoices or [], document_id)
    pieces = chunk_text(text)
    summary = _summary(extraction).strip()
    if summary:
        pieces = [summary, *pieces]
    pieces = pieces[:40] or [path.name]
    vectors, embed_backend = embed_texts(pieces)
    chunks = [
        {"text": piece, "embedding": vector}
        for piece, vector in zip(pieces, vectors)
    ]
    return {
        "ok": True,
        "page_count": len(pages),
        "texts": pages,
        "extraction": extraction,
        "line_items": extraction.get("line_items") or [],
        "validation_issues": validation["issues"],
        "status": validation["status"],
        "chunks": chunks,
        "provider": provider,
        "model": model,
        "prompt_version": prompt_version(),
        "embedding_backend": embed_backend,
    }


def run_validation(extraction: dict, existing_invoices: list[dict] | None = None, document_id: str | None = None) -> dict:
    validation = validate_extraction(extraction, existing_invoices or [], document_id)
    return {
        "ok": True,
        "validation_issues": validation["issues"],
        "status": validation["status"],
        "line_items": extraction.get("line_items") or [],
    }


def _assert_storage_path(path: Path) -> None:
    import os

    root = os.environ.get("STORAGE_DIR", "").strip()
    if not root:
        return
    resolved_root = Path(root).resolve()
    resolved = path.resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise DocumentProcessError("File path is outside storage")
