# HEADREST Accessory Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `HEADREST` sofa compartment (already tickable in Allowed Options) appear and work in the POS sofa configurator as a free-standing accessory module, like `Console` / `STOOL`.

**Architecture:** Register `HEADREST` as a first-class entry in the shared geometry table (`SOFA_MODULES`) so `findModule` resolves it directly and the POS Custom Build palette stops filtering it out. It is an `accessory` (no snap participation) that, like `Console`, must sit beside a sofa to close. Art temporarily reuses `STOOL.png`; pricing reuses the existing per-Model compartment pricing. Closure failure copy is generalized from Console-specific to accessory-agnostic.

**Tech Stack:** TypeScript (strict), Vitest, pnpm workspace + Turborepo. Packages: `@2990s/shared` (pure pricing/geometry), `@2990s/pos` (Vite/React PWA).

## Global Constraints

- Money: retail/catalog prices are whole-MYR `INTEGER`; do not introduce sen/float in the retail model.
- Red line #2: do NOT change snap math, `cellEdges` arm logic, or the 22 plan-view PNGs.
- Red line #4: do NOT weaken server-side pricing recompute on `POST /mfg-sales-orders`.
- No DB migration. Backend is unchanged — `HEADREST` is already in the master compartment pool and tickable.
- Compartment id vocabulary is the unified parens form; `HEADREST` is a bare code (no dash/parens) and passes through `normalizeCompartmentCode` unchanged.
- Brand voice for any copy: sentence case, warm, no hype.

---

### Task 1: Register HEADREST as an accessory module (shared geometry)

**Files:**
- Modify: `packages/shared/src/sofa-build.ts` (`SOFA_MODULES` ≈ line 184; `MODULE_EDGES_BASE` ≈ line 841; `representativeArtCode` ≈ lines 288-294)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts` (append a new `describe` block at end of file, after line 791)

**Interfaces:**
- Consumes: existing exports `findModule`, `isAccessoryModule`, `representativeArtCode`, `cellEdges`, and the `Cell`/`SofaModuleSpec` types (all already imported in the test file).
- Produces: `findModule('HEADREST')` returns a `SofaModuleSpec` `{ id:'HEADREST', group:'Accessory', label:'Headrest', w:50, d:30, cushions:0, accessory:true }`; `isAccessoryModule('HEADREST') === true`; `representativeArtCode('HEADREST') === 'STOOL'`; `cellEdges` for a HEADREST cell at `rot:0` is `['open','open','open','open']`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/__tests__/sofa-build.test.ts` (end of file, after the final `});` on line 791):

```ts
/* Case 8 — HEADREST free-standing accessory module (2026-06-29). */
describe('HEADREST accessory module', () => {
  it('findModule resolves HEADREST as a 50×30 accessory', () => {
    const m = findModule('HEADREST');
    expect(m).toBeDefined();
    expect(m?.group).toBe('Accessory');
    expect(m?.accessory).toBe(true);
    expect(m?.w).toBe(50);
    expect(m?.d).toBe(30);
    expect(m?.cushions).toBe(0);
  });

  it('isAccessoryModule(HEADREST) is true', () => {
    expect(isAccessoryModule('HEADREST')).toBe(true);
  });

  it('representativeArtCode(HEADREST) reuses STOOL art (temporary)', () => {
    expect(representativeArtCode('HEADREST')).toBe('STOOL');
  });

  it('HEADREST has no arms — all edges open', () => {
    const edges = cellEdges({ id: 'h', moduleId: 'HEADREST', x: 0, y: 0, rot: 0 });
    expect(edges).toEqual(['open', 'open', 'open', 'open']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared test -- sofa-build`
Expected: FAIL — the four new assertions fail (`findModule('HEADREST')` is `undefined`, so `m?.group` etc. are `undefined`, `isAccessoryModule` is `false`, `representativeArtCode` returns `'HEADREST'`).

- [ ] **Step 3: Add the SOFA_MODULES entry**

In `packages/shared/src/sofa-build.ts`, immediately after the `STOOL` entry (line 184), add:

```ts
  // Headrest — 50×30 free-standing accessory (2026-06-29). Like Console, must
  // sit beside a sofa to close; doesn't count toward bundles/seats. Art: reuses
  // STOOL.png until Loo uploads a real PNG in Maintenance.
  { id: 'HEADREST', group: 'Accessory', label: 'Headrest', w: 50, d: 30, cushions: 0, accessory: true },
```

- [ ] **Step 4: Add the MODULE_EDGES_BASE entry**

In `packages/shared/src/sofa-build.ts`, immediately after the `'STOOL'` edges entry (line 841), add:

