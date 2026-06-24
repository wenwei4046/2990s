# Part A — Customer demographics capture (race + age frame) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a customer's **race** and **age frame** in the POS handover Customer step — required for NEW customers, prefilled for existing ones — stored on the SO snapshot for later marketing analysis, never shown on the SO/PDF.

**Architecture:** Two new nullable columns on `mfg_sales_orders` (`customer_race`, `customer_age_frame`), mirroring the existing emergency-contact snapshot precedent (the `customers` registry has no such columns). A shared `@2990s/shared` constants module is the single source of truth for the option lists + validators, used by the POS form, the POS validation, and the API write/coercion. The POS Customer step gains two dropdowns and a required-for-new gate keyed on the already-derived `form.customerType`. The customer-search endpoint returns the two fields so an existing pick prefills.

**Tech Stack:** pnpm workspace + Turborepo, TypeScript 5.7 strict, React 19 (POS SPA), Hono on CF Workers (API), Drizzle (schema is source of truth), Supabase Postgres, Vitest.

## Global Constraints

- **Drizzle schema is the source of truth** (`packages/db/src/schema.ts`); migrations are append-only and applied to prod via the **Supabase MCP** (`apply_migration` / `execute_sql`), not the failing GH workflow.
- **Money / pricing recompute:** untouched — this is read-capture only, no pricing path changes.
- **Storage location:** SO snapshot `mfg_sales_orders.customer_race` / `customer_age_frame` ONLY. Do **not** add columns to the `customers` registry (mirrors emergency contact).
- **Race options (exact):** `Malay`, `Chinese`, `Indian`, `Others`.
- **Age frame codes (exact):** `below_18`, `18_25`, `26_35`, `36_45`, `above_45` (labels: `Below 18`, `18–25`, `26–35`, `36–45`, `Above 45`). Store the **code**, never a birthdate.
- **Required for NEW customers only** (`form.customerType === 'NEW'`); optional + prefilled for an existing pick. Capture must **never block** an existing-customer order.
- **Never** render race/age frame on the SO document, PDF, or any customer-facing surface.
- **Brand voice in copy:** warm, sentence case, no emoji, no hype.
- **Deploy order:** migration (columns) BEFORE the API/POS code that reads/writes them. Remind about PWA hard-refresh after the POS deploy.
- **Commits** end with the repo trailer (`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: …`) per CLAUDE.md — appended to every commit message below.

---

### Task 1: Shared demographics constants + validators

**Files:**
- Create: `packages/shared/src/customer-demographics.ts`
- Create (test): `packages/shared/src/customer-demographics.test.ts`
- Modify: `packages/shared/src/index.ts` (add one export line)

**Interfaces:**
- Produces: `RACE_OPTIONS: readonly ['Malay','Chinese','Indian','Others']`; `AGE_FRAMES: readonly {code,label}[]`; `type Race`; `type AgeFrameCode`; `isValidRace(v: unknown): v is Race`; `isValidAgeFrame(v: unknown): v is AgeFrameCode`; `ageFrameLabel(code: string|null|undefined): string`. Consumed by Tasks 4 (POS form) and 6 (API).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/customer-demographics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  RACE_OPTIONS, AGE_FRAMES, isValidRace, isValidAgeFrame, ageFrameLabel,
} from './customer-demographics';

