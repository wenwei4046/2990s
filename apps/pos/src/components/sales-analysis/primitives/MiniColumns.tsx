import { useEffect, useRef } from 'react';
import styles from '../SaShared.module.css';

interface MiniColumnsProps {
  data: Array<{ label: string; value: number; sub?: string }>;
  /** Bar-area px. Default 140. */
  height?: number;
  /** Px per column slot. Default 44. */
  slotWidth?: number;
  /** Printed above the column only when set AND slotWidth >= 40. */
  valueFormatter?: (v: number) => string;
  /** Optional overlay series, same length/scale as data values. */
  secondary?: number[];
  /** That column fills var(--sa-emph); others var(--sa-c1). */
  emphasizeLabel?: string | null;
  /** Overrides fill per column (e.g. Unknown age band → var(--sa-unknown)). */
  colorOf?: (label: string) => string;
  /** Tap-to-inspect; the whole slot (full height × slotWidth) is the hit target. */
  onSelect?: (label: string) => void;
  /** Selected column gets a 1.5px var(--c-ink) stroke. */
  selectedLabel?: string | null;
}

const LABEL_AREA = 34; // x label + sub under the bars
const VALUE_HEADROOM = 14; // reserved above bars when value labels print

/** SVG-in-JSX column chart for monthly trend and age bands. No libraries.
 *  Scrolls inside its own wrapper — the page never scrolls horizontally. */
export const MiniColumns = ({
  data,
  height = 140,
  slotWidth = 44,
  valueFormatter,
  secondary,
  emphasizeLabel,
  colorOf,
  onSelect,
  selectedLabel,
}: MiniColumnsProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // When content overflows, start at the right end (most recent data).
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const width = data.length * slotWidth;
  const showValues = valueFormatter != null && slotWidth >= 40;
  const headroom = showValues ? VALUE_HEADROOM : 0;
  const barArea = height - headroom;
  const max = Math.max(
    1,
    ...data.map((d) => d.value),
    ...(secondary ?? []),
  );

  const primaryW = slotWidth * 0.6;
  const secondaryW = slotWidth * 0.3;

  return (
    <div ref={scrollRef} className={styles.miniScroll}>
      <svg
        className={styles.miniSvg}
        width={width}
        height={height + LABEL_AREA}
        viewBox={`0 0 ${width} ${height + LABEL_AREA}`}
      >
        {data.map((d, i) => {
          const slotX = i * slotWidth;
          const barH = d.value > 0 ? Math.max(2, (d.value / max) * barArea) : 0;
          const y = headroom + (barArea - barH);
          const fill =
            emphasizeLabel != null && d.label === emphasizeLabel
              ? 'var(--sa-emph)'
              : colorOf
                ? colorOf(d.label)
                : 'var(--sa-c1)';
          const sec = secondary?.[i];
          const secH = sec != null && sec > 0 ? Math.max(2, (sec / max) * barArea) : 0;
          const secX = slotX + slotWidth - secondaryW - slotWidth * 0.02;
          const selected = selectedLabel != null && d.label === selectedLabel;
          return (
            <g key={d.label}>
              {barH > 0 && (
                <rect
                  x={slotX + slotWidth * 0.05}
                  y={y}
                  width={primaryW}
                  height={barH}
                  rx={3}
                  fill={fill}
                  stroke={selected ? 'var(--c-ink)' : 'none'}
                  strokeWidth={selected ? 1.5 : 0}
                />
              )}
              {barH === 0 && selected && (
                <rect
                  x={slotX + slotWidth * 0.05}
                  y={headroom + barArea - 2}
                  width={primaryW}
                  height={2}
                  rx={1}
                  fill="none"
                  stroke="var(--c-ink)"
                  strokeWidth={1.5}
                />
              )}
              {secH > 0 && (
                <rect
                  x={secX}
                  y={headroom + (barArea - secH)}
                  width={secondaryW}
                  height={secH}
                  rx={2}
                  fill="var(--sa-c3)"
                />
              )}
              {sec != null && sec < 0 && (
                // Below-baseline tick so a negative month reads differently
                // from a zero one; the exact value lives in caption/table.
                <rect x={secX} y={height + 1.5} width={secondaryW} height={3} rx={1.5} fill="var(--sa-c3)" />
              )}
              {showValues && valueFormatter != null && (
                <text
                  x={slotX + slotWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#6b6b6b"
                >
                  {valueFormatter(d.value)}
                </text>
              )}
              <text
                x={slotX + slotWidth / 2}
                y={height + 14}
                textAnchor="middle"
                fontSize={12}
                fill="var(--c-ink)"
              >
                {d.label}
              </text>
              {d.sub != null && (
                <text
                  x={slotX + slotWidth / 2}
                  y={height + 28}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#6b6b6b"
                >
                  {d.sub}
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={width} y1={height + 0.5} y2={height + 0.5} stroke="var(--line)" strokeWidth={1} />
        {onSelect &&
          data.map((d, i) => (
            <rect
              key={`hit-${d.label}`}
              className={styles.miniHit}
              x={i * slotWidth}
              y={0}
              width={slotWidth}
              height={height + LABEL_AREA}
              fill="transparent"
              onClick={() => onSelect(d.label)}
            />
          ))}
      </svg>
    </div>
  );
};
