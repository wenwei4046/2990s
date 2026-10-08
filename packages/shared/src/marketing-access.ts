// ----------------------------------------------------------------------------
// Who is the MARKETING account, and who may use the POS Marketing section.
//
// One predicate, read by two callers that must agree: the POS (which shows the
// sidebar section, opens /marketing and blocks "Complete order") and 2990's API
// (which stores the showroom displays and launch requests behind that section).
// If they disagreed, someone would see a page whose saves are refused, or be
// refused a page whose saves would work.
//
// ── THE MARKETING ACCOUNT ───────────────────────────────────────────────────
// Owner 2026-10-08: a special account, picked from the PIN-login dropdown, with
// exactly a salesperson's permissions PLUS the Marketing section, minus
// Maintain and OPEX — and it may NOT place an order. It is a Houzs member whose
// Title is "Sales Marketing": Houzs only lets a Title whose slug starts with
// `sales` into the PIN dropdown and the PIN door (routes/pos.ts), and an
// unmapped Sales title derives the plain `sales` POS role, which is the
// "same as sales" half for free.
//
// Houzs says so itself, as the capability `pos.marketing` on /auth/me
// (pmsAccess.isPosMarketingAccount over there): the Title named EXACTLY "Sales
// Marketing" once casing and spacing are normalised, in the sales cohort, and
// not the director tier. Exact, never a word match — the account reads a
// company's whole sales history, so a Title that merely contains the word must
// not inherit it. Until a Houzs build that answers is deployed the capability is
// ABSENT — and absent means "not answered", never "no" (the same tri-state every
// capability read in lib/houzs-perms.ts uses). Only then does the rule below run,
// on the facts /auth/me already carries.
// ----------------------------------------------------------------------------

/** The Houzs /auth/me capability that names the marketing account. */
export const POS_MARKETING_CAP = 'pos.marketing';

/** Houzs's director tier — "may see every salesperson's sales". Read here as
 *  the server-side stand-in for the POS's Maintain curator roles. */
export const SALES_VIEW_ALL_CAP = 'scm.sales.viewAll';

export interface MarketingCallerFacts {
  /** /auth/me `user.capabilities`. Missing key = not answered. */
  capabilities?: Readonly<Record<string, boolean>> | null;
  /** /auth/me `user.position_name` — the member's Title as shown in Houzs. */
  positionName?: string | null;
}

/** The marketing Title, normalised as Houzs normalises position names. */
const MARKETING_TITLE = 'sales marketing';

const normalisedTitle = (name: string | null | undefined): string =>
  (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Is this caller the marketing account?
 *
 * Houzs's answer wins whenever it gives one, true OR false. While it is
 * unanswered, Houzs's own rule runs on the facts /auth/me already carries: the
 * exact Title, and not a director or a non-sales Title by the capabilities
 * Houzs does answer (`org.director`, `org.sales.staff`).
 */
export function isMarketingMember(facts: MarketingCallerFacts | null | undefined): boolean {
  if (!facts) return false;
  const caps = facts.capabilities ?? {};
  const answered = caps[POS_MARKETING_CAP];
  if (typeof answered === 'boolean') return answered;
  return normalisedTitle(facts.positionName) === MARKETING_TITLE
    && caps['org.director'] !== true
    && caps['org.sales.staff'] !== false;
}
