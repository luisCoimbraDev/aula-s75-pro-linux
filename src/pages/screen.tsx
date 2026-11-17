import type { StudioState } from "../studio";
import { Button } from "../ui";
import { Choice, FileButton, Panel } from "../ui/shared";
import { canSend } from "../ui/studio-controls";
import { Clock3, FileImage, Send, Trash2 } from "lucide-react";
import { LcdPreview } from "../ui/lcd-preview";
export function Screen({ s }: { s: StudioState }) {
  return (
    <div className="screen-columns">
      <Panel
        title="Prévia do LCD"
        description="Veja o enquadramento antes de enviar."
      >
        <LcdPreview s={s} />
      </Panel>
      <Panel
        title="Imagem ou GIF"
        description="Escolha uma mídia e envie para a tela do S75 Pro."
      >
        <div className="upload-zone">
          <FileImage size={32} />
          <h3>
            {s.settings.media
              ? "Pronto para um novo visual?"
              : "Adicione seu próximo GIF"}
          </h3>
          <p>GIF, PNG ou JPEG · até 4 MiB · até 141 quadros</p>
          <FileButton
            accept="image/png,image/jpeg,image/gif"
            onChange={s.importMedia}
          >
            {s.settings.media ? "Trocar arquivo" : "Escolher arquivo"}
          </FileButton>
        </div>
        {s.settings.media && (
          <>
            <div className="media-info">
              <FileImage size={18} />
              <div>
                <strong>{s.settings.media.name}</strong>
                <small>{s.settings.media.frames} quadros</small>
              </div>
              <Button
                variant="ghost"
                iconOnly
                aria-label="Remover mídia"
                onClick={() => {
                  s.settings.media = null;
                }}
              >
                <Trash2 size={15} />
              </Button>
            </div>
            <Choice
              label="Enquadramento"
              value={s.settings.media.fit}
              onChange={(v) => {
                if (s.settings.media)
                  s.settings.media.fit = v as "cover" | "contain";
              }}
              options={[
                { value: "cover", label: "Preencher a tela" },
                { value: "contain", label: "Mostrar imagem inteira" },
              ]}
            />
          </>
        )}
        <div className="actions">
          <Button
            leftIcon={<Clock3 size={14} />}
            onClick={() => {
              void s.syncClock();
            }}
            disabled={!canSend(s)}
          >
            Sincronizar relógio
          </Button>
          <Button
            variant="primary"
            leftIcon={<Send size={14} />}
            onClick={() => {
              void s.sendScreen();
            }}
            disabled={!canSend(s) || !s.settings.media}
          >
            Enviar ao LCD
          </Button>
        </div>
        <p className="hint">
          A seleção altera a prévia. O envio por USB grava a mídia no teclado.
        </p>
      </Panel>
    </div>
  );
}
