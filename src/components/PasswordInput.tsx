"use client";
import { useState } from "react";
import Icon from "./Icon";

/** Password field with a show/hide button. */
export default function PasswordInput({ id, value, onChange, label, autoComplete = "current-password", showLabel, hideLabel }: { id: string; value: string; onChange: (v: string) => void; label: string; autoComplete?: string; showLabel: string; hideLabel: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} className="input" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={8} />
        <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? hideLabel : showLabel} title={show ? hideLabel : showLabel} aria-pressed={show}><Icon n={show ? "eyeoff" : "eye"} /></button>
      </div>
    </div>
  );
}
