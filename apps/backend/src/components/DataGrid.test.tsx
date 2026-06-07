// Regression tests for the DataGrid global search — guards the
// precomputed-search-blob + debounce change (the '\n' column separator must not
// produce false cross-column matches).
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
