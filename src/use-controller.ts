import { useEffect, useState, useSyncExternalStore } from "react";

export function useController<
  T extends {
    state: object;
    mount: () => Promise<void>;
    dispose: () => void;
    subscribe: (fn: () => void) => () => void;
    getSnapshot: () => number;
  },
>(create: () => T): T["state"] {
  const [controller] = useState(create);
  useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.mount();
    return () => controller.dispose();
  }, [controller]);
  return controller.state;
}
