import { reactive, watch } from "@vue/reactivity";

// Reactive state only: both windows render exclusively through React + Darwin UI.
export function lifecycle() {
  const mounts: Array<() => unknown> = [],
    cleanups: Array<() => void> = [];
  let disposed = false;
  return {
    onMounted(fn: () => unknown) {
      mounts.push(fn);
    },
    onUnmounted(fn: () => void) {
      cleanups.push(fn);
    },
    async mount() {
      try {
        for (const fn of mounts) await fn();
      } finally {
        if (disposed) cleanups.forEach((fn) => fn());
      }
    },
    dispose() {
      disposed = true;
      cleanups.forEach((fn) => fn());
    },
  };
}

export function bindController<T extends object>(
  values: T,
  life: ReturnType<typeof lifecycle>,
) {
  const state = reactive(values);
  let revision = 0;
  const subscribers = new Set<() => void>();
  const stop = watch(
    state,
    () => {
      revision++;
      subscribers.forEach((fn) => fn());
    },
    { deep: true },
  );
  return {
    state,
    subscribe(fn: () => void) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    getSnapshot: () => revision,
    mount: life.mount,
    dispose() {
      stop();
      subscribers.clear();
      life.dispose();
    },
  };
}
