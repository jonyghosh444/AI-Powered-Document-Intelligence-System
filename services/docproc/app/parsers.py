import logging
import os
import shutil
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook
from PIL import Image
from pypdf import PdfReader

from app.errors import DocumentProcessError

logging.getLogger("pypdf").setLevel(logging.ERROR)


def page_cap() -> int:
    raw = os.environ.get("DOC_PAGE_CAP", "50")
    try:
        return max(1, int(raw))
    except ValueError:
        return 50


def _ocr_image(image: Image.Image) -> str:
    try:
        import pytesseract
    except ImportError as exc:
        raise DocumentProcessError("OCR library is not installed") from exc
    _ensure_tessdata()
    rgb = image.convert("RGB")
    try:
        return pytesseract.image_to_string(rgb) or ""
    except Exception as exc:
        raise DocumentProcessError(f"OCR failed: {exc}") from exc


def _ensure_tessdata() -> None:
    if os.environ.get("TESSDATA_PREFIX"):
        return
    binary = shutil.which("tesseract")
    if not binary:
        return
    tessdata = Path(binary).resolve().parents[1] / "share" / "tessdata"
    if (tessdata / "eng.traineddata").exists():
        os.environ["TESSDATA_PREFIX"] = str(tessdata)


def _pdf_page_image(path: Path, page_index: int) -> Image.Image:
    try:
        from pdf2image import convert_from_path
    except ImportError as exc:
        raise DocumentProcessError("pdf2image is not installed") from exc
    try:
        images = convert_from_path(
            str(path),
            first_page=page_index + 1,
            last_page=page_index + 1,
            dpi=200,
        )
    except Exception as exc:
        raise DocumentProcessError(f"Could not rasterize PDF page {page_index + 1}: {exc}") from exc
    if not images:
        raise DocumentProcessError(f"PDF page {page_index + 1} produced no image")
    return images[0]


def parse_pdf(path: Path) -> list[dict]:
    try:
        reader = PdfReader(str(path))
    except Exception as exc:
        raise DocumentProcessError(f"Unreadable PDF: {exc}") from exc
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise DocumentProcessError("Encrypted PDF") from exc
    cap = page_cap()
    pages = reader.pages[:cap]
    texts = []
    for index, page in enumerate(pages):
        try:
            digital = page.extract_text() or ""
        except Exception as exc:
            raise DocumentProcessError(f"Failed reading PDF page {index + 1}: {exc}") from exc
        text = digital.strip()
        if len(text) < 20:
            image = _pdf_page_image(path, index)
            text = _ocr_image(image).strip()
        texts.append({"index": index, "label": f"page-{index + 1}", "text": text})
    if not texts:
        raise DocumentProcessError("PDF has no pages")
    return texts


def parse_image(path: Path) -> list[dict]:
    try:
        image = Image.open(path)
        image.load()
    except Exception as exc:
        raise DocumentProcessError(f"Unreadable image: {exc}") from exc
    frames = getattr(image, "n_frames", 1) or 1
    cap = page_cap()
    texts = []
    for index in range(min(frames, cap)):
        image.seek(index)
        text = _ocr_image(image).strip()
        texts.append({"index": index, "label": f"frame-{index + 1}", "text": text})
    return texts


def _rows_to_text(rows: list[list[str]]) -> str:
    lines = []
    for row in rows:
        cells = [cell.strip() for cell in row if cell and cell.strip() and cell.strip().lower() != "nan"]
        if not cells:
            continue
        if len(cells) == 1:
            lines.append(cells[0])
        else:
            lines.append(" | ".join(cells))
    return "\n".join(lines)


def parse_xlsx(path: Path) -> list[dict]:
    try:
        workbook = load_workbook(path, data_only=True, read_only=True)
    except Exception as exc:
        raise DocumentProcessError(f"Unreadable spreadsheet: {exc}") from exc
    texts = []
    try:
        for index, sheet in enumerate(workbook.worksheets[: page_cap()]):
            rows = []
            for row in sheet.iter_rows(values_only=True):
                rows.append(["" if cell is None else str(cell) for cell in row])
            texts.append({"index": index, "label": sheet.title or f"sheet-{index + 1}", "text": _rows_to_text(rows)})
    finally:
        workbook.close()
    if not texts:
        raise DocumentProcessError("Spreadsheet has no sheets")
    return texts


def parse_xls(path: Path) -> list[dict]:
    try:
        import xlrd
    except ImportError as exc:
        raise DocumentProcessError("xlrd is not installed") from exc
    try:
        book = xlrd.open_workbook(str(path))
    except Exception as exc:
        raise DocumentProcessError(f"Unreadable spreadsheet: {exc}") from exc
    texts = []
    for index in range(min(book.nsheets, page_cap())):
        sheet = book.sheet_by_index(index)
        rows = []
        for r in range(sheet.nrows):
            rows.append(["" if sheet.cell_value(r, c) is None else str(sheet.cell_value(r, c)) for c in range(sheet.ncols)])
        texts.append({"index": index, "label": sheet.name or f"sheet-{index + 1}", "text": _rows_to_text(rows)})
    if not texts:
        raise DocumentProcessError("Spreadsheet has no sheets")
    return texts


def parse_csv(path: Path) -> list[dict]:
    last_error = None
    frame = None
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            frame = pd.read_csv(path, header=None, dtype=str, encoding=encoding, keep_default_na=False)
            break
        except Exception as exc:
            last_error = exc
            frame = None
    if frame is None:
        raise DocumentProcessError(f"Unreadable CSV: {last_error}")
    rows = frame.fillna("").astype(str).values.tolist()
    return [{"index": 0, "label": "csv", "text": _rows_to_text(rows)}]


def parse_file(path: Path, mime: str) -> list[dict]:
    suffix = path.suffix.lower()
    if mime == "application/pdf" or suffix == ".pdf":
        return parse_pdf(path)
    if mime in {"image/jpeg", "image/png", "image/tiff"} or suffix in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}:
        return parse_image(path)
    if suffix == ".xls" or mime == "application/vnd.ms-excel":
        return parse_xls(path)
    if suffix in {".xlsx"} or "spreadsheetml" in mime:
        return parse_xlsx(path)
    if suffix == ".csv" or mime in {"text/csv", "application/csv", "text/plain"}:
        return parse_csv(path)
    raise DocumentProcessError(f"Unsupported file type: {mime or suffix}")


def combined_text(pages: list[dict]) -> str:
    chunks = []
    for page in pages:
        label = page.get("label") or f"page-{page.get('index', 0) + 1}"
        chunks.append(f"[{label}]\n{page.get('text') or ''}".strip())
    return "\n\n".join(chunks).strip()
