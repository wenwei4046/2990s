# Customer demographics (birthday + gender on the Customer Database) + Sales Analysis Customer Data tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace POS age-group capture with an exact **birthday**, add **gender**, store race+birthday+gender on the **`customers` table** (off the SO), and add a **Customer Data** tab to POS Sales Analysis (per-customer list with exact age + gender/race/age distributions + a precise-age filter).

**Architecture:** Demographics persist via the existing `upsert_customer_by_name_phone` RPC (keep-first coalesce) at order time; the SO no longer carries them. The shared `@2990s/shared` package holds all pure logic (validators, `ageFromBirthday`, and the analysis `summarizeCustomerDemographics`) so client + server share one source of truth. Age is always derived exactly from birthday — **no fixed age buckets anywhere**.

**Tech Stack:** Drizzle (Postgres source of truth) + hand-written SQL migrations (applied via Supabase MCP), Hono on CF Workers (API), Vite/React 19 POS (PWA), Vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-06-26-customer-demographics-birthday-gender-design.md`

## Global Constraints

- **Money** is integer **centi** in the ERP/analytics layer (`*_centi`); never floats.
- **Demographics never appear on any SO/DO/SI or customer-facing surface** — marketing-internal only.
- **No fixed age buckets** — age is computed exactly from birthday; the analysis age filter is a precise min/max.
- **Gender vocabulary:** `Male` / `Female` / `Others` (exact strings).
- **Race vocabulary (unchanged):** `Malay` / `Chinese` / `Indian` / `Others`.
- **Required-for-NEW is a POS capture-time gate**, not a server 400. The server stays lenient (format-validate + coalesce); it must never reject a sale over marketing data.
- **Migrations are append-only**, hand-written, applied to prod via Supabase MCP (owner-gated), **migrate-before-deploy**. Next free numbers: **0205**, **0206**.
- **Drizzle `packages/db/src/schema.ts` is the source of truth.** Keep it consistent with the migrations.
- **Brand voice** in any new copy: sentence case, calm, no hype, no emoji. Body ink `#221F20`.
- **POS is a PWA** — after deploy, a hard refresh is required (deploy is owner-gated; out of this plan's scope).
- Run gates from the worktree root: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`. The local build guard may need `ALLOW_LOCAL_API_URL=1`.

---

### Task 1: Shared — add gender + birthday helpers (TDD); keep age-frame for now

Add the new vocabulary/validators/derivations. The old `AGE_FRAMES`/`isValidAgeFrame`/`ageFrameLabel` stay until Task 10 (so consumers keep compiling); this task is purely additive.

**Files:**
- Modify: `packages/shared/src/customer-demographics.ts`
- Test: `packages/shared/src/customer-demographics.test.ts`

**Interfaces:**
- Produces: `GENDER_OPTIONS` (`readonly ['Male','Female','Others']`), `Gender` type, `isValidGender(v): v is Gender`, `ageFromBirthday(birthday: string|null|undefined, asOf?: string): number|null`, `isValidBirthday(v: unknown, asOf?: string): v is string`.

- [ ] **Step 1: Write the failing tests** — append to `packages/shared/src/customer-demographics.test.ts`. First extend the import at the top of the file to add the new symbols:

```ts
import {
  RACE_OPTIONS, AGE_FRAMES, isValidRace, isValidAgeFrame, ageFrameLabel,
  GENDER_OPTIONS, isValidGender, ageFromBirthday, isValidBirthday,
} from './customer-demographics';
```

Then append these suites:

```ts
describe('GENDER_OPTIONS / isValidGender', () => {
  it('exposes Male/Female/Others in order', () => {
    expect(GENDER_OPTIONS).toEqual(['Male', 'Female', 'Others']);
  });
  it('accepts known values, rejects everything else', () => {
    expect(isValidGender('Male')).toBe(true);
    expect(isValidGender('Female')).toBe(true);
    expect(isValidGender('Others')).toBe(true);
    expect(isValidGender('male')).toBe(false);
    expect(isValidGender('')).toBe(false);
    expect(isValidGender(null)).toBe(false);
  });
});

describe('ageFromBirthday', () => {
  const asOf = '2026-06-26';
  it('is one less before the birthday lands this year', () => {
    expect(ageFromBirthday('2000-12-31', asOf)).toBe(25);
  });
  it('ticks up on and after the birthday', () => {
    expect(ageFromBirthday('2000-06-26', asOf)).toBe(26);
    expect(ageFromBirthday('2000-01-01', asOf)).toBe(26);
  });
  it('handles leap-day births', () => {
    expect(ageFromBirthday('2004-02-29', '2026-02-28')).toBe(21);
    expect(ageFromBirthday('2004-02-29', '2026-03-01')).toBe(22);
  });
  it('returns null for malformed or impossible dates', () => {
    expect(ageFromBirthday('2021-02-29', asOf)).toBeNull(); // not a real date
    expect(ageFromBirthday('not-a-date', asOf)).toBeNull();
    expect(ageFromBirthday('', asOf)).toBeNull();
    expect(ageFromBirthday(null, asOf)).toBeNull();
  });
});

describe('isValidBirthday', () => {
  const asOf = '2026-06-26';
  it('accepts a plausible past date', () => {
    expect(isValidBirthday('1990-05-10', asOf)).toBe(true);
  });
  it('rejects future dates', () => {
    expect(isValidBirthday('2027-01-01', asOf)).toBe(false);
  });
  it('rejects implausible ages (>120) and bad formats', () => {
    expect(isValidBirthday('1900-01-01', asOf)).toBe(false);
    expect(isValidBirthday('1990/05/10', asOf)).toBe(false);
    expect(isValidBirthday('1990-13-01', asOf)).toBe(false);
    expect(isValidBirthday(null, asOf)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared test -- customer-demographics`
Expected: FAIL — `GENDER_OPTIONS`/`isValidGender`/`ageFromBirthday`/`isValidBirthday` are not exported.

- [ ] **Step 3: Implement the new exports** — append to `packages/shared/src/customer-demographics.ts` (after the existing `ageFrameLabel`):

```ts
export const GENDER_OPTIONS = ['Male', 'Female', 'Others'] as const;
export type Gender = (typeof GENDER_OPTIONS)[number];
const GENDER_SET = new Set<string>(GENDER_OPTIONS);

export function isValidGender(v: unknown): v is Gender {
  return typeof v === 'string' && GENDER_SET.has(v);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Device-local today as ISO YYYY-MM-DD (Malaysia UTC+8 on the tablets). The
 *  age derivations compare device-local on purpose, mirroring the handover
 *  no-past-dates rule. */
function todayIsoLocal(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** Exact integer age from an ISO birthday as of `asOf` (default today). Returns
 *  null for malformed or impossible calendar input. Calendar comparison (no
 *  rounding) — age ticks up only on/after the birthday. */
export function ageFromBirthday(birthday: string | null | undefined, asOf?: string): number | null {
  if (typeof birthday !== 'string' || !ISO_DATE_RE.test(birthday)) return null;
  const ref = asOf && ISO_DATE_RE.test(asOf) ? asOf : todayIsoLocal();
  const [by, bm, bd] = birthday.split('-').map(Number) as [number, number, number];
  const [ry, rm, rd] = ref.split('-').map(Number) as [number, number, number];
  // Reject impossible dates (e.g. 2021-02-29) — Date would silently roll over.
  const d = new Date(Date.UTC(by, bm - 1, bd));
  if (d.getUTCFullYear() !== by || d.getUTCMonth() !== bm - 1 || d.getUTCDate() !== bd) return null;
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age;
}

/** True when `v` is a valid ISO birthday: a real calendar date, not in the
 *  future, and a plausible human age (0..120) as of `asOf`. */
export function isValidBirthday(v: unknown, asOf?: string): v is string {
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) return false;
  const age = ageFromBirthday(v, asOf);
  return age !== null && age >= 0 && age <= 120;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared test -- customer-demographics`
Expected: PASS (new suites green; existing race/age-frame suites still green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/customer-demographics.ts packages/shared/src/customer-demographics.test.ts
git commit -m "feat(shared): gender options + birthday validators/age derivation (customer demographics)"
```

---

### Task 2: DB — customers demographics columns + migration 0205 (RPC extension)

Additive schema + the additive migration that adds the `customers` columns and re-creates the resolver RPC with demographics. The SO-column drop is Task 10.

**Files:**
- Modify: `packages/db/src/schema.ts` (customers table ~line 561-589)
- Create: `packages/db/migrations/0205_customer_demographics_to_customers.sql`

**Interfaces:**
- Produces: `customers.race` (text), `customers.birthday` (date), `customers.gender` (text); RPC `upsert_customer_by_name_phone(text, text, text, text DEFAULT NULL, date DEFAULT NULL, text DEFAULT NULL)` with keep-first coalesce.

- [ ] **Step 1: Add the columns to the Drizzle schema** — in `packages/db/src/schema.ts`, inside the `customers` pgTable, immediately after the `lastSeenAt:` line and before the `}, (t) => ({` index block, insert:

```ts
  // Marketing demographics (2026-06-26) — customer-level, captured at POS
  // handover (required for NEW; client-side gate), never on the SO/PDF. race =
  // RACE_OPTIONS value, gender = GENDER_OPTIONS value, birthday is an ISO date
  // (exact age derived at read time — no buckets). Filled keep-first by
  // upsert_customer_by_name_phone. Read by Sales Analysis (Customer Data tab).
  race:     text('race'),
  birthday: date('birthday'),
  gender:   text('gender'),
```

- [ ] **Step 2: Ensure `date` is imported** — confirm `date` is in the drizzle-orm/pg-core import at the top of `schema.ts`. Run:

```bash
grep -nE "from 'drizzle-orm/pg-core'" packages/db/src/schema.ts
grep -nE "^\s*date," packages/db/src/schema.ts | head -1
```

If `date` is not in the import list, add it (e.g. change `import { pgTable, text, uuid, timestamp, ... }` to include `date`).

- [ ] **Step 3: Verify the schema typechecks**

Run: `pnpm --filter @2990s/db typecheck` (or `pnpm typecheck`)
Expected: PASS (additive columns; nothing references them yet).

- [ ] **Step 4: Write the migration** — create `packages/db/migrations/0205_customer_demographics_to_customers.sql`:

```sql
-- 0205 — customer marketing demographics move onto the customers table.
-- race / birthday / gender become customer-level attributes (the Customer
-- Database), replacing Part A's SO-snapshot age-frame capture. Birthday gives an
-- EXACT age (no buckets). Captured at POS handover (required for NEW customers —
-- a client-side gate), never shown on the SO/PDF. customers is empty on prod
-- (0 rows verified 2026-06-03, mig 0146) so there is no backfill.
--
-- ADDITIVE here (columns + RPC). The matching drop of the now-dead SO snapshot
-- columns (customer_race / customer_age_frame, mig 0185) is a separate file
-- (0206) so add-before-use / drop-after-unused stays clean.
-- Apply BEFORE deploying the API/POS code (migrate-before-deploy). Re-run safe.

BEGIN;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS race     text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday date;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender   text;

-- Extend the find-or-create resolver to persist demographics. Adding params
-- changes the function signature, so DROP the 3-arg version and CREATE the
-- 6-arg one (new params DEFAULT NULL → existing 3-arg callers resolve here via
-- defaults). Keep-first coalesce: a returning customer keeps stored demographics;
-- only NULL fields get filled. Same identity key + SECURITY DEFINER as 0146.
DROP FUNCTION IF EXISTS public.upsert_customer_by_name_phone(text, text, text);

CREATE FUNCTION public.upsert_customer_by_name_phone(
  p_name     text,
  p_phone    text,
  p_email    text DEFAULT NULL,
  p_race     text DEFAULT NULL,
  p_birthday date DEFAULT NULL,
  p_gender   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_id    uuid;
  v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 chars, no 0/O/1/I/L
  v_code  text;
  i       int;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' OR p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'upsert_customer_by_name_phone: name and phone are both required';
  END IF;

  -- Existing customer → keep-first; bump last_seen; coalesce-fill demographics.
  SELECT id INTO v_id FROM customers
    WHERE lower(btrim(name)) = lower(btrim(p_name)) AND phone = p_phone
    LIMIT 1;
  IF FOUND THEN
    UPDATE customers SET
      last_seen_at = now(),
      race     = COALESCE(race,     p_race),
      birthday = COALESCE(birthday, p_birthday),
      gender   = COALESCE(gender,   p_gender)
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- New customer → insert with a unique code + demographics, retrying on a
  -- unique_violation (code collision OR concurrent same-(name,phone) insert).
  LOOP
    v_code := '2990S-';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO customers (name, phone, email, customer_code, race, birthday, gender)
      VALUES (btrim(p_name), p_phone, NULLIF(btrim(coalesce(p_email, '')), ''), v_code,
              p_race, p_birthday, p_gender)
      RETURNING id INTO v_id;
      RETURN v_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_id FROM customers
        WHERE lower(btrim(name)) = lower(btrim(p_name)) AND phone = p_phone
        LIMIT 1;
      IF FOUND THEN
        UPDATE customers SET
          last_seen_at = now(),
          race     = COALESCE(race,     p_race),
          birthday = COALESCE(birthday, p_birthday),
          gender   = COALESCE(gender,   p_gender)
        WHERE id = v_id;
        RETURN v_id;
      END IF;
      -- else a code collision → loop and regenerate.
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_customer_by_name_phone(text, text, text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_customer_by_name_phone(text, text, text, text, date, text) TO authenticated;

COMMIT;
```

- [ ] **Step 5: Commit** (the migration is applied to prod later, owner-gated, via Supabase MCP — not run locally)

```bash
git add packages/db/src/schema.ts packages/db/migrations/0205_customer_demographics_to_customers.sql
git commit -m "feat(db): customers race/birthday/gender + RPC persists demographics (mig 0205)"
```

---

### Task 3: API — persist demographics via the RPC on SO create; stop the SO-snapshot write

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (import ~line 20; RPC create call ~1875; POST insert ~3111-3114; PATCH RPC call ~4230)

**Interfaces:**
- Consumes: `isValidRace`, `isValidBirthday`, `isValidGender` from `@2990s/shared`; RPC `upsert_customer_by_name_phone` 6-arg signature (Task 2).
- Produces: SO create/patch now write `customers.race/birthday/gender` via the RPC; the SO no longer carries `customer_race`/`customer_age_frame` in its insert.

- [ ] **Step 1: Swap the shared imports** — in `apps/api/src/routes/mfg-sales-orders.ts`, change the demographics import line:

```ts
  isValidRace, isValidAgeFrame,
```
to:
```ts
  isValidRace, isValidBirthday, isValidGender,
```

- [ ] **Step 2: Pass demographics into the create-path RPC call** — replace the create call body (~line 1875):

```ts
    const { data: resolvedCustomerId, error: customerErr } = await sb.rpc('upsert_customer_by_name_phone', {
      p_name:  customerName,
      p_phone: normPhone,
      p_email: typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
    });
```
with:
```ts
    const { data: resolvedCustomerId, error: customerErr } = await sb.rpc('upsert_customer_by_name_phone', {
      p_name:  customerName,
      p_phone: normPhone,
      p_email: typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
      // Marketing demographics → customers table (keep-first coalesce in the RPC).
      // Lenient: invalid/missing → null; the POS gate already enforced required-for-NEW.
      p_race:     isValidRace(body.customerRace) ? (body.customerRace as string) : null,
      p_birthday: isValidBirthday(body.customerBirthday) ? (body.customerBirthday as string) : null,
      p_gender:   isValidGender(body.customerGender) ? (body.customerGender as string) : null,
    });
```

- [ ] **Step 3: Remove the SO-snapshot demographic writes** — delete these four lines from the POST insert object (~3111-3114):

```ts
    /* Marketing demographics (2026-06-25, mig 0185) — coerced to a known option
       or NULL; never shown on the SO/PDF. Read by Sales Analysis. */
    customer_race: isValidRace(body.customerRace) ? (body.customerRace as string) : null,
    customer_age_frame: isValidAgeFrame(body.customerAgeFrame) ? (body.customerAgeFrame as string) : null,
```

(Leave `target_date:` and `customer_id:` that follow.)

- [ ] **Step 4: Pass demographics into the PATCH re-resolve call** — replace the PATCH call (~line 4230):

```ts
      const { data: rid } = await sb.rpc('upsert_customer_by_name_phone', {
        p_name: nm, p_phone: ph,
        p_email: typeof body['email'] === 'string' && (body['email'] as string).trim() ? (body['email'] as string).trim() : null,
      });
```
with:
```ts
      const { data: rid } = await sb.rpc('upsert_customer_by_name_phone', {
        p_name: nm, p_phone: ph,
        p_email: typeof body['email'] === 'string' && (body['email'] as string).trim() ? (body['email'] as string).trim() : null,
        p_race:     isValidRace(body['customerRace']) ? (body['customerRace'] as string) : null,
        p_birthday: isValidBirthday(body['customerBirthday']) ? (body['customerBirthday'] as string) : null,
        p_gender:   isValidGender(body['customerGender']) ? (body['customerGender'] as string) : null,
      });
```

- [ ] **Step 5: Verify typecheck** (no HTTP harness for this route — typecheck + review per spec §10)

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS. (`isValidAgeFrame` is no longer imported/used here; `customer_race`/`customer_age_frame` are still valid schema columns until Task 10, so the dropped insert keys don't break typing.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): SO create/patch persist race/birthday/gender to customers via RPC (not SO)"
```

---

### Task 4: API — customer-search returns demographics from the customers table

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` (GET /customer-search ~lines 1219-1293)

**Interfaces:**
- Produces: each `customer-search` hit carries `customerId`, `race`, `birthday`, `gender` (sourced from `customers`), replacing the old `ageFrame`.

- [ ] **Step 1: Add `customer_id` to the SO select, drop the SO demographic columns** — change the select (~line 1219):

```ts
    .select('doc_no, debtor_name, phone, email, customer_type, address1, address2, city, postcode, customer_state, building_type, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, customer_race, customer_age_frame, created_at')
```
to:
```ts
    .select('doc_no, debtor_name, phone, email, customer_type, address1, address2, city, postcode, customer_state, building_type, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, customer_id, created_at')
```

- [ ] **Step 2: Update the `Row` type** — change (~line 1235):

```ts
    customer_race: string | null; customer_age_frame: string | null;
```
to:
```ts
    customer_id: string | null;
```

- [ ] **Step 3: Update `FILL_FIELDS`** — change (~line 1250):

```ts
    ['race', 'customer_race'], ['ageFrame', 'customer_age_frame'],
```
to:
```ts
    ['customerId', 'customer_id'],
```

- [ ] **Step 4: Update the seed object** — change (~line 1290-1291):

```ts
      race:          r.customer_race,
      ageFrame:      r.customer_age_frame,
```
to:
```ts
      customerId:    r.customer_id,
      race:          null,    // attached below from the customers table
      birthday:      null,
      gender:        null,
```

- [ ] **Step 5: Attach demographics from `customers` before returning** — replace the final return line:

```ts
  return c.json({ customers: [...byKey.values()].slice(0, 8) });
```
with:
```ts
  // Demographics live on the customers table (not the SO snapshot). Attach
  // race/birthday/gender by the SO's customer_id (newest order per identity
  // seeded the entry + its customer_id; FILL_FIELDS coalesced older ones).
  const hits = [...byKey.values()];
  const customerIds = [...new Set(
    hits.map((h) => h.customerId as string | null).filter((x): x is string => !!x),
  )];
  if (customerIds.length) {
    const { data: custRows } = await sb
      .from('customers')
      .select('id, race, birthday, gender')
      .in('id', customerIds);
    const byId = new Map<string, { race: string | null; birthday: string | null; gender: string | null }>();
    for (const cr of (custRows ?? []) as Array<{ id: string; race: string | null; birthday: string | null; gender: string | null }>) {
      byId.set(cr.id, { race: cr.race, birthday: cr.birthday, gender: cr.gender });
    }
    for (const h of hits) {
      const d = h.customerId ? byId.get(h.customerId as string) : undefined;
      h.race = d?.race ?? null;
      h.birthday = d?.birthday ?? null;
      h.gender = d?.gender ?? null;
    }
  }
  return c.json({ customers: hits.slice(0, 8) });
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): customer-search reads race/birthday/gender from the customers table"
```

---

### Task 5: POS — handover form fields + validators (TDD)

**Files:**
- Modify: `apps/pos/src/lib/handover-helpers.ts` (HandoverForm ~line 87; validateCustomer ~146-152; customerBlockers ~250-258)
- Test: `apps/pos/src/lib/handover-helpers.test.ts`

**Interfaces:**
- Produces: `HandoverForm` carries `race`, `birthday`, `gender` (no `ageFrame`); a NEW customer requires all three.

- [ ] **Step 1: Update the test fixture + cases** — in `apps/pos/src/lib/handover-helpers.test.ts`:

Change the `baseForm` demographics line (line 27):
```ts
  race: '', ageFrame: '',
```
to:
```ts
  race: '', birthday: '', gender: '',
```

Replace the whole `describe('validateCustomer — race/age required for NEW customers', ...)` block (lines 51-66) with:
```ts
describe('validateCustomer — race/birthday/gender required for NEW customers', () => {
  // A complete, valid contact; only customerType + demographics vary per case.
  const okContact = { ...baseForm, name: 'Loo', phone: '0123456789', email: 'a@b.com' };
  it('NEW customer missing all demographics is invalid', () => {
    expect(validateCustomer({ ...okContact, customerType: 'NEW', race: '', birthday: '', gender: '' })).toBe(false);
  });
  it('NEW customer with race + birthday + gender is valid', () => {
    expect(validateCustomer({ ...okContact, customerType: 'NEW', race: 'Malay', birthday: '2000-01-15', gender: 'Male' })).toBe(true);
  });
  it('NEW customer missing only birthday is invalid', () => {
    expect(validateCustomer({ ...okContact, customerType: 'NEW', race: 'Indian', birthday: '', gender: 'Female' })).toBe(false);
  });
  it('NEW customer missing only gender is invalid', () => {
    expect(validateCustomer({ ...okContact, customerType: 'NEW', race: 'Indian', birthday: '2000-01-15', gender: '' })).toBe(false);
  });
  it('EXISTING customer missing demographics is still valid (not blocked)', () => {
    expect(validateCustomer({ ...okContact, customerType: 'EXISTING', race: '', birthday: '', gender: '' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/pos test -- handover-helpers`
Expected: FAIL — `HandoverForm` has no `birthday`/`gender`; `ageFrame` removed.

- [ ] **Step 3: Update the `HandoverForm` interface** — in `apps/pos/src/lib/handover-helpers.ts`, replace the demographics comment + field (lines ~84-87):

```ts
  /** Marketing demographics (2026-06-25). Captured at handover, stored on the
   *  SO snapshot, never shown on the SO/PDF. REQUIRED when customerType==='NEW'
   *  (a brand-new customer); optional + prefilled for an existing pick. */
  race: string; ageFrame: string;
```
with:
```ts
  /** Marketing demographics (2026-06-26). Captured at handover, persisted to the
   *  customers table (not the SO/PDF). REQUIRED when customerType==='NEW';
   *  optional + prefilled for an existing pick. birthday is ISO YYYY-MM-DD;
   *  gender is a GENDER_OPTIONS value; exact age is derived from birthday. */
  race: string; birthday: string; gender: string;
```

- [ ] **Step 4: Update `validateCustomer`** — replace the demographics clause (line ~152):

```ts
  && (f.customerType !== 'NEW' || (f.race.trim().length > 0 && f.ageFrame.trim().length > 0));
```
with:
```ts
  && (f.customerType !== 'NEW'
      || (f.race.trim().length > 0 && f.birthday.trim().length > 0 && f.gender.trim().length > 0));
```

- [ ] **Step 5: Update `customerBlockers`** — replace the two demographics blockers (lines ~256-257):

```ts
  if (f.customerType === 'NEW' && !f.race.trim()) b.push('Race required for a new customer');
  if (f.customerType === 'NEW' && !f.ageFrame.trim()) b.push('Age group required for a new customer');
```
with:
```ts
  if (f.customerType === 'NEW' && !f.race.trim()) b.push('Race required for a new customer');
  if (f.customerType === 'NEW' && !f.birthday.trim()) b.push('Birthday required for a new customer');
  if (f.customerType === 'NEW' && !f.gender.trim()) b.push('Gender required for a new customer');
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/pos test -- handover-helpers`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/lib/handover-helpers.ts apps/pos/src/lib/handover-helpers.test.ts
git commit -m "feat(pos): handover form captures birthday + gender (NEW requires race+birthday+gender)"
```

---

### Task 6: POS — CustomerStep UI + payload + search-hit type

Wire the birthday date input (with exact-age caption), gender select, prefill, payload, and the search-hit shape.

**Files:**
- Modify: `apps/pos/src/components/handover/CustomerStep.tsx`
- Modify: `apps/pos/src/lib/customer-search.ts` (CustomerSearchHit ~42-43)
- Modify: `apps/pos/src/pages/Handover.tsx` (form init line 66; payload lines 359-360)
- Modify: `apps/pos/src/lib/pos-handover-so.ts` (PosHandoffPayload ~72-76)

**Interfaces:**
- Consumes: `RACE_OPTIONS`, `GENDER_OPTIONS`, `ageFromBirthday` from `@2990s/shared`; `todayLocalIso` from `handover-helpers`; `birthday`/`gender` from `HandoverForm` (Task 5) and `CustomerSearchHit`.

- [ ] **Step 1: Update `CustomerSearchHit`** — in `apps/pos/src/lib/customer-search.ts`, replace (lines ~40-43):

```ts
  /* Marketing demographics carried from the newest SO snapshot (per-field
     coalesce, server-side). Prefilled into the Customer step on an existing pick. */
  race: string | null;
  ageFrame: string | null;
```
with:
```ts
  /* Marketing demographics from the customers table (by the newest order's
     customer_id, server-side). Prefilled into the Customer step on a pick. */
  customerId: string | null;
  race: string | null;
  birthday: string | null;
  gender: string | null;
```

- [ ] **Step 2: Update `PosHandoffPayload`** — in `apps/pos/src/lib/pos-handover-so.ts`, replace (lines ~72-76):

```ts
  /* Marketing demographics (camelCase; API maps to customer_race /
     customer_age_frame on the SO snapshot). Optional on the wire — the POS form
     enforces required-for-new before submit; never shown on the SO/PDF. */
  customerRace?: string;
  customerAgeFrame?: string;
```
with:
```ts
  /* Marketing demographics (camelCase). The API persists these to the customers
     table — race / birthday / gender — via upsert_customer_by_name_phone, NOT on
     the SO. Optional on the wire — the POS form enforces required-for-new before
     submit; never shown on the SO/PDF. */
  customerRace?: string;
  customerBirthday?: string; // ISO YYYY-MM-DD
  customerGender?: string;
```

- [ ] **Step 3: Update the Handover empty form + payload** — in `apps/pos/src/pages/Handover.tsx`:

Change line 66:
```ts
  race: '', ageFrame: '',
```
to:
```ts
  race: '', birthday: '', gender: '',
```

Change the payload demographics (lines 359-360):
```ts
        ...(form.race.trim() ? { customerRace: form.race.trim() } : {}),
        ...(form.ageFrame.trim() ? { customerAgeFrame: form.ageFrame.trim() } : {}),
```
to:
```ts
        ...(form.race.trim() ? { customerRace: form.race.trim() } : {}),
        ...(form.birthday.trim() ? { customerBirthday: form.birthday } : {}),
        ...(form.gender.trim() ? { customerGender: form.gender.trim() } : {}),
```

- [ ] **Step 4: Update CustomerStep imports** — in `apps/pos/src/components/handover/CustomerStep.tsx`:

Change `import { useEffect } from 'react';` to:
```ts
import { useEffect, useMemo } from 'react';
```

Change `import type { HandoverForm } from '../../lib/handover-helpers';` to:
```ts
import { todayLocalIso, type HandoverForm } from '../../lib/handover-helpers';
```

Change `import { RACE_OPTIONS, AGE_FRAMES } from '@2990s/shared';` to:
```ts
import { RACE_OPTIONS, GENDER_OPTIONS, ageFromBirthday } from '@2990s/shared';
```

- [ ] **Step 5: Update the prefill** — in `pickCustomer`, replace the demographics prefill (lines ~57-58):

```ts
    if (h.race) update('race', h.race);
    if (h.ageFrame) update('ageFrame', h.ageFrame);
```
with:
```ts
    if (h.race) update('race', h.race);
    if (h.birthday) update('birthday', h.birthday);
    if (h.gender) update('gender', h.gender);
```

- [ ] **Step 6: Add the computed age + replace the demographics fields** — inside the component body, after the `derivedType`/`useEffect` block and before `return (`, add:

```ts
  const age = useMemo(() => ageFromBirthday(form.birthday), [form.birthday]);
```

Then replace the whole Race + Age-group `fieldRow` + caption block (the `<div className="fieldRow">` containing Race and Age group, through the `{!matched && (...)}` caption — lines ~148-170) with:

```tsx
      <div className="fieldRow">
        <Field label={`Race${matched ? '' : ' *'}`}>
          <select value={form.race} onChange={(e) => update('race', e.target.value)}>
            <option value="">{matched ? '— optional —' : '— select —'}</option>
            {RACE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label={`Gender${matched ? '' : ' *'}`}>
          <select value={form.gender} onChange={(e) => update('gender', e.target.value)}>
            <option value="">{matched ? '— optional —' : '— select —'}</option>
            {GENDER_OPTIONS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="fieldRow">
        <Field label={`Birthday${matched ? '' : ' *'}`}>
          <input
            type="date"
            value={form.birthday}
            min="1924-01-01"
            max={todayLocalIso()}
            onChange={(e) => update('birthday', e.target.value)}
          />
          {age !== null && (
            <p className={styles.signCaption} style={{ marginTop: 4 }}>Age {age}</p>
          )}
        </Field>
      </div>
      {!matched && (
        <p className={styles.signCaption}>
          Race, birthday and gender are recorded for marketing only — not shown on the order.
        </p>
      )}
```

- [ ] **Step 7: Verify typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS (`ageFrame`/`AGE_FRAMES` no longer referenced in POS app code).

- [ ] **Step 8: Commit**

```bash
git add apps/pos/src/components/handover/CustomerStep.tsx apps/pos/src/lib/customer-search.ts apps/pos/src/pages/Handover.tsx apps/pos/src/lib/pos-handover-so.ts
git commit -m "feat(pos): CustomerStep birthday date + age + gender; payload + search-hit shape"
```

---

### Task 7: Shared — Sales Analysis customer demographics core (TDD)

**Files:**
- Modify: `packages/shared/src/sales-analysis.ts`
- Test: `packages/shared/src/sales-analysis.test.ts`

**Interfaces:**
- Consumes: `ageFromBirthday` (Task 1).
- Produces: `SaCustomerRow`, `DistributionBucket`, `CustomerDemographicsSummary`, `AgeFilter`, `summarizeCustomerDemographics(rows, filter?)`.

- [ ] **Step 1: Write the failing tests** — append to `packages/shared/src/sales-analysis.test.ts`. Extend the import:

```ts
import {
  collapseToPurchases, summarizeOverview, monthlyTrend, type SaOrderRow,
  summarizeCustomerDemographics, type SaCustomerRow,
} from './sales-analysis';
```

Then append:

```ts
const cust = (over: Partial<SaCustomerRow> = {}): SaCustomerRow => ({
  id: 'c1', name: 'Cust', race: null, birthday: null, gender: null, state: null,
  orderCount: 1, ltvCenti: 0, firstOrderDate: '2026-01-01', lastOrderDate: '2026-01-01',
  isReturning: false, ...over,
});

describe('summarizeCustomerDemographics', () => {
  const asOf = '2026-06-26';

  it('buckets gender/race with Unknown for nulls and sorts by count desc', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', gender: 'Male', race: 'Chinese' }),
      cust({ id: 'b', gender: 'Male', race: 'Malay' }),
      cust({ id: 'c', gender: 'Female', race: null }),
      cust({ id: 'd', gender: null, race: 'Malay' }),
    ], { asOf });
    expect(s.total).toBe(4);
    expect(s.gender).toEqual([
      { key: 'Male', count: 2 }, { key: 'Female', count: 1 }, { key: 'Unknown', count: 1 },
    ]);
    expect(s.race.find((b) => b.key === 'Unknown')?.count).toBe(1);
  });

  it('age filter is inclusive on both ends; null-birthday excluded when bounds set', () => {
    const rows = [
      cust({ id: 'a', birthday: '2000-06-26' }), // age 26
      cust({ id: 'b', birthday: '1996-06-26' }), // age 30
      cust({ id: 'c', birthday: '1990-06-26' }), // age 36
      cust({ id: 'd', birthday: null }),         // no age
    ];
    const s = summarizeCustomerDemographics(rows, { ageMin: 26, ageMax: 30, asOf });
    expect(s.total).toBe(2);
    expect(s.perCustomer.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps null-birthday rows when no bounds are set, but never in the histogram', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', birthday: '2000-06-26' }),
      cust({ id: 'b', birthday: null }),
    ], { asOf });
    expect(s.total).toBe(2);
    expect(s.withBirthday).toBe(1);
    expect(s.ageHistogram).toEqual([{ age: 26, count: 1 }]);
  });

  it('counts new vs returning', () => {
    const s = summarizeCustomerDemographics([
      cust({ id: 'a', isReturning: true }),
      cust({ id: 'b', isReturning: false }),
      cust({ id: 'c', isReturning: false }),
    ], { asOf });
    expect(s.newVsReturning).toEqual({ newCount: 2, returningCount: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared test -- sales-analysis`
Expected: FAIL — `summarizeCustomerDemographics`/`SaCustomerRow` not exported.

- [ ] **Step 3: Implement the core** — in `packages/shared/src/sales-analysis.ts`, add the import at the top:

```ts
import { ageFromBirthday } from './customer-demographics';
```

Then append at the end of the file:

```ts
export interface SaCustomerRow {
  id: string;
  name: string;
  race: string | null;
  birthday: string | null;
  gender: string | null;
  state: string | null;
  orderCount: number;     // collapsed physical purchases in scope
  ltvCenti: number;       // sum of total_revenue_centi over scoped orders
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  isReturning: boolean;   // >1 physical purchase in scope
}

export interface DistributionBucket { key: string; count: number }

export interface CustomerDemographicsSummary {
  total: number;          // customers after the age filter
  withBirthday: number;   // of those, how many have a usable birthday
  perCustomer: Array<SaCustomerRow & { age: number | null }>;
  gender: DistributionBucket[];   // includes 'Unknown'
  race: DistributionBucket[];     // includes 'Unknown'
  byState: DistributionBucket[];  // includes 'Unknown'
  ageHistogram: Array<{ age: number; count: number }>; // per exact year, ascending
  newVsReturning: { newCount: number; returningCount: number };
}

export interface AgeFilter { ageMin?: number | null; ageMax?: number | null; asOf?: string }

/** Pure demographics aggregation for the Customer Data tab. Age is computed
 *  EXACTLY from birthday (no buckets). The age filter is inclusive on both
 *  bounds; when any bound is set, rows without a usable age are excluded.
 *  Null/blank race/gender/state count as 'Unknown'. */
export function summarizeCustomerDemographics(
  rows: ReadonlyArray<SaCustomerRow>,
  filter: AgeFilter = {},
): CustomerDemographicsSummary {
  const { ageMin, ageMax, asOf } = filter;
  const lo = ageMin ?? Number.NEGATIVE_INFINITY;
  const hi = ageMax ?? Number.POSITIVE_INFINITY;
  const bounded = ageMin != null || ageMax != null;

  const perCustomer = rows
    .map((r) => ({ ...r, age: ageFromBirthday(r.birthday, asOf) }))
    .filter((r) => (bounded ? r.age !== null && r.age >= lo && r.age <= hi : true));

  const bump = (m: Map<string, number>, k: string | null): void => {
    const key = k && k.trim() ? k : 'Unknown';
    m.set(key, (m.get(key) ?? 0) + 1);
  };
  const gender = new Map<string, number>();
  const race = new Map<string, number>();
  const state = new Map<string, number>();
  const ageCounts = new Map<number, number>();
  let withBirthday = 0; let newCount = 0; let returningCount = 0;

  for (const r of perCustomer) {
    bump(gender, r.gender);
    bump(race, r.race);
    bump(state, r.state);
    if (r.age !== null) { withBirthday += 1; ageCounts.set(r.age, (ageCounts.get(r.age) ?? 0) + 1); }
    if (r.isReturning) returningCount += 1; else newCount += 1;
  }

  const toBuckets = (m: Map<string, number>): DistributionBucket[] =>
    [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    total: perCustomer.length,
    withBirthday,
    perCustomer,
    gender: toBuckets(gender),
    race: toBuckets(race),
    byState: toBuckets(state),
    ageHistogram: [...ageCounts.entries()]
      .map(([age, count]) => ({ age, count }))
      .sort((a, b) => a.age - b.age),
    newVsReturning: { newCount, returningCount },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared test -- sales-analysis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sales-analysis.ts packages/shared/src/sales-analysis.test.ts
git commit -m "feat(shared): summarizeCustomerDemographics — exact-age filter + distributions"
```

---

### Task 8: API — add the `customers` section to GET /sales-analysis

**Files:**
- Modify: `apps/api/src/routes/sales-analysis.ts`

**Interfaces:**
- Consumes: `collapseToPurchases`, `SaCustomerRow` (Task 7); `customers.race/birthday/gender/state/name` (Task 2).
- Produces: response gains `customers: SaCustomerRow[]` (per-customer rows over the scoped orders).

- [ ] **Step 1: Extend the shared imports** — change (line 10):

```ts
import { summarizeOverview, monthlyTrend, type SaOrderRow } from '@2990s/shared';
```
to:
```ts
import { summarizeOverview, monthlyTrend, collapseToPurchases, type SaOrderRow, type SaCustomerRow } from '@2990s/shared';
```

- [ ] **Step 2: Add `customer_id` to the orders select + Raw type** — change the select (line 35):

```ts
    .select('doc_no, cross_category_source_doc_no, so_date, total_revenue_centi, total_margin_centi, service_centi, is_test')
```
to:
```ts
    .select('doc_no, cross_category_source_doc_no, so_date, total_revenue_centi, total_margin_centi, service_centi, is_test, customer_id')
```

Change the `Raw` type (lines 41-44) to add `customer_id`:
```ts
  type Raw = {
    doc_no: string; cross_category_source_doc_no: string | null; so_date: string;
    total_revenue_centi: number | null; total_margin_centi: number | null; service_centi: number | null;
    customer_id: string | null;
  };
```

- [ ] **Step 3: Build the customers section + return it** — replace the final two lines:

```ts
  const overview = summarizeOverview(scoped, deliveryByDoc);
  return c.json({ period, includeTest, overview, monthly });
```
with:
```ts
  const overview = summarizeOverview(scoped, deliveryByDoc);

  // Customer Data section — demographics from the customers table for the
  // customers behind the SCOPED orders. Demographics live on customers (not the
  // SO); ages + distributions are computed client-side so the precise-age filter
  // stays flexible. Per-customer order stats are over the scoped window.
  const custIdByDoc = new Map<string, string | null>();
  for (const r of ((orderRows ?? []) as Raw[])) custIdByDoc.set(r.doc_no, r.customer_id ?? null);
  const ordersByCustomer = new Map<string, SaOrderRow[]>();
  for (const r of scoped) {
    const cid = custIdByDoc.get(r.docNo);
    if (!cid) continue;
    const arr = ordersByCustomer.get(cid);
    if (arr) arr.push(r); else ordersByCustomer.set(cid, [r]);
  }
  let customers: SaCustomerRow[] = [];
  const custIds = [...ordersByCustomer.keys()];
  if (custIds.length) {
    const { data: custRows, error: custErr } = await sb
      .from('customers')
      .select('id, name, state, race, birthday, gender')
      .in('id', custIds);
    if (custErr) return c.json({ error: 'load_failed', reason: custErr.message }, 500);
    type CustRow = { id: string; name: string | null; state: string | null; race: string | null; birthday: string | null; gender: string | null };
    const profile = new Map<string, CustRow>();
    for (const cr of (custRows ?? []) as CustRow[]) profile.set(cr.id, cr);
    customers = custIds.map((cid) => {
      const ords = ordersByCustomer.get(cid)!;
      const purchases = collapseToPurchases(ords).length;
      const dates = ords.map((o) => o.soDate).sort();
      const p = profile.get(cid);
      return {
        id: cid,
        name: p?.name ?? '',
        race: p?.race ?? null,
        birthday: p?.birthday ?? null,
        gender: p?.gender ?? null,
        state: p?.state ?? null,
        orderCount: purchases,
        ltvCenti: ords.reduce((s, o) => s + o.totalRevenueCenti, 0),
        firstOrderDate: dates[0] ?? null,
        lastOrderDate: dates[dates.length - 1] ?? null,
        isReturning: purchases > 1,
      };
    });
  }

  return c.json({ period, includeTest, overview, monthly, customers });
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sales-analysis.ts
git commit -m "feat(api): GET /sales-analysis returns per-customer demographics section"
```

---

### Task 9: POS — Sales Analysis tab bar + Customer Data view

**Files:**
- Create: `apps/pos/src/components/sales-analysis/CustomerDataTab.tsx`
- Modify: `apps/pos/src/lib/sales-analysis-queries.ts`
- Modify: `apps/pos/src/pages/SalesAnalysis.tsx`
- Modify: `apps/pos/src/pages/SalesAnalysis.module.css`

**Interfaces:**
- Consumes: `summarizeCustomerDemographics`, `SaCustomerRow`, `fmtQty`, `fmtCenti` from `@2990s/shared`; `SalesAnalysisResponse.customers`.

- [ ] **Step 1: Extend the response type** — in `apps/pos/src/lib/sales-analysis-queries.ts`, change the import (line 2):

```ts
import type { OverviewResult, MonthlyRow } from '@2990s/shared';
```
to:
```ts
import type { OverviewResult, MonthlyRow, SaCustomerRow } from '@2990s/shared';
```

and add `customers` to the response interface:
```ts
export interface SalesAnalysisResponse {
  period: string;
  includeTest: boolean;
  overview: OverviewResult;
  monthly: MonthlyRow[];
  customers: SaCustomerRow[];
}
```

- [ ] **Step 2: Create the Customer Data tab component** — `apps/pos/src/components/sales-analysis/CustomerDataTab.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { fmtQty, summarizeCustomerDemographics, type SaCustomerRow } from '@2990s/shared';
import styles from '../../pages/SalesAnalysis.module.css';

const MIN_SAMPLE = 10;
const TOP_N = 50;

const parseAge = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export const CustomerDataTab = ({ customers }: { customers: SaCustomerRow[] }) => {
  const [ageMinStr, setAgeMinStr] = useState('');
  const [ageMaxStr, setAgeMaxStr] = useState('');
  const ageMin = parseAge(ageMinStr);
  const ageMax = parseAge(ageMaxStr);

  const summary = useMemo(
    () => summarizeCustomerDemographics(customers, { ageMin, ageMax }),
    [customers, ageMin, ageMax],
  );
  const thin = summary.total < MIN_SAMPLE;
  const maxAgeCount = Math.max(1, ...summary.ageHistogram.map((h) => h.count));
  const ranked = useMemo(
    () => [...summary.perCustomer].sort((a, b) => (b.lastOrderDate ?? '').localeCompare(a.lastOrderDate ?? '')),
    [summary.perCustomer],
  );

  const pctOf = (count: number) => (summary.total > 0 ? Math.round((count / summary.total) * 100) : 0);
  const distRow = (label: string, count: number) => (
    <div key={label} className={styles.trendRow}>
      <span className={styles.cardSub}>{label}</span>
      <span className={styles.barTrack}>
        <span className={styles.bar} style={{ width: `${pctOf(count)}%` }} />
      </span>
      <span className={styles.cardSub}>{fmtQty(count)} ({pctOf(count)}%)</span>
    </div>
  );

  return (
    <>
      <div className={styles.controls}>
        <label className={styles.toggle}>Min age
          <input className={styles.ageInput} type="number" min={0} max={120} value={ageMinStr}
            onChange={(e) => setAgeMinStr(e.target.value)} />
        </label>
        <label className={styles.toggle}>Max age
          <input className={styles.ageInput} type="number" min={0} max={120} value={ageMaxStr}
            onChange={(e) => setAgeMaxStr(e.target.value)} />
        </label>
        <span className={styles.cardSub}>
          {fmtQty(summary.total)} customers{(ageMin != null || ageMax != null) ? ' in range' : ''}
        </span>
      </div>

      {thin && (
        <p className={styles.note}>
          Only {summary.total} customer{summary.total === 1 ? '' : 's'} in this view — figures are directional.
        </p>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Gender</h2>
        {summary.gender.map((b) => distRow(b.key, b.count))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Race</h2>
        {summary.race.map((b) => distRow(b.key, b.count))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Age (per year)</h2>
        {summary.ageHistogram.length === 0 && <p className={styles.muted}>No birthdays on record in range.</p>}
        {summary.ageHistogram.map((h) => (
          <div key={h.age} className={styles.trendRow}>
            <span className={styles.cardSub}>{h.age}</span>
            <span className={styles.barTrack}>
              <span className={styles.bar} style={{ width: `${Math.round((h.count / maxAgeCount) * 100)}%` }} />
            </span>
            <span className={styles.cardSub}>{fmtQty(h.count)}</span>
          </div>
        ))}
        <p className={styles.cardSub}>
          New {fmtQty(summary.newVsReturning.newCount)} · Returning {fmtQty(summary.newVsReturning.returningCount)} · {fmtQty(summary.withBirthday)} with birthday
        </p>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Customers</h2>
        <div className={`${styles.custRow} ${styles.custHead}`}>
          <span>Name</span><span>Race</span><span>Birthday</span><span>Age</span><span>Gender</span><span>Orders</span><span>Last order</span>
        </div>
        {ranked.slice(0, TOP_N).map((r) => (
          <div key={r.id} className={styles.custRow}>
            <span>{r.name || '—'}</span>
            <span>{r.race ?? '—'}</span>
            <span>{r.birthday ?? '—'}</span>
            <span>{r.age ?? '—'}</span>
            <span>{r.gender ?? '—'}</span>
            <span>{fmtQty(r.orderCount)}</span>
            <span>{r.lastOrderDate ?? '—'}</span>
          </div>
        ))}
        {ranked.length > TOP_N && (
          <p className={styles.cardSub}>Showing the {TOP_N} most recent of {fmtQty(ranked.length)} customers.</p>
        )}
      </div>
    </>
  );
};
```

- [ ] **Step 3: Add the tab framework to the page** — in `apps/pos/src/pages/SalesAnalysis.tsx`:

Add the import (after the existing `useSalesAnalysis` import):
```ts
import { CustomerDataTab } from '../components/sales-analysis/CustomerDataTab';
```

Add tab state (next to the other `useState` calls):
```ts
  const [tab, setTab] = useState<'overview' | 'customers'>('overview');
```

Insert a tab bar immediately after the closing `</div>` of `headerRow` (before `{isLoading && ...}`):
```tsx
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
            onClick={() => setTab('overview')}
          >Overview</button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'customers' ? styles.tabActive : ''}`}
            onClick={() => setTab('customers')}
          >Customer Data</button>
        </div>
```

Wrap the existing overview block: change the opening guard `{ov && (` to `{tab === 'overview' && ov && (` (its closing `)}` stays). Then add, right after that block's closing `)}`:
```tsx
        {tab === 'customers' && data && <CustomerDataTab customers={data.customers} />}
```

- [ ] **Step 4: Add the CSS** — append to `apps/pos/src/pages/SalesAnalysis.module.css`:

```css
.tabs { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--line); }
.tab {
  font: inherit; font-size: var(--fs-14); color: #6b6b6b;
  background: none; border: none; padding: 8px 12px; cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.tabActive { color: var(--c-ink); border-bottom-color: var(--c-accent, #b06a3b); font-weight: 600; }
.ageInput { font: inherit; width: 64px; margin-left: 6px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.custRow {
  display: grid; grid-template-columns: 1.6fr 1fr 1.2fr 0.5fr 0.9fr 0.7fr 1.1fr;
  gap: var(--space-3); align-items: center; padding: 6px 0;
  border-top: 1px solid #f0ebe4; font-size: var(--fs-13); color: var(--c-ink);
}
.custHead { color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.03em; font-size: var(--fs-12); border-top: none; }
```

- [ ] **Step 5: Verify typecheck + build**

Run: `pnpm --filter @2990s/pos typecheck && ALLOW_LOCAL_API_URL=1 pnpm --filter @2990s/pos build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/components/sales-analysis/CustomerDataTab.tsx apps/pos/src/lib/sales-analysis-queries.ts apps/pos/src/pages/SalesAnalysis.tsx apps/pos/src/pages/SalesAnalysis.module.css
git commit -m "feat(pos): Sales Analysis Customer Data tab — precise-age filter + distributions + list"
```

---

### Task 10: Cleanup — drop SO demographic columns + retire age-frame exports

Now that nothing reads/writes the SO demographic columns or the age-frame vocabulary, remove them. This task ends with the FULL gate suite green.

**Files:**
- Modify: `packages/db/src/schema.ts` (mfg_sales_orders demographics ~lines 1505-1510 after merge)
- Create: `packages/db/migrations/0206_drop_so_customer_demographics.sql`
- Modify: `packages/shared/src/customer-demographics.ts`
- Modify: `packages/shared/src/customer-demographics.test.ts`

- [ ] **Step 1: Confirm no remaining consumers** — run:

```bash
grep -rnE "AGE_FRAMES|isValidAgeFrame|ageFrameLabel|AgeFrameCode|\bageFrame\b|customer_age_frame|customerAgeFrame" \
  apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Expected: **no matches**. If any remain, fix them before continuing (they are leftovers from Tasks 3-9).

- [ ] **Step 2: Remove the SO demographic columns from the schema** — in `packages/db/src/schema.ts`, delete the demographics comment block + the two columns in `mfgSalesOrders`:

```ts
  /* Marketing demographics (2026-06-25, migration 0185) — captured at POS
     handover (required for NEW customers), never shown on the SO/PDF. Read by
     Sales Analysis. customer_age_frame stores a code (below_18 / 18_25 / 26_35
     / 36_45 / above_45); customer_race stores the value. */
  customerRace:                   text('customer_race'),
  customerAgeFrame:               text('customer_age_frame'),
```
(Delete all six lines. Keep the `is_test` comment + column that follow.)

- [ ] **Step 3: Write the drop migration** — create `packages/db/migrations/0206_drop_so_customer_demographics.sql`:

```sql
-- 0206 — drop the now-dead SO demographic snapshot columns (Part A, mig 0185).
-- Demographics moved to the customers table in 0205; nothing reads/writes these
-- on the SO anymore. The capture path never deployed → no real data lost. The
-- current payment-totals view (0200) enumerates columns explicitly and does NOT
-- reference these two, so no view rebuild is needed.
--
-- PRE-CHECK (run manually before applying; expect ZERO rows). If any object
-- depends on these columns, drop/recreate it first:
--   SELECT dependent.relname, a.attname
--   FROM pg_depend d
--   JOIN pg_rewrite r ON r.oid = d.objid
--   JOIN pg_class dependent ON dependent.oid = r.ev_class
--   JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
--   WHERE d.refobjid = 'public.mfg_sales_orders'::regclass
--     AND a.attname IN ('customer_race','customer_age_frame');
--
-- Additive-safe: IF EXISTS guards make it re-runnable. Transactional.

BEGIN;
ALTER TABLE mfg_sales_orders DROP COLUMN IF EXISTS customer_race;
ALTER TABLE mfg_sales_orders DROP COLUMN IF EXISTS customer_age_frame;
COMMIT;
```

- [ ] **Step 4: Retire the age-frame vocabulary from the shared module** — in `packages/shared/src/customer-demographics.ts`, delete `AGE_FRAMES`, `AgeFrameCode`, the `AGE_FRAME_SET`, `isValidAgeFrame`, and `ageFrameLabel`. The file's surviving exports are: `RACE_OPTIONS`, `Race`, `isValidRace`, `GENDER_OPTIONS`, `Gender`, `isValidGender`, `ageFromBirthday`, `isValidBirthday`. Update the file's top comment to describe race + gender + birthday (no age-frame).

- [ ] **Step 5: Remove the age-frame tests** — in `packages/shared/src/customer-demographics.test.ts`, remove `AGE_FRAMES`, `isValidAgeFrame`, `ageFrameLabel` from the import and delete their `describe` blocks. Keep the race/gender/birthday suites.

- [ ] **Step 6: Run the full gate suite**

Run (from worktree root): `pnpm typecheck && pnpm test && pnpm lint`
Expected: PASS across all packages. Then:
Run: `ALLOW_LOCAL_API_URL=1 pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations/0206_drop_so_customer_demographics.sql packages/shared/src/customer-demographics.ts packages/shared/src/customer-demographics.test.ts
git commit -m "chore(db,shared): drop SO demographic columns (mig 0206) + retire age-frame vocabulary"
```

---

## Deploy notes (owner-gated; out of plan scope, for the handoff)

1. Apply migrations **0205 then 0206** to prod via Supabase MCP (run the 0206 pre-check first). Migrate-before-deploy.
2. Deploy API (Worker) then POS (PWA). Remind Loo to hard-refresh the POS after deploy.
3. The branch already merged `origin/main` (66 commits). Before opening a PR, `git pull --ff-only` / re-merge if `origin/main` advanced again (parallel sessions).

## Self-review notes

- **Spec coverage:** §4 → Tasks 2,10; §5 → Tasks 1,10; §6 → Task 2; §7.1 → Tasks 3,4; §7.2 → (no-op, defaults) noted in Task 3; §8 → Tasks 5,6; §9 → Tasks 7,8,9. All covered.
- **Type consistency:** `SaCustomerRow` defined in Task 7, consumed verbatim in Tasks 8/9; `summarizeCustomerDemographics` signature identical across Task 7 (def) and Task 9 (call); `HandoverForm` `birthday`/`gender` introduced in Task 5, consumed in Task 6; RPC 6-arg signature defined in Task 2, called in Task 3.
- **Green-throughout:** old age-frame exports + SO columns are retained until Task 10, so every intermediate task compiles.
