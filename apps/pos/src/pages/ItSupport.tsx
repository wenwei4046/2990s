// ----------------------------------------------------------------------------
// ItSupport — staff report a problem to IT, follow it, reply, confirm the fix.
// Same function as Houzs ERP's IT Support page, over the same hub (see
// lib/it-support.ts). Three views in one page: my requests, report a problem,
// one request. Houzs target only; anywhere else it bounces to the catalog.
// ----------------------------------------------------------------------------
import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy, Paperclip } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { IS_HOUZS } from '../lib/apiClient';
import {
  IT_ACCEPT, IT_KINDS, IT_MAX_FILES, IT_URGENCY, itAddFiles, itConfirmFixed, itGetRequest, itLabel, itListRequests,
  itOpenFile, itSendReply, itSendRequest, itStatusText, itStepLine, type ItFileRef,
} from '../lib/it-support';
import styles from './ItSupport.module.css';

const when = (iso: string) => new Date(iso).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Please try again in a moment.');

function Files({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <div className={styles.files}>
      <input
        ref={input} type="file" multiple accept={IT_ACCEPT} hidden
        onChange={(e) => {
          const r = itAddFiles(files, e.target.files);
          e.target.value = '';
          if ('refused' in r) return setRefused(r.refused);
          setRefused(null);
          onChange(r.files);
        }}
      />
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className={styles.chip}>
          {f.name}
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => { setRefused(null); onChange(files.filter((_, j) => j !== i)); }}>×</button>
        </span>
      ))}
      {files.length < IT_MAX_FILES && (
        <Button type="button" variant="ghost" onClick={() => input.current?.click()}>
          <Paperclip size={16} strokeWidth={1.75} /> Add a screenshot or file
        </Button>
      )}
      <p className={styles.hint}>Pictures, MP4 or MOV video, PDF or ZIP. Up to {IT_MAX_FILES} files, 10 MB each.</p>
      {refused && <p role="alert" className={styles.error}>{refused}</p>}
    </div>
  );
}

function NewRequest({ onSent }: { onSent: (code: string) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('bug');
  const [urgency, setUrgency] = useState('medium');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set('title', title.trim());
      form.set('description', description.trim());
      form.set('type', kind);
      form.set('priority', urgency);
      form.set('occurred_at', new Date().toISOString());
      form.set('page_url', window.location.href);
      for (const f of files) form.append('files', f, f.name);
      return itSendRequest(form);
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['it-support'] }); onSent(r.code); },
    onError: (e) => setError(msg(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (send.isPending) return;
    if (!title.trim()) return setError('Say in a few words what the problem is.');
    setError(null);
    send.mutate();
  };
  return (
    <form className={styles.card} onSubmit={submit}>
      <label className={styles.field}>
        <span className="t-eyebrow">What is the problem?</span>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="The order will not save" required />
      </label>
      <label className={styles.field}>
        <span className="t-eyebrow">Details</span>
        <textarea value={description} maxLength={10000} rows={5} onChange={(e) => setDescription(e.target.value)}
          placeholder="What you did, what you expected, and what happened instead." />
      </label>
      <label className={styles.field}>
        <span className="t-eyebrow">Kind of request</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {IT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span className="t-eyebrow">How urgent</span>
        <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          {IT_URGENCY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className={styles.field}>
        <span className="t-eyebrow">Screenshots</span>
        <Files files={files} onChange={setFiles} />
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <Button type="submit" size="lg" fullWidth disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send to IT'}</Button>
    </form>
  );
}

function OneRequest({ code }: { code: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['it-support', code], queryFn: () => itGetRequest(code), refetchInterval: 30_000 });
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Reading a request marks it seen on the hub, so the list's "New reply" moves.
  const refresh = () => Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ['it-support', 'list'] })]);
  const sendReply = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (reply.trim()) form.set('body', reply.trim());
      for (const f of files) form.append('files', f, f.name);
      return itSendReply(code, form);
    },
    onSuccess: () => { setReply(''); setFiles([]); void refresh(); },
    onError: (e) => setError(msg(e)),
  });
  const confirm = useMutation({ mutationFn: () => itConfirmFixed(code), onSuccess: () => void refresh(), onError: (e) => setError(msg(e)) });
  const openFile = useMutation({ mutationFn: (a: ItFileRef) => itOpenFile(a), onError: (e) => setError(msg(e)) });

  if (!q.data) {
    return q.isError ? (
      <div className={styles.card}>
        <p role="alert" className={styles.error}>{msg(q.error)}</p>
        <Button type="button" variant="ghost" onClick={() => void q.refetch()}>Retry</Button>
      </div>
    ) : <p className={styles.hint}>Loading…</p>;
  }
  const { ticket: t, events } = q.data;
  const closed = t.status === 'closed' || t.status === 'rejected';
  const busy = sendReply.isPending || confirm.isPending || openFile.isPending;
  return (
    <>
      <div className={styles.card}>
        <div className={styles.row}><span className={styles.code}>{t.code}</span><span className={styles.badge}>{itStatusText(t.status)}</span></div>
        <h2 className="t-h3">{t.title}</h2>
        <p className={styles.hint}>{itLabel(t.type)} · {itLabel(t.priority)} · {t.assignee_name ? `Handled by ${t.assignee_name}` : 'Not picked up yet'}</p>
        {t.description && <p className={styles.body}>{t.description}</p>}
        {t.status === 'resolved' && (
          <>
            <p className="t-body">IT has marked this as done. If it is fixed, confirm to close it. If not, reply below and it goes back to IT.</p>
            <Button type="button" disabled={busy} onClick={() => { setError(null); confirm.mutate(); }}>
              {confirm.isPending ? 'Closing…' : 'Yes, it is fixed'}
            </Button>
          </>
        )}
      </div>
      <div className={styles.card}>
        {events.map((s) => (
          <div key={s.id} className={styles.step}>
            <p className="t-body">
              <strong>{s.author_kind === 'reporter' ? 'You' : s.author_name}</strong> {itStepLine(s)}{' '}
              <span className={styles.hint}>{when(s.created_at)}</span>
            </p>
            {s.body && <p className={styles.body}>{s.body}</p>}
            {s.attachments.map((a) => (
              <Button key={a.id} type="button" variant="ghost" disabled={busy} onClick={() => { setError(null); openFile.mutate(a); }}>
                <Paperclip size={16} strokeWidth={1.75} /> {a.filename}
              </Button>
            ))}
          </div>
        ))}
      </div>
      {closed ? (
        <p className={styles.hint}>This request is closed. If the problem is back, report it again.</p>
      ) : (
        <form className={styles.card} onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (!reply.trim() && files.length === 0) return setError('Write a reply or attach a file.');
          setError(null);
          sendReply.mutate();
        }}>
          <label className={styles.field}>
            <span className="t-eyebrow">Reply to IT</span>
            <textarea value={reply} maxLength={10000} rows={3} onChange={(e) => setReply(e.target.value)} />
          </label>
          <Files files={files} onChange={setFiles} />
          <Button type="submit" disabled={busy}>{sendReply.isPending ? 'Sending…' : 'Send reply'}</Button>
        </form>
      )}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </>
  );
}

