import type { StudioState } from "../studio";
import { Button } from "./index";
import { Send } from "lucide-react";
export const numeric = (names: string[]) =>
  names.map((label, value) => ({ label, value }));
export function canSend(s: StudioState) {
  return (
    s.native && !!s.device && !s.hardwareBusy && !s.closing && !s.initializing
  );
}
export function Apply({
  s,
  scope,
  children,
}: {
  s: StudioState;
  scope: string;
  children: string;
}) {
  return (
    <Button
      variant="primary"
      leftIcon={<Send size={14} />}
      disabled={!canSend(s)}
      onClick={() => {
        void s.sendToKeyboard(scope);
      }}
    >
      {children}
    </Button>
  );
}
