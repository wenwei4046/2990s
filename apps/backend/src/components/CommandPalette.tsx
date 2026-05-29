// ----------------------------------------------------------------------------
// Global Ctrl/Cmd+K command palette — jump to any module/page.
// Mounted once in Layout. Opens on Cmd/Ctrl+K (or the topbar "Search" trigger),
// filters NAV_ITEMS, arrow-keys to move, Enter to go, Esc to close.
// (Commander 2026-05-29 — UI/UX reorg, Hookka-style.)
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, CornerDownLeft } from 'lucide-react';
import { NAV_ITEMS, type NavItem } from '../lib/nav-items';
import styles from './CommandPalette.module.css';

export const CommandPalette = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<NavItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((it) =>
      `${it.label} ${it.group} ${it.keywords ?? ''}`.toLowerCase().includes(q),
    );
  }, [query]);

  // Reset + focus whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after paint so the input exists
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const go = (it: NavItem | undefined) => {
    if (!it) return;
    onClose();
    navigate(it.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={styles.searchRow}>
          <Search size={18} strokeWidth={1.75} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Jump to a module or page…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search modules"
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>

        <div className={styles.list} ref={listRef}>
          {results.length === 0 && <div className={styles.empty}>No matches for “{query}”.</div>}
          {results.map((it, i) => (
            <button
              key={it.path}
              type="button"
              className={`${styles.item} ${i === active ? styles.itemActive : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(it)}
            >
              <div className={styles.itemMain}>
                <span className={styles.itemLabel}>{it.label}</span>
                <span className={styles.itemGroup}>{it.group}</span>
              </div>
              {i === active && <CornerDownLeft size={14} strokeWidth={1.75} className={styles.enterHint} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
