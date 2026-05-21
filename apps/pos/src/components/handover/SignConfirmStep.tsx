import type { Ref } from 'react';
import { Check } from 'lucide-react';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import type { HandoverForm } from '../../lib/handover-helpers';
import styles from '../../pages/Handover.module.css';

export const SignConfirmStep = ({
  form, update, signatureRef,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  signatureRef: Ref<SignaturePadHandle>;
}) => (
  <section className={styles.stepBody}>
    <h2 className={styles.stepTitle}>Sign &amp; confirm</h2>
    <p className={styles.stepLead}>
      Final step — customer reviews the order on the right and signs below to confirm.
    </p>

    <SignaturePad
      ref={signatureRef}
      onChange={(signed) => update('signed', signed)}
    />

    <p className={styles.signCaption}>
      By signing, the customer confirms the items, delivery date, address, and total. Same price guarantee applies.
    </p>

    {form.signed && (
      <p className={styles.recordedNote}>
        <Check size={14} strokeWidth={2} />
        Signed. Ready to place order.
      </p>
    )}
  </section>
);
