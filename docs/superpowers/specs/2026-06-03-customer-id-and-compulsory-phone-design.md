# Customer ID + Compulsory Phone — design spec

> **Status:** SPEC ONLY — not built. Chairman (Loo) brief 2026-06-03.
> A future session implements this. Read this top-to-bottom first.
> Related shipped work: the delivery-fee cross-category link (see memory
> `delivery-fee-special-crossorder-wip`) — this spec makes its "same customer"
> check robust.

---

## 1. What the Chairman asked for

> "Do a customer id, at the same time make sure all SO need to fill up the
> phone number, so that compulsory got number."

Two things:
1. **Compulsory phone** — every Sales Order MUST have a phone number.
2. **Real customer identity** — give each customer a stable `customer_id` and
   link every SO to it, so "this customer's orders" and "is this the same
   customer" stop relying on fuzzy name text.

**Why it matters (business):** today there is no real customer record — every
SO just carries a *copy* of the name + phone. "Same customer" is guessed (the
backend search guesses by name; the new cross-category delivery link guesses by
phone). With compulsory phone + a customer master, the system can reliably tie a
person's orders together (follow-up purchases, history, the cross-category
discount, future loyalty/CRM).

---

## 2. Current state (verified 2026-06-03, with evidence)

- **`customers` table EXISTS but is dead.** `packages/db/src/schema.ts` ~L438:
  `customers(id, name, phone, email, address…, first_seen_at, last_seen_at)`
  with a NON-unique index on `phone` (`idx_customers_phone`). **Nothing writes
  to it** — grep `from('customers')` across `apps/api/src` returns no
  insert/upsert.
- **`mfg_sales_orders.customer_id` EXISTS but is ALWAYS NULL for POS orders.**
  - The POS handover payload never sends a customer id (`apps/pos/src/lib/pos-handover-so.ts`,
    `apps/pos/src/pages/Handover.tsx` — no `customerId`).
  - The SO POST writes `customer_id: (body.customerId as string) ?? null`
    (`apps/api/src/routes/mfg-sales-orders.ts` ~L1504) → null.
- **Each SO stores a denormalised snapshot:** `debtor_name` (NOT NULL — the
  name), `phone` (nullable; normalised via `normalizePhone` on insert), `email`.
- **Phone is OPTIONAL end-to-end today** EXCEPT the POS Customer step now
  client-requires it (`validateCustomer` in `apps/pos/src/lib/handover-helpers.ts`
  requires `name + phone + email`). The **server does NOT enforce phone**, and
  the Backend "New SO" form does not require it.
- **How "same customer" is decided today (inconsistent):**
  - Backend "find past orders" `/debtors/search` → `ilike('debtor_name', …)`
    (`mfg-sales-orders.ts` ~L330) — **by NAME** (typos / duplicates unreliable).
  - Cross-category delivery link `checkCrossCategorySource`
    (`mfg-sales-orders.ts` ~L703-730) — **by normalised PHONE**, and **lenient**:
    if either side has no phone the same-customer check is SKIPPED.
- **`normalizePhone`** lives in `@2990s/shared/phone` (used on SO insert + the
  cross-cat check). Returns null on unparseable input (fallback keeps raw).

---

## 3. Design

### 3.1 Compulsory phone (server-authoritative)

Phone must be present + valid on **every** SO at creation, enforced at the layer
that can't be bypassed (the API), not just the POS UI.

- **`POST /mfg-sales-orders`**: before insert, require a phone. Normalise it; if
  empty/invalid → reject `400 { error: 'phone_required' }`. (POS already
  client-gates this; the server is the real guard for the Backend New SO + any
  direct API call.)
- **Backend New SO form** (`apps/backend/.../SalesOrder*` New form): make the
  phone field required client-side too (parity with POS), with a clear message.
- **POS**: already required via `validateCustomer`; keep + ensure the value is
  always sent (it is, via `phone`).
- **DB constraint — staged, NOT immediate NOT NULL.** Existing rows + legacy
  paths may have null phones, so do NOT slap `NOT NULL` on `mfg_sales_orders.phone`
  on day 1. Enforce at the API first; consider a `NOT NULL` (or CHECK) only
  after a backfill pass confirms 100 % coverage. **Decision needed (D1).**

### 3.2 Customer master — find-or-create by phone, set `customer_id`

On `POST /mfg-sales-orders` (after phone is validated + normalised), resolve the
customer and stamp `customer_id` on the SO header:

```
normPhone = normalizePhone(body.phone)            // required, validated above
customerId = upsert_customer_by_phone(normPhone, name, email, address…)
… insert SO with customer_id = customerId, phone = normPhone …
```

`upsert_customer_by_phone`:
- Look up `customers` by `phone = normPhone`.
- **Found** → use its `id`; bump `last_seen_at = now()`. (Name/email: **keep the
  existing** customer name; do NOT overwrite from a later order — **Decision D2**:
  keep-first vs update-to-latest.)
- **Not found** → INSERT a new `customers` row (name, phone, email, address from
  the order) → use the new `id`.
- **Concurrency:** two SOs for a brand-new phone at the same instant must not
  create two customers. Use an atomic upsert: `INSERT … ON CONFLICT (phone) DO
  UPDATE SET last_seen_at = now() RETURNING id`. This needs a **UNIQUE** index on
  `customers.phone` (see migration). Doing this server-side as one statement (or
  a `SECURITY DEFINER` RPC) avoids the read-then-write race.

