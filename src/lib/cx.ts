/** Joins class names, skipping falsy values: `cx(styles.a, isOn && styles.on)`. */
export function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(' ');
}
