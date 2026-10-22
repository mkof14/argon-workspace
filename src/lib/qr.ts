// A small QR code encoder for the internal labels (byte mode, error correction M, versions 1–10), written here so
// labels need no third-party service or package. Follows ISO/IEC 18004: Reed–Solomon error correction, the eight
// masks with the standard penalty rules, format and version information. Pure; tested against a reference decoder.

const ECC_M = { // per version: [ec codewords per block, blocks in group 1, data codewords per block in group 1, blocks in group 2, data codewords per block in group 2]
  1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44],
} as Record<number, number[]>;
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

function gfTables() {
  const exp = new Array(512).fill(0), log = new Array(256).fill(0); let x = 1;
  for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}
const GF = gfTables();
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF.exp[GF.log[a] + GF.log[b]]);
function rsGenerator(degree: number) {
  let g = [1];
  for (let i = 0; i < degree; i++) { const n = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= mul(g[j], GF.exp[i]); } g = n; }
  return g;
}
function rsRemainder(data: number[], degree: number) {
  const gen = rsGenerator(degree); const res = new Array(degree).fill(0);
  for (const b of data) { const f = b ^ res.shift()!; res.push(0); for (let i = 0; i < degree; i++) res[i] ^= mul(gen[i + 1], f); }
  return res;
}

/** The QR matrix (true = dark) for a text, or throws when it does not fit version 10-M. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 0;
  for (let v = 1; v <= 10; v++) { const [, b1, d1, b2, d2] = ECC_M[v]; const cap = b1 * d1 + b2 * d2; const need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8; if (need <= cap * 8) { ver = v; break; } }
  if (!ver) throw new Error("Too long for a label code");
  const [ecLen, b1, d1, b2, d2] = ECC_M[ver]; const capBytes = b1 * d1 + b2 * d2;
  // data bits: mode 0100 (byte), count, bytes, terminator, padding
  const bits: number[] = []; const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capBytes * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const data: number[] = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let p = 0; data.length < capBytes; p++) data.push(p % 2 ? 0x11 : 0xec);
  // blocks, error correction, interleaving
  const blocks: number[][] = []; let k = 0;
  for (let i = 0; i < b1; i++) { blocks.push(data.slice(k, k + d1)); k += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(data.slice(k, k + d2)); k += d2; }
  const ecs = blocks.map((b) => rsRemainder(b, ecLen));
  const out: number[] = []; const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  const size = ver * 4 + 17;
  const m: (boolean | null)[][] = Array.from({ length: size }, () => new Array(size).fill(null));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r: number, c: number, v: boolean) => { m[r][c] = v; fn[r][c] = true; };
  const finder = (r: number, c: number) => { for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
    const on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)); set(rr, cc, on); } };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[ver];
  const last = al.length - 1;
  al.forEach((r, i) => al.forEach((c, j) => { if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1); }));
  // reserve format (and version) areas, the dark module
  for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
  set(size - 8, 8, true);
  if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(i, size - 11 + j, false); set(size - 11 + j, i, false); }
  // place the codewords (zigzag from the bottom right, two columns at a time, skipping the timing column)
  const cw: number[] = []; for (const b of out) for (let i = 7; i >= 0; i--) cw.push((b >>> i) & 1);
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const c = right - j; const up = ((right + 1) & 2) === 0; const r = up ? size - 1 - vert : vert;
      if (!fn[r][c]) { m[r][c] = idx < cw.length ? cw[idx] === 1 : false; idx++; }
    }
  }
  const MASKS = [(r: number, c: number) => (r + c) % 2 === 0, (r: number) => r % 2 === 0, (_: number, c: number) => c % 3 === 0, (r: number, c: number) => (r + c) % 3 === 0,
    (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
  const formatBits = (mask: number) => { const d = (0 << 3) | mask; // level M = 00
    let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return ((d << 10) | rem) ^ 0x5412; };
  const versionBits = (v: number) => { let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); return (v << 12) | rem; };
  const build = (mask: number) => {
    const g = m.map((row, r) => row.map((v, c) => (fn[r][c] ? !!v : (!!v) !== MASKS[mask](r, c))));
    const f = formatBits(mask); const bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) g[i][8] = bit(i);
    g[7][8] = bit(6); g[8][8] = bit(7); g[8][7] = bit(8);
    for (let i = 9; i < 15; i++) g[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) g[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) g[size - 15 + i][8] = bit(i);
    g[size - 8][8] = true;
    if (ver >= 7) { const vb = versionBits(ver); for (let i = 0; i < 18; i++) { const b = ((vb >>> i) & 1) === 1; const a = Math.floor(i / 3), bb = size - 11 + (i % 3); g[a][bb] = b; g[bb][a] = b; } }
    return g;
  };
  const penalty = (g: boolean[][]) => {
    let p = 0;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < size; i++) { let run = 1; for (let j = 1; j < size; j++) { const a = pass ? g[j][i] : g[i][j], b = pass ? g[j - 1][i] : g[i][j - 1]; if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) { const v = g[r][c]; if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) p += 3; }
    const pat = [true, false, true, true, true, false, true];
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < size; i++) for (let j = 0; j + 6 < size; j++) {
      let hit = true; for (let k2 = 0; k2 < 7; k2++) if ((pass ? g[j + k2][i] : g[i][j + k2]) !== pat[k2]) { hit = false; break; }
      if (!hit) continue;
      const clear = (from: number, to: number) => { for (let q = from; q < to; q++) { if (q < 0 || q >= size) continue; if (pass ? g[q][i] : g[i][q]) return false; } return true; };
      if (clear(j - 4, j) || clear(j + 7, j + 11)) p += 40;
    }
    let dark = 0; for (const row of g) for (const v of row) if (v) dark++;
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = build(0), bp = penalty(best);
  for (let mk = 1; mk < 8; mk++) { const g = build(mk); const p = penalty(g); if (p < bp) { best = g; bp = p; } }
  return best;
}

/** An SVG of the code with a quiet zone of four modules. */
export function qrSvg(text: string, px = 4): string {
  const g = qrMatrix(text); const n = g.length + 8; let d = "";
  g.forEach((row, r) => row.forEach((v, c) => { if (v) d += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
