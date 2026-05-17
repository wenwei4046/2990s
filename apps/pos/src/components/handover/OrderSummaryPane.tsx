import type { CartLine } from '../../state/cart';
import type { HandoverForm } from '../../lib/handover-helpers';

interface FormPaneProps {
  mode: 'form';
  lines: CartLine[];
  form: HandoverForm;
  subtotal: number;
  addonTotal: number;
  total: number;
}
interface ReceiptPaneProps {
  mode: 'receipt';
  orderId: string;
  placedAt: string;
  lines: CartLine[];
  customer: { name: string; address?: string };
  delivery: { date?: string };
  payment: { method: string };
  paid: number;
}

export const OrderSummaryPane = (_p: FormPaneProps | ReceiptPaneProps) => (
  <aside style={{ background: 'var(--bg-alt)', padding: 'var(--space-4)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
    OrderSummaryPane stub (Task 7)
  </aside>
);
