# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

`run(input)` returns exactly what csv-reader 1.0.0 returns for
`{text, header}` -> `{columns, rows, errors}`, but faster.

## Files

- `solve.js` — dependency-free ES module exporting `run(input)`.
- `main.ts` — the program the harness runs: reads
  `MAKEFUN_INPUT_DIR/cases.json`, answers each case with `run()`, writes
  `MAKEFUN_OUTPUT_DIR/answers.json`.
- `package.json` — `{"type": "module"}` so Node loads the sources as ES
  modules directly (no reparse).

## How it is faster

The reference reads one character at a time and builds every field by
appending one character at a time. This entry, in one pass over the text:

- scans unquoted fields with `charCodeAt` and takes each field out with a
  single `slice` once its end is found;
- jumps straight to the next quote with `indexOf` for quoted fields;
- writes each field's result into shared variables instead of allocating
  a result object per field, which keeps garbage collection low;
- handles doubled quotes, CR/LF inside quotes, junk after a closing quote
  and stray CRs only on paths that run when such a thing actually appears.

No dependencies, no state kept between calls, deterministic: two runs on
the same set produce byte-identical output.

## Verification

See `csv-log-2026-11-22.md`: practice set 6/6 identical to the reference,
57 hand-written edge cases identical, ~2.0x faster than the house baseline
end to end on the practice set.
