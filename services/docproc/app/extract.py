import json
import os
import re
from typing import Any

import httpx

from app.errors import DocumentProcessError
from app.prompt import EXTRACTION_PROMPT, PROMPT_VERSION

SCALAR_FIELDS = [
    "invoice_number",
    "invoice_date",
    "supplier_name",
    "customer_name",
    "subtotal",
    "tax",
    "total",
    "currency",
]
NUMERIC_FIELDS = {"subtotal", "tax", "total"}

_LINE_RE = re.compile(
    r"^-\s*(.+?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*$"
)
_FIELD_RES = {
    "invoice_number": re.compile(r"(?im)^invoice\s*number:\s*(.+?)\s*$"),
    "invoice_date": re.compile(r"(?im)^invoice\s*date:\s*(.+?)\s*$"),
    "supplier_name": re.compile(r"(?im)^supplier:\s*(.+?)\s*$"),
    "customer_name": re.compile(r"(?im)^customer:\s*(.+?)\s*$"),
    "currency": re.compile(r"(?im)^currency:\s*([A-Za-z]{3})\s*$"),
    "subtotal": re.compile(r"(?im)^subtotal:\s*([0-9]+(?:\.[0-9]+)?)\s*$"),
    "tax": re.compile(r"(?im)^tax:\s*([0-9]+(?:\.[0-9]+)?)\s*$"),
    "total": re.compile(r"(?im)^total:\s*([0-9]+(?:\.[0-9]+)?)\s*$"),
}


def empty_extraction() -> dict:
    result = {field: {"value": None, "confidence": 0} for field in SCALAR_FIELDS}
    result["line_items"] = []
    return result


def _number(raw: Any) -> float | None:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _unwrap(value: Any) -> Any:
    if isinstance(value, dict) and "value" in value:
        return value.get("value")
    return value


def _line_text(value: Any) -> str | None:
    value = _unwrap(value)
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "n/a"}:
        return None
    return text


def _line_number(value: Any) -> float | None:
    value = _unwrap(value)
    if value in (None, ""):
        return None
    if isinstance(value, str):
        value = value.replace(",", "").replace("$", "").strip()
    return _number(value)


def _field(value: Any, confidence: float) -> dict:
    if value is None or value == "":
        return {"value": None, "confidence": 0}
    if isinstance(value, str):
        value = value.strip()
        if not value or value.lower() in {"null", "none", "n/a"}:
            return {"value": None, "confidence": 0}
    return {"value": value, "confidence": confidence}


def normalize_extraction(payload: Any) -> dict:
    result = empty_extraction()
    if not isinstance(payload, dict):
        return result
    for field in SCALAR_FIELDS:
        raw = payload.get(field)
        if isinstance(raw, dict):
            value = raw.get("value")
            confidence = raw.get("confidence", 0.5 if value not in (None, "") else 0)
        else:
            value = raw
            confidence = 0.5 if value not in (None, "") else 0
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = 0
        confidence = max(0.0, min(1.0, confidence))
        if field in NUMERIC_FIELDS and value not in (None, ""):
            if isinstance(value, str):
                value = value.replace(",", "").replace("$", "").strip()
            number = _number(value)
            result[field] = _field(number, confidence if number is not None else 0)
            if number is None:
                result[field] = {"value": None, "confidence": 0}
        elif field == "currency" and isinstance(value, str):
            result[field] = _field(value.upper(), confidence)
        else:
            result[field] = _field(value, confidence)
    items = payload.get("line_items") or []
    normalized_items = []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            description = _line_text(item.get("description"))
            quantity = _line_number(item.get("quantity"))
            unit_price = _line_number(item.get("unit_price"))
            amount = _line_number(item.get("amount"))
            if description is None and quantity is None and unit_price is None and amount is None:
                continue
            normalized_items.append(
                {
                    "description": description,
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "amount": amount,
                }
            )
    result["line_items"] = normalized_items
    return result


def extract_fixture(text: str) -> dict:
    result = empty_extraction()
    for field, pattern in _FIELD_RES.items():
        match = pattern.search(text or "")
        if not match:
            continue
        raw = match.group(1).strip()
        if field in NUMERIC_FIELDS:
            result[field] = _field(_number(raw), 0.99)
        elif field == "currency":
            result[field] = _field(raw.upper(), 0.99)
        else:
            result[field] = _field(raw, 0.99)
    items = []
    for line in (text or "").splitlines():
        match = _LINE_RE.match(line.strip())
        if not match:
            continue
        items.append(
            {
                "description": match.group(1).strip(),
                "quantity": float(match.group(2)),
                "unit_price": float(match.group(3)),
                "amount": float(match.group(4)),
            }
        )
    result["line_items"] = items
    return result


def _strip_json(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    return text


def extract_gemini(text: str) -> dict:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise DocumentProcessError("GEMINI_API_KEY is not set")
    model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    prompt = EXTRACTION_PROMPT + (text or "")[:60000]
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    last_error = "model returned no JSON"
    for _ in range(2):
        try:
            response = httpx.post(url, json=payload, timeout=60)
        except httpx.HTTPError as exc:
            raise DocumentProcessError(f"Gemini request failed: {exc}") from exc
        if response.status_code >= 400:
            raise DocumentProcessError(f"Gemini HTTP {response.status_code}: {response.text[:400]}")
        body = response.json()
        candidates = body.get("candidates") or []
        parts = ((candidates[0].get("content") or {}).get("parts") if candidates else None) or []
        raw = "\n".join(part.get("text", "") for part in parts if isinstance(part, dict))
        try:
            return normalize_extraction(json.loads(_strip_json(raw)))
        except json.JSONDecodeError:
            last_error = "model returned invalid JSON"
            continue
    raise DocumentProcessError(last_error)


def extract_fields(text: str) -> tuple[dict, str, str]:
    provider = os.environ.get("EXTRACTION_PROVIDER", "fixture").strip().lower()
    model = "fixture-rules"
    if provider == "gemini":
        if not os.environ.get("GEMINI_API_KEY", "").strip():
            return extract_fixture(text), "fixture-fallback", model
        model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
        return extract_gemini(text), "gemini", model
    return extract_fixture(text), "fixture", model


def prompt_version() -> str:
    return PROMPT_VERSION
