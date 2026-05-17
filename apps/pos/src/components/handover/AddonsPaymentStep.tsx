import type { HandoverForm } from '../../lib/handover-helpers';
import type { AddonRow } from '../../lib/queries';

export const AddonsPaymentStep = (_p: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  addons: AddonRow[];
}) => <div>Add-ons &amp; payment step — TODO (Task 13)</div>;
