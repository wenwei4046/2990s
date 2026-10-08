// Export for Procurement (design screen 09): an editable plain-text brief to
// paste into WhatsApp or email.

import { useState } from 'react';
import { Copy, X } from 'lucide-react';
import s from './marketing.module.css';

/** Clipboard API where the context allows it; the textarea + execCommand path
 *  for an insecure-context preview (same-Wi-Fi HTTP) where it does not. */
const fallbackCopy = (t: string) => {
  const ta = document.createElement('textarea');
  ta.value = t;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* nothing more to try */ }
  ta.remove();
};

export const ExportModal = ({ initial, onClose }: { initial: string; onClose: () => void }) => {
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const done = () => setCopied(true);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  };

  return (
    <>
      <div className={s.exportScrim} onClick={onClose} />
      <div className={s.exportBox} role="dialog" aria-label="Export for Procurement">
        <div className={s.exportHead}>
          <div>
            <div className={s.modalTitle}>Export for Procurement</div>
            <div className={s.modalSub}>Copy and paste into WhatsApp or email. You can edit the text before copying.</div>
          </div>
          <button type="button" className={s.closeBtn} aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.75} className={s.icon} />
          </button>
        </div>
        <div className={s.exportBody}>
          <textarea
            className={s.exportText}
            value={text}
            spellCheck={false}
            aria-label="Export text"
            onChange={(e) => { setText(e.target.value); setCopied(false); }}
          />
        </div>
        <div className={s.exportFoot}>
          <button type="button" className={s.ghostBtn} onClick={onClose}>Close</button>
          <button type="button" className={`${s.copyBtn} ${copied ? s.copyBtnDone : ''}`} onClick={copy}>
            <Copy size={15} strokeWidth={1.75} className={s.icon} />{copied ? 'Copied' : 'Copy text'}
          </button>
        </div>
      </div>
    </>
  );
};
