import type { StudioState } from "../studio";
import { Button } from "../ui";
import { Choice, Panel, Range } from "../ui/shared";
import { canSend, numeric } from "../ui/studio-controls";
import { Music2 } from "lucide-react";
import { LcdPreview } from "../ui/lcd-preview";
export function Live({ s }: { s: StudioState }) {
  return (
    <div className="columns">
      <Panel
        title="Ritmo musical"
        description="A iluminação acompanha o áudio do computador."
      >
        <div className="live-symbol">
          <Music2 size={36} />
          <span>Áudio → RGB</span>
        </div>
        <Choice
          label="Paleta"
          value={s.livePalette}
          onChange={(v) => {
            s.livePalette = Number(v);
          }}
          options={numeric(s.livePalettes)}
        />
        <Range
          label="Sensibilidade"
          value={s.liveGain}
          onChange={(v) => {
            s.liveGain = v;
          }}
          min={1}
          max={10}
        />
        <Button
          variant="primary"
          leftIcon={<Music2 size={15} />}
          onClick={() => {
            void s.startLive("music");
          }}
          disabled={!canSend(s)}
        >
          Iniciar ritmo musical
        </Button>
        <p className="hint">
          Usa a saída de áudio do PipeWire. O app precisa permanecer aberto
          durante o efeito.
        </p>
      </Panel>
      <Panel
        title="Animação nas teclas"
        description="Projete sua imagem ou GIF nas 80 teclas."
      >
        <LcdPreview s={s} />
        <div className="actions">
          <Button
            onClick={() => {
              s.page = "screen";
            }}
          >
            Escolher mídia
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void s.startLive("animation");
            }}
            disabled={!canSend(s) || !s.settings.media}
          >
            Reproduzir nas teclas
          </Button>
        </div>
        <p className="hint">
          O efeito ao vivo usa USB e preserva a mídia do LCD. Ao parar, a
          iluminação do perfil é restaurada.
        </p>
      </Panel>
    </div>
  );
}
