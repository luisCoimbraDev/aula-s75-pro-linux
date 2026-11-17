import type { StudioState } from "../studio";
import { Button } from "../ui";
import { Choice, ColorPicker, Panel, Range, Toggle } from "../ui/shared";
import { Apply, canSend, numeric } from "../ui/studio-controls";

import { KeyboardPreview } from "../ui/keyboard-preview";
export function Lighting({ s }: { s: StudioState }) {
  return (
    <>
      <KeyboardPreview s={s} />
      <div className="columns">
        <Panel
          title="Cor e personalização"
          description="Uma cor principal para o teclado inteiro."
        >
          <ColorPicker
            value={s.baseColor}
            onChange={(v) => {
              s.baseColor = v;
            }}
            colors={s.colors}
          />
          <Toggle
            label="Personalizar teclas individualmente"
            description="Combine a cor principal com cores especiais nas teclas que escolher."
            checked={s.individualLighting}
            onChange={(v) => {
              s.individualLighting = v;
            }}
          />
          {s.individualLighting && (
            <div className="inset">
              <ColorPicker
                label={`Cor da tecla ${s.selected.label}`}
                value={s.customColor}
                onChange={(v) => {
                  s.customColor = v;
                }}
                colors={s.colors}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={!s.settings.keyColors[s.selected.id]}
                onClick={() => {
                  delete s.settings.keyColors[s.selected.id];
                }}
              >
                Usar cor principal nesta tecla
              </Button>
            </div>
          )}
          <p className="hint">
            As cores individuais ficam guardadas ao desativar a opção.
          </p>
        </Panel>
        <Panel
          title="Efeito e intensidade"
          description="Os efeitos são salvos na memória do teclado."
        >
          <Choice
            label="Efeito"
            value={s.settings.effect}
            onChange={(v) => {
              s.settings.effect = v;
            }}
            options={[
              ...(s.individualLighting
                ? [{ value: "custom", label: "Personalização individual" }]
                : []),
              { value: "static", label: "Cor estática" },
              { value: "wave", label: "Onda" },
              { value: "breathing", label: "Respiração" },
              ...s.hardwareModes
                .slice(1)
                .map((label, i) => ({ value: `mode:${i + 1}`, label })),
              { value: "off", label: "Desligado" },
            ]}
          />
          <Range
            label="Brilho"
            value={s.settings.brightness}
            onChange={(v) => {
              s.settings.brightness = v;
            }}
          />
          <Range
            label="Velocidade"
            value={s.settings.speed}
            onChange={(v) => {
              s.settings.speed = v;
            }}
          />
          <Toggle
            label="Usar cores do efeito"
            checked={s.settings.colorful}
            onChange={(v) => {
              s.settings.colorful = v;
            }}
            disabled={s.individualLighting}
          />
          <Choice
            label="Direção"
            value={s.settings.direction}
            onChange={(v) => {
              s.settings.direction = Number(v);
            }}
            options={numeric([
              "Padrão",
              "Alternativa 1",
              "Alternativa 2",
              "Alternativa 3",
            ])}
          />
          <div className="actions">
            <Button
              onClick={() => {
                void s.readColors();
              }}
              disabled={!canSend(s)}
            >
              Ler cores atuais
            </Button>
            <Apply s={s} scope="lighting">
              Aplicar iluminação
            </Apply>
          </div>
        </Panel>
      </div>
    </>
  );
}
