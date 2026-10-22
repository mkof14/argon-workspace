import { qrMatrix } from "../../src/lib/qr";
import { writeFileSync } from "fs";
const texts:string[] = ["AGR1:build:3f2a9c1e-0000-4000-8000-000000000001","LOC:STORE","AGR-WO-000123","SN-C20-0001","x","Ünïcode тест"];
for (let n = 1; n <= 213; n += 7) texts.push("Q".repeat(n));
writeFileSync(process.argv[2], JSON.stringify(texts.map(t => ({ t, m: qrMatrix(t).map(r => r.map(v => v ? 1 : 0)) }))));
