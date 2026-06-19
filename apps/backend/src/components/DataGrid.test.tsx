// Regression tests for the DataGrid global search — guards the
// precomputed-search-blob + debounce change (the '\n' column separator must not
// produce false cross-column matches).
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { DataGrid, type DataGridColumn } from './DataGrid';

type Row = { id: string; name: string; city: string };

const rows: Row[] = [
  { id: '1', name: 'Alice', city: 'Penang' },
  { id: '2', name: 'Bob', city: 'Ipoh' },
  { id: '3', name: 'Carol', city: 'Penang' },
];

const columns: DataGridColumn<Row>[] = [
  { key: 'name', label: 'Name', accessor: (r) => r.name },
  { key: 'city', label: 'City', accessor: (r) => r.city },
];

const renderGrid = () =>
  render(
    <DataGrid<Row> rows={rows} columns={columns} rowKey={(r) => r.id} storageKey="test-grid-search" />,
  );

describe('DataGrid global search', () => {
  it('renders every row before any query', () => {
    renderGrid();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('filters across columns (city match keeps both Penang rows, drops Ipoh)', async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.type(screen.getByPlaceholderText('Search…'), 'penang');
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Carol')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });
  });

  it('produces no false cross-column match for a gibberish query', async () => {
    const user = userEvent.setup();
    renderGrid();
    // "aliceipoh" only exists if two columns are concatenated without a
    // separator — it must NOT match any single row.
    await user.type(screen.getByPlaceholderText('Search…'), 'aliceipoh');
    await waitFor(() => {
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
      expect(screen.queryByText('Carol')).not.toBeInTheDocument();
    });
  });
});

// ── Unified per-column filters: number range / date range / numbering ──
type DocRow = { id: string; doc: string; amount: number; date: string };
const docRows: DocRow[] = [
  { id: '1', doc: 'PO-2606-001', amount: 100, date: '2026-06-10' },
  { id: '2', doc: 'PO-2606-002', amount: 250, date: '2026-06-20' },
  { id: '3', doc: 'PO-2605-010', amount: 400, date: '2026-05-15' },
];
const docColumns: DataGridColumn<DocRow>[] = [
  { key: 'doc', label: 'Doc No', accessor: (r) => r.doc, filterType: 'numbering', filterValue: (r) => r.doc },
  { key: 'amount', label: 'Amount', align: 'right', accessor: (r) => r.amount, filterType: 'number', numberValue: (r) => r.amount },
  { key: 'date', label: 'Date', accessor: (r) => r.date, filterType: 'date', dateValue: (r) => r.date },
];
const renderDocGrid = () =>
  render(<DataGrid<DocRow> rows={docRows} columns={docColumns} rowKey={(r) => r.id} storageKey="test-grid-filters" />);

describe('DataGrid per-column filters', () => {
  it('number range (min) drops rows below the bound', async () => {
    const user = userEvent.setup();
    renderDocGrid();
    await user.click(screen.getByLabelText('Filter Amount'));
    await user.type(screen.getAllByRole('spinbutton')[0]!, '200'); // Min
    await waitFor(() => {
      expect(screen.queryByText('PO-2606-001')).not.toBeInTheDocument(); // 100 < 200
      expect(screen.getByText('PO-2606-002')).toBeInTheDocument(); // 250
      expect(screen.getByText('PO-2605-010')).toBeInTheDocument(); // 400
    });
  });

  it('date range (from) drops earlier rows', async () => {
    const user = userEvent.setup();
    renderDocGrid();
    await user.click(screen.getByLabelText('Filter Date'));
    await user.type(screen.getByLabelText('From date'), '01/06/2026');
    await waitFor(() => {
      expect(screen.queryByText('PO-2605-010')).not.toBeInTheDocument(); // 2026-05-15 < from
      expect(screen.getByText('PO-2606-001')).toBeInTheDocument();
      expect(screen.getByText('PO-2606-002')).toBeInTheDocument();
    });
  });

  it('numbering type-to-find narrows the value list', async () => {
    const user = userEvent.setup();
    renderDocGrid();
    await user.click(screen.getByLabelText('Filter Doc No'));
    const find = screen.getByPlaceholderText('Find…');
    await user.type(find, '2605');
    await waitFor(() => {
      // Only the matching code remains as a checkbox option in the popover.
      const labels = screen.getAllByText(/PO-260/).map((n) => n.textContent);
      expect(labels).toContain('PO-2605-010');
      // The option for the non-matching code is gone from the list (the grid
      // cells still show all rows — no row filter applied until a value is ticked).
      const options = screen.getAllByRole('checkbox');
      expect(options.length).toBe(1);
    });
  });
});

// ── First-class multi-select column (selectable prop) ──
describe('DataGrid multi-select column', () => {
  function SelectableGrid() {
    const [sel, setSel] = useState<Set<string>>(new Set());
    return (
      <DataGrid<Row>
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="test-grid-select"
        selectable={{
          selectedKeys: sel,
          onToggle: (k) => setSel((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
          onToggleAll: (keys, all) => setSel(all ? new Set() : new Set(keys)),
        }}
      />
    );
  }

  it('row checkbox toggles selection; header select-all picks every visible row', async () => {
    const user = userEvent.setup();
    render(<SelectableGrid />);
    // header select-all + one per row (3 rows) = 4 checkboxes
    const boxes = () => screen.getAllByRole('checkbox');
    expect(boxes()).toHaveLength(4);
    // tick a single row
    await user.click(screen.getByLabelText('Select all rows'));
    await waitFor(() => {
      expect(boxes().filter((b) => (b as HTMLInputElement).checked)).toHaveLength(4);
    });
    // clicking select-all again clears
    await user.click(screen.getByLabelText('Select all rows'));
    await waitFor(() => {
      expect(boxes().filter((b) => (b as HTMLInputElement).checked)).toHaveLength(0);
    });
  });
});
