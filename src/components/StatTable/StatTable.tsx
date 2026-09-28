import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Key,
  type ReactNode,
} from 'react';
import { cx } from '@/lib/cx';
import styles from './StatTable.module.css';

export interface StatTableColumn<K extends string = string> {
  /** Which value of each row goes in this column. */
  key: K;
  /** Short header text, e.g. "PTS". */
  header: string;
  /** Full name read by screen readers instead of `header`, e.g. "Points". */
  fullLabel?: string;
  /** Defaults to `start` for the first column and `center` for the others. */
  align?: 'start' | 'center' | 'end';
  /** Minimum width as a CSS length, e.g. '4rem'. Columns otherwise fit their content. */
  width?: string;
}

/** One value per column key: numbers, strings like "5-9", or any small node. */
export type StatTableRow<K extends string = string> = Readonly<Record<K, ReactNode>>;

export interface StatTableProps<K extends string> {
  /** Names the table for screen readers (a visually hidden caption). */
  caption: string;
  /** The first column (row labels such as "Q1") stays put while the rest scroll sideways. */
  columns: readonly StatTableColumn<K>[];
  rows: readonly StatTableRow<K>[];
  /** Totals, shown in bold under the rows, e.g. `{ period: 'Total', pts: 14, ... }`. */
  totalRow?: StatTableRow<K>;
  /** Index of a row in `rows` to highlight, e.g. the current quarter. */
  highlightedRow?: number;
  /**
   * What the highlight means, read by screen readers after the row's label, e.g.
   * "season high". Defaults to "current".
   */
  highlightLabel?: string;
  /** Stable row keys when rows can be added, removed or reordered. Defaults to the index. */
  rowKey?: (row: StatTableRow<K>, index: number) => Key;
  className?: string;
}

interface ScrollEdges {
  /** Scrolled away from the start: the sticky column shows its edge. */
  start: boolean;
  /** More columns hidden past the end: the table fades out on the right. */
  end: boolean;
}

/** Tracks whether a horizontal scroller has content hidden on either side. */
function useScrollEdges() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  const measure = useCallback(() => {
    const scroller = ref.current;
    if (!scroller) return;
    const start = scroller.scrollLeft > 1;
    const end = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
    setEdges((previous) =>
      previous.start === start && previous.end === end ? previous : { start, end },
    );
  }, []);

  useLayoutEffect(() => {
    const scroller = ref.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    // Fires once right away, then whenever the scroller or the table changes size.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, edges, measure };
}

const alignClass = { start: styles.start, center: styles.center, end: styles.end } as const;

/**
 * Compact table of numbers (box scores, game logs). Numbers use tabular figures.
 * When the columns don't fit, the table scrolls sideways under a sticky first column.
 */
export function StatTable<K extends string>({
  caption,
  columns,
  rows,
  totalRow,
  highlightedRow,
  highlightLabel = 'current',
  rowKey,
  className,
}: StatTableProps<K>) {
  const captionId = useId();
  const { ref, edges, measure } = useScrollEdges();
  const scrollable = edges.start || edges.end;

  const cellClassName = (column: StatTableColumn<K>, index: number) =>
    cx(
      styles.cell,
      index === 0 && styles.sticky,
      alignClass[column.align ?? (index === 0 ? 'start' : 'center')],
    );

  const renderRow = (row: StatTableRow<K>, highlighted = false) =>
    columns.map((column, index) =>
      index === 0 ? (
        <th key={column.key} scope="row" className={cellClassName(column, index)}>
          {row[column.key]}
          {/* The highlight is only a background color, so say what it means too. */}
          {highlighted ? <span className="visually-hidden">, {highlightLabel}</span> : null}
        </th>
      ) : (
        <td key={column.key} className={cellClassName(column, index)}>
          {row[column.key]}
        </td>
      ),
    );

  return (
    <div
      ref={ref}
      role="region"
      aria-labelledby={captionId}
      // Focusable only when it scrolls, so keyboard users can scroll it with the arrow keys.
      tabIndex={scrollable ? 0 : undefined}
      className={cx(
        styles.scroller,
        edges.start && styles.scrolledStart,
        edges.end && styles.moreAtEnd,
        className,
      )}
      onScroll={measure}
    >
      <table className={styles.table}>
        <caption id={captionId} className="visually-hidden">
          {caption}
        </caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr className={styles.headRow}>
            {columns.map((column, index) => (
              <th key={column.key} scope="col" className={cellClassName(column, index)}>
                {column.fullLabel ? (
                  <>
                    <span aria-hidden="true">{column.header}</span>
                    <span className="visually-hidden">{column.fullLabel}</span>
                  </>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row, index) : index}
              className={cx(styles.bodyRow, index === highlightedRow && styles.highlighted)}
            >
              {renderRow(row, index === highlightedRow)}
            </tr>
          ))}
        </tbody>
        {totalRow ? (
          <tfoot>
            <tr className={styles.totalRow}>{renderRow(totalRow)}</tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
