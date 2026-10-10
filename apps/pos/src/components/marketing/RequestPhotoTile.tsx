// The photo a launch request was filed with, as a tile beside the sofa as
// laid out (owner 2026-10-10: a card shows both — the layout, as before, and
// the photo). A photo is a few hundred KB on its request row and never in
// /state, so a tile reads it only once it comes near the screen. The read is
// shared with the form and the display drawer (same cache key), and a new
// photo (a new version) is read again.

import { useEffect, useRef, useState } from 'react';
import { useRequestPhoto } from '../../lib/marketing-api';
import s from './marketing.module.css';

export const RequestPhotoTile = ({ requestId, version, className }: {
  requestId: string;
  /** The photo's upload time. */
  version: string;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const photo = useRequestPhoto(near ? requestId : null, near ? version : null).data;
  // Decorative: a card is named by its piece, and the form and the drawer
  // show this photo with its label.
  return (
    <div ref={ref} className={className} aria-hidden>
      {photo && <img src={photo.dataUrl} alt="" className={s.photoTileImg} />}
    </div>
  );
};
