import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "AI-Powered Document Intelligence System",
  description: "Upload invoices, review extracted fields, and search processed documents.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="nav">
            <Link href="/" className="brand">
              <strong>AI-Powered Document Intelligence System</strong>
              <span>Invoice extraction and review</span>
            </Link>
            <div className="nav-links">
              <Link href="/">Upload</Link>
              <Link href="/search">Search</Link>
            </div>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
