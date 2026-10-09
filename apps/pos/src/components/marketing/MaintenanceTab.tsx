// Maintenance — the option lists Marketing keeps for its own forms (owner
// 2026-10-09). Fabric series, colour, leg and seat come from the SKU Master;
// the sofa Category → Function lists of the New product form have no such
// source, so they are kept here. Opened from ⋯ beside the section's tabs.
// Not in the design handoff, so it borrows the section's own card, chip and
// dialog styles.
//
// A launch request stores the names it was saved with, so renaming or
// removing an option changes what the form offers next — never a saved
// request.

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import {
  useRemoveSofaOption, useSaveSofaOption, type MarketingState, type SofaCategoryOption,
} from '../../lib/marketing-api';
import s from './marketing.module.css';

type Editing =
  | { mode: 'add'; category: SofaCategoryOption | null }
  | { mode: 'edit'; id: string; name: string; category: SofaCategoryOption | null; functions: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const MaintenanceTab = ({ state, toast }: { state: MarketingState; toast: (t: string) => void }) => {
  const [editing, setEditing] = useState<Editing | null>(null);
  const cats = state.sofaOptions;

  return (
    <>
      <div className={s.maintWrap}>
        <div className={s.srHeader}>
          <div className={s.srHeaderText}>
            <span className={s.eyebrowBurnt}>New product form · Sofa</span>
            <h2 className={s.srTitle}>Category and function</h2>
            <span className={s.srSummary}>
              What the form offers under Category, and under each category, Function. A saved request keeps the names it was saved with.
            </span>
          </div>
          <button type="button" className={s.addDisplayBtn} onClick={() => setEditing({ mode: 'add', category: null })}>
            <Plus size={16} strokeWidth={1.75} className={s.icon} />Add category
          </button>
        </div>

        {cats.length === 0 && (
          <div className={s.emptyCard}>
            <div className={s.emptyCardTitle}>No categories yet.</div>
            <div className={s.emptyCardBody}>A sofa request needs a category and a function to save. Add a category, then its functions.</div>
          </div>
        )}

        <div className={s.maintGrid}>
          {cats.map((c) => (
            <section key={c.id} className={s.maintCard} aria-label={c.name}>
              <header className={s.maintCardHead}>
                <span className={s.maintName}>{c.name}</span>
                <span className={s.srCount}>{c.functions.length}</span>
                <span className={s.spacer} />
                <button
                  type="button" className={s.miniIconBtn} title={`Rename or remove ${c.name}`} aria-label={`Edit ${c.name}`}
                  onClick={() => setEditing({ mode: 'edit', id: c.id, name: c.name, category: null, functions: c.functions.length })}
                >
                  <Pencil size={16} strokeWidth={1.75} className={s.icon} />
                </button>
              </header>
              <span className={s.fieldLabel}>Functions</span>
              <div className={s.chipRow}>
                {c.functions.map((f) => (
                  <button
                    key={f.id} type="button" className={s.fnChip} title={`Rename or remove ${f.name}`}
                    onClick={() => setEditing({ mode: 'edit', id: f.id, name: f.name, category: c, functions: 0 })}
                  >
                    {f.name}
                  </button>
                ))}
                <button type="button" className={s.fnAdd} onClick={() => setEditing({ mode: 'add', category: c })}>
                  + Add function
                </button>
              </div>
              {c.functions.length === 0 && (
                <span className={s.maintHint}>No functions yet — a {c.name} request cannot be saved until it has one.</span>
              )}
            </section>
          ))}
        </div>
      </div>

      {editing && (
        <OptionDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onDone={(text) => { setEditing(null); toast(text); }}
        />
      )}
    </>
  );
};

/** Add, rename or remove one category or function — ShowroomDialog's shape. */
const OptionDialog = ({ editing, onClose, onDone }: {
  editing: Editing;
  onClose: () => void;
  onDone: (toast: string) => void;
}) => {
  const isEdit = editing.mode === 'edit';
  const cat = editing.category;
  const kind = cat ? 'function' : 'category';
  const [name, setName] = useState(isEdit ? editing.name : '');
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  const save = useSaveSofaOption();
  const remove = useRemoveSofaOption();
  const busy = save.isPending || remove.isPending;
  const title = `${isEdit ? 'Edit' : 'Add'} ${kind}${cat ? ` · ${cat.name}` : ''}`;

  const doSave = async () => {
    const n = name.trim();
    if (!n) { setErr(`Give the ${kind} a name.`); return; }
    try {
      await save.mutateAsync(isEdit ? { id: editing.id, name: n } : { categoryId: cat?.id ?? null, name: n });
      onDone(isEdit ? `${n} saved` : `${n} added`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doRemove = async () => {
    if (!isEdit) return;
    try {
      await remove.mutateAsync(editing.id);
      onDone(`${editing.name} removed`);
    } catch (e) {
      setConfirming(false);
      setErr((e as Error).message);
    }
  };

  if (confirming && isEdit) {
    return (
      <div className={s.dialogScrim}>
        <div className={s.dialog} role="alertdialog" aria-label={`Remove ${editing.name}?`}>
          <div className={s.dialogTitle}>Remove {editing.name}?</div>
          <div className={s.dialogText}>
            {cat
              ? `It comes off the ${cat.name} list in the New product form.`
              : `It comes off the New product form${editing.functions ? `, with its ${plural(editing.functions, 'function', 'functions')}` : ''}.`}
            {' '}Requests already saved keep what they say.
          </div>
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
      <form className={s.dialog} role="dialog" aria-label={title} onSubmit={(e) => { e.preventDefault(); void doSave(); }}>
        <div className={s.dialogTitle}>{title}</div>
        <label className={s.field}>
          <span className={s.fieldLabel}>Name</span>
          <input
            className={s.input}
            value={name}
            maxLength={60}
            placeholder={cat ? 'Push back' : 'Seater'}
            autoFocus
            onChange={(e) => { setName(e.target.value); setErr(''); }}
          />
        </label>
        {err && <div className={s.formError}>{err}</div>}
        <div className={`${s.dialogActions} ${isEdit ? s.dialogActionsSplit : ''}`}>
          {isEdit && (
            <button type="button" className={s.textDanger} disabled={busy} onClick={() => { setErr(''); setConfirming(true); }}>
              Remove {kind}
            </button>
          )}
          <span className={s.dialogActionsEnd}>
            <button type="button" className={s.ghostBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={s.primaryPill} disabled={busy}>{isEdit ? 'Save' : `Add ${kind}`}</button>
          </span>
        </div>
      </form>
    </div>
  );
};
