# Mobile POS implementation and simulation verification

Date: 24 September 2026. Scope: adapt the existing POS for phone portrait while retaining the selling workflow, tablet layout, pricing helpers and production request contracts. No deployment or production order/payment was performed.

## Run the review version

```powershell
pnpm --filter @2990s/pos dev:simulation
```

Open `http://127.0.0.1:6288/catalog`. The review session is left at 390 × 844 in the in-app browser. The orange simulation notice identifies the local environment. Use any six digits for the simulated My Orders PIN; no real credentials are needed.

The simulation uses fictional products and customers and persists only in this browser's local storage. Select **Demo Customer** in the customer-name search to populate the required details. Sample codes are `PWP-DEMO-BED`, `PWP-DEMO-SOFA`, and `PROMO-DEMO-MATT`; used codes retain their normal local redemption state. The Home voucher is **DEMO HOME RM100**.

All API requests are intercepted before the application starts. External fetches and unhandled mutations are blocked; an unknown API route fails locally. A simulation-only Content Security Policy also restricts network destinations. No production key is supplied by this mode. Simulated proof uploads stay local. Confirmation copy and printed documents identify the simulation; no coordinator or customer notification is sent.

Simulation build output is `apps/pos/dist-simulation`, separate from the production `dist` directory. HMR is disabled in simulation so source edits do not reset an in-progress checkout; refresh deliberately after code changes.

For static simulation previews, external font imports are stripped so the isolated CSP does not block Vite's stylesheet preloader. Production fonts are unchanged. A same-Wi-Fi HTTP URL can display the mobile UI, but full camera/proof/checkout testing requires HTTPS (or the computer's localhost secure context) because these flows use browser cryptography APIs.

## Phone behavior

| Area | Implemented behavior |
| --- | --- |
| Navigation and catalog | Compact logo/cart/menu row, full-width search below it, and All/Mattress/Bedframe/Sofa/Accessories category icons. The redundant mobile series selector is removed. Sofa catalog prices explicitly say “Modules from”. |
| Mattress and bedframe | Compact footprint, stacked size/variant controls, visible selected price, PWP input, fabric/colour and special options, fixed Add action. |
| Modular sofa | Quick Pick and Customize retained; module/options sheet, tap to add, drag to position/snap, module selector, rotate/remove, upgrades and total. |
| Configuration state | Fabric/colour survive mode switching; leaving a changed configuration asks whether to keep configuring or discard. Successful Add/Save bypasses the warning. |
| Cart and quotes | Full configuration summaries, quantities, gift/PWP restrictions, editable lines, scrollable quote form and save/load workflow. |
| Checkout | Existing seven steps, single-column inputs, collapsible order summary, stable footer, camera/file proof controls, split transactions, signature area. |
| My Orders | Full-width header search and Option B compact Personal/Showroom (or Company) summary rows with expandable revenue details. Phone-sized detail dialog, focus containment, section jumps, editable permitted variants, payment ledger, balance collection and Proceed action. |
| Motion | 320ms page/step entrances, 280ms sheets and 100ms press feedback; reduced-motion rules. Fixed footers do not inherit entrance transforms. |
| Device sizing | Portrait rotation gate removed, zoom permitted, 16px phone form text, safe-area padding and dynamic viewport sizing. |

## Browser journeys verified

The app was operated through the visible local browser, including real UI clicks, file selection and signature drawing. Browser viewport checks are not physical iPhone/Android device certification.

