#!/usr/bin/env bash
# anchor-drift-check.sh — TIGHT-pair drift monitor for the 2990 ↔ Houzs SCM clone.
#
# The Houzs SCM is a near-byte clone of 2990's SCM (see docs/THREE-ERP-ANCHORING.md).
# This flags which shared backend routes have DRIFTED, so "who changed first"
# surfaces on demand instead of by accident. Diffs ignore import lines (the only
# legitimate clone difference: @2990s/* path rewrites), so the count is REAL
# logic drift. Sorted worst-first. Run it from anywhere.
#
# Usage:  bash scripts/anchor-drift-check.sh  [/path/to/2990s]  [/path/to/Houzs-ERP-cutover]
set -u

T="${1:-C:/Users/User/Desktop/2990s}"
H="${2:-C:/Users/User/Desktop/Houzs-ERP-cutover}"

# Shared SCM backend routes that should stay 1:1 (TIGHT tier). Auth/RBAC,
# POS, branding, and Houzs-only modules are intentionally excluded.
ROUTES="mfg-sales-orders delivery-orders-mfg sales-invoices mfg-purchase-orders \
grns purchase-invoices purchase-returns delivery-returns inventory suppliers mrp \
mrp-lead-times accounting sofa-combos stock-transfers stock-takes product-models \
consignment-orders consignment-notes outstanding document-flow"

printf '%-26s %8s %8s %s\n' "route" "2990" "houzs" "drift(non-import Δ lines)"
printf '%s\n' "--------------------------------------------------------------------"

total=0
for r in $ROUTES; do
  a="$T/apps/api/src/routes/$r.ts"
  b="$H/backend/src/scm/routes/$r.ts"
  if [ ! -f "$a" ] && [ ! -f "$b" ]; then continue; fi
  if [ ! -f "$a" ]; then printf '%-26s %8s %8s %s\n' "$r" "—" "yes" "MISSING in 2990"; continue; fi
  if [ ! -f "$b" ]; then printf '%-26s %8s %8s %s\n' "$r" "yes" "—" "MISSING in Houzs"; continue; fi
  la=$(grep -vc '^\s*import' "$a")
  lb=$(grep -vc '^\s*import' "$b")
  # changed non-import lines (both directions)
  d=$(diff <(grep -v '^\s*import' "$a") <(grep -v '^\s*import' "$b") 2>/dev/null | grep -c '^[<>]')
  total=$((total + d))
  flag=""
  if [ "$d" -eq 0 ]; then flag="✓ in sync"; elif [ "$d" -lt 30 ]; then flag="~ minor"; else flag="⚠ DRIFTED"; fi
  printf '%-26s %8s %8s %5s   %s\n' "$r" "$la" "$lb" "$d" "$flag"
done
printf '%s\n' "--------------------------------------------------------------------"
printf 'TOTAL drift (non-import changed lines across shared routes): %s\n' "$total"
echo "Tip: a high count on one route = re-sync candidate (port the ahead side → behind side)."
