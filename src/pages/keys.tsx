import type { StudioState } from "../studio";
import { Button } from "../ui";
import { Choice, Panel } from "../ui/shared";
import { Apply } from "../ui/studio-controls";

import { KeyboardPreview } from "../ui/keyboard-preview";
const mediaActions = [
  ["volume-up", "Aumentar volume"],
  ["volume-down", "Diminuir volume"],
  ["mute", "Silenciar áudio"],
  ["play-pause", "Reproduzir / pausar"],
  ["next", "Próxima faixa"],
  ["previous", "Faixa anterior"],
  ["stop", "Parar reprodução"],
];
export function Keys({ s }: { s: StudioState }) {
  const options = [
    { value: "", label: "Função original" },
    ...s.keys
      .filter((k) => k.label !== "Fn")
      .map((k) => ({ value: `key:${k.usage}`, label: `Tecla · ${k.label}` })),
    ...mediaActions.map(([id, label]) => ({
      value: `media:${id}`,
      label: `Áudio · ${label}`,
    })),
    ...[
      ["1", "Clique esquerdo"],
      ["3", "Clique direito"],
      ["2", "Clique central"],
      ["5", "Rolar para cima"],
      ["6", "Rolar para baixo"],
      ["7", "Voltar"],
      ["8", "Avançar"],
    ].map(([id, label]) => ({
      value: `mouse:${id}`,
      label: `Mouse · ${label}`,
    })),
    ...s.settings.macros.map((m) => ({
      value: `macro:${m.id}`,
      label: `Macro · ${m.name}`,
    })),
    { value: "disabled", label: "Desativar tecla" },
  ];
  return (
    <>
      <KeyboardPreview s={s} />
      <div className="columns">
        <Panel
          title={`Tecla ${s.selected.label}`}
          description={`${s.layer === "fn" ? "Camada Fn" : "Camada principal"} · posição ${s.selected.id}`}
        >
          <Choice
            label="Ação da tecla"
            value={s.mapping}
            onChange={(v) => {
              s.mapping = v;
            }}
            options={options}
            searchable
          />
          <div className="actions">
            <Button
              variant="ghost"
              disabled={!s.mapping}
              onClick={() => {
                s.mapping = "";
              }}
            >
              Restaurar função original
            </Button>
            <Apply s={s} scope="keys">
              Aplicar teclas e macros
            </Apply>
          </div>
        </Panel>
        <Panel
          title="Combinação personalizada"
          description="Combine um modificador com a tecla que você precisa."
        >
          <div className="columns compact">
            <Choice
              label="Modificadores"
              value={s.shortcutMods}
              onChange={(v) => {
                s.shortcutMods = Number(v);
              }}
              options={[
                { value: 0, label: "Sem modificador" },
                { value: 1, label: "Ctrl" },
                { value: 2, label: "Shift" },
                { value: 4, label: "Alt" },
                { value: 8, label: "Super" },
                { value: 3, label: "Ctrl + Shift" },
                { value: 5, label: "Ctrl + Alt" },
                { value: 7, label: "Ctrl + Alt + Shift" },
                { value: 10, label: "Super + Shift" },
              ]}
            />
            <Choice
              label="Tecla"
              value={s.shortcutKey}
              onChange={(v) => {
                s.shortcutKey = Number(v);
              }}
              options={s.keys
                .filter((k) => k.label !== "Fn")
                .map((k) => ({ value: k.usage, label: k.label }))}
              searchable
            />
          </div>
          <Button
            onClick={() => {
              s.mapping = `shortcut:${s.shortcutMods}:${s.shortcutKey}`;
            }}
          >
            Usar nesta tecla
          </Button>
          <p className="hint">
            A alteração entra no perfil. Clique em aplicar para enviar ao
            teclado.
          </p>
        </Panel>
      </div>
    </>
  );
}
