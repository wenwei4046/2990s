import { forwardRef, type ButtonHTMLAttributes } from 'react';
import styles from './LoadingButton.module.css';

// ---------------------------------------------------------------------------
// LoadingButton — drop-in for any mutation button that previously toggled
// `disabled={mutation.isPending}` and swapped its label to "Saving…".
//
// API:
//   <LoadingButton loading={createPo.isPending} loadingText="Creating…"
//                  variant="primary" size="md" onClick={submit}>
//     Create PO
//   </LoadingButton>
//
// When loading: disabled, spinner shown, label optionally replaced.
// ---------------------------------------------------------------------------

export interface LoadingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingText?: string;
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

const Spinner = ({ small }: { small?: boolean }) => (
  <svg
    className={`${styles.spinner} ${small ? styles.spinnerSm : ''}`}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle
      className={styles.spinnerTrack}
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="3"
    />
    <path
      className={styles.spinnerHead}
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
    />
  </svg>
);

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  (
    {
      loading = false,
      loadingText,
      variant = 'primary',
      size = 'md',
      disabled,
      className,
      type = 'button',
      children,
      ...rest
    },
    ref,
  ) => {
    const variantClass =
      variant === 'primary' ? styles.primary :
      variant === 'danger' ? styles.danger :
      styles.ghost;
    const sizeClass = size === 'sm' ? styles.sm : styles.md;
    const cls = [styles.button, variantClass, sizeClass, className ?? '']
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cls}
        {...rest}
      >
        {loading && <Spinner small={size === 'sm'} />}
        <span>{loading && loadingText ? loadingText : children}</span>
      </button>
    );
  },
);
LoadingButton.displayName = 'LoadingButton';
