import type { HandoverForm } from '../../lib/handover-helpers';

export const ConfirmPaymentStep = (_p: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  subtotal: number;
  addonTotal: number;
}) => <div>Confirm payment step — TODO (Task 14)</div>;