describe('customer-demographics', () => {
  it('exposes the four race options in order', () => {
    expect(RACE_OPTIONS).toEqual(['Malay', 'Chinese', 'Indian', 'Others']);
  });

  it('exposes five non-overlapping age-frame codes in order', () => {
    expect(AGE_FRAMES.map((a) => a.code)).toEqual([
      'below_18', '18_25', '26_35', '36_45', 'above_45',
    ]);
  });

  it('isValidRace accepts known races and rejects anything else', () => {
    expect(isValidRace('Chinese')).toBe(true);
    expect(isValidRace('Martian')).toBe(false);
    expect(isValidRace('')).toBe(false);
    expect(isValidRace(null)).toBe(false);
  });

  it('isValidAgeFrame accepts codes and rejects labels/others', () => {
    expect(isValidAgeFrame('26_35')).toBe(true);
    expect(isValidAgeFrame('26-35')).toBe(false);
    expect(isValidAgeFrame('26–35')).toBe(false);
    expect(isValidAgeFrame(undefined)).toBe(false);
  });

  it('ageFrameLabel maps code → label and returns "" for unknown/empty', () => {
    expect(ageFrameLabel('18_25')).toBe('18–25');
    expect(ageFrameLabel('nope')).toBe('');
    expect(ageFrameLabel(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @2990s/shared exec vitest run src/customer-demographics.test.ts`
Expected: FAIL — cannot find module `./customer-demographics`.

- [ ] **Step 3: Write the module**

Create `packages/shared/src/customer-demographics.ts`:

```ts
// customer-demographics — race + age-frame vocabulary for the POS customer
// capture step and the Sales Analysis marketing list (single source of truth).
// Stored on the SO snapshot (mfg_sales_orders.customer_race / customer_age_frame),
// mirroring the emergency-contact precedent. Captured at handover (REQUIRED for
// NEW customers), never shown on the SO/PDF — collected for marketing analysis.

export const RACE_OPTIONS = ['Malay', 'Chinese', 'Indian', 'Others'] as const;
export type Race = (typeof RACE_OPTIONS)[number];

/** Age band the salesperson picks at handover. We store the stable CODE (not a
 *  birthdate / computed age); the label is derived for display so relabelling
 *  never migrates data. Buckets are non-overlapping. */
export const AGE_FRAMES = [
  { code: 'below_18', label: 'Below 18' },
  { code: '18_25', label: '18–25' },
  { code: '26_35', label: '26–35' },
  { code: '36_45', label: '36–45' },
  { code: 'above_45', label: 'Above 45' },
] as const;
export type AgeFrameCode = (typeof AGE_FRAMES)[number]['code'];

const RACE_SET = new Set<string>(RACE_OPTIONS);
const AGE_FRAME_SET = new Set<string>(AGE_FRAMES.map((a) => a.code));

export function isValidRace(v: unknown): v is Race {
  return typeof v === 'string' && RACE_SET.has(v);
}

export function isValidAgeFrame(v: unknown): v is AgeFrameCode {
  return typeof v === 'string' && AGE_FRAME_SET.has(v);
}

/** Human label for a stored age-frame code; '' for unknown/empty. */
export function ageFrameLabel(code: string | null | undefined): string {
  return AGE_FRAMES.find((a) => a.code === code)?.label ?? '';
}
```

- [ ] **Step 4: Add the package export**

In `packages/shared/src/index.ts`, append after the last export line (currently `export * from './special-delivery-match';`):

```ts
export * from './customer-demographics'; // 2026-06-25 — race/age-frame constants + validators (marketing capture)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @2990s/shared exec vitest run src/customer-demographics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/customer-demographics.ts packages/shared/src/customer-demographics.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): race + age-frame constants + validators for customer capture"
```

---

### Task 2: DB migration + Drizzle schema columns

**Files:**
- Create: `packages/db/migrations/0185_so_customer_demographics.sql`
- Modify: `packages/db/src/schema.ts:1393` (add two columns after `emergencyContactRelationship`)

**Interfaces:**
- Produces: columns `mfg_sales_orders.customer_race text` (nullable) and `mfg_sales_orders.customer_age_frame text` (nullable). Consumed by Task 6 (API write + search read).

- [ ] **Step 1: Write the migration file**

Create `packages/db/migrations/0185_so_customer_demographics.sql`:

```sql
-- 0185_so_customer_demographics.sql
-- Marketing data collection (2026-06-25): capture the customer's race + age
-- band at POS handover. Stored on the SO snapshot, mirroring the emergency-
-- contact precedent (the customers registry has no such columns). Required for
-- NEW customers in the POS Customer step; never shown on the SO / PDF. Read by
-- the Sales Analysis marketing list (each customer's most-recent SO snapshot).
-- Both nullable; existing rows stay NULL. age_frame stores a stable CODE
-- (below_18 / 18_25 / 26_35 / 36_45 / above_45); race stores the value.

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS customer_race text;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS customer_age_frame text;
```

- [ ] **Step 2: Update the Drizzle schema (source of truth)**

In `packages/db/src/schema.ts`, immediately after line 1393 (`emergencyContactRelationship:   text('emergency_contact_relationship'),`) insert:

```ts
  /* Marketing demographics (2026-06-25, migration 0185) — captured at POS
     handover (required for NEW customers), never shown on the SO/PDF. Read by
     Sales Analysis. customer_age_frame stores a code (below_18 / 18_25 / 26_35
     / 36_45 / above_45); customer_race stores the value. */
  customerRace:                   text('customer_race'),
  customerAgeFrame:               text('customer_age_frame'),
```

- [ ] **Step 3: Apply the migration to the database (Supabase MCP)**

Apply via the Supabase MCP `apply_migration` tool with name `0185_so_customer_demographics` and the SQL from Step 1. (Do NOT rely on the GH "Apply DB migration" workflow — it is known-broken.)

- [ ] **Step 4: Verify the columns exist**

Run via Supabase MCP `execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'mfg_sales_orders'
  and column_name in ('customer_race', 'customer_age_frame')
order by column_name;
```
Expected: two rows, both `text`, both `is_nullable = YES`.

- [ ] **Step 5: Typecheck the schema change**

Run: `pnpm --filter @2990s/db typecheck`
Expected: PASS (no type errors from the new columns).

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0185_so_customer_demographics.sql packages/db/src/schema.ts
git commit -m "feat(db): add customer_race + customer_age_frame to mfg_sales_orders (mig 0185)"
```

---

### Task 3: HandoverForm fields + required-for-new validation

**Files:**
- Modify: `apps/pos/src/lib/handover-helpers.ts` (interface `HandoverForm` ~line 82; `validateCustomer` line 141; `customerBlockers` line 242)
- Modify: `apps/pos/src/pages/Handover.tsx:65` (the `empty` form initializer)
- Create (test): `apps/pos/src/lib/handover-helpers.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (presence check only — does not import the constants).
- Produces: `HandoverForm.race: string`, `HandoverForm.ageFrame: string`; `validateCustomer` now requires race+ageFrame when `customerType === 'NEW'`. Consumed by Tasks 4 (form UI) and 5 (payload).

- [ ] **Step 1: Add the two fields to the `HandoverForm` interface**

In `apps/pos/src/lib/handover-helpers.ts`, after line 82 (`emergencyName: string; emergencyRelation: string; emergencyPhone: string;`) insert:

```ts

  /** Marketing demographics (2026-06-25). Captured at handover, stored on the
   *  SO snapshot, never shown on the SO/PDF. REQUIRED when customerType==='NEW'
   *  (a brand-new customer); optional + prefilled for an existing pick. */
  race: string; ageFrame: string;
```

- [ ] **Step 2: Add the fields to the `empty` form so the app still compiles**

In `apps/pos/src/pages/Handover.tsx`, in the `empty` object, after line 65 (`emergencyName: '', emergencyRelation: '', emergencyPhone: '',`) insert:

```ts
  race: '', ageFrame: '',
```

- [ ] **Step 3: Write the failing validation test**

Create `apps/pos/src/lib/handover-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateCustomer, type HandoverForm } from './handover-helpers';

// Minimal valid HandoverForm; override only what each case needs.
const base = (over: Partial<HandoverForm>): HandoverForm => ({
  name: 'Jane Tan', phone: '+60123456789', email: 'jane@example.com',
  salespersonId: '', customerType: 'NEW',
  addressLater: false, fullAddress: '', addressLine2: '',
  postcode: '', city: '', state: '', buildingType: '',
  billingSame: true, billingAddress: '', billingAddressLine2: '',
  billingPostcode: '', billingCity: '', billingState: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  race: 'Chinese', ageFrame: '26_35',
  deliveryDate: '', deliveryDateLater: false, processDate: '',
  addons: {}, paymentMethod: '', amountPaid: 0, extraPayments: [],
  additionalDeliveryFee: 0, crossCategorySourceSo: '',
  paymentPreset: 'full', approvalCode: '', slipUploadSessionId: null,
  paymentRecorded: false, signed: false, acknowledgedTerms: false,
  installmentMonths: null, merchantProvider: null,
  ...over,
});

describe('validateCustomer — race/age required for NEW customers', () => {
  it('NEW customer missing both race and age is invalid', () => {
    expect(validateCustomer(base({ customerType: 'NEW', race: '', ageFrame: '' }))).toBe(false);
  });
  it('NEW customer with race + age is valid', () => {
    expect(validateCustomer(base({ customerType: 'NEW', race: 'Malay', ageFrame: '18_25' }))).toBe(true);
  });
  it('NEW customer missing only age is invalid', () => {
    expect(validateCustomer(base({ customerType: 'NEW', race: 'Indian', ageFrame: '' }))).toBe(false);
  });
  it('EXISTING customer missing race/age is still valid (not blocked)', () => {
    expect(validateCustomer(base({ customerType: 'EXISTING', race: '', ageFrame: '' }))).toBe(true);
  });
  it('still enforces name/phone/email', () => {
    expect(validateCustomer(base({ email: 'bad-email' }))).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @2990s/pos exec vitest run src/lib/handover-helpers.test.ts`
Expected: FAIL — the NEW-without-race case returns `true` (rule not yet added).

- [ ] **Step 5: Add the required-for-new rule to `validateCustomer`**

In `apps/pos/src/lib/handover-helpers.ts`, replace `validateCustomer` (lines 141–144):

```ts
export const validateCustomer = (f: HandoverForm): boolean =>
  f.name.trim().length > 0
  && f.phone.trim().length > 0
  && EMAIL_RE.test(f.email.trim())
  // Race + age band are compulsory for a NEW customer (the first time we record
  // them); an existing pick already carries them / can be left as prefilled.
  && (f.customerType !== 'NEW' || (f.race.trim().length > 0 && f.ageFrame.trim().length > 0));
```

- [ ] **Step 6: Add the human-readable blockers**

In `apps/pos/src/lib/handover-helpers.ts`, in `customerBlockers` (lines 242–249), add the two checks before `return b;`:

```ts
  if (f.customerType === 'NEW' && !f.race.trim()) b.push('Race required for a new customer');
  if (f.customerType === 'NEW' && !f.ageFrame.trim()) b.push('Age group required for a new customer');
  return b;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @2990s/pos exec vitest run src/lib/handover-helpers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/pos/src/lib/handover-helpers.ts apps/pos/src/lib/handover-helpers.test.ts apps/pos/src/pages/Handover.tsx
git commit -m "feat(pos): require race + age frame for new customers at handover"
```

---

### Task 4: Customer step dropdowns + prefill

**Files:**
- Modify: `apps/pos/src/components/handover/CustomerStep.tsx` (import + `pickCustomer` ~line 55 + new UI before `</section>` ~line 143)
- Modify: `apps/pos/src/lib/customer-search.ts` (`CustomerSearchHit` ~line 39)

**Interfaces:**
- Consumes: `RACE_OPTIONS`, `AGE_FRAMES` from `@2990s/shared` (Task 1); `form.race` / `form.ageFrame` (Task 3); `CustomerSearchHit.race` / `.ageFrame` (added here, populated by Task 6).
- Produces: the Customer step renders Race + Age-group dropdowns and prefills them on an existing pick.

- [ ] **Step 1: Extend `CustomerSearchHit` with the two fields**

In `apps/pos/src/lib/customer-search.ts`, after line 39 (`emergencyContactRelationship: string | null;`) insert:

```ts
  /* Marketing demographics carried from the newest SO snapshot (per-field
     coalesce, server-side). Prefilled into the Customer step on an existing pick. */
  race: string | null;
  ageFrame: string | null;
```

- [ ] **Step 2: Import the constants in CustomerStep**

In `apps/pos/src/components/handover/CustomerStep.tsx`, after line 13 (`import styles from '../../pages/Handover.module.css';`) add:

```ts
import { RACE_OPTIONS, AGE_FRAMES } from '@2990s/shared';
```

- [ ] **Step 3: Prefill race/age on an existing pick**

In `pickCustomer` (CustomerStep.tsx), after line 55 (`if (h.emergencyContactRelationship) update('emergencyRelation', h.emergencyContactRelationship);`) add:

```ts
    if (h.race) update('race', h.race);
    if (h.ageFrame) update('ageFrame', h.ageFrame);
```

- [ ] **Step 4: Render the two dropdowns**

In CustomerStep.tsx, insert this block immediately after the closing `</div>` of the salesperson/customer-type `fieldRow` (after line 143, before `</section>` on line 144). The `*` and helper line show only for a NEW customer (`!matched`):

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
        <Field label={`Age group${matched ? '' : ' *'}`}>
          <select value={form.ageFrame} onChange={(e) => update('ageFrame', e.target.value)}>
            <option value="">{matched ? '— optional —' : '— select —'}</option>
            {AGE_FRAMES.map((a) => (
              <option key={a.code} value={a.code}>{a.label}</option>
            ))}
          </select>
        </Field>
      </div>
      {!matched && (
        <p className={styles.signCaption}>
          Race and age group are recorded for marketing only — not shown on the order.
        </p>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS (no type errors; `form.race`/`form.ageFrame` and `h.race`/`h.ageFrame` resolve).

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/components/handover/CustomerStep.tsx apps/pos/src/lib/customer-search.ts
git commit -m "feat(pos): race + age-group dropdowns on the handover Customer step"
```

---

### Task 5: Payload plumbing (POS → API)

**Files:**
- Modify: `apps/pos/src/lib/pos-handover-so.ts` (`PosHandoffPayload` ~line 70)
- Modify: `apps/pos/src/pages/Handover.tsx` (payload assembly ~line 357)

**Interfaces:**
- Consumes: `form.race` / `form.ageFrame` (Task 3).
- Produces: the POST `/mfg-sales-orders` body carries `customerRace?` and `customerAgeFrame?`. Consumed by Task 6 (API write).

- [ ] **Step 1: Add the two optional fields to `PosHandoffPayload`**

In `apps/pos/src/lib/pos-handover-so.ts`, after line 70 (`emergencyContactRelationship?: string;`) insert:

```ts

  /* Marketing demographics (camelCase; API maps to customer_race /
     customer_age_frame on the SO snapshot). Optional on the wire — the POS form
     enforces required-for-new before submit. */
  customerRace?: string;
  customerAgeFrame?: string;
```

- [ ] **Step 2: Send them in the payload (conditional spread, matching the emergency-contact pattern)**

In `apps/pos/src/pages/Handover.tsx`, in the `payload` object, after the emergency-contact spreads (lines 353–357, the `emergencyContactRelationship` spread) insert:

```ts
        ...(form.race.trim() ? { customerRace: form.race.trim() } : {}),
        ...(form.ageFrame.trim() ? { customerAgeFrame: form.ageFrame.trim() } : {}),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/lib/pos-handover-so.ts apps/pos/src/pages/Handover.tsx
git commit -m "feat(pos): send customerRace + customerAgeFrame in the handover payload"
```

---

### Task 6: API — persist on create + return on customer-search

**Files:**
- Modify: `apps/api/src/routes/mfg-sales-orders.ts` — `@2990s/shared` import (lines 8–20); customer-search SELECT + Row + FILL_FIELDS + seed (lines 1196–1265); create insert (after line 3059)

**Interfaces:**
- Consumes: `isValidRace` / `isValidAgeFrame` from `@2990s/shared` (Task 1); columns `customer_race` / `customer_age_frame` (Task 2); body `customerRace` / `customerAgeFrame` (Task 5).
- Produces: the create writes the (validated) demographics onto the SO row; `GET /customer-search` returns `race` / `ageFrame` per customer for prefill (Task 4).

- [ ] **Step 1: Import the validators**

In `apps/api/src/routes/mfg-sales-orders.ts`, inside the existing `from '@2990s/shared'` import block (lines 8–20), add a line after `passesRefinementColumns,` (line 19):

```ts
  isValidRace, isValidAgeFrame,
```

- [ ] **Step 2: Persist on create (coerced to a known option or NULL)**

In the create insert object, after line 3059 (`emergency_contact_relationship: (body.emergencyContactRelationship as string) ?? null,`) insert:

```ts
    /* Marketing demographics (2026-06-25, mig 0185) — coerced to a known option
       or NULL; never shown on the SO/PDF. Read by Sales Analysis. */
    customer_race: isValidRace(body.customerRace) ? (body.customerRace as string) : null,
    customer_age_frame: isValidAgeFrame(body.customerAgeFrame) ? (body.customerAgeFrame as string) : null,
```

- [ ] **Step 3: Add the columns to the customer-search SELECT**

In the `/customer-search` handler, change the `.select(...)` string (line 1196) to append the two columns before `created_at`:

```ts
    .select('doc_no, debtor_name, phone, email, customer_type, address1, address2, city, postcode, customer_state, building_type, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, customer_race, customer_age_frame, created_at')
```

- [ ] **Step 4: Add the two columns to the `Row` type**

In the same handler, in the `Row` type (lines 1202–1211), after `emergency_contact_relationship: string | null;` (line 1209) insert:

```ts
    customer_race: string | null; customer_age_frame: string | null;
```

- [ ] **Step 5: Coalesce race/age per-field across a customer's orders**

In the `FILL_FIELDS` array (lines 1219–1224), add the two pairs after `['buildingType', 'building_type'],` (line 1223):

```ts
    ['race', 'customer_race'], ['ageFrame', 'customer_age_frame'],
```

- [ ] **Step 6: Seed race/age into the returned object**

In the `byKey.set(key, {...})` object (lines 1251–1265), after `buildingType:  r.building_type,` (line 1261) insert:

```ts
      race:          r.customer_race,
      ageFrame:      r.customer_age_frame,
```

- [ ] **Step 7: Typecheck the API**

Run: `pnpm --filter @2990s/api typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/mfg-sales-orders.ts
git commit -m "feat(api): persist race/age frame on SO create + return them from customer-search"
```

---

### Task 7: Full gate + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the workspace quality gates**

Run: `pnpm typecheck`
Expected: PASS across all packages.

Run: `pnpm test`
Expected: PASS — includes the new `customer-demographics` (5) and `handover-helpers` (5) tests.

Run: `pnpm lint`
Expected: PASS (no new lint errors introduced by these files).

Run: `pnpm build`
Expected: PASS (POS + API + packages build). If the POS build trips the build-guard on a local API URL, run with `ALLOW_LOCAL_API_URL=1` as the existing convention.

- [ ] **Step 2: Manual smoke (dev) — required-for-new gate**

Start POS dev (`pnpm --filter @2990s/pos dev`). In a handover for a brand-NEW name+phone: confirm the Customer step shows `Race *` and `Age group *`, the Continue button is blocked with "Race required for a new customer" / "Age group required for a new customer" until both are picked, and that filling them unblocks Continue.

- [ ] **Step 3: Manual smoke (dev) — existing pick prefill + not-required**

Place an order for the new customer (with race/age). Start a second handover, type the same name, and pick the customer from the search dropdown: confirm Race + Age group prefill from the prior order and the `*` / required gate is gone (an existing customer can proceed without re-touching them).

- [ ] **Step 4: Verify persistence (DB)**

Via Supabase MCP `execute_sql` (replace with the doc_no created in Step 2):

```sql
select doc_no, debtor_name, customer_race, customer_age_frame
from mfg_sales_orders
order by created_at desc
limit 3;
```
Expected: the new SO row carries the chosen `customer_race` + `customer_age_frame` (an age-frame CODE like `26_35`).

- [ ] **Step 5: Confirm it is NOT on the customer-facing document**

Open the SO PDF / customer print for that order and confirm race / age frame do **not** appear anywhere.

- [ ] **Step 6: Deploy (when approved by the owner)**

Migration 0185 is already applied (Task 2). Deploy the API (`wrangler deploy` via the repo's deploy path) THEN the POS bundle (`scripts/deploy-pos.sh`). Remind the user to PWA hard-refresh the POS tablet after the deploy.

---

## Out of scope for Part A (noted, not built)

- **PATCH / `recustomer` write of race/age.** The POS edit (Proceed "change customer") flow has no race/age input in Part A, so there is no caller; adding server-side PATCH handling now would be untested dead code. Deferred to whenever a POS edit UI sends these fields.
- **`customers`-registry column + Backend-directory editing.** Future option; Part A uses the SO snapshot only.
- **Part B (Sales Analysis page)** — separate plan; it reads each customer's most-recent SO snapshot for race/age.

---

## Self-review

- **Spec coverage:** A.1 (snapshot columns) → Task 2; A.2 (shared constants) → Task 1; A.3 (dropdowns, required-for-new, not on PDF) → Tasks 3+4+ verify 5; A.4 (persist on create, validator coercion, prefill via search, no RPC change) → Tasks 5+6. PATCH/recustomer explicitly deferred (documented). ✅
- **Placeholder scan:** every code step shows complete code; every run step gives an exact command + expected result. No TBD/TODO. ✅
- **Type consistency:** `HandoverForm.race`/`ageFrame` (Task 3) used in Tasks 4/5; payload keys `customerRace`/`customerAgeFrame` (Task 5) consumed in Task 6; `CustomerSearchHit.race`/`ageFrame` (Task 4) populated by Task 6's seed object; `isValidRace`/`isValidAgeFrame`/`RACE_OPTIONS`/`AGE_FRAMES` (Task 1) consumed in Tasks 4/6. Names match across tasks. ✅
