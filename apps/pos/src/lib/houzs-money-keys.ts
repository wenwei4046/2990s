// ----------------------------------------------------------------------------
// Reading money off a Houzs row when the key may be spelled either way.
//
// Houzs migration 0305 (their PR #2438, 2026-08-18) renamed 291 money columns
// across 70 tables from `_centi` to `_sen`, and the API fields with them. The
// unit did NOT change — centi-MYR and sen are both hundredths of a ringgit, so
// this is a rename and never a conversion. Do not scale either side.
//
// Why this needs a helper instead of a find-and-replace:
//
//   · An absent key is `undefined`, not an error. Every read of the old
//     spelling silently became 0 — the My Orders board totalled RM 0, printed
//     SO documents showed RM 0 paid, fabric tracking read 0 across the board.
//     Nothing threw, so nothing surfaced.
//   · The POS talks to TWO backends. `VITE_BACKEND_TARGET` picks Houzs in
//     production, but 2990's own API is still the target in local dev and it
//     serves the ORIGINAL `_centi` spelling. A one-way rename fixes production
//     and breaks every developer's machine.
//
// So: prefer the canonical `_sen`, fall back to `_centi`, and treat a missing
// value as absent rather than as zero where the caller cares about the
// difference (`readMoneyOrNull`).
//
// This is the read half. The WRITE half is `soMoneyPayload` in
// pos-handover-so.ts, which sends both spellings for the same reason.
// See also `soProcessingDatePayload` — the same fix for the 0286 date rename,
// which is the incident this one repeats.
// ----------------------------------------------------------------------------

/** A row from either backend. Deliberately loose: these arrive as JSON, and the
 *  call sites pass a mix of declared interfaces (MineSoRow, ProductSupplierRow)
 *  and bare parsed objects. A declared interface does NOT satisfy
 *  `Record<string, unknown>` — it has no index signature — so the parameter is
 *  `object` and the lookup is narrowed below. */
type MoneyRow = object | null | undefined;

const numberOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** The one place the loose lookup happens. A key the row does not declare is
 *  exactly the case this module exists to handle. */
const at = (row: object, key: string): unknown =>
  (row as Record<string, unknown>)[key];

/** The value under `<base>_sen`, else `<base>_centi`, else null.
 *
 *  `base` is the column name WITHOUT the unit suffix: pass `'total_revenue'`
 *  to read `total_revenue_sen` / `total_revenue_centi`. */
export const readMoneyOrNull = (row: MoneyRow, base: string): number | null => {
  if (!row) return null;
  const sen = numberOrNull(at(row, `${base}_sen`));
  if (sen !== null) return sen;
  return numberOrNull(at(row, `${base}_centi`));
};

/** As readMoneyOrNull, but a missing value reads as 0 — for the many call
 *  sites that already collapsed null to 0 with `?? 0`. */
export const readMoney = (row: MoneyRow, base: string): number =>
  readMoneyOrNull(row, base) ?? 0;

/** Sen → whole ringgit, rounded. The POS displays whole MYR (db/schema.ts
 *  §Money); the Houzs ledger is sen. */
export const senToMyr = (sen: number | null | undefined): number =>
  Math.round((sen ?? 0) / 100);

/** Read a money column and convert to whole ringgit in one step — the shape
 *  most display call sites want. */
export const readMoneyMyr = (row: MoneyRow, base: string): number =>
  senToMyr(readMoney(row, base));

/** The paid total on an SO header. Three sources in preference order, mirroring
 *  what so-doc.ts already did: the payments-ledger rollup first, then the
 *  deprecated header column, then the deposit. Each is tried under BOTH
 *  spellings before falling through to the next.
 *
 *  Houzs renamed the rollup to `paid_sen_total` — note the suffix sits in the
 *  MIDDLE, so it does not match the `<base>_sen` shape the helpers above use
 *  and has to be spelled out. */
export const readPaidTotal = (row: MoneyRow): number => {
  if (!row) return 0;
  const rollup =
    numberOrNull(at(row, 'paid_sen_total')) ?? numberOrNull(at(row, 'paid_centi_total'));
  if (rollup !== null) return rollup;
  const paid = readMoneyOrNull(row, 'paid');
  if (paid !== null) return paid;
  return readMoney(row, 'deposit');
};
