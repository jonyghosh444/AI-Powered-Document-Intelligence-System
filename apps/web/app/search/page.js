"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../../lib/api";

export default function SearchPage() {
  const [filters, setFilters] = useState({ q: "", supplier: "", customer: "", invoice_number: "", status: "" });
  const [semantic, setSemantic] = useState("");
  const [keywordResults, setKeywordResults] = useState([]);
  const [semanticResults, setSemanticResults] = useState([]);
  const [message, setMessage] = useState("");

  function setField(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function runKeyword(event) {
    event.preventDefault();
    setMessage("");
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    try {
      const body = await api(`/search?${params.toString()}`);
      setKeywordResults(body.results || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function runSemantic(event) {
    event.preventDefault();
    setMessage("");
    try {
      const body = await api("/search/semantic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: semantic }),
      });
      setSemanticResults(body.results || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <main className="stack">
      <header>
        <h1>Search processed documents.</h1>
        <p className="lede">Keyword filters use the database. Semantic search ranks text chunks by meaning, using the local embedding model.</p>
      </header>
      <form className="card search-grid" onSubmit={runKeyword}>
        <label>Keywords<input value={filters.q} onChange={(event) => setField("q", event.target.value)} /></label>
        <label>Supplier<input value={filters.supplier} onChange={(event) => setField("supplier", event.target.value)} /></label>
        <label>Customer<input value={filters.customer} onChange={(event) => setField("customer", event.target.value)} /></label>
        <label>Invoice number<input value={filters.invoice_number} onChange={(event) => setField("invoice_number", event.target.value)} /></label>
        <button className="primary" type="submit">Filter</button>
      </form>
      <section className="card">
        <table>
          <thead><tr><th>File</th><th>Invoice</th><th>Supplier</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            {keywordResults.length === 0 ? <tr><td colSpan={6} className="muted">No keyword results yet.</td></tr> : null}
            {keywordResults.map((row) => (
              <tr key={row.id}>
                <td><Link className="filename" href={`/documents/${row.id}`}>{row.filename}</Link></td>
                <td>{row.invoice_number || "—"}</td>
                <td>{row.supplier_name || "—"}</td>
                <td>{row.customer_name || "—"}</td>
                <td>{row.total ?? "—"}</td>
                <td>{(row.status || "").replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <form className="card stack" onSubmit={runSemantic}>
        <label>Semantic query<input value={semantic} onChange={(event) => setSemantic(event.target.value)} placeholder="unpaid widgets from Acme" /></label>
        <div><button className="primary" type="submit">Search by meaning</button></div>
      </form>
      <section className="card stack">
        {semanticResults.length === 0 ? <p className="muted">No semantic results yet.</p> : null}
        {semanticResults.map((row, index) => (
          <article key={`${row.id}-${index}`}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Link className="filename" href={`/documents/${row.id}`}>{row.filename}</Link>
              <span className="score">{Number(row.score).toFixed(3)}</span>
            </div>
            <p className="mono">{row.text.slice(0, 280)}</p>
          </article>
        ))}
      </section>
      {message ? <p className="error-text">{message}</p> : null}
    </main>
  );
}
