export const StepFooter = (p: {
  isFirst: boolean;
  currentKey: 'customer' | 'address' | 'emergency' | 'target' | 'addons' | 'confirm' | 'sign';
  valid: boolean;
  submitting: boolean;
  paymentRecorded: boolean;
  onPrev: () => void;
  onNext: () => void | Promise<void>;
  onRecordPayment: () => void;
}) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--line)' }}>
    {!p.isFirst ? (
      <button type="button" onClick={p.onPrev} disabled={p.submitting}>← Previous</button>
    ) : (
      <span />
    )}
    <button type="submit" disabled={!p.valid || p.submitting}>Continue →</button>
  </div>
);
