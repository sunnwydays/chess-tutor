/**
 * Lesson -> review queue. A lesson moment that ends with hints used (or the
 * move shown) becomes a box-0 review item, tagged with the idea from the
 * player's labels, else the coach's motif. Browser only (localStorage).
 */
import { createItem, loadQueue, saveQueue, type QueueState } from "./queue";
import { ideaTag, loadLabels, saveSource, type ReviewSource } from "./sources";

/** Queue the source unless it is already queued. Returns the new state, or null if nothing changed. */
export function enqueueMoment(src: ReviewSource, motif?: string): QueueState | null {
  const state = loadQueue();
  if (state.items.some((it) => it.id === src.id)) return null;
  const withMotif: ReviewSource = { ...src, motif: motif || src.motif };
  saveSource(withMotif);
  const tag = ideaTag(loadLabels()[src.id], withMotif.motif);
  const next: QueueState = {
    ...state,
    items: [...state.items, createItem(src.id, tag, src.moment.fenBefore, state.clock)],
  };
  saveQueue(next);
  return next;
}
