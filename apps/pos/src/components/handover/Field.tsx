import type { ReactNode } from 'react';

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field">
    <span className="fieldLabel">{label}</span>
    {children}
  </label>
);
