from app.extract import extract_fixture, normalize_extraction


def test_fixture_reads_template_and_leaves_gaps_null():
    text = """
Invoice Number: INV-9
Invoice Date: 2024-03-01
Customer: Northwind Traders
Currency: usd
Subtotal: 100.00
Tax: 10.00
Total: 110.00
- Widget | 2 | 40.00 | 80.00
"""
    result = extract_fixture(text)
    assert result["invoice_number"]["value"] == "INV-9"
    assert result["supplier_name"]["value"] is None
    assert result["currency"]["value"] == "USD"
    assert result["subtotal"]["value"] == 100
    assert result["line_items"][0]["description"] == "Widget"
    assert result["line_items"][0]["amount"] == 80


def test_normalize_unwraps_nested_line_items():
    result = normalize_extraction(
        {
            "line_items": [
                {
                    "description": {"value": "Widget", "confidence": 1},
                    "quantity": {"value": "2", "confidence": 0.8},
                    "unit_price": {"value": 40, "confidence": 0.8},
                    "amount": {"value": "80.00", "confidence": 0.9},
                }
            ]
        }
    )
    assert result["line_items"] == [
        {"description": "Widget", "quantity": 2.0, "unit_price": 40.0, "amount": 80.0}
    ]


def test_normalize_rejects_non_numeric_money():
    result = normalize_extraction({"total": {"value": "not-a-number", "confidence": 0.4}, "line_items": []})
    assert result["total"]["value"] is None
    assert result["invoice_number"]["value"] is None