```ts
  'HEADREST':['open', 'open', 'open', 'open'],
```

- [ ] **Step 5: Add the temporary art alias in representativeArtCode**

In `packages/shared/src/sofa-build.ts`, edit `representativeArtCode` (lines 288-294). It currently reads:

```ts
export const representativeArtCode = (code: string): string => {
  const norm = normalizeCompartmentCode(code);
  if (MODULE_BY_ID.has(norm)) return norm;
  const s = parseCompartmentStructure(norm);
  const rep = s ? familyRepresentative(s) : undefined;
  return rep ?? norm;
};
```

Change it to (the alias must sit ABOVE the `MODULE_BY_ID.has` check, because HEADREST is now in that map):

```ts
export const representativeArtCode = (code: string): string => {
  const norm = normalizeCompartmentCode(code);
  // TEMP (2026-06-29): HEADREST has no art yet — reuse STOOL.png until Loo
  // uploads a real PNG in Maintenance (resolveModuleArtSrc's imageUrl branch
  // then takes precedence and this alias goes dormant).
  if (norm === 'HEADREST') return 'STOOL';
  if (MODULE_BY_ID.has(norm)) return norm;
  const s = parseCompartmentStructure(norm);
  const rep = s ? familyRepresentative(s) : undefined;
  return rep ?? norm;
};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared test -- sofa-build`
Expected: PASS — all four new tests green, no existing test regressed.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sofa-build.ts packages/shared/src/__tests__/sofa-build.test.ts
git commit -m "feat(shared): register HEADREST as a free-standing accessory sofa module"
```

---

### Task 2: Generalize the accessory closure message

**Files:**
- Modify: `packages/shared/src/sofa-build.ts` (`ClosureFailure` union ≈ lines 1468-1475; closure block ≈ line 1642)
- Test: `packages/shared/src/__tests__/sofa-build.test.ts` (existing Console tests at lines 756-760 and 780-790; add new HEADREST cases inside the `analyzeSofa closure` describe, before its closing `});` on line 791)

**Interfaces:**
- Consumes: `analyzeSofa(cells: Cell[], depth)` → `{ closed: boolean; reason: ClosureFailure | null; ... }`; the `HEADREST` module registered in Task 1.
- Produces: `ClosureFailure` no longer includes `'Console needs a sofa next to it'`; it includes `'Accessory needs a sofa next to it'`. A non-`STOOL` all-accessory group reports the new string.

- [ ] **Step 1: Update existing tests and add new failing tests**

In `packages/shared/src/__tests__/sofa-build.test.ts`:

(a) Change the existing Console-only test (lines 756-760) to expect the generalized message:

```ts
  it('reports the accessory message for a console-only group', () => {
    const r = analyzeSofa([{ id: 'a', moduleId: 'Console', x: 0, y: 0, rot: 0 }], '24');
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('Accessory needs a sofa next to it');
  });
```

(b) Change the existing stool+console test (lines 780-790) assertion:

```ts
  it('a stool wedged with a console still needs a sofa (accessory rule)', () => {
    const r = analyzeSofa(
      [
        { id: 'a', moduleId: 'STOOL',   x: 0,  y: 0, rot: 0 },
        { id: 'b', moduleId: 'Console', x: 80, y: 0, rot: 0 },
      ],
      '24',
    );
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('Accessory needs a sofa next to it');
  });
