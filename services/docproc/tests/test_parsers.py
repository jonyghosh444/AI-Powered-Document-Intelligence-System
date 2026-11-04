import pytest
from reportlab.pdfgen import canvas

from app.errors import DocumentProcessError
from app.parsers import parse_csv, parse_file, parse_pdf, parse_xls, parse_xlsx


def _invoice(number="INV-1001", total="110.00", supplier="Acme Supplies", include_supplier=True):
    lines = [
        f"Invoice Number: {number}",
        "Invoice Date: 2024-03-01",
    ]
    if include_supplier:
        lines.append(f"Supplier: {supplier}")
    lines.extend(
        [
            "Customer: Northwind Traders",
            "Currency: USD",
            "Subtotal: 100.00",
            "Tax: 10.00",
            f"Total: {total}",
            "- Widget | 2 | 40.00 | 80.00",
            "- Gadget | 1 | 20.00 | 20.00",
        ]
    )
    return "\n".join(lines)


def test_digital_pdf_and_page_cap(tmp_path, monkeypatch):
    path = tmp_path / "two.pdf"
    pdf = canvas.Canvas(str(path))
    pdf.drawString(72, 720, _invoice())
    pdf.showPage()
    pdf.drawString(72, 720, "Second page still has enough digital text for extraction.")
    pdf.save()
    pages = parse_pdf(path)
    assert len(pages) == 2
    assert "INV-1001" in pages[0]["text"]
    monkeypatch.setenv("DOC_PAGE_CAP", "1")
    assert len(parse_pdf(path)) == 1


def test_multi_sheet_xlsx_and_csv_and_xls(tmp_path):
    from openpyxl import Workbook
    import xlwt

    xlsx = tmp_path / "book.xlsx"
    book = Workbook()
    first = book.active
    first.title = "March"
    for index, line in enumerate(_invoice().splitlines(), start=1):
        first.cell(index, 1, line)
    second = book.create_sheet("Notes")
    second.cell(1, 1, "Supplier: Extra Sheet Co")
    book.save(xlsx)
    sheets = parse_xlsx(xlsx)
    assert [sheet["label"] for sheet in sheets] == ["March", "Notes"]
    assert "INV-1001" in sheets[0]["text"]

    csv_path = tmp_path / "plain.csv"
    csv_path.write_text("\n".join(f'"{line}"' for line in _invoice("INV-2002").splitlines()), encoding="utf-8")
    csv_text = parse_csv(csv_path)[0]["text"]
    assert "INV-2002" in csv_text

    xls_path = tmp_path / "legacy.xls"
    workbook = xlwt.Workbook()
    sheet = workbook.add_sheet("Invoice")
    for index, line in enumerate(_invoice("INV-3003").splitlines()):
        sheet.write(index, 0, line)
    workbook.save(str(xls_path))
    assert "INV-3003" in parse_xls(xls_path)[0]["text"]


def test_corrupt_files_fail(tmp_path):
    pdf = tmp_path / "broken.pdf"
    pdf.write_bytes(b"this is not a pdf")
    with pytest.raises(DocumentProcessError):
        parse_pdf(pdf)
    sheet = tmp_path / "broken.xlsx"
    sheet.write_bytes(b"not a zip")
    with pytest.raises(DocumentProcessError):
        parse_xlsx(sheet)
    image = tmp_path / "broken.png"
    image.write_bytes(b"nope")
    with pytest.raises(DocumentProcessError):
        parse_file(image, "image/png")


def test_image_ocr_when_tesseract_exists(tmp_path):
    pytesseract = pytest.importorskip("pytesseract")
    pytest.importorskip("pdf2image")
    try:
        pytesseract.get_tesseract_version()
    except Exception:
        pytest.skip("tesseract is not installed")
    pdf_path = tmp_path / "scan.pdf"
    pdf = canvas.Canvas(str(pdf_path))
    y = 740
    for line in _invoice("INV-IMG").splitlines():
        pdf.drawString(72, y, line)
        y -= 18
    pdf.save()
    from pdf2image import convert_from_path

    try:
        images = convert_from_path(str(pdf_path), dpi=200)
    except Exception:
        pytest.skip("poppler is not installed")
    path = tmp_path / "scan.png"
    images[0].save(path)
    text = parse_file(path, "image/png")[0]["text"]
    assert "INV-IMG" in text

    tiff = tmp_path / "scan.tiff"
    images[0].save(tiff, format="TIFF")
    assert "INV-IMG" in parse_file(tiff, "image/tiff")[0]["text"]
