import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "docproc"))

import json
import os
import time

os.environ.setdefault("EXTRACTION_PROVIDER", "fixture")
os.environ.setdefault("EMBED_BACKEND", "hash")

from PIL import Image, ImageDraw
from openpyxl import Workbook
from reportlab.pdfgen import canvas
import xlwt

from app.errors import DocumentProcessError
from app.pipeline import run_pipeline

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "eval" / "dataset"
REPORT = ROOT / "docs" / "evaluation-report.md"
FIELDS = [
    "invoice_number",
    "invoice_date",
    "supplier_name",
    "customer_name",
    "subtotal",
    "tax",
    "total",
    "currency",
]


def invoice_lines(number, total="110.00", supplier="Acme Supplies", include_supplier=True, subtotal="100.00", tax="10.00"):
    lines = [f"Invoice Number: {number}", "Invoice Date: 2024-03-01"]
    if include_supplier:
        lines.append(f"Supplier: {supplier}")
    lines.extend(
        [
            "Customer: Northwind Traders",
            "Currency: USD",
            f"Subtotal: {subtotal}",
            f"Tax: {tax}",
            f"Total: {total}",
            "- Widget | 2 | 40.00 | 80.00",
            "- Gadget | 1 | 20.00 | 20.00",
        ]
    )
    return lines


def write_pdf(path: Path, lines: list[str]) -> None:
    pdf = canvas.Canvas(str(path))
    for index, line in enumerate(lines):
        if index and index % 28 == 0:
            pdf.showPage()
        pdf.drawString(72, 760 - (index % 28) * 18, line)
    pdf.save()


def write_xlsx(path: Path, lines: list[str], extra_sheet=False) -> None:
    book = Workbook()
    sheet = book.active
    sheet.title = "Invoice"
    for index, line in enumerate(lines, start=1):
        sheet.cell(index, 1, line)
    if extra_sheet:
        notes = book.create_sheet("Notes")
        notes.cell(1, 1, "Currency: USD")
    book.save(path)


def write_xls(path: Path, lines: list[str]) -> None:
    book = xlwt.Workbook()
    sheet = book.add_sheet("Invoice")
    for index, line in enumerate(lines):
        sheet.write(index, 0, line)
    book.save(str(path))


def write_csv(path: Path, lines: list[str]) -> None:
    path.write_text("\n".join(f'"{line}"' for line in lines), encoding="utf-8")


def write_image(path: Path, lines: list[str]) -> None:
    pdf_path = path.with_suffix(".render.pdf")
    write_pdf(pdf_path, lines)
    try:
        from pdf2image import convert_from_path

        images = convert_from_path(str(pdf_path), dpi=200)
        if path.suffix.lower() in {".tif", ".tiff"}:
            images[0].save(path, format="TIFF")
        else:
            images[0].save(path, format="PNG")
    except Exception:
        image = Image.new("RGB", (1600, 1000), "white")
        draw = ImageDraw.Draw(image)
        y = 30
        for line in lines:
            draw.text((30, y), line, fill="black")
            y += 34
        image.save(path)
    finally:
        pdf_path.unlink(missing_ok=True)


def expected_fields(number, total=110.0, supplier="Acme Supplies", subtotal=100.0, tax=10.0, include_supplier=True):
    return {
        "invoice_number": number,
        "invoice_date": "2024-03-01",
        "supplier_name": supplier if include_supplier else None,
        "customer_name": "Northwind Traders",
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "currency": "USD",
    }


CASES = []


def add_case(case_id, filename, kind, lines, fields, expect_ok=True, expect_status="completed"):
    CASES.append(
        {
            "id": case_id,
            "filename": filename,
            "kind": kind,
            "lines": lines,
            "fields": fields,
            "line_items": [
                {"description": "Widget", "amount": 80},
                {"description": "Gadget", "amount": 20},
            ],
            "expect_ok": expect_ok,
            "expect_status": expect_status,
        }
    )


def build_cases():
    CASES.clear()
    specs = [
        ("clean-pdf-1", "clean-pdf-1.pdf", "pdf", "INV-1001", "110.00", 110.0, "completed"),
        ("clean-pdf-2", "clean-pdf-2.pdf", "pdf", "INV-1002", "110.00", 110.0, "completed"),
        ("clean-pdf-3", "clean-pdf-3.pdf", "pdf", "INV-1003", "110.00", 110.0, "completed"),
        ("clean-csv", "clean.csv", "csv", "INV-1004", "110.00", 110.0, "completed"),
        ("clean-xlsx", "clean.xlsx", "xlsx", "INV-1005", "110.00", 110.0, "completed"),
        ("clean-xls", "clean.xls", "xls", "INV-1006", "110.00", 110.0, "completed"),
        ("clean-image", "clean.png", "image", "INV-1007", "110.00", 110.0, "completed"),
        ("missing-supplier", "missing-supplier.pdf", "pdf", "INV-1008", "110.00", 110.0, "needs_review"),
        ("bad-total", "bad-total.pdf", "pdf", "INV-1009", "999.00", 999.0, "needs_review"),
        ("duplicate-pdf", "duplicate.pdf", "pdf", "INV-1001", "110.00", 110.0, "needs_review"),
        ("cross-xlsx", "cross.xlsx", "xlsx", "INV-1002", "50.00", 50.0, "needs_review"),
        ("second-image", "second.tiff", "image", "INV-1010", "110.00", 110.0, "completed"),
        ("clean-pdf-4", "clean-pdf-4.pdf", "pdf", "INV-1011", "110.00", 110.0, "completed"),
        ("clean-csv-2", "clean-2.csv", "csv", "INV-1012", "110.00", 110.0, "completed"),
    ]
    for case_id, filename, kind, number, total_text, total_value, status in specs:
        include_supplier = case_id != "missing-supplier"
        add_case(
            case_id,
            filename,
            kind,
            invoice_lines(number, total=total_text, include_supplier=include_supplier),
            expected_fields(number, total=total_value, include_supplier=include_supplier),
            True,
            status,
        )
    CASES.append(
        {
            "id": "corrupt-pdf",
            "filename": "corrupt.pdf",
            "kind": "corrupt",
            "lines": [],
            "fields": {},
            "line_items": [],
            "expect_ok": False,
            "expect_status": "failed",
        }
    )


