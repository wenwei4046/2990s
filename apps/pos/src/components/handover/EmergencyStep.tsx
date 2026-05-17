import type { HandoverForm } from '../../lib/handover-helpers';

export const EmergencyStep = (_p: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => <div>Emergency step — TODO (Task 10)</div>;
