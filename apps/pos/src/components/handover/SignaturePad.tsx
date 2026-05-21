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
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SIGN_W,
      y: ((e.clientY - rect.top) / rect.height) * SIGN_H,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    last.current = getPos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#221F20';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    last.current = p;
    if (!hasInk) {
      setHasInk(true);
      onChange(true);
    }
  };
  const end = () => {
    drawing.current = false;
  };

  const clearPad = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, SIGN_W, SIGN_H);
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
        onPointerLeave={end}
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
