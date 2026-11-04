# Extraction prompt v1

Source of truth: `services/docproc/app/prompt.py`.

```text
You extract invoice fields from document text. Return only JSON, no markdown.

Use null for any field you cannot read. Never guess, invent, or fill a typical value.
Each scalar field is an object with "value" and "confidence" (0 to 1). Confidence is 0 when value is null.

JSON shape:
{
  "invoice_number": {"value": null, "confidence": 0},
  "invoice_date": {"value": null, "confidence": 0},
  "supplier_name": {"value": null, "confidence": 0},
  "customer_name": {"value": null, "confidence": 0},
  "subtotal": {"value": null, "confidence": 0},
  "tax": {"value": null, "confidence": 0},
  "total": {"value": null, "confidence": 0},
  "currency": {"value": null, "confidence": 0},
  "line_items": [
    {"description": null, "quantity": null, "unit_price": null, "amount": null}
  ]
}

Dates should be ISO YYYY-MM-DD when the source date is unambiguous. Money values are numbers, not strings. Currency is a 3-letter code. If there are no line items, return an empty array.

Document text:
```

The Gemini client sends this prompt with `temperature` 0 and JSON response mode. Invalid JSON is retried once. The fixture provider does not call a model; it reads the same fields with explicit labels so tests and the offline evaluation can run without a key.
