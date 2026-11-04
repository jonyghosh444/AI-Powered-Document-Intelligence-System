export type FieldValue = { value: string | number | null; confidence: number | null };

export type LineItemInput = {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  amount?: number | null;
};

export type ExtractionResult = {
  invoice_number: FieldValue;
  invoice_date: FieldValue;
  supplier_name: FieldValue;
  customer_name: FieldValue;
  subtotal: FieldValue;
  tax: FieldValue;
  total: FieldValue;
  currency: FieldValue;
  line_items: LineItemInput[];
};

export const SCALAR_FIELDS = [
  "invoice_number",
  "invoice_date",
  "supplier_name",
  "customer_name",
  "subtotal",
  "tax",
  "total",
  "currency",
] as const;

const NUMERIC = new Set(["subtotal", "tax", "total"]);

export type CorrectionChange = {
  fieldPath: string;
  oldValue: string | null;
  newValue: string | null;
};

function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function normalizeScalar(field: string, value: unknown): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (NUMERIC.has(field)) {
    const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }
  return String(value).trim();
}

export function emptyExtraction(): ExtractionResult {
  return {
    invoice_number: { value: null, confidence: 0 },
    invoice_date: { value: null, confidence: 0 },
    supplier_name: { value: null, confidence: 0 },
    customer_name: { value: null, confidence: 0 },
    subtotal: { value: null, confidence: 0 },
    tax: { value: null, confidence: 0 },
    total: { value: null, confidence: 0 },
    currency: { value: null, confidence: 0 },
    line_items: [],
  };
}

export function applyCorrections(current: unknown, patch: Record<string, unknown>): { next: ExtractionResult; changes: CorrectionChange[] } {
  const base = { ...emptyExtraction(), ...(current && typeof current === "object" ? (current as ExtractionResult) : {}) };
  const next: ExtractionResult = {
    ...base,
    line_items: Array.isArray(base.line_items) ? base.line_items.map((item) => ({ ...item })) : [],
  };
  const changes: CorrectionChange[] = [];

  for (const field of SCALAR_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const previous = next[field]?.value ?? null;
    const value = normalizeScalar(field, patch[field]);
    if (asText(previous) === asText(value)) continue;
    next[field] = { value, confidence: 1 };
    changes.push({ fieldPath: field, oldValue: asText(previous), newValue: asText(value) });
  }

  if (Object.prototype.hasOwnProperty.call(patch, "line_items") && Array.isArray(patch.line_items)) {
    const previous = JSON.stringify(next.line_items);
    const items = patch.line_items.map((item) => {
      const row = (item || {}) as LineItemInput;
      return {
        description: row.description == null || row.description === "" ? null : String(row.description),
        quantity: row.quantity == null || row.quantity === ("" as unknown) ? null : Number(row.quantity),
        unit_price: row.unit_price == null || row.unit_price === ("" as unknown) ? null : Number(row.unit_price),
        amount: row.amount == null || row.amount === ("" as unknown) ? null : Number(row.amount),
      };
    });
    const serialized = JSON.stringify(items);
    if (previous !== serialized) {
      changes.push({ fieldPath: "line_items", oldValue: previous, newValue: serialized });
      next.line_items = items;
    }
  }

  return { next, changes };
}
