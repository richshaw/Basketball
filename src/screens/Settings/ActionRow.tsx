import type { MouseEventHandler, ReactNode } from 'react';
import { ListRow } from '@/components/GroupedList/ListRow';
import styles from './ActionRow.module.css';

export interface ActionRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}

/**
 * A row that does something right away (save a file, restore, add sample data). Its
 * title is tinted like an iOS action row, unlike rows that open a screen or sheet.
 */
export function ActionRow({ title, ...props }: ActionRowProps) {
  return <ListRow {...props} title={<span className={styles.title}>{title}</span>} />;
}
