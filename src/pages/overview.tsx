import { Usb } from "lucide-react";
import type { StudioState } from "../studio";
import { Badge, Button, Card } from "../ui";
import { BatteryStatus, Panel } from "../ui/shared";
import { canSend } from "../ui/studio-controls";
import {
  ArrowRight,
  Command,
  Lightbulb,
  Monitor,
  RefreshCw,
} from "lucide-react";
import { KeyboardPreview } from "../ui/keyboard-preview";
export function Overview({ s }: { s: StudioState }) {
  return (
    <>
      <div className="device-summary">
        <div>
          <Badge variant={s.device ? "success" : "secondary"}>
            <Usb size={12} />
            {s.connectionLabel}
          </Badge>
          <h2>
            AULA S75 Pro<span>Seu teclado, do seu jeito.</span>
          </h2>
        </div>
        <div className="device-stats">
          <div>
            <small>PERFIL ATUAL</small>
            <strong>{s.profileName || "Sem nome"}</strong>
          </div>
          <div>
            <small>CONEXÃO</small>
            <strong>{s.device ? "USB com fio" : "Aguardando"}</strong>
          </div>
          <div>
            <small>BATERIA</small>
            <BatteryStatus battery={s.battery} />
          </div>
        </div>
      </div>
      <KeyboardPreview s={s} />
      <div className="shortcut-grid">
        {[
          {
            page: "lighting",
            title: "Iluminação",
            text: s.effectNames[s.settings.effect],
            Icon: Lightbulb,
          },
          {
            page: "screen",
            title: "Tela LCD",
            text: s.settings.media?.name || "Adicione uma imagem ou GIF",
            Icon: Monitor,
          },
          {
            page: "keys",
            title: "Teclas e camadas",
            text: `${Object.keys(s.settings.mappings).length} remapeamentos no perfil`,
            Icon: Command,
          },
        ].map(({ page, title, text, Icon }) => (
          <Card key={page} className="studio-card shortcut-card">
            <Icon size={21} />
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
            <Button
              variant="ghost"
              iconOnly
              aria-label={`Abrir ${title}`}
              onClick={() => {
                s.page = page;
              }}
            >
              <ArrowRight size={16} />
            </Button>
          </Card>
        ))}
      </div>
      <Panel
        title="Conexão do teclado"
        description="Use o cabo USB para enviar configurações e mídia."
        action={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            loading={s.refreshing}
            disabled={!s.native}
            onClick={() => {
              void s.refresh();
            }}
          >
            Verificar
          </Button>
        }
      >
        <div className="diagnostics">
          <div>
            <small>Dispositivo</small>
            <strong>
              {s.device
                ? `${s.device.vendorId}:${s.device.productId}`
                : "Não detectado"}
            </strong>
          </div>
          <div>
            <small>Interfaces HID</small>
            <strong>
              {s.device
                ? `${s.interfaces.length} identificadas`
                : "Aguardando USB"}
            </strong>
          </div>
          <div>
            <small>Configuração</small>
            <strong>
              {canSend(s) ? "Disponível por USB" : "Aguardando conexão"}
            </strong>
          </div>
          <Button
            disabled={!canSend(s)}
            onClick={() => {
              void s.probeKeyboard();
            }}
          >
            Testar comunicação
          </Button>
        </div>
        {s.device && (
          <details className="details">
            <summary>Detalhes das interfaces</summary>
            {s.interfaces.map((item) => (
              <div className="interface-row" key={item.node}>
                <code>{item.node}</code>
                <span>{item.driver || "HID"}</span>
                <small>{item.nodeVisible ? "Visível" : "Indisponível"}</small>
              </div>
            ))}
          </details>
        )}
        {s.battery?.message && <p className="hint">{s.battery.message}</p>}
      </Panel>
    </>
  );
}
