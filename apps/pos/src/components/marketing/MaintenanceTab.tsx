// Maintenance — the option lists Marketing keeps for its own forms (owner
// 2026-10-09). Fabric series, colour, leg and seat come from the SKU Master;
// the sofa Category → Function lists of the New product form have no such
// source, so they are kept here. Opened from ⋯ beside the section's tabs.
// Not in the design handoff, so it borrows the section's own card, chip and
// dialog styles.
//
// A category is edited in one dialog, its functions with it — rename, remove,
// add (owner 2026-10-10: the edit button must change the functions too, not
// only the name). Save sends the whole list at once (0221), so it is never
// left half-saved; Cancel leaves everything as it was.
//
// A launch request stores the names it was saved with, so renaming or
// removing an option changes what the form offers next — never a saved
// request.

import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import {
  useRemoveSofaOption, useSaveSofaCategory, type MarketingState, type SofaCategoryOption,
} from '../../lib/marketing-api';
import s from './marketing.module.css';

/** The category the dialog edits (null adds one), and where the cursor
 *  starts: its name, a new function row, or the function clicked (its id). */
interface Editing { category: SofaCategoryOption | null; focus: 'name' | 'new' | string }

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
          <button type="button" className={s.addDisplayBtn} onClick={() => setEditing({ category: null, focus: 'name' })}>
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
                  type="button" className={s.miniIconBtn} title={`Edit ${c.name} and its functions`} aria-label={`Edit ${c.name}`}
                  onClick={() => setEditing({ category: c, focus: 'name' })}
                >
                  <Pencil size={16} strokeWidth={1.75} className={s.icon} />
                </button>
              </header>
              <span className={s.fieldLabel}>Functions</span>
              <div className={s.chipRow}>
                {c.functions.map((f) => (
                  <button
                    key={f.id} type="button" className={s.fnChip} title={`Rename or remove ${f.name}`}
                    onClick={() => setEditing({ category: c, focus: f.id })}
                  >
                    {f.name}
                  </button>
                ))}
                <button type="button" className={s.fnAdd} onClick={() => setEditing({ category: c, focus: 'new' })}>
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
        <CategoryDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onDone={(text) => { setEditing(null); toast(text); }}
        />
      )}
    </>
  );
};

/** A function in the dialog: one already on the list (its id), or a new one. */
interface FnRow { key: string; id: string | null; name: string; saved: string; removed: boolean }

let fnKey = 0;
const blankRow = (): FnRow => ({ key: `new-${++fnKey}`, id: null, name: '', saved: '', removed: false });

