/**
 * Where the canvas delivers a picked drawable id.
 *
 * The config panel starts a pick and the canvas finishes it, and the two are in
 * different branches of the component tree. A single-slot handler keeps that
 * hand-off explicit instead of threading a callback through the app shell, and
 * makes it impossible for two panels to be waiting on a pick at once.
 */
type PickHandler = (drawableId: string) => void;

let handler: PickHandler | null = null;

/** Registers the handler for the next pick; replaces any pending one. */
export function requestDrawablePick(next: PickHandler): void {
  handler = next;
}

export function cancelDrawablePick(): void {
  handler = null;
}

/** Called by the canvas when the user clicks a mesh in picking mode. */
export function deliverDrawablePick(drawableId: string): void {
  const current = handler;
  handler = null;
  current?.(drawableId);
}
