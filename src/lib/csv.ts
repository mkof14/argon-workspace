/** Minimal RFC-4180 CSV parser (quotes, commas, semicolons, new lines in quotes). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, ""); const delim = (s.split("\n")[0].match(/;/g)?.length || 0) > (s.split("\n")[0].match(/,/g)?.length || 0) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