1. **Mattress + PWP bedframe → order → balance payment.** Selected AKKA King at RM2,990; ARIA King PWP RM1,490 plus RM125 divan option; selected bedframe variants. Cart included the protector and two pillows. Total RM4,605 became RM4,505 after the RM100 Home voucher. Submitted two simulated transactions (six-month installment RM2,253 with proof and cash RM1,000), selected delivery/processing dates, signed, and created **DEMO-SO-0002**. My Orders accepted a simulated bank-transfer balance of RM1,252 with proof and showed **100% paid / three transactions**. Changed bedframe colour from BF-01 to BF-02, saved, and reopened to verify persistence. Proceed action and the SO view were reachable.
2. **Custom modular sofa → quote → order.** Added left/right arm modules, dragged to a valid snapped 210cm layout, rotated/restored a module, selected EZ/EZ002 and leg 6, switched modes, verified fabric/layout retention and Keep configuring. Added the RM4,105 build, saved and loaded the quote, then completed a cash 50% deposit of RM2,053 with address/date to be confirmed. Created **DEMO-SO-0003**. Receipt showed the component composition, EZ002 / SEAT 28 / LEG 6, and RM2,052 balance. Signature remained populated after changing viewport width.
3. **Quick Pick + PWP + accessory gift → quote.** Invalid code produced a local error. `PWP-DEMO-SOFA` changed the eligible layout from RM2,990 to RM1,990. CG colour, leg 6 and Sofa Full Fabric added to a RM2,240 cart; PWP quantity was locked. Added a pillow and applied the free-accessory campaign, returning the total to RM2,240. Saved **Phone PWP Demo** from a 360 × 500 viewport after the quote-form scroll fix.
4. **Responsive review.** Operated primary flows at 390 × 844 and 360 × 800; checked 430 × 932, short 360 × 500, tablet 1024 × 768 and desktop 1440 × 900. Measured no horizontal document overflow on the checked cart/configuration views. Original tablet two-pane sofa layout remained intact.
5. **Salesperson review fixes.** Fixed first-tap Continue losing its click when the footer moved after input blur; retested one-tap navigation. Fixed nested Sales/Houzs menu closing prematurely, clipped quote-entry space, sofa fabric loss on mode switching, incomplete sofa cart summaries, and an image containment rule that distorted sofa silhouettes. Replaced invalid nested Quick Pick buttons with independent native controls; browser retest confirmed selection and Edit in Customize work, zero nested buttons, and no new console errors.

## Automated validation

- Final POS unit/component suite: **500 tests across 40 files passed**.
- Simulation API tests cover create/idempotent retry, ledger and proof lifecycle, PWP/voucher/gifts, quote/cart persistence, TBC and grouped-sofa changes, swaps, payment validation and local unknown-route rejection.
- Transport tests verify local API routing, external request rejection, static asset allowance and fail-closed mutation behavior.
- Added component regressions cover mobile menu behavior, customer autofill, summary disclosure, signature resize and payment attachment controls.
- TypeScript and `build:simulation` passed; changed TypeScript/TSX lint has zero errors (existing warnings remain). `git diff --check` passed.
- A normal production build was deliberately stopped by the repository's existing guard because the local `.env` points to a localhost API. The guard was retained; production builds still require the normal production environment from CI. Nothing was deployed.

## 25 September layout refinement

My Orders now uses the selected Option B on phones. Verified both disclosures, order search/clear, month navigation, range controls, 360px/390px phone widths and the retained desktop cards at 1280px. Fixed a simulation-only sales-summary date filter discovered during review: August shows zero orders and September restores RM11,600 across three demonstration orders. All 17 simulation API tests and the simulation build passed. No order or payment was created or changed during this refinement.

## Practical limits

- Actual iOS Safari/Android Chrome camera permissions, virtual keyboard behavior and installed-PWA behavior still need a physical-device smoke test. The local browser verified responsive layout, file upload, pointer dragging and signature behavior.
- The simulator exercises the existing frontend contracts and shared rules; it does not prove every production backend integration or real payment-provider behavior. Live creation, payments and notifications were intentionally excluded.
- Draft protection is a leave-page warning, not recovery after a browser crash. The existing Quick Pick named Special Add-ons and CustomBuilder per-seat/fabric/leg/special-order paths are preserved; CustomBuilder did not previously expose the same named Special Add-ons picker.
- No commit, push or deployment was made. The local review server remains available while this task's development process is running.

## 25 September release verification

The owner subsequently authorized merge and production deployment, retaining tablet presentation. The release adds phone-only A status tabs with filtered counts, keyboard navigation and cross-status search links. Opening and closing an order preserves the selected tab. My Orders and Catalog keep their original in-page search and header steps at 768px and above; tablet checkout labels and payment controls also retain their previous appearance.

- Verified 360px phone tabs, search, empty states, month changes and detail return; verified the 1024px original KPI cards, search toolbar and three-column order board.
- Workspace tests passed: POS 503, Backend 89, Shared 787 and API 460 (the unchanged Shared/API suites used Turbo cache). ESLint passed after excluding generated `.dist` and `dist-simulation` bundles, alongside the existing `dist` exclusion.
- Fresh normal production POS build passed with the CI Houzs configuration. All 55 emitted text artifacts were scanned: no simulation fixtures, credentials, handlers or chunks; production bootstrap contains only the main application import. The manifest permits phone portrait and the update remains user-triggered through the existing PWA refresh prompt.
- No real order, payment, voucher redemption or customer update was submitted during release verification. Production delivery is tracked by the release PR and GitHub Actions deployment, rather than the earlier local-only status above.