def materialize(case):
    path = DATASET / case["filename"]
    if case["kind"] == "pdf":
        write_pdf(path, case["lines"])
    elif case["kind"] == "xlsx":
        write_xlsx(path, case["lines"], extra_sheet=True)
    elif case["kind"] == "xls":
        write_xls(path, case["lines"])
    elif case["kind"] == "csv":
        write_csv(path, case["lines"])
    elif case["kind"] == "image":
        write_image(path, case["lines"])
    elif case["kind"] == "corrupt":
        path.write_bytes(b"this is not a pdf")
    return path


def mime_for(path: Path) -> str:
    return {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".tiff": "image/tiff",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".csv": "text/csv",
    }[path.suffix.lower()]


def close(left, right) -> bool:
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, (int, float)) or isinstance(right, (int, float)):
        try:
            return abs(float(left) - float(right)) <= 0.02
        except (TypeError, ValueError):
            return False
    return str(left).strip().lower() == str(right).strip().lower()


def score_case(case, result):
    if not case["expect_ok"]:
        return {"fields": 0, "correct": 0, "skipped": True}
    correct = 0
    total = 0
    extraction = result.get("extraction") or {}
    for field in FIELDS:
        total += 1
        predicted = (extraction.get(field) or {}).get("value")
        if close(predicted, case["fields"][field]):
            correct += 1
    predicted_items = {item.get("description"): item.get("amount") for item in result.get("line_items") or []}
    for item in case["line_items"]:
        total += 1
        if close(predicted_items.get(item["description"]), item["amount"]):
            correct += 1
    return {"fields": total, "correct": correct, "skipped": False}


def run():
    build_cases()
    DATASET.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    os.environ["STORAGE_DIR"] = str(DATASET.resolve())
    seen = []
    rows = []
    started = time.perf_counter()
    for case in CASES:
        path = materialize(case)
        t0 = time.perf_counter()
        try:
            result = run_pipeline(str(path), mime_for(path), seen, case["id"])
            elapsed = time.perf_counter() - t0
            ok = bool(result.get("ok"))
            error = None
        except DocumentProcessError as exc:
            elapsed = time.perf_counter() - t0
            result = {"ok": False, "error": str(exc), "status": "failed"}
            ok = False
            error = str(exc)
        if ok:
            extraction = result["extraction"]
            seen.append(
                {
                    "document_id": case["id"],
                    "invoice_number": extraction["invoice_number"]["value"],
                    "supplier_name": extraction["supplier_name"]["value"],
                    "total": extraction["total"]["value"],
                    "line_items": result["line_items"],
                }
            )
        scored = score_case(case, result if ok else {})
        rows.append(
            {
                "id": case["id"],
                "filename": case["filename"],
                "ok": ok,
                "status": result.get("status") if ok else "failed",
                "expected_status": case["expect_status"],
                "seconds": round(elapsed, 3),
                "correct": scored["correct"],
                "fields": scored["fields"],
                "error": error or result.get("error"),
                "provider": result.get("provider"),
            }
        )
    elapsed = time.perf_counter() - started
    attempted = len(rows)
    successes = [row for row in rows if row["ok"]]
    failures = attempted - len(successes)
    field_total = sum(row["fields"] for row in rows)
    field_correct = sum(row["correct"] for row in rows)
    accuracy = (field_correct / field_total) if field_total else 0
    provider = os.environ.get("EXTRACTION_PROVIDER", "fixture")
    backend = os.environ.get("EMBED_BACKEND", "hash")
    lines = [
        "# Evaluation report",
        "",
        f"Provider: `{provider}`. Embedding backend for this run: `{backend}`.",
        "The labeled set is synthetic. Each file uses the same invoice template so the fixture extractor can be scored without a paid model.",
        "Set `EXTRACTION_PROVIDER=gemini` and `GEMINI_API_KEY` before rerunning `npm run eval` to measure the free Gemini tier. This report records the provider that actually ran.",
        "",
        f"- Documents: {attempted}",
        f"- Success rate: {len(successes) / attempted:.1%} ({len(successes)} processed, including records flagged for review)",
        f"- Failure rate: {failures / attempted:.1%} ({failures} file{'s' if failures != 1 else ''} the pipeline rejected)",
        f"- Field accuracy on processed documents: {accuracy:.1%} ({field_correct}/{field_total} fields and line amounts)",
        f"- Mean processing time: {sum(row['seconds'] for row in rows) / attempted:.3f}s",
        f"- Wall time: {elapsed:.3f}s",
        "",
        "| Case | Result | Status | Expected | Seconds | Fields |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            f"| {row['id']} | {'ok' if row['ok'] else 'failed'} | {row['status']} | {row['expected_status']} | {row['seconds']:.3f} | {row['correct']}/{row['fields']} |"
        )
    lines.append("")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (DATASET / "labels.json").write_text(json.dumps([{k: v for k, v in case.items() if k != "lines"} for case in CASES], indent=2), encoding="utf-8")
    print(REPORT.read_text())


if __name__ == "__main__":
    run()
