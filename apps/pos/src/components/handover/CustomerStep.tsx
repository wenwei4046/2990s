import type { HandoverForm } from '../../lib/handover-helpers';

export const CustomerStep = (_p: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => <div>Customer step — TODO (Task 8)</div>;
