// Shared layout for the public legal pages (no sign-in required).
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 22px 60px", fontFamily: "'IBM Plex Sans',Segoe UI,Helvetica,Arial,sans-serif", color: "#111820", lineHeight: 1.6, fontSize: 16 }}>
      <a href="https://www.agron1.com"><img src="/logo-full.webp" alt="AGRON" width={180} style={{ height: "auto", display: "block", marginBottom: 28 }} /></a>
      <h1 style={{ fontSize: 30, margin: "0 0 4px" }}>{title}</h1>
      <p style={{ color: "#6E7A87", margin: "0 0 28px" }}>AGRON Workspace · Last updated {updated}</p>
      {children}
      <hr style={{ border: 0, borderTop: "1px solid #D5DCE4", margin: "36px 0 14px" }} />
      <p style={{ color: "#6E7A87", fontSize: 14 }}>AGRON Inc. · <a href="mailto:info@agron1.com">info@agron1.com</a> · <a href="https://www.agron1.com">agron1.com</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
    </main>
  );
}