/** Add a category, or edit one: its name and every function under it. */
const CategoryDialog = ({ editing, onClose, onDone }: {
  editing: Editing;
  onClose: () => void;
  onDone: (toast: string) => void;
}) => {
  const cat = editing.category;
  const [init] = useState(() => {
    const kept = (cat?.functions ?? []).map((f): FnRow => ({ key: f.id, id: f.id, name: f.name, saved: f.name, removed: false }));
    // A new category starts with a row for its first function.
    const extra = editing.focus === 'new' || !cat ? blankRow() : null;
    const focus = editing.focus === 'new' ? extra!.key : editing.focus === 'name' ? null : editing.focus;
    return { rows: extra ? [...kept, extra] : kept, focus };
  });
  const [name, setName] = useState(cat?.name ?? '');
  const [rows, setRows] = useState<FnRow[]>(init.rows);
  /** The row the cursor goes to when it mounts; null is the name. */
  const [focusKey, setFocusKey] = useState<string | null>(init.focus);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  const save = useSaveSofaCategory();
  const remove = useRemoveSofaOption();
  const busy = save.isPending || remove.isPending;
  const title = cat ? 'Edit category' : 'Add category';

  const setRow = (key: string, p: Partial<FnRow>) => {
    setErr('');
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };
  /** A function already on the list is marked, so Save says what comes off
   *  and Undo can bring it back; a new one just goes. */
  const dropRow = (r: FnRow) => {
    if (r.id) setRow(r.key, { removed: true });
    else setRows((rs) => rs.filter((x) => x.key !== r.key));
  };
  const addRow = () => {
    const r = blankRow();
    setErr('');
    setRows((rs) => [...rs, r]);
    setFocusKey(r.key);
  };

  const kept = rows.filter((r) => !r.removed);
  const marked = rows.length - kept.length;

  const doSave = async () => {
    const n = name.trim();
    if (!n) { setErr('Give the category a name.'); return; }
    // A new row left empty is dropped; one already on the list needs a name.
    const live = kept.filter((r) => r.id || r.name.trim());
    if (live.some((r) => !r.name.trim())) { setErr('Give each function a name, or remove it.'); return; }
    const seen = new Set<string>();
    for (const r of live) {
      const k = r.name.trim().toLowerCase();
      if (seen.has(k)) { setErr(`${r.name.trim()} is on the list twice.`); return; }
      seen.add(k);
    }
    const functions = live.map((r) => (r.id ? { id: r.id, name: r.name.trim() } : { name: r.name.trim() }));
    const unchanged = cat && n === cat.name && functions.length === cat.functions.length
      && functions.every((f, i) => 'id' in f && f.id === cat.functions[i]!.id && f.name === cat.functions[i]!.name);
    if (unchanged) { onClose(); return; }
    try {
      await save.mutateAsync({ id: cat?.id ?? null, name: n, functions });
      onDone(cat ? `${n} saved` : `${n} added`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doRemove = async () => {
    if (!cat) return;
    try {
      await remove.mutateAsync(cat.id);
      onDone(`${cat.name} removed`);
    } catch (e) {
      setConfirming(false);
      setErr((e as Error).message);
    }
  };

  if (confirming && cat) {
    return (
      <div className={s.dialogScrim}>
        <div className={s.dialog} role="alertdialog" aria-label={`Remove ${cat.name}?`}>
          <div className={s.dialogTitle}>Remove {cat.name}?</div>
          <div className={s.dialogText}>
            {`It comes off the New product form${cat.functions.length ? `, with its ${plural(cat.functions.length, 'function', 'functions')}` : ''}.`}
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
      <form className={`${s.dialog} ${s.dialogTall}`} role="dialog" aria-label={title} onSubmit={(e) => { e.preventDefault(); void doSave(); }}>
        <div className={s.dialogTitle}>{title}</div>
        <label className={s.field}>
          <span className={s.fieldLabel}>Name</span>
          <input
            className={s.input}
            value={name}
            maxLength={60}
            placeholder="Seater"
            autoFocus={focusKey === null}
            onChange={(e) => { setName(e.target.value); setErr(''); }}
          />
        </label>
        <div className={s.field}>
          <span className={s.fieldLabel}>Functions</span>
          <div className={s.fnEditList}>
            {rows.map((r, i) => (r.removed ? (
              <div key={r.key} className={`${s.fnEditRow} ${s.fnEditRowGone}`}>
                <span className={s.fnGoneName}>{r.saved}</span>
                <span className={s.fnGoneTag}>Removed</span>
                <button type="button" className={s.fnUndo} onClick={() => setRow(r.key, { removed: false })}>Undo</button>
              </div>
            ) : (
              <div key={r.key} className={s.fnEditRow}>
                <input
                  className={`${s.input} ${s.fnEditInput}`}
                  value={r.name}
                  maxLength={60}
                  placeholder="Push back"
                  aria-label={`Function ${i + 1}`}
                  autoFocus={r.key === focusKey}
                  onChange={(e) => setRow(r.key, { name: e.target.value })}
                />
                <button
                  type="button" className={s.fnRemove} title="Remove"
                  aria-label={`Remove ${r.name.trim() || `function ${i + 1}`}`} onClick={() => dropRow(r)}
                >
                  <X size={16} strokeWidth={1.75} className={s.icon} />
                </button>
              </div>
            )))}
          </div>
          <button type="button" className={`${s.fnAdd} ${s.fnAddInline}`} onClick={addRow}>+ Add function</button>
          {marked > 0 && (
            <span className={s.dialogNote}>
              {marked === 1 ? 'The function marked Removed comes' : `The ${marked} functions marked Removed come`} off the New product form when you save. Requests already saved keep what they say.
            </span>
          )}
          {!kept.some((r) => r.id || r.name.trim()) && (
            <span className={s.maintHint}>A sofa request cannot be saved under this category until it has a function.</span>
          )}
        </div>
        {err && <div className={s.formError}>{err}</div>}
        <div className={`${s.dialogActions} ${cat ? s.dialogActionsSplit : ''}`}>
          {cat && (
            <button type="button" className={s.textDanger} disabled={busy} onClick={() => { setErr(''); setConfirming(true); }}>
              Remove category
            </button>
          )}
          <span className={s.dialogActionsEnd}>
            <button type="button" className={s.ghostBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={s.primaryPill} disabled={busy}>{cat ? 'Save' : 'Add category'}</button>
          </span>
        </div>
      </form>
    </div>
  );
};
