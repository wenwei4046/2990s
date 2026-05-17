interface StepDef { phase: 1 | 2; key: string; label: string; }

export const PhaseNav = (_p: {
  phase: 1 | 2;
  steps: readonly StepDef[];
  currentIdx: number;
  validity: Record<string, boolean>;
  onJump: (targetIdx: number) => void;
}) => (
  <div style={{ padding: 'var(--space-3)', background: 'var(--bg-alt)', borderRadius: 'var(--radius-sm)' }}>
    PhaseNav stub (Task 6)
  </div>
);
