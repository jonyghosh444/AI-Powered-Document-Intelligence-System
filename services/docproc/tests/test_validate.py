from app.validate import validate_extraction


def _field(value, confidence=0.9):
    return {"value": value, "confidence": confidence}


def extraction(**overrides):
    base = {
        "invoice_number": _field("INV-1"),
        "invoice_date": _field("2024-03-01"),
        "supplier_name": _field("Acme Supplies"),
        "customer_name": _field("Northwind Traders"),
        "subtotal": _field(100),
        "tax": _field(10),
        "total": _field(110),
        "currency": _field("USD"),
        "line_items": [
            {"description": "Widget", "quantity": 2, "unit_price": 40, "amount": 80},
            {"description": "Gadget", "quantity": 1, "unit_price": 20, "amount": 20},
        ],
    }
    base.update(overrides)
    return base


def codes(result):
    return {issue["code"] for issue in result["issues"]}


def test_clean_invoice_completes():
    result = validate_extraction(extraction())
    assert result["status"] == "completed"
    assert result["issues"] == []


def test_missing_field_bad_date_currency_and_total():
    result = validate_extraction(
        extraction(
            supplier_name=_field(None, 0),
            invoice_date=_field("Marchtober"),
            currency=_field("XYZ"),
            total=_field(50),
        )
    )
    assert result["status"] == "needs_review"
    assert {"missing_field", "invalid_date", "invalid_currency", "total_mismatch"} <= codes(result)


def test_line_sum_mismatch():
    result = validate_extraction(extraction(subtotal=_field(90)))
    assert "line_sum_mismatch" in codes(result)


def test_duplicate_and_cross_document():
    other = {
        "document_id": "doc-a",
        "invoice_number": "INV-1",
        "supplier_name": "Acme Supplies",
        "total": 90,
        "line_items": [{"description": "Widget", "amount": 90}],
    }
    result = validate_extraction(extraction(), [other], document_id="doc-b")
    assert {"duplicate_invoice", "cross_document_mismatch"} <= codes(result)


def test_same_document_is_not_a_duplicate_of_itself():
    other = {
        "document_id": "doc-a",
        "invoice_number": "INV-1",
        "supplier_name": "Acme Supplies",
        "total": 110,
        "line_items": [
            {"description": "Widget", "amount": 80},
            {"description": "Gadget", "amount": 20},
        ],
    }
    result = validate_extraction(extraction(), [other], document_id="doc-a")
    assert result["status"] == "completed"
