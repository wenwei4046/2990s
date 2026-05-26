// ----------------------------------------------------------------------------
// size-info — shared SIZE_INFO map + display helpers.
//
// Source of truth for what each bedframe / mattress size letter
// (K · Q · S · SS · SK · SP) maps to as a Malaysian-market label and
// physical width × length in centimetres. Used by the auto-SKU-generator
// preview, the Model Detail page's Allowed Options picker, the New Model
// dialog's inline picker, and the Maintenance pool list display.
//
// MUST stay aligned with the same map duplicated server-side in
// apps/api/src/routes/product-models.ts §SIZE_INFO — that one runs in
// Cloudflare Workers and can't import from this package directly.
// Forward-port goal: lift to packages/shared/ once a non-trivial second
// caller in workers appears.
// ----------------------------------------------------------------------------

export type SizeInfo = {
  /** Imperial label e.g. "6FT" — for SK / SP the label IS the dimensions
      ("200X200CM"), so `dim` is empty. */
  label: string;
  dim:   string;
  w:     number;  // width in cm
  l:     number;  // length in cm
};

export const SIZE_INFO: Record<string, SizeInfo> = {
  K:  { label: '6FT',       dim: '183X190CM', w: 183, l: 190 },
  Q:  { label: '5FT',       dim: '152X190CM', w: 152, l: 190 },
  S:  { label: '3FT',       dim: '90X190CM',  w: 90,  l: 190 },
  SS: { label: '3.5FT',     dim: '107X190CM', w: 107, l: 190 },
  SK: { label: '200X200CM', dim: '',          w: 200, l: 200 },
  SP: { label: '220X220CM', dim: '',          w: 220, l: 220 },
};

/** "K" → "K · 6FT · 183x190CM" — for pool list displays where commander
    wants to see what the bare letter actually unpacks to. SK/SP have label
    that IS dimensions, so the dim segment is dropped to avoid the awkward
    "SK · 200X200CM · " trailing-separator look. Unknown codes pass through
    unchanged. */
export function formatSizeRich(code: string): string {
  const info = SIZE_INFO[code];
  if (!info) return code;
  if (info.dim) return `${code} · ${info.label} · ${info.dim}`;
  return `${code} · ${info.label}`;
}
