// Change notifier behind services.subscribe(). Any number of notify() calls made in the
// same tick reach each listener once.

export type Listener = () => void;

export interface ChangeNotifier {
  subscribe(listener: Listener): () => void;
  notify(): void;
}

export function createChangeNotifier(): ChangeNotifier {
  const listeners = new Set<Listener>();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        // One failing listener must not stop the others from hearing about the write.
        console.error('CareVault: a change listener threw', error);
      }
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    },
  };
}
