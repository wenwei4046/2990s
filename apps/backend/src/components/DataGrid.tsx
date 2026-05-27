// DataGrid — reusable AutoCount-style data grid primitive.
//
// Built for high-density ERP list views (Sales Orders, Purchase Orders, etc.).
// Features:
//   - Drag column headers to reorder
//   - Right-click header → context menu (hide / pin left / auto-fit width)
//   - Resize columns via right-edge drag handle
//   - Sort: click sort arrow per column (asc / desc / off)
//   - Global search across all string-coercible cells
//   - Group-by zone: drag a column header onto the banner to group rows;
//     multiple group levels supported; rows collapse with caret
//   - Layout persisted to localStorage[storageKey]:
//       { order, hidden, widths, groupBy, sort }
//   - Sticky header. Density: row height ~28px, body fs-12, header fs-10
//     uppercase letter-spacing 0.06em.
//
// Pure React + HTML5 drag-and-drop. No new deps.
//
// The toolbar (New / Edit / View / etc.) is rendered by the calling page —
// DataGrid keeps the search box on the right of its own toolbar slot and
// accepts arbitrary toolbar children on the left.

import {
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Search } from 'lucide-react';
import styles from './DataGrid.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

export type DataGridColumn<T> = {
  key: string;
  label: string;
  accessor: (row: T) => ReactNode;
  /** default width in px */
  width?: number;
  minWidth?: number;
  align?: 'left' | 'right';
  sortable?: boolean;
  groupable?: boolean;
  sortFn?: (a: T, b: T) => number;
  /** value used when grouping (defaults to String(accessor(row))) */
  groupValue?: (row: T) => string;
  /** value used by global search (defaults to String(accessor(row))) */
  searchValue?: (row: T) => string;
};

export type DataGridProps<T> = {
  rows: T[];
  columns: DataGridColumn<T>[];
  /** localStorage key for column layout persistence */
  storageKey: string;
  /** row id accessor — required for selection + key */
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  onRowDoubleClick?: (row: T) => void;
  onSelectionChange?: (rows: T[]) => void;
  toolbar?: ReactNode;
  /** controlled focus for the "Find" button — bump to focus the search box */
  focusSearchNonce?: number;
  /** show "Drag a column header here to group by that column" banner */
  groupBanner?: boolean;
  emptyMessage?: string;
  isLoading?: boolean;
};

type Layout = {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
  groupBy: string[];
  pinned: string[];
  sort: { key: string; dir: 'asc' | 'desc' } | null;
};

const DEFAULT_LAYOUT: Layout = {
  order: [],
  hidden: [],
  widths: {},
  groupBy: [],
  pinned: [],
  sort: null,
};

function readLayout(key: string): Layout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<Layout>;
    return { ...DEFAULT_LAYOUT, ...parsed };
  } catch { return DEFAULT_LAYOUT; }
}
function writeLayout(key: string, layout: Layout) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(layout)); } catch { /* quota */ }
}

const coerceSearchString = (v: ReactNode): string => {
  if (v == null || v === false) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  // for ReactNode (e.g., a span with a pill), best-effort: skip — caller can supply searchValue
  return '';
};

