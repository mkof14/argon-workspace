-- P9-S1 — one complete hosted security run at the database layer (staging only), in this order:
--   part "pre" fixtures → snapshot A → snapshot B (noise: A vs B) → part "hidden" fixtures (US-persons-only only)
--   → snapshot C (leak: B vs C for every unauthorised persona) → direct access by known id → verdict.
-- Usage: set p9s1.run = '<run id>'; then this file (after s1-hosted-security.sql and s1-personas.sql).
set p9s1.part = 'pre';
\ir s1-fixtures.sql
select p9s1.snapshot(current_setting('p9s1.run'), 'A');
select p9s1.snapshot(current_setting('p9s1.run'), 'B');
set p9s1.part = 'hidden';
\ir s1-fixtures.sql
select p9s1.snapshot(current_setting('p9s1.run'), 'C');
select p9s1.direct_check(current_setting('p9s1.run'));
\ir s1-report.sql
