import type { CartLine } from "@/lib/cart";
import type { ModelProvider } from "@/lib/vendor/types";

/** Domain events: facts other parts of the app react to, so features don't call each other directly. */
export type DomainEvents = {
  "order.placed": { lines: CartLine[]; total: number };
  "generation.started": { provider: ModelProvider; remaining: number };
  "generation.finished": { provider: ModelProvider; ok: boolean };
};

type Handler<K extends keyof DomainEvents> = (event: DomainEvents[K]) => void;
const handlers = new Map<keyof DomainEvents, Set<Handler<never>>>();

/** Subscribe; returns the unsubscribe (handy as a useEffect cleanup). */
export function on<K extends keyof DomainEvents>(type: K, handler: Handler<K>): () => void {
  const set = handlers.get(type) ?? new Set();
  handlers.set(type, set);
  set.add(handler as Handler<never>);
  return () => void set.delete(handler as Handler<never>);
}

// ponytail: in-page and synchronous; a handler that throws stops the rest. BroadcastChannel if tabs must hear it.
export function publish<K extends keyof DomainEvents>(type: K, event: DomainEvents[K]) {
  handlers.get(type)?.forEach((handler) => (handler as Handler<K>)(event));
}
