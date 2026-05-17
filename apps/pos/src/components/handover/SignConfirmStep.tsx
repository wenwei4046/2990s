import type { HandoverForm } from '../../lib/handover-helpers';

export const SignConfirmStep = (_p: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => <div>Sign &amp; confirm step — TODO (Task 15)</div>;
