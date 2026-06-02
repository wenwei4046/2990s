import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './MonthCalendar.module.css';

const WEEKDAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const MONTH_LABEL = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const pad2 = (n: number): string => String(n).padStart(2, '0');
const isoOf = (year: number, month0: number, day: number): string =>
  `${year}-${pad2(month0 + 1)}-${pad2(day)}`;

export const MonthCalendar = ({
  value, onChange, minDate,
}: {
  value: string;                          // YYYY-MM-DD or ''
  onChange: (date: string) => void;
  minDate: Date;
}) => {
  const initialMonth = value
    ? { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) - 1 }
    : { year: minDate.getFullYear(), month: minDate.getMonth() };

  const [view, setView] = useState(initialMonth);

  const cells = useMemo(() => {
    const firstDay = new Date(view.year, view.month, 1);
    const lastDay = new Date(view.year, view.month + 1, 0);
    const startWeekday = firstDay.getDay();         // 0 = Sun
    const totalDays = lastDay.getDate();
    const arr: Array<number | null> = [];
    for (let i = 0; i < startWeekday; i++) arr.push(null);
    for (let d = 1; d <= totalDays; d++) arr.push(d);
    return arr;
  }, [view]);

  const minIso = isoOf(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());

  const isDisabled = (day: number): boolean => isoOf(view.year, view.month, day) < minIso;
  const isSelected = (day: number): boolean => isoOf(view.year, view.month, day) === value;

  const stepMonth = (delta: number) => {
    setView(({ year, month }) => {
      const nm = month + delta;
      if (nm < 0)  return { year: year - 1, month: 11 };
      if (nm > 11) return { year: year + 1, month: 0 };
      return { year, month: nm };
    });
  };

  // Backward nav is bounded so the user can't sail into all-disabled past months.
  const minMonthCmp = minDate.getFullYear() * 12 + minDate.getMonth();
  const viewMonthCmp = view.year * 12 + view.month;
  const canPrev = viewMonthCmp > minMonthCmp;

  return (
    <div className={styles.cal}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.nav}
          onClick={() => stepMonth(-1)}
          aria-label="Previous month"
          disabled={!canPrev}
        >
          <ChevronLeft size={16} strokeWidth={1.75} />
        </button>
        <span className={styles.monthLabel}>
          {MONTH_LABEL[view.month]} {view.year}
        </span>
        <button
          type="button"
          className={styles.nav}
          onClick={() => stepMonth(1)}
          aria-label="Next month"
        >
          <ChevronRight size={16} strokeWidth={1.75} />
        </button>
      </header>
      <div className={styles.weekdays}>
        {WEEKDAYS.map((w) => <span key={w} className={styles.weekday}>{w}</span>)}
      </div>
      <div className={styles.grid}>
        {cells.map((d, i) => d === null ? (
          <span key={i} className={styles.empty} aria-hidden="true" />
        ) : (
          <button
            type="button"
            key={i}
            className={`${styles.day} ${isSelected(d) ? styles.daySelected : ''} ${isDisabled(d) ? styles.dayDisabled : ''}`}
            disabled={isDisabled(d)}
            onClick={() => onChange(isoOf(view.year, view.month, d))}
            aria-current={isSelected(d) ? 'date' : undefined}
          >
            {d}
          </button>
        ))}
      </div>
      <div className={styles.legend}>
        <span className={styles.legendDot} aria-hidden="true" />
        <span>Selected</span>
      </div>
    </div>
  );
};
