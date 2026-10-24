# User guide (PDF in EN, RU, UK, AR)

The guide is generated from the app's own sources — the Learning Center handbook, section help, glossary, FAQ,
the section/role/approval configuration — plus the guide texts in `src/config/guide/{en,ru,uk,ar}.ts`.
The same model (`src/lib/guidemodel.ts`) renders the in-app page `/guide`, so the page is always current.

After every user-visible change (version bump in `src/lib/version.ts`):

1. Update the guide texts if the change needs more than the handbook/FAQ already say (all four languages).
2. Demo build on :3124 — `NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next build && npx next start -p 3124`
3. `node scripts/guide/make.mjs` — screenshots (sample data only), PDFs with page numbers into `/guide`, `guide/manifest.json`.

`tests/guide.test.ts` fails when the PDFs are older than the app version. Needs Playwright (global is fine) and poppler (`pdftotext`, `pdfinfo`).
The PDFs are served only to signed-in staff by `/api/guide`.
