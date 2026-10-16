"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/errors";

/** Shown when a page crashes. The error is logged for admins; the user can retry or go home. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error, error.digest ? `digest ${error.digest}` : "page"); }, [error]);
  return (
    <div className="login"><div className="box" style={{ textAlign: "center" }}>
      <div className="brand"><img src="/logo-full.webp" alt="AGRON™" width={1000} height={334} /></div>
      <h2 style={{ margin: 0 }}>Something went wrong on this page</h2>
      <p className="muted" style={{ margin: 0 }}>The error has been logged for the administrators. Try again, or go back to the start page.<br />Произошла ошибка. Мы её записали — попробуйте ещё раз.</p>
      <div className="toolbar" style={{ justifyContent: "center" }}>
        <button className="btn primary" onClick={() => reset()}>Try again</button>
        <a className="btn" href="/">Start page</a>
      </div>
    </div></div>
  );
}
