import type { StudioState } from "../studio";
import { Monitor } from "lucide-react";
export function LcdPreview({ s }: { s: StudioState }) {
  return (
    <div className="lcd-preview">
      <div className="lcd-frame">
        {s.settings.media ? (
          <img
            src={s.settings.media.data}
            style={{ objectFit: s.settings.media.fit }}
            alt="Prévia da mídia selecionada para o LCD"
          />
        ) : (
          <div className="lcd-empty">
            <Monitor size={28} />
            <strong>S75</strong>
            <span>Sua próxima ideia.</span>
          </div>
        )}
      </div>
      <small>135 × 240 px · LCD</small>
    </div>
  );
}
