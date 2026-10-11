"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/errors";

/** Last-resort error screen when the root layout itself fails. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error, "root"); }, [error]);
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#0B1020", color: "#E8ECF5" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
        <h2>AGRON Workspace is temporarily unavailable</h2>
        <p style={{ opacity: 0.75 }}>The error has been logged. Please try again in a moment.</p>
        <button onClick={() => reset()} style={{ padding: "10px 18px", borderRadius: 10, border: 0, background: "#5B6CF0", color: "#fff", fontSize: 15, cursor: "pointer" }}>Try again</button>
      </div>
    </body></html>
  );
}