function RequestList({ onOpen }: { onOpen: (code: string) => void }) {
  const q = useQuery({ queryKey: ['it-support', 'list'], queryFn: itListRequests, refetchInterval: 60_000 });
  if (!q.data) {
    return q.isError ? (
      <div className={styles.card}>
        <p role="alert" className={styles.error}>{msg(q.error)}</p>
        <Button type="button" variant="ghost" onClick={() => void q.refetch()}>Retry</Button>
      </div>
    ) : <p className={styles.hint}>Loading…</p>;
  }
  if (q.data.length === 0) {
    return (
      <div className={styles.card}>
        <LifeBuoy size={28} strokeWidth={1.75} />
        <h2 className="t-h3">Nothing sent to IT yet.</h2>
        <p className="t-body fg-muted">When something in the system is not working, or you need a change, report it here. IT replies on this page.</p>
      </div>
    );
  }
  return (
    <>
      {q.data.map((r) => (
        <button key={r.code} type="button" className={`${styles.card} ${styles.item}`} onClick={() => onOpen(r.code)}>
          <span className={styles.row}>
            <span className={styles.code}>{r.code}</span>
            {r.unread && <span className={styles.badge}>New reply</span>}
            <span className={styles.badge}>{itStatusText(r.status)}</span>
          </span>
          <span className={r.unread ? styles.titleNew : styles.title}>{r.title}</span>
          <span className={styles.hint}>
            {itLabel(r.priority)} · {r.assignee_name ?? 'Not picked up yet'} · updated {when(r.updated_at)}
          </span>
        </button>
      ))}
    </>
  );
}

type View = { v: 'list' } | { v: 'new' } | { v: 'one'; code: string };

export const ItSupport = () => {
  const [view, setView] = useState<View>({ v: 'list' });
  if (!IS_HOUZS) return <Navigate to="/catalog" replace />;
  const toList = () => setView({ v: 'list' });
  return (
    <main className={styles.shell}>
      <div className={styles.col}>
        <header className={styles.head}>
          {view.v === 'list' ? (
            <Link to="/catalog" className={styles.back}><ArrowLeft size={18} strokeWidth={1.75} /> Back to products</Link>
          ) : (
            <button type="button" className={styles.back} onClick={toList}><ArrowLeft size={18} strokeWidth={1.75} /> All my requests</button>
          )}
          <h1 className="t-h2">{view.v === 'new' ? 'Report a problem' : view.v === 'one' ? 'IT request' : 'IT Support'}</h1>
          {view.v === 'list' && <Button type="button" onClick={() => setView({ v: 'new' })}>Report a problem</Button>}
        </header>
        {view.v === 'new' ? <NewRequest onSent={(code) => setView({ v: 'one', code })} />
          : view.v === 'one' ? <OneRequest key={view.code} code={view.code} />
          : <RequestList onOpen={(code) => setView({ v: 'one', code })} />}
      </div>
    </main>
  );
};
