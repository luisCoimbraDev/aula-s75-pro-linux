import type { StudioState } from "../studio";
import { Button } from "../ui";
import { Choice, Panel, Toggle } from "../ui/shared";
import { Apply, canSend, numeric } from "../ui/studio-controls";
import { Clock3, PanelTop } from "lucide-react";
export function Device({ s }: { s: StudioState }) {
  const d = s.settings.deviceSettings;
  return (
    <div className="columns">
      <Panel
        title="Comportamento das teclas"
        description="Bloqueios, camada Fn e resposta."
      >
        <Toggle
          label="Bloquear Super / Windows"
          checked={!!d.winLock}
          onChange={(v) => {
            d.winLock = Number(v);
          }}
        />
        <Toggle
          label="Bloquear Alt + F4"
          checked={!!d.altF4}
          onChange={(v) => {
            d.altF4 = Number(v);
          }}
        />
        <Toggle
          label="Bloquear Alt + Tab"
          checked={!!d.altTab}
          onChange={(v) => {
            d.altTab = Number(v);
          }}
        />
        <Choice
          label="Comportamento Fn"
          value={d.fnSwitch}
          onChange={(v) => {
            d.fnSwitch = Number(v);
          }}
          options={numeric(["Enquanto pressionada", "Alternar camada"])}
        />
        <Choice
          label="Repouso"
          value={d.sleep}
          onChange={(v) => {
            d.sleep = Number(v);
          }}
          options={numeric(["Nunca", "1 minuto", "5 minutos", "30 minutos"])}
        />
        <Choice
          label="Resposta das teclas"
          value={d.response}
          onChange={(v) => {
            d.response = Number(v);
          }}
          options={Array.from({ length: 5 }, (_, i) => ({
            value: i + 1,
            label:
              i === 0
                ? "1 · Mais rápida"
                : i === 4
                  ? "5 · Mais estável"
                  : String(i + 1),
          }))}
        />
        <div className="actions">
          <Apply s={s} scope="settings">
            Aplicar opções
          </Apply>
        </div>
      </Panel>
      <div className="stack">
        <Panel
          title="Luz lateral"
          description="Um detalhe para completar seu setup."
        >
          <Choice
            label="Modo da luz lateral"
            value={s.settings.barMode}
            onChange={(v) => {
              s.settings.barMode = Number(v);
            }}
            options={["Fluxo", "Vermelho", "Azul", "Neon", "Desligada"].map(
              (label, i) => ({ label, value: 32 + i }),
            )}
          />
          <Apply s={s} scope="bar">
            Aplicar luz lateral
          </Apply>
        </Panel>
        <Panel
          title="Relógio do teclado"
          description="Use a data e a hora desta sessão."
        >
          <Button
            leftIcon={<Clock3 size={15} />}
            onClick={() => {
              void s.syncClock();
            }}
            disabled={!canSend(s)}
          >
            Sincronizar agora
          </Button>
        </Panel>
        <Panel
          title="Integração com o GNOME"
          description="GIF, cor e bateria na barra superior."
        >
          <p className="hint">
            O menu nativo abre sem manter a interface do editor em memória.
          </p>
          <Button
            leftIcon={<PanelTop size={15} />}
            onClick={() => {
              void s.installPanel();
            }}
            loading={s.installingPanel}
            disabled={!s.native || s.hardwareBusy}
          >
            {s.desktopIntegration?.batteryMenu
              ? "Atualizar integração"
              : "Ativar menu nativo"}
          </Button>
        </Panel>
      </div>
    </div>
  );
}