```

(c) Add two new tests just before the `analyzeSofa closure` describe's closing `});` (line 791):

```ts
  it('a HEADREST-only group is not closed and needs a sofa', () => {
    const r = analyzeSofa([{ id: 'a', moduleId: 'HEADREST', x: 0, y: 0, rot: 0 }], '24');
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('Accessory needs a sofa next to it');
  });

  it('HEADREST wedged with a stool still needs a sofa (accessory rule)', () => {
    const r = analyzeSofa(
      [
        { id: 'a', moduleId: 'STOOL',    x: 0,  y: 0, rot: 0 },
        { id: 'b', moduleId: 'HEADREST', x: 80, y: 0, rot: 0 },
      ],
      '24',
    );
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('Accessory needs a sofa next to it');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @2990s/shared test -- sofa-build`
Expected: FAIL — the four assertions above expect `'Accessory needs a sofa next to it'` but the code still produces `'Console needs a sofa next to it'`.

- [ ] **Step 3: Widen the ClosureFailure union**

In `packages/shared/src/sofa-build.ts`, change the last member of the `ClosureFailure` union (line 1475) from:

```ts
  | 'Console needs a sofa next to it';
```

to:

```ts
  | 'Accessory needs a sofa next to it';
```

- [ ] **Step 4: Update the closure-block message**

In `packages/shared/src/sofa-build.ts`, in the all-accessory closure block (lines 1636-1643), change line 1642 from:

```ts
    reason = everyPieceStandsAlone ? null : 'Console needs a sofa next to it';
```

to:

```ts
    reason = everyPieceStandsAlone ? null : 'Accessory needs a sofa next to it';
```

(Leave the `everyPieceStandsAlone` logic — still only `STOOL` — and the surrounding comment unchanged; only the user-facing string changes.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @2990s/shared test -- sofa-build`
Expected: PASS — updated Console tests, both new HEADREST tests, and all prior tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sofa-build.ts packages/shared/src/__tests__/sofa-build.test.ts
git commit -m "feat(shared): generalize accessory closure message (Console -> Accessory)"
```

---

### Task 3: Classify HEADREST as Accessory in the POS resolver

**Files:**
- Modify: `apps/pos/src/lib/queries.ts` (`classifyCompartmentCode` ≈ lines 1257-1265)

**Interfaces:**
- Consumes: nothing new.
- Produces: `classifyCompartmentCode('HEADREST')` returns `'Accessory'` (was `'Other'`), so the `ResolvedSofaCompartment` built by `useSofaCustomizerData` carries `group: 'Accessory'`.

**Note on no unit test:** `classifyCompartmentCode` is a module-private helper in `queries.ts` (not exported) and `queries.ts` has no unit-test harness (it is React Query glue). This one-line classification is verified by `pnpm typecheck` plus the live QA in Task 4 (HEADREST renders under the Accessory group). Do not export it solely to test it.

- [ ] **Step 1: Add the HEADREST classification rule**

In `apps/pos/src/lib/queries.ts`, in `classifyCompartmentCode` (lines 1257-1265), add a rule for HEADREST alongside the other accessory matches. The function currently reads:

```ts
function classifyCompartmentCode(rawCode: string): ResolvedSofaCompartment['group'] {
  const norm = rawCode.trim();
  if (/^L[-(]/i.test(norm) || /^L$/i.test(norm)) return 'L-Shape';
  if (/^CNR$/i.test(norm) || /^CORNER/i.test(norm)) return 'Corner';
  if (/^STOOL|^Console|^WC-/i.test(norm)) return 'Accessory';
  if (/^2/.test(norm)) return '2-seater';
  if (/^1/.test(norm)) return '1-seater';
  return 'Other';
}
```

Change the accessory line to also match HEADREST:

```ts
  if (/^STOOL|^Console|^WC-|^HEADREST/i.test(norm)) return 'Accessory';
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm --filter @2990s/pos typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/lib/queries.ts
git commit -m "feat(pos): classify HEADREST compartment as an Accessory"
```

---

### Task 4: Verify gates + live behaviour

**Files:** none (verification only).

- [ ] **Step 1: Run the full workspace gates**

Run:
```bash
pnpm typecheck
pnpm test
pnpm lint
```
Expected: all PASS. (If `pnpm build` is run for POS and it trips the build-guard on a local API URL, prefix with `ALLOW_LOCAL_API_URL=1`.)

- [ ] **Step 2: Live QA in the POS configurator**

Start POS dev (`pnpm --filter @2990s/pos dev`) and, for the **Annsa** model (which has HEADREST ticked in Allowed Options):
- Open Custom Build. Confirm a **HEADREST** chip appears under the **Accessory** group in the Modules palette, showing its price (or `TBC` if no per-Model price set yet).
- Tap it to add a cell — confirm a 50×30 block renders on the canvas using the STOOL placeholder art (or the Maintenance-uploaded PNG if one exists).
- With only a HEADREST cell, confirm the configurator reports not-closed with copy "Accessory needs a sofa next to it".
- Add a closed sofa beside it and confirm the sofa itself still closes (the accessory does not block a real sofa's closure).

- [ ] **Step 3: Confirm the branch is ready**

No further code change. Hand off for review (the worktree is `headrest-compartment-debug`).

---

## Post-merge / deploy notes (not implementation steps)

- Code-only; **no migration**. Deploy the **POS** bundle (the configurator change is client-side); the API/shared change is display + geometry config only and does not alter server recompute. Remind Loo to hard-refresh the PWA after the POS deploy.
- Loo, after deploy: (a) set the per-Model `HEADREST` price in the allowed-options pricing editor if not already set; (b) optionally upload the real `HEADREST` PNG in Maintenance to replace the STOOL placeholder (no code change needed — `resolveModuleArtSrc` prefers the uploaded `imageUrl`).