export function DataGrid<T>({
  rows,
  columns,
  storageKey,
  rowKey,
  searchPlaceholder = 'Search…',
  onRowDoubleClick,
  onSelectionChange,
  toolbar,
  focusSearchNonce,
  groupBanner = true,
  emptyMessage = 'No data.',
  isLoading = false,
}: DataGridProps<T>) {
  const [layout, setLayoutRaw] = useState<Layout>(() => readLayout(storageKey));
  const setLayout = useCallback((updater: (l: Layout) => Layout) => {
    setLayoutRaw((prev) => {
      const next = updater(prev);
      writeLayout(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [ctx, setCtx] = useState<{ x: number; y: number; colKey: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [groupZoneActive, setGroupZoneActive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Refocus search when parent bumps focusSearchNonce ("Find" button).
  useEffect(() => {
    if (focusSearchNonce != null) searchRef.current?.focus();
  }, [focusSearchNonce]);

  // Close context menu on outside click.
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctx]);

  // ── Resolve visible/ordered columns ───────────────────────────────
  const visibleColumns = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const order = layout.order.length
      ? [...layout.order.filter((k) => byKey.has(k)), ...columns.filter((c) => !layout.order.includes(c.key)).map((c) => c.key)]
      : columns.map((c) => c.key);
    return order
      .filter((k) => !layout.hidden.includes(k))
      .map((k) => byKey.get(k)!)
      .filter(Boolean);
  }, [columns, layout.order, layout.hidden]);

  // ── Filtered + sorted + grouped rows ──────────────────────────────
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((c) => {
        const sv = c.searchValue ? c.searchValue(row) : coerceSearchString(c.accessor(row));
        return sv.toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, search]);

  const sortedRows = useMemo(() => {
    if (!layout.sort) return filteredRows;
    const col = columns.find((c) => c.key === layout.sort!.key);
    if (!col) return filteredRows;
    const cmp = col.sortFn ?? ((a: T, b: T) => {
      const va = coerceSearchString(col.accessor(a));
      const vb = coerceSearchString(col.accessor(b));
      // numeric-aware
      const na = Number(va), nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb) && va !== '' && vb !== '') return na - nb;
      return va.localeCompare(vb);
    });
    const dir = layout.sort.dir === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => cmp(a, b) * dir);
  }, [filteredRows, columns, layout.sort]);

  // Selection callback when row changes.
  useEffect(() => {
    if (!onSelectionChange) return;
    if (selectedKey == null) { onSelectionChange([]); return; }
    const found = rows.find((r) => rowKey(r) === selectedKey);
    onSelectionChange(found ? [found] : []);
  }, [selectedKey, rows, rowKey, onSelectionChange]);

  // ── Group rendering ───────────────────────────────────────────────
  // Multi-level groups produced as a flat list of render instructions.
  type Render =
    | { kind: 'group'; level: number; path: string; label: string; count: number; collapsed: boolean }
    | { kind: 'row'; row: T };

  const renderList: Render[] = useMemo(() => {
    if (layout.groupBy.length === 0) return sortedRows.map((row) => ({ kind: 'row' as const, row }));

    const out: Render[] = [];
    const groupKeys = layout.groupBy
      .map((k) => columns.find((c) => c.key === k))
      .filter((c): c is DataGridColumn<T> => Boolean(c));

    const buildGroupValue = (col: DataGridColumn<T>, row: T): string => {
      if (col.groupValue) return col.groupValue(row);
      return coerceSearchString(col.accessor(row)) || '(blank)';
    };

    // Tree-style traversal
    type Node = { value: string; rows: T[]; children: Map<string, Node> };
    const root: Node = { value: '', rows: [], children: new Map() };
    for (const row of sortedRows) {
      let node = root;
      for (const col of groupKeys) {
        const v = buildGroupValue(col, row);
        if (!node.children.has(v)) node.children.set(v, { value: v, rows: [], children: new Map() });
        node = node.children.get(v)!;
      }
      node.rows.push(row);
    }

    // Recursively count rows under a node (direct + descendants).
    const collectRows = (node: Node): T[] => {
      const acc: T[] = [...node.rows];
      for (const child of node.children.values()) acc.push(...collectRows(child));
      return acc;
    };

    const walk = (node: Node, level: number, parentPath: string) => {
      for (const child of node.children.values()) {
        const path = parentPath ? `${parentPath} ${child.value}` : child.value;
        const totalRows = collectRows(child).length;
        const collapsed = collapsedGroups.has(path);
        const groupCol = groupKeys[level];
        const groupLabel = groupCol ? groupCol.label : '';
        out.push({ kind: 'group', level, path, label: `${groupLabel}: ${child.value}`, count: totalRows, collapsed });
        if (!collapsed) {
          if (level + 1 < groupKeys.length) walk(child, level + 1, path);
          else for (const row of child.rows) out.push({ kind: 'row', row });
        }
      }
    };
    walk(root, 0, '');
    return out;
  }, [sortedRows, layout.groupBy, columns, collapsedGroups]);

  // ── Column DnD (reorder) ──────────────────────────────────────────
  const onDragStartHeader = (e: DragEvent<HTMLTableCellElement>, key: string) => {
    e.dataTransfer.setData('text/x-datagrid-col', key);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOverHeader = (e: DragEvent<HTMLTableCellElement>, key: string) => {
    e.preventDefault();
    setDropTarget(key);
  };
  const onDropHeader = (e: DragEvent<HTMLTableCellElement>, targetKey: string) => {
    e.preventDefault();
    setDropTarget(null);
    const sourceKey = e.dataTransfer.getData('text/x-datagrid-col');
    if (!sourceKey || sourceKey === targetKey) return;
    setLayout((l) => {
      const orderNow = (l.order.length ? l.order : columns.map((c) => c.key)).filter((k) => k !== sourceKey);
      const idx = orderNow.indexOf(targetKey);
      orderNow.splice(idx, 0, sourceKey);
      return { ...l, order: orderNow };
    });
  };

  // ── Group-by drop zone ───────────────────────────────────────────
  const onGroupZoneDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setGroupZoneActive(true);
  };
  const onGroupZoneDragLeave = () => setGroupZoneActive(false);
  const onGroupZoneDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setGroupZoneActive(false);
    const sourceKey = e.dataTransfer.getData('text/x-datagrid-col');
    if (!sourceKey) return;
    const col = columns.find((c) => c.key === sourceKey);
    if (!col || col.groupable === false) return;
    setLayout((l) => l.groupBy.includes(sourceKey) ? l : { ...l, groupBy: [...l.groupBy, sourceKey] });
  };
  const removeGroup = (key: string) =>
    setLayout((l) => ({ ...l, groupBy: l.groupBy.filter((k) => k !== key) }));

  // ── Column resize ────────────────────────────────────────────────
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const onResizeStart = (e: MouseEvent<HTMLDivElement>, key: string, currentW: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startW: currentW };
    const onMove = (ev: globalThis.MouseEvent) => {
      const r = resizingRef.current; if (!r) return;
      const delta = ev.clientX - r.startX;
      const next = Math.max(40, r.startW + delta);
      setLayoutRaw((prev) => ({ ...prev, widths: { ...prev.widths, [r.key]: next } }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // persist final widths
      setLayoutRaw((prev) => { writeLayout(storageKey, prev); return prev; });
      resizingRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Header context menu actions ──────────────────────────────────
  const hideColumn = (key: string) =>
    setLayout((l) => ({ ...l, hidden: l.hidden.includes(key) ? l.hidden : [...l.hidden, key] }));
  const showColumn = (key: string) =>
    setLayout((l) => ({ ...l, hidden: l.hidden.filter((k) => k !== key) }));
  const pinLeft = (key: string) =>
    setLayout((l) => {
      // pin = move to front of order
      const orderNow = (l.order.length ? l.order : columns.map((c) => c.key)).filter((k) => k !== key);
      orderNow.unshift(key);
      return { ...l, order: orderNow };
    });
  const autoFit = (key: string) => {
    // ~8.5px per character heuristic — good enough without measuring DOM.
    const col = columns.find((c) => c.key === key);
    if (!col) return;
    let max = col.label.length;
    for (const row of rows) {
      const s = coerceSearchString(col.accessor(row));
      if (s.length > max) max = s.length;
    }
    const w = Math.max(60, Math.min(420, Math.round(max * 7.5 + 20)));
    setLayout((l) => ({ ...l, widths: { ...l.widths, [key]: w } }));
  };
  const resetLayout = () => setLayout(() => DEFAULT_LAYOUT);

  // ── Sort handlers ─────────────────────────────────────────────────
  const toggleSort = (key: string) => {
    setLayout((l) => {
      if (!l.sort || l.sort.key !== key) return { ...l, sort: { key, dir: 'asc' } };
      if (l.sort.dir === 'asc') return { ...l, sort: { key, dir: 'desc' } };
      return { ...l, sort: null };
    });
  };

  // ── Group toggle ─────────────────────────────────────────────────
  const toggleGroup = (path: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });

  // ── Render ────────────────────────────────────────────────────────
  const totalCols = visibleColumns.length;
  const groupedCount = layout.groupBy.length;

  return (
    <div className={styles.root}>
      {/* Toolbar — caller's actions + global search */}
      <div className={styles.toolbar}>
        {toolbar}
        <div className={styles.toolbarSpacer} />
        <div className={styles.searchWrap}>
          <Search {...ICON} aria-hidden />
          <input
            ref={searchRef}
            className={styles.searchInput}
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Group-by zone */}
      {groupBanner && (
        <div
          className={`${styles.groupZone} ${groupZoneActive ? styles.groupZoneActive : ''}`}
          onDragOver={onGroupZoneDragOver}
          onDragLeave={onGroupZoneDragLeave}
          onDrop={onGroupZoneDrop}
        >
          {groupedCount === 0 ? (
            <span>Drag a column header here to group by that column.</span>
          ) : (
            <>
              <span>Grouped by:</span>
              {layout.groupBy.map((k) => {
                const c = columns.find((cc) => cc.key === k);
                return (
                  <span key={k} className={styles.groupChip}>
                    {c?.label ?? k}
                    <button className={styles.groupChipRemove} onClick={() => removeGroup(k)} title="Remove group">x</button>
                  </span>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Table */}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead className={styles.thead}>
            <tr>
              {visibleColumns.map((col) => {
                const w = layout.widths[col.key] ?? col.width ?? 140;
                const style: CSSProperties = { width: w, minWidth: col.minWidth ?? 40 };
                const isSorted = layout.sort?.key === col.key;
                const arrow = isSorted ? (layout.sort!.dir === 'asc' ? 'A' : 'V') : '';
                return (
                  <th
                    key={col.key}
                    className={`${styles.th} ${col.align === 'right' ? styles.thAlignRight : ''} ${dropTarget === col.key ? styles.thDragOver : ''}`}
                    style={style}
                    draggable
                    onDragStart={(e) => onDragStartHeader(e, col.key)}
                    onDragOver={(e) => onDragOverHeader(e, col.key)}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => onDropHeader(e, col.key)}
                    onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, colKey: col.key }); }}
                    title={col.label}
                  >
                    <span className={styles.thInner}>
                      {col.sortable !== false ? (
                        <button type="button" className={styles.sortBtn} onClick={(e) => { e.stopPropagation(); toggleSort(col.key); }}>
                          {col.label}
                          {arrow && <span className={styles.sortArrow}>{arrow === 'A' ? '^' : 'v'}</span>}
                        </button>
                      ) : col.label}
                    </span>
                    <div
                      className={styles.resizeHandle}
                      onMouseDown={(e) => onResizeStart(e, col.key, w)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={styles.tbody}>
            {isLoading && (
              <tr><td className={styles.empty} colSpan={totalCols || 1}>Loading…</td></tr>
            )}
            {!isLoading && renderList.length === 0 && (
              <tr><td className={styles.empty} colSpan={totalCols || 1}>{emptyMessage}</td></tr>
            )}
            {!isLoading && renderList.map((item, idx) => {
              if (item.kind === 'group') {
                return (
                  <tr key={`g-${item.path}`} className={styles.groupRow} onClick={() => toggleGroup(item.path)}>
                    <td className={styles.groupRowCell} colSpan={totalCols || 1} style={{ paddingLeft: 8 + item.level * 16 }}>
                      <span className={styles.groupCaret}>{item.collapsed ? '>' : 'v'}</span>
                      {item.label}
                      <span className={styles.groupCount}>({item.count})</span>
                    </td>
                  </tr>
                );
              }
              const row = item.row;
              const key = rowKey(row);
              return (
                <tr
                  key={`r-${key}-${idx}`}
                  className={`${styles.tr} ${selectedKey === key ? styles.trSelected : ''}`}
                  onClick={() => setSelectedKey(key)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                >
                  {visibleColumns.map((col) => {
                    const w = layout.widths[col.key] ?? col.width ?? 140;
                    return (
                      <td
                        key={col.key}
                        className={`${styles.td} ${col.align === 'right' ? styles.tdAlignRight : ''}`}
                        style={{ width: w, maxWidth: w }}
                      >
                        {col.accessor(row)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Status / footer */}
      <div className={styles.statusLine}>
        <span>{isLoading ? 'Loading…' : `${filteredRows.length} of ${rows.length} rows`}</span>
        <span>
          <button className={styles.tbarBtn} onClick={resetLayout} title="Reset column layout">Reset layout</button>
        </span>
      </div>

      {/* Context menu */}
      {ctx && (() => {
        const col = columns.find((c) => c.key === ctx.colKey);
        const hidden = layout.hidden.includes(ctx.colKey);
        const grouped = layout.groupBy.includes(ctx.colKey);
        return (
          <div className={styles.ctxMenu} style={{ top: ctx.y, left: ctx.x }} onClick={(e) => e.stopPropagation()}>
            <button className={styles.ctxItem} onClick={() => { hideColumn(ctx.colKey); setCtx(null); }}>Hide column</button>
            <button className={styles.ctxItem} onClick={() => { pinLeft(ctx.colKey); setCtx(null); }}>Pin left</button>
            <button className={styles.ctxItem} onClick={() => { autoFit(ctx.colKey); setCtx(null); }}>Auto-fit width</button>
            {col?.groupable !== false && (
              <button className={styles.ctxItem} onClick={() => {
                if (!grouped) setLayout((l) => ({ ...l, groupBy: [...l.groupBy, ctx.colKey] }));
                setCtx(null);
              }}>{grouped ? 'Already grouped' : 'Group by this column'}</button>
            )}
            {layout.hidden.length > 0 && (
              <>
                <div className={styles.ctxDivider} />
                <div style={{ padding: '4px 10px', color: 'var(--fg-muted)', fontSize: 'var(--fs-11)' }}>Hidden:</div>
                {layout.hidden.map((k) => {
                  const c = columns.find((cc) => cc.key === k);
                  return (
                    <button key={k} className={styles.ctxItem} onClick={() => { showColumn(k); setCtx(null); }}>
                      Show {c?.label ?? k}
                    </button>
                  );
                })}
              </>
            )}
            {hidden && (
              <button className={styles.ctxItem} onClick={() => { showColumn(ctx.colKey); setCtx(null); }}>
                Show column
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
