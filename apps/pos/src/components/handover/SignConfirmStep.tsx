import type { Ref } from 'react';
import { Check } from 'lucide-react';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import type { HandoverForm } from '../../lib/handover-helpers';
import { RECEIPT_TERMS } from '../../lib/legal';
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
      Final step — customer reviews the order on the right, acknowledges the terms, and signs below to confirm.
    </p>

    {/* Terms acknowledgement — the same terms that print on the Sales Order.
        Must be ticked (alongside the signature) before the order can be placed. */}
    <div className={styles.termsBox}>
      <ol className={styles.termsList}>
        {RECEIPT_TERMS.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
      <label className={styles.termsAck}>
        <input
          type="checkbox"
          checked={form.acknowledgedTerms}
          onChange={(e) => update('acknowledgedTerms', e.target.checked)}
        />
        <span>The customer has read and agrees to the terms and conditions above.</span>
      </label>
    </div>

    <SignaturePad
      ref={signatureRef}
      onChange={(signed) => update('signed', signed)}
    />

    <p className={styles.signCaption}>
      By signing, the customer confirms the items, delivery date, address, and total. Same price guarantee applies.
    </p>

    {form.signed && form.acknowledgedTerms && (
      <p className={styles.recordedNote}>
        <Check size={14} strokeWidth={2} />
        Signed and acknowledged. Ready to place order.
      </p>
    )}
  </section>
);
