// Photo → record helpers: which open purchase order a delivery note belongs to.

type R = { id: string; section: string; title: string; status: string | null; data: Record<string, any> };
const words = (s: any) => new Set(String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => w.length > 1 && !["inc", "llc", "ltd", "fze", "fzco", "co", "corp", "gmbh", "the"].includes(w)));
const overlap = (a: any, b: any) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };

/** Open purchase orders (approved or ordered) ranked by how well they match the delivery note. */
export function matchPO(note: { vendor?: any; item?: any; qty?: any }, all: R[]) {
  return all.filter((r) => r.section === "operations.procurement" && ["Approved", "Ordered"].includes(r.status || ""))
    .map((r) => {
      const v = overlap(note.vendor, r.data?.vendor), i = Math.max(overlap(note.item, r.data?.item), overlap(note.item, r.title));
      const score = v * 3 + i * 3 + (r.status === "Ordered" ? 1 : 0) + (Number(note.qty) && Number(note.qty) === Number(r.data?.qty) ? 0.5 : 0);
      return { r, score: Math.round(score * 100) / 100 };
    }).filter((x) => x.score >= 1.5).sort((a, b) => b.score - a.score).slice(0, 5);
}
