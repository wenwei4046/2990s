import type { HandoverForm } from '../../lib/handover-helpers';

export const TargetDateStep = (_p: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
}) => <div>Target date step — TODO (Task 12)</div>;
