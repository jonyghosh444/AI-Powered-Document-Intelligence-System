# Test results

Recorded on this machine after `npm run test:py`, `RUN_E2E=1 npm run test:api` from `apps/api`, and `npm run eval`.

## Python

`services/docproc` pytest: 13 passed.

Covers digital PDF text, the page cap, multi-sheet XLSX, CSV, XLS, corrupt PDF, spreadsheet, and image failures, OCR on a rendered PNG and TIFF, fixture extraction without inventing a missing supplier, money normalization, clean validation, bad dates and totals, duplicate and cross-document checks, the full PDF pipeline, and rejection of paths outside storage.

## API

Jest: 5 passed.

- Correction merge unit tests: 3 passed.
- End-to-end, with Postgres, Redis, and a stub document service: upload, background processing, job status, manual correction, retry, keyword search, semantic search, and rejection of a `.txt` upload.

## Evaluation

Provider `fixture`, embedding backend `hash` for this timed run. 15 synthetic documents.

- Success rate: 93.3% (14 processed, including records flagged for review)
- Failure rate: 6.7% (the corrupt PDF)
- Field accuracy on processed documents: 100.0% (140/140)
- Mean processing time: 0.148s

The image cases were read with Tesseract. Re-run `EXTRACTION_PROVIDER=gemini npm run eval` when a free Gemini key is available; the report names whichever provider actually ran. Full table: `docs/evaluation-report.md`.
