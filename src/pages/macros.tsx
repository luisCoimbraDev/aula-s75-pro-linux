import { useCallback } from "react";
import type { StudioState } from "../studio";
import { Button, Input } from "../ui";
import { Choice, Empty, Field, Panel } from "../ui/shared";
import { Apply, numeric } from "../ui/studio-controls";
import { Keyboard, Layers, Plus, Square, Trash2, X } from "lucide-react";
export function Macros({ s }: { s: StudioState }) {
  const captureInput = useCallback(
    (element: HTMLDivElement | null) => {
      s.macroInput = element;
    },
    [s],
  );
  return (
    <div className="macro-columns">
      <Panel
        title="Suas macros"
        action={
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Criar macro"
            onClick={s.addMacro}
          >
            <Plus size={16} />
          </Button>
        }
      >
        {s.settings.macros.length ? (
          <div className="macro-library">
            {s.settings.macros.map((m) => (
              <Button
                key={m.id}
                variant={s.selectedMacro === m.id ? "default" : "ghost"}
                className="macro-item"
                onClick={() => {
                  s.selectedMacro = m.id;
                  s.recording = false;
                }}
              >
                <Layers size={16} />
                <span>
                  {m.name}
                  <small>{m.events.length} eventos</small>
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <Empty
            icon={<Layers size={24} />}
            title="Sua primeira sequência"
            description="Crie uma macro para começar."
            action={
              <Button size="sm" onClick={s.addMacro}>
                Criar macro
              </Button>
            }
          />
        )}
      </Panel>
      <Panel
        title={s.macro ? "Editar sequência" : "Editor de macros"}
        description="Grave, ajuste e atribua a uma tecla."
      >
        {s.macro ? (
          <>
            <Field label="Nome">
              <Input
                aria-label="Nome da macro"
                value={s.macro.name}
                maxLength={60}
                onChange={(e) => {
                  s.macro!.name = e.target.value;
                }}
              />
            </Field>
            <div className="columns compact">
              <Choice
                label="Reprodução"
                value={s.macro.playMode ?? 0}
                onChange={(v) => {
                  s.macro!.playMode = Number(v);
                }}
                options={numeric([
                  "Uma vez",
                  "Repetir N vezes",
                  "Alternar ao pressionar",
                  "Enquanto pressionada",
                  "Clique para executar",
                ])}
              />
              {s.macro.playMode === 1 && (
                <Field label="Repetições">
                  <Input
                    aria-label="Repetições"
                    type="number"
                    min={1}
                    max={255}
                    value={s.macro.loops ?? 1}
                    onChange={(e) => {
                      s.macro!.loops = Number(e.target.value);
                    }}
                  />
                </Field>
              )}
            </div>
            <div className="actions start">
              <Button
                variant={s.recording ? "destructive" : "default"}
                leftIcon={
                  s.recording ? (
                    <Square size={12} />
                  ) : (
                    <span className="record-dot" />
                  )
                }
                onClick={() => {
                  if (s.recording) s.recording = false;
                  else s.startRecording();
                }}
              >
                {s.recording ? "Encerrar gravação" : "Gravar sequência"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  s.macro!.events = [];
                  s.recording = false;
                }}
              >
                Limpar
              </Button>
              <small className="muted">
                {s.macro.events.length} / 500 eventos
              </small>
            </div>
            <div
              ref={captureInput}
              tabIndex={0}
              className={`record-area ${s.recording ? "recording" : ""}`}
              onKeyDown={(e) => s.recordKey(e.nativeEvent, "down")}
              onKeyUp={(e) => s.recordKey(e.nativeEvent, "up")}
              onBlur={() => {
                s.recording = false;
              }}
            >
              <Keyboard size={22} />
              <strong>
                {s.recording ? "Gravando nesta área" : "Área de gravação"}
              </strong>
              <p>
                {s.recording
                  ? "Digite sua sequência. Esc encerra a gravação."
                  : "Clique em Gravar sequência para capturar as teclas aqui."}
              </p>
            </div>
            {!!s.macro.events.length && (
              <div className="event-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Tecla</th>
                      <th>Evento</th>
                      <th>Atraso (ms)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.macro.events.map((event, i) => (
                      <tr key={i}>
                        <td>
                          <code>{event.key}</code>
                        </td>
                        <td>
                          {event.kind === "down" ? "Pressionar" : "Soltar"}
                        </td>
                        <td>
                          <Input
                            aria-label={`Atraso do evento ${i + 1}`}
                            type="number"
                            min={0}
                            max={60000}
                            value={event.delay}
                            onChange={(e) => {
                              event.delay = Number(e.target.value);
                            }}
                          />
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label={`Excluir evento ${i + 1}`}
                            onClick={() => {
                              s.macro!.events.splice(i, 1);
                            }}
                          >
                            <X size={14} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="hint">
              Atribua a macro em Teclas e camadas. A memória disponível é
              verificada antes do envio.
            </p>
            <div className="actions">
              <Button
                variant="ghost"
                leftIcon={<Trash2 size={14} />}
                onClick={s.deleteMacro}
              >
                Excluir macro
              </Button>
              <Apply s={s} scope="macros">
                Aplicar macros e atribuições
              </Apply>
            </div>
          </>
        ) : (
          <Empty
            icon={<Layers size={28} />}
            title="Um toque, várias ações"
            description="Selecione uma macro na biblioteca ou crie uma nova."
            action={<Button onClick={s.addMacro}>Criar macro</Button>}
          />
        )}
      </Panel>
    </div>
  );
}
