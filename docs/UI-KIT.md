# UI-KIT

> System-wide UI contract for the 2990's Portal. Sits alongside `UI_REFERENCE.md`
> (which is the prototype-fidelity contract). Where this document and a module's
> own habits disagree, this document wins.

**State of this file (2026-07-27):** it currently holds **§1.5 only**. The
earlier sections (§1–§1.4, including the Information Hierarchy frozen as T1)
are **not present in this repository** — no `UI-KIT` document, no
`Current Action` / `Current Issues` component, and no collapsible left rail
exists on `main` or on this branch. §1.5 is written to be self-contained; when
§1.4 lands, the region names below (`identity`, `currentAction`) are the hooks
it plugs into.

---

## §1.5 — Drawer Structure Standardisation

### The rule

Every drawer in the system has the **same five regions in the same order**:

```
┌─────────────────────────────┐
│ Header          (sticky)    │  order number · customer name · close
├─────────────────────────────┤
│ Identity        (sticky)    │  what/who this record is
├─────────────────────────────┤
│ Current Action  (sticky)    │  what to do next — ALWAYS visible
├─────────────────────────────┤
│                             │
│ Content         (scrolls)   │  information · items · delivery ·
│                             │  payment · history · attachments
│                             │
├─────────────────────────────┤
│ Footer          (sticky)    │  primary action · secondary action
└─────────────────────────────┘
```

A module does **not** get to choose this order.

### How it is enforced

`packages/design-system/src/components/Drawer.tsx`.

The regions are **slot props**, not children:

```tsx
<Drawer
  title={so.docNo}              // Header — order number
  subtitle={so.customerName}    // Header — customer name
  onClose={close}               // Header — close button
  identity={<StatusStrip …/>}   // Identity
  currentAction={<NextStep …/>} // Current Action
  footer={<><Cancel/><Save/></>}// Footer
>
  {/* Content — the only scrollable region */}
</Drawer>
```

Because `children` maps to the content region and everything else is a named
slot, there is no arrangement of JSX that produces a different order. Passing
the props in a different order changes nothing (there is a test for this).

**Sticky is structural, not `position: sticky`.** The panel is a flex column,
the four chrome regions are `flex: 0 0 auto`, and only the content region has
`flex: 1 1 auto; min-height: 0; overflow-y: auto`. So "the header never
scrolls" is a property of the layout — a module cannot opt out of it by
forgetting something.

### Region rules

| Region | Required | Rule |
|---|---|---|
| Header | yes | Order/document number as `title`, customer/counterparty as `subtitle`, close button always rendered. Never scrolls. |
| Identity | optional | Sticky. What this record IS — status, counterparty, headline totals. |
| Current Action | optional | Sticky. **Must stay visible** — it never collapses, never scrolls away, never degrades to a bare icon. |
| Content | yes | The **only** scroller in the drawer. Everything else goes here. |
| Footer | optional | Sticky. Primary + secondary action. Never scrolls with content. |

**An omitted slot renders nothing at all** — no empty strip, no "None"
placeholder, no completed-state chrome. Same rule the information hierarchy
uses for sections with no content.

### Desktop / tablet / mobile

- **Tablet has no breakpoint of its own.** It takes the desktop values, so the
  hierarchy and panel proportions are identical.
- **Mobile (≤640px)** changes only the panel's *width* (full-bleed) and corner
  radius, plus a safe-area inset on the footer. It renders the **same DOM in
  the same order**, and every region keeps its sticky behaviour — including
  Current Action.

There is no responsive rule anywhere in the primitive that hides, collapses, or
re-orders a region.

### Widths

`width="sm" | "md" | "lg" | "xl" | "page"` → `420 / 560 / 720 / 960 / 1100px`,
each capped at 92–94vw. Mobile overrides all of them to 100vw.

### Two behaviours the primitive adds

Both follow from "only the content region scrolls" and from the drawer being a
modal surface. Flagging them because they are behaviour, not just layout:

1. **Escape closes the drawer** (same as clicking the scrim, which every
   migrated drawer already did). Suppressed by `dismissible={false}`.
2. **The page behind the drawer is scroll-locked** while it is open, so the
   wheel does not chain through to the list underneath once the content hits
   its end. The lock is reference-counted, so nested drawers behave.

`dismissible={false}` is the escape hatch for a drawer with a mutation in
flight — the scrim and Escape stop closing it, but the explicit close button
still works.

### What this card did NOT change

No business rules, no workflow, no queue, no dictionary, no API, no schema, no
new fields. Every migrated drawer keeps its exact form fields, validation,
mutations and copy — only the chrome around them moved.

### Adoption

Migrated to `<Drawer>` (18 drawers, 14 files):

| File | Drawer(s) |
|---|---|
| `components/PinDrawer.tsx` | Reset PIN / passcode |
| `components/DeliveryFieldsDrawer.tsx` | Edit HC fields |
| `components/WarehouseFormDrawer.tsx` | New / Edit warehouse |
| `pages/FlowDrawers.tsx` | `DrawerShell` → GRN, Purchase Invoice, Sales Order, Sales Invoice |
| `pages/DeliveryPlanningRegions.tsx` | New region |
| `pages/Users.tsx` | Invite user · Edit user |
| `pages/Suppliers.tsx` | New supplier |
| `pages/Currencies.tsx` | Add / Edit currency |
| `pages/Settings.tsx` | Supplier drawer · Driver drawer |
| `pages/Fleet.tsx` | New driver · New helper · New lorry |
| `pages/PurchaseOrders.tsx` | PO detail |
| `pages/Products.tsx` | New SKU · Product suppliers |
| `pages/Warehouse.tsx` | Rack detail |
| `pages/Inventory.tsx` | Stock breakdown · Warehouse form |

**Deliberately not migrated** (and why):

- **Dialogs, not drawers** — centred / height-capped panels with no full-height
  scroll region. `Products.tsx` `SpecialsHistoryDialog`,
  `MaintenanceHistoryDialog`, `ImportSkusDialog`; `Suppliers.tsx` batch-edit
  modal. §1.5 governs drawers; these need their own section.
- **`ProductModels.tsx` → embedded `ProductModelDetail`** — a full *page*
  rendered inside an overlay, with its own header and close affordance.
  Conforming it means restructuring the page component, which is page work, not
  drawer-chrome work.
- **POS `OrderStatus.tsx` order drawer** — already conforms structurally
  (`.detail` is a flex column, `.detailBody` is the only scroller, `.detailFoot`
  is pinned). It is left on its own POS-tuned styling; adopting the shared
  component would change the live tablet PWA's typography and spacing, which
  needs a visual sign-off first.

### Tests

`apps/backend/src/components/Drawer.structure.test.tsx` — 11 cases covering
region order (including prop-order independence), omitted-slot rendering, the
chrome-outside-the-scroller invariant, the scroll lock, dismissal, and the
dialog's accessible name.
