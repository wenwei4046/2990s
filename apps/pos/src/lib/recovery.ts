// Detect a Supabase password-recovery session from the URL hash.
//
// The implicit-flow recovery link returns the user to
//   …/set-password#access_token=…&type=recovery&…
// supabase-js (detectSessionInUrl: true) strips that hash asynchronously, so the
// AuthProvider snapshots it synchronously at init via this helper. The matching
// `PASSWORD_RECOVERY` onAuthStateChange event is the runtime backup (lib/auth.tsx).
//
// Kept as a per-app copy (Backend has its own) — apps must not import each other.
export const detectRecoveryInUrl = (
  hash: string = window.location.hash,
): boolean => /(?:^|[#&])type=recovery(?:&|$)/.test(hash);
