from reportlab.pdfgen import canvas

from app.pipeline import run_pipeline


def test_pipeline_on_pdf(tmp_path, monkeypatch):
    monkeypatch.setenv("EXTRACTION_PROVIDER", "fixture")
    monkeypatch.setenv("EMBED_BACKEND", "hash")
    monkeypatch.setenv("STORAGE_DIR", str(tmp_path))
    path = tmp_path / "invoice.pdf"
    pdf = canvas.Canvas(str(path))
    for line_index, line in enumerate(
        [
            "Invoice Number: INV-1001",
            "Invoice Date: 2024-03-01",
            "Supplier: Acme Supplies",
            "Customer: Northwind Traders",
            "Currency: USD",
            "Subtotal: 100.00",
            "Tax: 10.00",
            "Total: 110.00",
            "- Widget | 2 | 40.00 | 80.00",
            "- Gadget | 1 | 20.00 | 20.00",
        ]
    ):
        pdf.drawString(72, 740 - line_index * 18, line)
    pdf.save()
    result = run_pipeline(str(path), "application/pdf", [], "doc-1")
    assert result["ok"] is True
    assert result["status"] == "completed"
    assert result["provider"] == "fixture"
    assert result["extraction"]["invoice_number"]["value"] == "INV-1001"
    assert result["chunks"]
    assert len(result["chunks"][0]["embedding"]) == 384


def test_pipeline_rejects_path_outside_storage(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_DIR", str(tmp_path / "storage"))
    (tmp_path / "storage").mkdir()
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"%PDF")
    result_path = tmp_path / "storage" / "note.txt"
    result_path.write_text("x")
    from app.pipeline import run_pipeline as pipeline

    try:
        pipeline(str(outside), "application/pdf")
        raised = False
    except Exception as exc:
        raised = "outside storage" in str(exc)
    assert raised
