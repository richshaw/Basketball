/**
 * Waits for `task` to settle (either way), but no longer than `ms`: then it runs on
 * alone. Never rejects. For a wait that must not hang on a database that doesn't
 * answer, e.g. saving before an export or before the game ends.
 */
export async function waitAtMost(task: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    task.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}
