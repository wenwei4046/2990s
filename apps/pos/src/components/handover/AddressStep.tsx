import type { HandoverForm } from '../../lib/handover-helpers';
import type { LocalityRow } from '../../lib/queries';

export const AddressStep = (_p: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  localities: LocalityRow[];
}) => <div>Address step — TODO (Task 9)</div>;
