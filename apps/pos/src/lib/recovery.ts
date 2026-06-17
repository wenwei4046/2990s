// Detect a Supabase password-recovery session from the URL hash.
//
// The implicit-flow recovery link returns the user to
//   …/set-password#access_token=…&type=recovery&…
// supabase-js (detectSessionInUrl: true) strips that hash asynchronously, so the
// AuthProvider snapshots it synchronously at init via this helper. The matching
// `PASSWORD_RECOVERY` onAuthStateChange event is the runtime backup (lib/auth.tsx).
//
// We require BOTH `access_token` and `type=recovery`: a bare `#type=recovery`
// carries no real session (supabase-js ignores a tokenless hash), so trusting it
// would let a crafted link force a signed-in user onto the reset form. Demanding
// the token keeps genuine implicit-flow links working while rejecting that spoof.
//
// Kept as a per-app copy (Backend has its own) — apps must not import each other.
export const detectRecoveryInUrl = (
  hash: string = window.location.hash,
): boolean =>
  /(?:^|[#&])type=recovery(?:&|$)/.test(hash) &&
  /(?:^|[#&])access_token=/.test(hash);
