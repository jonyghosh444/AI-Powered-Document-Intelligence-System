from datetime import datetime

CURRENCIES = {"USD", "EUR", "GBP", "BDT", "INR", "CAD", "AUD", "JPY", "SGD", "AED"}
TOLERANCE = 0.02
REQUIRED = [
    "invoice_number",
    "invoice_date",
    "supplier_name",
    "customer_name",
    "subtotal",
    "tax",
    "total",
    "currency",
]
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y")


def _value(extraction: dict, field: str):
    raw = extraction.get(field)
    if isinstance(raw, dict):
        return raw.get("value")
    return raw


def _issue(code: str, message: str, field: str | None = None, severity: str = "error") -> dict:
    return {"code": code, "field": field, "message": message, "severity": severity}


def _parse_date(value: str) -> bool:
    text = value.strip()
    for fmt in DATE_FORMATS:
        try:
            datetime.strptime(text, fmt)
            return True
        except ValueError:
            continue
    return False


def _number(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _close(left: float, right: float) -> bool:
    return abs(left - right) <= TOLERANCE


def _line_signature(items: list[dict]) -> tuple:
    rows = []
    for item in items:
        description = str(item.get("description") or "").strip().lower()
        amount = _number(item.get("amount"))
        rows.append((description, None if amount is None else round(amount, 2)))
    return tuple(sorted(rows))


def validate_extraction(extraction: dict, existing_invoices: list[dict] | None = None, document_id: str | None = None) -> dict:
    issues = []
    for field in REQUIRED:
        if _value(extraction, field) in (None, ""):
            issues.append(_issue("missing_field", f"{field.replace('_', ' ')} is missing", field))

    invoice_date = _value(extraction, "invoice_date")
    if invoice_date not in (None, "") and not _parse_date(str(invoice_date)):
        issues.append(_issue("invalid_date", "invoice date is not a recognized date", "invoice_date"))

    currency = _value(extraction, "currency")
    if currency not in (None, "") and str(currency).upper() not in CURRENCIES:
        issues.append(_issue("invalid_currency", "currency is not a supported code", "currency"))

    numbers = {}
    for field in ("subtotal", "tax", "total"):
        raw = _value(extraction, field)
        if raw in (None, ""):
            continue
        parsed = _number(raw)
        if parsed is None:
            issues.append(_issue("invalid_number", f"{field} is not a number", field))
        else:
            numbers[field] = parsed

    line_items = extraction.get("line_items") or []
    if not line_items:
        issues.append(_issue("missing_line_items", "no line items were extracted", "line_items"))
    else:
        amounts = []
        for index, item in enumerate(line_items):
            amount = _number(item.get("amount"))
            if amount is None:
                issues.append(_issue("invalid_number", f"line item {index + 1} amount is missing", "line_items"))
            else:
                amounts.append(amount)
        if amounts and "subtotal" in numbers and not _close(sum(amounts), numbers["subtotal"]):
            issues.append(
                _issue(
                    "line_sum_mismatch",
                    "line item amounts do not add up to the subtotal",
                    "subtotal",
                )
            )

    if {"subtotal", "tax", "total"} <= numbers.keys() and not _close(numbers["subtotal"] + numbers["tax"], numbers["total"]):
        issues.append(_issue("total_mismatch", "subtotal plus tax does not equal the total", "total"))

    invoice_number = _value(extraction, "invoice_number")
    supplier = _value(extraction, "supplier_name")
    if invoice_number:
        number_key = str(invoice_number).strip().lower()
        supplier_key = str(supplier or "").strip().lower()
        for other in existing_invoices or []:
            if document_id and other.get("document_id") == document_id:
                continue
            other_number = str(other.get("invoice_number") or "").strip().lower()
            if not other_number or other_number != number_key:
                continue
            other_supplier = str(other.get("supplier_name") or "").strip().lower()
            if supplier_key and other_supplier == supplier_key:
                issues.append(
                    _issue(
                        "duplicate_invoice",
                        f"invoice {invoice_number} from {supplier} already exists",
                        "invoice_number",
                    )
                )
            other_total = _number(other.get("total"))
            current_total = numbers.get("total")
            other_lines = _line_signature(other.get("line_items") or [])
            current_lines = _line_signature(line_items)
            totals_differ = (
                other_total is not None and current_total is not None and not _close(other_total, current_total)
            )
            lines_differ = bool(other_lines) and bool(current_lines) and other_lines != current_lines
            if totals_differ or lines_differ:
                issues.append(
                    _issue(
                        "cross_document_mismatch",
                        f"invoice {invoice_number} does not match another uploaded document",
                        "total",
                    )
                )
            break

    status = "needs_review" if any(issue["severity"] == "error" for issue in issues) else "completed"
    return {"issues": issues, "status": status}
