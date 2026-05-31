import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import styles from './SignaturePad.module.css';

const SIGN_W = 800;
const SIGN_H = 200;

export interface SignaturePadHandle {
  // Returns the canvas as a base64 PNG data URL, or null if nothing was drawn.
  // Used by Handover submit to persist the signature alongside the order.
  getDataUrl: () => string | null;
}

export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { onChange: (signed: boolean) => void }
>(({ onChange }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = useState(false);
  const inked = useRef(false);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const getPos = (e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SIGN_W,
      y: ((e.clientY - rect.top) / rect.height) * SIGN_H,
    };
  };

  // Mark the pad inked exactly once (drives the Clear button + getDataUrl +
  // the parent's "signed" flag).
  const markInked = () => {
    if (inked.current) return;
    inked.current = true;
    setHasInk(true);
    onChange(true);
  };

  const strokeStyle = (ctx: CanvasRenderingContext2D) => {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#221F20';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Stop the browser turning the press into a scroll/select/gesture (which
    // is what reduced strokes to single dots on touch/pen/trackpad).
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    const p = getPos(e);
    last.current = p;
    // Lay a dot down immediately so even a tap (no move) leaves a visible mark.
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = '#221F20';
    ctx.fill();
    // Best-effort capture — if it doesn't engage (some pen/trackpad stacks),
    // the stroke still survives because we no longer end it on pointerleave.
    try { canvasRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    markInked();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    // A mouse that reports no buttons held mid-move has been released outside
    // our up handler — stop drawing instead of trailing a line to the cursor.
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      drawing.current = false;
      return;
    }
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    strokeStyle(ctx);
    // Draw every coalesced sample so fast strokes stay smooth instead of
    // collapsing to sparse segments.
    const samples = typeof e.nativeEvent.getCoalescedEvents === 'function'
      ? e.nativeEvent.getCoalescedEvents()
      : [];
    const points = samples.length > 0 ? samples : [e.nativeEvent];
    for (const s of points) {
      const p = getPos(s);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
    }
    markInked();
  };

  // End on up / cancel only — NEVER on pointerleave. Ending on leave killed the
  // stroke the moment the pointer grazed the canvas edge (or whenever pointer
  // capture failed to engage), so the customer could only ever leave dots.
  const end = () => {
    drawing.current = false;
  };

  const clearPad = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, SIGN_W, SIGN_H);
    inked.current = false;
    setHasInk(false);
    onChange(false);
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, SIGN_W, SIGN_H);
  }, []);

  useImperativeHandle(ref, () => ({
    getDataUrl: () => {
      if (!hasInk || !canvasRef.current) return null;
      return canvasRef.current.toDataURL('image/png');
    },
  }), [hasInk]);

  return (
    <div className={styles.sign}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={SIGN_W}
        height={SIGN_H}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className={styles.actions}>
        <span className={styles.guide}>Customer signature</span>
        <button
          type="button"
          className={styles.clearBtn}
          onClick={clearPad}
          disabled={!hasInk}
        >
          <Eraser size={12} strokeWidth={1.75} />
          Clear
        </button>
      </div>
    </div>
  );
});

SignaturePad.displayName = 'SignaturePad';
