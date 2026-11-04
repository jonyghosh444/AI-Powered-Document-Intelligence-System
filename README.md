# AI-Powered Document Intelligence System

Upload invoices and related spreadsheets, extract the header fields and line items, validate the arithmetic, and review the result in a small web app.

## Stack

- Next.js review UI in `apps/web`
- NestJS API and BullMQ worker in `apps/api`
- Python parsing, OCR, extraction, and validation in `services/docproc`
- Postgres 16 with pgvector, Redis 7

pgvector is the vector store. A second database would cost memory on a small machine, and the brief allows that tradeoff when it is explained. Embeddings use the same `all-MiniLM-L6-v2` model through ONNX (`fastembed` 0.6.1). That release supports Python 3.13; the older 0.4 pin does not, and it avoids a PyTorch install on an 8 GB machine. If that model cannot be downloaded, the service falls back to a local hashed bag-of-words vector of the same size and reports the backend on the process response.

Extraction defaults to a fixture reader so the project runs with no API key. A free Gemini key switches the same JSON contract to `gemini-3.5-flash-lite`. This laptop has 8 GB of RAM and no usable GPU, so a local 7B model is not the default.

## Setup

Docker is the way to run the whole system. It starts Postgres, Redis, the Python document service, the API, and the web UI.

```bash
cp .env.example .env
docker compose up --build -d
```

Put a free [Google AI Studio](https://aistudio.google.com/apikey) key in `.env` when you want live extraction:

```bash
EXTRACTION_PROVIDER=gemini
GEMINI_API_KEY=your-free-key
GEMINI_MODEL=gemini-3.5-flash-lite
```

Then run `docker compose up -d` again so the document service picks up the key. With no key, leave `EXTRACTION_PROVIDER=fixture`.

Open http://localhost:3000. The API is http://localhost:3001. Uploaded files are shared by the API and the document service through one Docker volume. The first processed file downloads the local embedding model into that volume; later files reuse it. Tesseract and Poppler are inside the document image, so the host machine does not need them.

Postgres is published on port 5434 so it does not collide with another Postgres already using 5432. The containers talk to each other on the Compose network and do not use that host port.

Stop the stack with `docker compose down`. Add `-v` only when you also want to delete the database, uploads, and cached embedding model.

### Run on the host instead

This is only for development. The Compose file above is enough to use the app.

```bash
docker compose up -d postgres redis
ln -sf ../../.env apps/api/.env
npm install
npm run prisma:push
python3 -m venv services/docproc/.venv
services/docproc/.venv/bin/pip install -r services/docproc/requirements.txt
mkdir -p storage/uploads
npm run dev:doc
npm run dev:api
npm run dev:web
```

Host OCR also needs `tesseract-ocr` and `poppler-utils`. Point `DATABASE_URL` at `localhost:5434` and `DOCPROC_URL` at `http://127.0.0.1:8000`.

## What you can do

- Upload several PDF, JPG, PNG, TIFF, XLSX, XLS, or CSV files. The request returns when the jobs are queued.
- Watch status move from queued to processing, then completed, needs review, or failed.
- Open a document, fix a field or line item, and save. The previous value is kept in corrections and validation runs again.
- Reprocess a job from the document page.
- Filter by supplier, customer, invoice number, or keywords, and run a semantic query.

`DOC_PAGE_CAP` defaults to 50. That is the knob for the brief’s very long PDFs: pages are handled one at a time, and the cap keeps a single file from filling RAM.

## Tests and evaluation

```bash
npm run test:py
npm run test:api
RUN_E2E=1 npm run test:api
npm run eval
```

Python tests cover PDF text, the page cap, multi-sheet Excel, CSV, legacy XLS, corrupt files, OCR when Tesseract is installed, the fixture extractor, and the validation rules. API unit tests cover corrections. The end-to-end test needs Docker and `RUN_E2E=1`; it uploads a file through Nest, waits for the worker, corrects a field, retries, and searches.

`npm run eval` rebuilds `eval/dataset`, scores about 15 synthetic invoices, and writes `docs/evaluation-report.md`. The report names the provider. Fixture mode measures the rule reader. Gemini mode measures the live free-tier model.

## API

- `POST /documents` multipart field `files`
- `GET /documents` and `GET /documents/:id`
- `PATCH /documents/:id` corrected fields
- `GET /jobs/:id`
- `POST /jobs/:id/retry`
- `GET /search?q=&supplier=&customer=&invoice_number=&status=`
- `POST /search/semantic` JSON `{ "query": "..." }`

## AI-assisted development

This repository was implemented with Cursor’s agent (Grok). The extraction prompt is in `docs/prompts/extraction-v1.md` and `services/docproc/app/prompt.py`. No paid model is required to run the tests. Disclosure: generated code was reviewed by running the test suite, the evaluation script, and the upload flow.

## Walkthrough recording

Record a short screen capture after `docker compose up --build -d`:

1. Upload a clean PDF and the bad-total sample from `eval/dataset`.
2. Show the queued status change to completed and needs review.
3. Open the bad total, correct the total so it matches subtotal plus tax, and save.
4. Search for the supplier, then run a semantic query.

The repo cannot produce that video on its own.
