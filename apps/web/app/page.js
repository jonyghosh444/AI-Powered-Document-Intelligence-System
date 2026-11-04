"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

function Badge({ status }) {
  return <span className={`badge ${status || ""}`}>{(status || "unknown").replaceAll("_", " ")}</span>;
}

export default function HomePage() {
  const [files, setFiles] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const rows = await api("/documents");
    setDocuments(rows);
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(error.message));
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    if (!files.length) {
      setMessage("Choose at least one file.");
      return;
    }
    setBusy(true);
    setMessage("");
    const body = new FormData();
    for (const file of files) body.append("files", file);
    try {
      const result = await api("/documents", { method: "POST", body });
      setMessage(`Queued ${result.documents.length} file${result.documents.length === 1 ? "" : "s"}.`);
      setFiles([]);
      event.target.reset();
      await refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="stack">
      <header>
        <h1>Upload the day’s documents.</h1>
        <p className="lede">PDFs, scans, and spreadsheets are queued immediately. Open a row when processing finishes to check the invoice fields and any validation errors.</p>
      </header>
      <form className="card stack" onSubmit={onSubmit}>
        <div className="drop">
          <strong>PDF, JPG, PNG, TIFF, Excel, or CSV</strong>
          <span className="muted">Up to 20 files, 25 MB each.</span>
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.xlsx,.xls,.csv"
            onChange={(event) => setFiles(Array.from(event.target.files || []))}
          />
        </div>
        <div className="row">
          <button className="primary" disabled={busy} type="submit">{busy ? "Uploading…" : "Start processing"}</button>
          {message ? <span>{message}</span> : null}
        </div>
      </form>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Pages</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr><td colSpan={4} className="muted">No documents yet.</td></tr>
            ) : documents.map((document) => (
              <tr key={document.id}>
                <td><Link className="filename" href={`/documents/${document.id}`}>{document.filename}</Link></td>
                <td><Badge status={document.status} />{document.error ? <div className="error-text">{document.error}</div> : null}</td>
                <td>{document.pageCount ?? "—"}</td>
                <td>{new Date(document.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
