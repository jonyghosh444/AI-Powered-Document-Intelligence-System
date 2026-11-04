"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";

const FIELDS = [
  ["invoice_number", "Invoice number"],
  ["invoice_date", "Invoice date"],
  ["supplier_name", "Supplier"],
  ["customer_name", "Customer"],
  ["subtotal", "Subtotal"],
  ["tax", "Tax"],
  ["total", "Total"],
  ["currency", "Currency"],
];

function Badge({ status }) {
  return <span className={`badge ${status || ""}`}>{(status || "").replaceAll("_", " ")}</span>;
}

function valueOf(extraction, field) {
  const raw = extraction?.[field];
  if (raw && typeof raw === "object" && "value" in raw) return raw.value ?? "";
  return "";
}

export default function DocumentPage() {
  const params = useParams();
  const [document, setDocument] = useState(null);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const body = await api(`/documents/${params.id}`);
    setDocument(body);
    setForm({
      invoice_number: valueOf(body.extraction, "invoice_number"),
      invoice_date: valueOf(body.extraction, "invoice_date"),
      supplier_name: valueOf(body.extraction, "supplier_name"),
      customer_name: valueOf(body.extraction, "customer_name"),
      subtotal: valueOf(body.extraction, "subtotal"),
      tax: valueOf(body.extraction, "tax"),
      total: valueOf(body.extraction, "total"),
      currency: valueOf(body.extraction, "currency"),
      line_items: (body.lineItems || []).map((item) => ({
        description: item.description || "",
        quantity: item.quantity ?? "",
        unit_price: item.unit_price ?? "",
        amount: item.amount ?? "",
      })),
    });
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, [params.id]);

  useEffect(() => {
    if (!document || !["queued", "processing"].includes(document.status)) return undefined;
    const timer = setInterval(() => {
      load().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [document?.status, params.id]);

  function updateLine(index, key, value) {
    setForm((current) => {
      const line_items = current.line_items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item);
      return { ...current, line_items };
    });
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const payload = {
      ...form,
      subtotal: form.subtotal === "" ? null : Number(form.subtotal),
      tax: form.tax === "" ? null : Number(form.tax),
      total: form.total === "" ? null : Number(form.total),
      line_items: form.line_items.map((item) => ({
        description: item.description || null,
        quantity: item.quantity === "" ? null : Number(item.quantity),
        unit_price: item.unit_price === "" ? null : Number(item.unit_price),
        amount: item.amount === "" ? null : Number(item.amount),
      })),
    };
    try {
      const updated = await api(`/documents/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDocument(updated);
      setMessage("Correction saved.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function retry() {
    const job = document.jobs?.[0];
    if (!job) return;
    setMessage("");
    try {
      await api(`/jobs/${job.id}/retry`, { method: "POST" });
      setMessage("Reprocessing queued.");
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (!document || !form) {
    return <main><p>{message || "Loading document…"}</p></main>;
  }

  return (
    <main className="stack">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>{document.filename}</h1>
          <p className="lede">{document.provider ? `Extracted with ${document.provider}. ` : ""}Corrections are stored separately from the original extraction.</p>
        </div>
        <Badge status={document.status} />
      </header>
      {document.error ? <div className="issue error">{document.error}</div> : null}
      {document.issues?.length ? (
        <section className="issues">
          {document.issues.map((issue) => (
            <div key={issue.id} className={`issue ${issue.severity}`}>{issue.message}</div>
          ))}
        </section>
      ) : null}
      <form className="card stack" onSubmit={save}>
        <div className="fields">
          {FIELDS.map(([key, label]) => (
            <label key={key}>
              {label}
              <input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
            </label>
          ))}
        </div>
        <div>
          <strong>Line items</strong>
          <table>
            <thead>
              <tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {form.line_items.length === 0 ? <tr><td colSpan={4} className="muted">No line items.</td></tr> : null}
              {form.line_items.map((item, index) => (
                <tr key={index}>
                  <td><input value={item.description} onChange={(event) => updateLine(index, "description", event.target.value)} /></td>
                  <td><input value={item.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} /></td>
                  <td><input value={item.unit_price} onChange={(event) => updateLine(index, "unit_price", event.target.value)} /></td>
                  <td><input value={item.amount} onChange={(event) => updateLine(index, "amount", event.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="secondary"
            type="button"
            onClick={() => setForm({ ...form, line_items: [...form.line_items, { description: "", quantity: "", unit_price: "", amount: "" }] })}
          >
            Add line
          </button>
        </div>
        <div className="row">
          <button className="primary" disabled={saving || !document.extraction} type="submit">{saving ? "Saving…" : "Save correction"}</button>
          <button className="secondary" type="button" onClick={retry}>Reprocess</button>
          {message ? <span>{message}</span> : null}
        </div>
      </form>
      <section className="card">
        <strong>Source text</strong>
        {(document.texts || []).map((text) => (
          <details key={text.index}>
            <summary>{text.label}</summary>
            <p className="mono">{text.text || "No text extracted."}</p>
          </details>
        ))}
        {document.texts?.length ? null : <p className="muted">Text appears here after processing.</p>}
      </section>
    </main>
  );
}