Then `mfg_sales_orders.customer_id = customerId` in the existing header insert.

### 3.3 Use `customer_id` for matching (the payoff)

- **Cross-category eligibility** (`checkCrossCategorySource`): once every new SO
  has a `customer_id`, prefer matching the linked SO's `customer_id` against the
  *new* order's resolved `customer_id` (exact, robust) and fall back to phone for
  legacy rows. Drop the "lenient when no phone" hole — phone is now compulsory.
- **Customer history / directory:** "this customer's SOs" = `WHERE customer_id =
  ?`. Enables a future Customer Directory page + reliable repeat-customer detection.

### 3.4 Migration

`packages/db/migrations/0XXX_customer_id_compulsory_phone.sql` (pick the next
free number — **check `list_migrations` on prod + the migrations dir; multiple
concurrent branches are grabbing numbers, expect to renumber**):
- `CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON customers(phone) WHERE phone IS NOT NULL;`
  (the table is effectively empty today, so no dedupe needed — but verify.)
- (Optional) a `SECURITY DEFINER` function `upsert_customer_by_phone(...)` if the
  upsert is done in SQL rather than the route. Check `customers` RLS: the order
  POST runs as the authenticated staff client, so staff need INSERT/UPDATE/SELECT
  on `customers` (add policies, or do the upsert via the service-role/RPC).

### 3.5 Backfill (Phase 2, optional — Decision D3)

Existing SOs have `customer_id = null` + a phone snapshot. A one-off backfill:
for each existing SO with a phone, find-or-create the customer + set
`customer_id`; SOs without a phone stay null (or get a placeholder customer).
Lets historical orders connect. Recommended but not blocking.

---

## 4. File map

| Purpose | File |
|---|---|
| Unique index on `customers.phone` (+ optional upsert RPC) | new migration + `packages/db/src/schema.ts` |
| Phone-required guard + customer find-or-create + set `customer_id`; cross-cat match by `customer_id` | `apps/api/src/routes/mfg-sales-orders.ts` (POST handler + `checkCrossCategorySource`) |
| Customer resolve helper (shared) | new `apps/api/src/lib/resolve-customer.ts` (or inline) |
| POS phone already required — confirm + error copy | `apps/pos/src/lib/handover-helpers.ts` (`validateCustomer`) |
| Backend New SO — make phone required | `apps/backend/src/pages/` New SO form |
| (Phase 2) backfill script | `packages/db/scripts/backfill-customer-id.sql` |
| (Phase 2) Customer Directory page | `apps/backend/src/pages/` |

---

## 5. Edge cases + decisions the Chairman must confirm

- **D1 — DB NOT NULL on phone?** Recommend: enforce at API now; add `NOT NULL`
  only after a backfill confirms coverage. (Hard NOT NULL day-1 risks breaking
  legacy/edge create paths.)
- **D2 — When the same phone returns with a different name/email**, keep the
  first customer name or update to the latest? Recommend **keep-first** (the
  customer record is the canonical name; the SO still snapshots its own
  `debtor_name`). Always bump `last_seen_at`.
- **D3 — Backfill existing SOs?** Recommend yes (Phase 2) so history connects.
- **Walk-in who won't give a phone:** compulsory means the order is **blocked**.
  Confirm the policy — is there ANY exception (a "no-phone" placeholder)? Default
  per the brief: **no exception, phone compulsory.**
- **Foreign / unparseable numbers:** `normalizePhone` may return null. Decide:
  accept the raw string as the key, or require a parseable MY number. Recommend
  accept raw (don't block a real foreign customer) but store consistently.
- **Two people sharing one phone (family/company):** merged into one customer.
  Accepted limitation (matches the cross-category design).
- **RLS:** verify staff can INSERT/UPDATE/SELECT `customers` (or route the upsert
  through a `SECURITY DEFINER` RPC). The POS order POST uses the *authenticated
  staff* Supabase client.

---

## 6. Acceptance criteria

1. Creating an SO without a valid phone is **rejected** — POS blocks it (already)
   AND the server returns `400 phone_required` (Backend New SO + direct API too).
2. Two SOs placed with the **same** (normalised) phone resolve to the **same
   `customer_id`**; a new phone creates exactly one new `customers` row (no race
   duplicates).
3. Every newly created SO has a non-null `customer_id`.
4. The cross-category delivery link matches "same customer" by `customer_id`
   (exact), no longer by lenient phone-or-skip.
5. (Phase 2) A customer's full order history is queryable by `customer_id`.

---

## 7. Phasing

- **Phase 1 (this build):** compulsory phone (server + Backend) → find-or-create
  customer by phone → set `customer_id` on new SOs → cross-cat match uses
  `customer_id` (fallback phone for legacy).
- **Phase 2 (later):** backfill existing SOs; Customer Directory page; dedupe/merge
  tooling; (optionally) `NOT NULL` on phone once backfilled.

⚠️ **Migrations are append-only + applied to prod only on the Chairman's explicit
"go".** Multiple concurrent branches are grabbing migration numbers — verify the
next free number against prod (`list_migrations`) and the dir before applying;
expect to renumber to dodge collisions.
