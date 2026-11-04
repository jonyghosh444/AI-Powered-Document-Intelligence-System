import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { DocprocClient } from "./docproc.client";
import { PrismaService } from "./prisma.service";

@Controller()
export class SearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docproc: DocprocClient,
  ) {}

  @Get("search")
  async keyword(
    @Query("q") q?: string,
    @Query("supplier") supplier?: string,
    @Query("customer") customer?: string,
    @Query("invoice_number") invoiceNumber?: string,
    @Query("status") status?: string,
  ) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; filename: string; status: string; invoice_number: string | null; supplier_name: string | null; customer_name: string | null; total: number | null }>>`
      SELECT id, filename, status, invoice_number, supplier_name, customer_name, total
      FROM (
        SELECT DISTINCT ON (d.id)
          d.id,
          d.filename,
          d.status::text AS status,
          d.created_at,
          e.result->'invoice_number'->>'value' AS invoice_number,
          e.result->'supplier_name'->>'value' AS supplier_name,
          e.result->'customer_name'->>'value' AS customer_name,
          CASE
            WHEN e.result->'total'->>'value' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (e.result->'total'->>'value')::float
            ELSE NULL
          END AS total
        FROM documents d
        LEFT JOIN document_texts t ON t.document_id = d.id
        LEFT JOIN extractions e ON e.document_id = d.id AND e.is_current = true
        WHERE (${status || null}::text IS NULL OR d.status::text = ${status || null})
          AND (${invoiceNumber || null}::text IS NULL OR coalesce(e.result->'invoice_number'->>'value', '') ILIKE '%' || ${invoiceNumber || ""} || '%')
          AND (${supplier || null}::text IS NULL OR coalesce(e.result->'supplier_name'->>'value', '') ILIKE '%' || ${supplier || ""} || '%')
          AND (${customer || null}::text IS NULL OR coalesce(e.result->'customer_name'->>'value', '') ILIKE '%' || ${customer || ""} || '%')
          AND (
            ${q || null}::text IS NULL
            OR to_tsvector('english', coalesce(t.text, '')) @@ plainto_tsquery('english', coalesce(${q || null}, 'document'))
            OR coalesce(e.result->'invoice_number'->>'value', '') ILIKE '%' || coalesce(${q || null}, '') || '%'
            OR coalesce(e.result->'supplier_name'->>'value', '') ILIKE '%' || coalesce(${q || null}, '') || '%'
            OR coalesce(e.result->'customer_name'->>'value', '') ILIKE '%' || coalesce(${q || null}, '') || '%'
            OR d.filename ILIKE '%' || coalesce(${q || null}, '') || '%'
          )
        ORDER BY d.id, d.created_at DESC
      ) matched
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return { results: rows };
  }

  @Post("search/semantic")
  @HttpCode(200)
  async semantic(@Body() body: { query?: string }) {
    const query = (body?.query || "").trim();
    if (!query) throw new BadRequestException("Query is required");
    const embedding = await this.docproc.embed(query);
    if (embedding.some((value) => !Number.isFinite(value))) {
      throw new BadRequestException("Embedding was invalid");
    }
    const literal = `[${embedding.join(",")}]`;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; filename: string; text: string; score: number }>>(
      `SELECT d.id, d.filename, c.text, 1 - (c.embedding <=> $1::vector) AS score
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT 20`,
      literal,
    );
    return {
      results: rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        text: row.text,
        score: Number(row.score),
      })),
    };
  }
}
