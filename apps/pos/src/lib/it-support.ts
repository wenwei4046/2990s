// ----------------------------------------------------------------------------
// IT Support — report a problem to IT, follow it, reply, confirm the fix.
//
// Same function as Houzs ERP's IT Support page. The requests live in the Houzs
// IT Hub (support.houzscentury.com); Houzs's `/api/it-support/*` router is the
// only thing that talks to the hub. The POS calls that router with its Houzs
// session bearer + `X-Company-Id` (authedFetchRaw), so a request raised here
// lands in company 2's ("2990") hub inbox. Who is asking comes from the bearer on
// the server, never from anything this file sends.
//
// Houzs-target only: the 2990 API has no such route. Shapes and limits are
// copied from Houzs `frontend/src/lib/itSupport.ts` and `backend/src/routes/
// itSupport.ts` (nothing compiles against them — re-diff if the hub changes).
// ----------------------------------------------------------------------------
import { authedFetchRaw, houzsApiRoot, IS_HOUZS } from './apiClient';

export type ItStatus =
  | 'open' | 'in_progress' | 'on_hold' | 'testing' | 'waiting_reporter' | 'resolved' | 'closed' | 'rejected';

export interface ItRequestRow {
  code: string; type: string; priority: string; status: ItStatus; title: string;
  created_at: string; updated_at: string; assignee_name: string | null; unread: boolean;
}
export interface ItFileRef { id: number; event_id: number; filename: string; mime: string; size: number }
export interface ItStep {
  id: number; kind: 'created' | 'comment' | 'status' | 'assign' | 'priority' | 'type';
  author_kind: 'reporter' | 'developer' | 'system'; author_name: string;
  body: string | null; from_value: string | null; to_value: string | null; created_at: string;
  attachments: ItFileRef[];
}
export interface ItDetail {
  ticket: {
    code: string; type: string; priority: string; status: ItStatus; title: string; description: string;
    assignee_name: string | null; created_at: string; updated_at: string;
  };
  events: ItStep[];
}

/** How the person who SENT the request reads each state. */
const STATUS_TEXT: Record<ItStatus, string> = {
  open: 'Sent', in_progress: 'In progress', on_hold: 'On hold', testing: 'Being tested',
  waiting_reporter: 'Waiting for you', resolved: 'Done, please confirm', closed: 'Closed', rejected: 'Not going ahead',
};
/** The hub may grow a state this build has never heard of; show it as spelled. */
export const itStatusText = (s: string | null): string =>
  (s && s in STATUS_TEXT ? STATUS_TEXT[s as ItStatus] : s || 'a new state');

export const IT_KINDS = [['bug', 'Something is not working'], ['development', 'Ask for a change']] as const;
export const IT_URGENCY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const;
const LABELS: Record<string, string> = Object.fromEntries([
  ...IT_KINDS, ...IT_URGENCY, ['urgent', 'Urgent'],
]);
/** Kind or urgency as a label (IT may raise a request to urgent; the form does not offer it). */
export const itLabel = (v: string): string => LABELS[v] ?? v;

export function itStepLine(s: ItStep): string {
  if (s.kind === 'created') return 'sent this request';
  if (s.kind === 'status') return `changed it to ${itStatusText(s.to_value)}`;
  if (s.kind === 'assign') return s.to_value ? `gave it to ${s.to_value}` : 'took it off the person handling it';
  return 'replied';
}

export const IT_MAX_FILES = 5;
export const IT_MAX_BYTES = 10 * 1024 * 1024;
export const IT_ACCEPT = 'image/*,video/mp4,video/quicktime,application/pdf,.zip';
const itAccepted = (f: File) =>
  IT_ACCEPT.split(',').some((t) =>
    t.startsWith('.') ? f.name.toLowerCase().endsWith(t) : t.endsWith('/*') ? f.type.startsWith(t.slice(0, -1)) : f.type === t);

/** Adding files to an attachment list: the new list, or why it was refused. */
export function itAddFiles(current: File[], added: ArrayLike<File> | null): { files: File[] } | { refused: string } {
  const next = [...current, ...Array.from(added ?? [])];
  const odd = next.find((f) => !itAccepted(f));
  if (odd) return { refused: `${odd.name} is not a picture, MP4 or MOV video, PDF or ZIP.` };
  const big = next.find((f) => f.size > IT_MAX_BYTES);
  if (big) return { refused: `${big.name} is larger than 10 MB.` };
  if (next.length > IT_MAX_FILES) return { refused: `Attach at most ${IT_MAX_FILES} files.` };
  return { files: next };
}

/** The Houzs router answers `{ error }` in plain words; show that, not a status line. */
async function itFetch(path: string, init?: RequestInit): Promise<Response> {
  const root = houzsApiRoot();
  if (!IS_HOUZS || !root) throw new Error('IT Support is not available on this build.');
  const res = await authedFetchRaw(`/it-support${path}`, init, root);
  if (!res.ok) {
    let msg = 'IT Support could not be reached. Please try again in a moment.';
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === 'string' && j.error) msg = j.error;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res;
}
const itJson = async <T,>(path: string, init?: RequestInit) => (await itFetch(path, init)).json() as Promise<T>;

export const itListRequests = async () => (await itJson<{ tickets: ItRequestRow[] }>('/tickets')).tickets;
/** Reading one marks it seen on the hub. */
export const itGetRequest = (code: string) => itJson<ItDetail>(`/tickets/${encodeURIComponent(code)}`);
export const itSendRequest = (form: FormData) => itJson<{ code: string }>('/tickets', { method: 'POST', body: form });
export const itSendReply = (code: string, form: FormData) =>
  itJson(`/tickets/${encodeURIComponent(code)}/replies`, { method: 'POST', body: form });
export const itConfirmFixed = (code: string) =>
  itJson(`/tickets/${encodeURIComponent(code)}/confirm`, { method: 'POST' });
/** The download needs the Authorization header, which a plain link cannot send. */
export async function itOpenFile(a: ItFileRef): Promise<void> {
  const blob = await (await itFetch(`/attachments/${a.id}`)).blob();
  const url = URL.createObjectURL(new Blob([blob], { type: a.mime }));
  window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
