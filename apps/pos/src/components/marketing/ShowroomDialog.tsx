// Add showroom / Edit showroom — the Marketing section keeps its own showroom
// list (owner 2026-10-09: a record of what is on each floor, not the branch
// list the order form uses; migration 0218). Not in the design handoff, so it
// borrows the section's own dialog, field and button styles.
//
// Remove takes a showroom off the list without deleting it, and only once it
// has nothing on display and no open launch request — the server refuses
// otherwise, and the dialog says so before anyone tries.

import { useState } from 'react';
import { useRemoveShowroom, useSaveShowroom, type ShowroomOption } from '../../lib/marketing-api';
import s from './marketing.module.css';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const ShowroomDialog = ({ showroom, inUse, onClose, onSaved, onRemoved }: {
  /** The showroom to edit; absent to add one. */
  showroom?: ShowroomOption;
  /** What still points at it — Remove waits until both are 0. */
  inUse?: { pieces: number; open: number };
  onClose: () => void;
  onSaved: (saved: ShowroomOption, added: boolean) => void;
  onRemoved: (name: string) => void;
}) => {
  const [name, setName] = useState(showroom?.name ?? '');
  const [area, setArea] = useState(showroom?.area ?? '');
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  const save = useSaveShowroom();
  const remove = useRemoveShowroom();
  const pieces = inUse?.pieces ?? 0;
  const open = inUse?.open ?? 0;
  const busy = save.isPending || remove.isPending;

  const doSave = async () => {
    if (!name.trim()) { setErr('Give the showroom a name.'); return; }
    try {
      const saved = await save.mutateAsync({ id: showroom?.id, name: name.trim(), area: area.trim() });
      onSaved(saved, !showroom);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doRemove = async () => {
    if (!showroom) return;
    try {
      await remove.mutateAsync(showroom.id);
      onRemoved(showroom.name);
    } catch (e) {
      setConfirming(false);
      setErr((e as Error).message);
    }
  };

  if (confirming && showroom) {
    return (
      <div className={s.dialogScrim}>
        <div className={s.dialog} role="alertdialog" aria-label={`Remove ${showroom.name}?`}>
          <div className={s.dialogTitle}>Remove {showroom.name}?</div>
          <div className={s.dialogText}>It comes off the showroom list. Nothing is deleted — it stays on record.</div>
          <div className={s.dialogActions}>
            <button type="button" className={s.ghostBtn} onClick={() => setConfirming(false)}>Keep</button>
            <button type="button" className={s.dangerBtn} disabled={busy} onClick={() => void doRemove()}>Remove</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.dialogScrim}>
      <form
        className={s.dialog}
        role="dialog"
        aria-label={showroom ? 'Edit showroom' : 'Add showroom'}
        onSubmit={(e) => { e.preventDefault(); void doSave(); }}
      >
        <div className={s.dialogTitle}>{showroom ? 'Edit showroom' : 'Add showroom'}</div>
        <label className={s.field}>
          <span className={s.fieldLabel}>Name</span>
          <input
            className={s.input}
            value={name}
            maxLength={80}
            placeholder="Showroom KL"
            autoFocus
            onChange={(e) => { setName(e.target.value); setErr(''); }}
          />
        </label>
        <label className={s.field}>
          <span className={s.fieldLabel}>Area · optional</span>
          <input
            className={s.input}
            value={area}
            maxLength={120}
            placeholder="Petaling Jaya, Selangor"
            onChange={(e) => { setArea(e.target.value); setErr(''); }}
          />
        </label>
        {showroom && (pieces > 0 || open > 0) && (
          <div className={s.dialogNote}>
            To remove it, first clear its {[
              pieces ? plural(pieces, 'piece on display', 'pieces on display') : '',
              open ? plural(open, 'open launch request', 'open launch requests') : '',
            ].filter(Boolean).join(' and ')}.
          </div>
        )}
        {err && <div className={s.formError}>{err}</div>}
        <div className={`${s.dialogActions} ${showroom ? s.dialogActionsSplit : ''}`}>
          {showroom && (
            <button
              type="button"
              className={s.textDanger}
              disabled={busy || pieces > 0 || open > 0}
              onClick={() => { setErr(''); setConfirming(true); }}
            >
              Remove showroom
            </button>
          )}
          <span className={s.dialogActionsEnd}>
            <button type="button" className={s.ghostBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={s.primaryPill} disabled={busy}>{showroom ? 'Save' : 'Add showroom'}</button>
          </span>
        </div>
      </form>
    </div>
  );
};
