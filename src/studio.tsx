import { useRef } from "react";
import {
  ChevronRight,
  Command,
  FolderOpen,
  Keyboard,
  Layers,
  Lightbulb,
  Monitor,
  Music2,
  PanelTop,
  RefreshCw,
  Save,
  Settings2,
  Usb,
} from "lucide-react";
import { Badge, Button, Card } from "./ui";
import {
  BatteryStatus,
  Notice,
  Panel,
  Transfer,
  EditingLock,
} from "./ui/shared";
import { Apply } from "./ui/studio-controls";
import { useController } from "./use-controller";
import { createStudioController } from "./main-controller";
export type StudioState = ReturnType<typeof createStudioController>["state"];
import { Overview } from "./pages/overview";
import { Keys } from "./pages/keys";
import { Lighting } from "./pages/lighting";
import { Screen } from "./pages/screen";
import { Live } from "./pages/live";
import { Macros } from "./pages/macros";
import { Device } from "./pages/device";
import { Profiles } from "./pages/profiles";
const icons = {
  overview: Keyboard,
  keys: Command,
  lighting: Lightbulb,
  live: Music2,
  macros: Layers,
  screen: Monitor,
  device: Settings2,
  profiles: FolderOpen,
};
const captions: Record<string, string> = {
  overview: "Tudo o que importa, em um só lugar.",
  keys: "Remapeie teclas e organize sua camada Fn.",
  lighting: "Ajuste a cor do teclado inteiro ou personalize cada tecla.",
  live: "Transforme música e animações em iluminação.",
  macros: "Crie sequências e execute com um toque.",
  screen: "Escolha o próximo visual da tela do seu teclado.",
  device: "Ajuste o comportamento e os detalhes do S75 Pro.",
  profiles: "Guarde suas configurações para cada momento.",
};
export function Studio() {
  const s = useController(createStudioController);
  return <StudioView s={s} />;
}
export function StudioView({ s }: { s: StudioState }) {
  const content = useRef<HTMLDivElement>(null);
  const go = (page: string) => {
    s.page = page;
    s.recording = false;
    content.current?.scrollTo({ top: 0 });
  };
  return (
    <div className="studio-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">
            <Keyboard size={23} />
          </span>
          <div>
            <strong>S75 Studio</strong>
            <small>Seu espaço de controle</small>
          </div>
        </div>
        <div className="nav-label">PERSONALIZAR</div>
        <nav aria-label="Navegação principal">
          {s.pages.map((p) => {
            const Icon = icons[p.id as keyof typeof icons];
            return (
              <Button
                key={p.id}
                variant="ghost"
                className={`nav-button ${s.page === p.id ? "active" : ""}`}
                aria-current={s.page === p.id ? "page" : undefined}
                disabled={s.hardwareBusy || s.closing || s.initializing}
                onClick={() => go(p.id)}
                leftIcon={<Icon size={17} />}
              >
                {p.name}
              </Button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <Card className="sidebar-device">
            <div className="inline-icon">
              <Keyboard size={19} />
              <strong>AULA S75 Pro</strong>
              <span className={`status-dot ${s.device ? "online" : ""}`} />
            </div>
            <small>{s.connectionLabel}</small>
            <BatteryStatus battery={s.battery} compact />
          </Card>
          <div className="version">
            <span>S75 Studio</span>
            <span>0.7.0</span>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Meu teclado <ChevronRight size={13} />
            <strong>{s.currentPage.name}</strong>
          </span>
          <div className="topbar-end">
            <Badge variant={s.device ? "success" : "secondary"}>
              <span className={`status-dot ${s.device ? "online" : ""}`} />
              {s.connectionLabel}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Atualizar conexão e bateria"
              disabled={s.refreshing || !s.native}
              onClick={() => {
                void s.refresh();
              }}
            >
              <RefreshCw size={16} />
            </Button>
            {s.native && (
              <Button
                variant="ghost"
                leftIcon={<PanelTop size={15} />}
                disabled={s.closing || s.hardwareBusy || s.installingPanel}
                onClick={() => {
                  void s.recollect("quick");
                }}
              >
                Controle rápido
              </Button>
            )}
          </div>
        </header>
        <div className="content-scroll" ref={content}>
          <div className="page-content">
            <div className="page-heading">
              <div>
                <h1>{s.currentPage.name}</h1>
                <p>{captions[s.page]}</p>
              </div>
              <div className="header-actions">
                <span className={`draft-status ${s.dirty ? "dirty" : ""}`}>
                  {s.dirty ? "Alterações pendentes" : "Perfil salvo"}
                </span>
                <Button
                  leftIcon={<Save size={15} />}
                  disabled={s.hardwareBusy || s.closing || s.initializing}
                  loading={s.saving}
                  onClick={() => {
                    void s.save();
                  }}
                >
                  Salvar perfil
                </Button>
                <Apply s={s} scope="profile">
                  Enviar perfil
                </Apply>
              </div>
            </div>
            {!s.native && (
              <Notice>
                Prévia no navegador. Abra o aplicativo desktop para enviar
                configurações por USB.
              </Notice>
            )}
            {s.desktopIntegration?.gnome &&
              !s.desktopIntegration.batteryMenu && (
                <div className="integration-note">
                  <div className="inline-icon">
                    <PanelTop size={18} />
                    <span>
                      Seu teclado na barra do GNOME.
                      <small>GIF, cor e bateria sem abrir o editor.</small>
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      void s.installPanel();
                    }}
                    loading={s.installingPanel}
                    disabled={s.hardwareBusy}
                  >
                    Ativar integração
                  </Button>
                </div>
              )}
            {s.error && (
              <Notice
                error
                dismiss={() => {
                  s.error = "";
                }}
              >
                {s.error}
              </Notice>
            )}
            {s.progress && (
              <Transfer
                progress={s.progress}
                busy={s.hardwareBusy}
                outcome={s.hardwareOutcome}
                percent={s.transferPercent}
                cancel={s.cancelTransfer}
                canCancel={s.canCancel}
              />
            )}
            {s.pendingProfile && (
              <Panel
                title="Há alterações não salvas"
                description={`Carregar “${s.pendingProfile.name}” substitui as alterações atuais. Salve seu perfil antes se quiser mantê-las.`}
              >
                <div className="actions">
                  <Button
                    onClick={() => {
                      s.pendingProfile = null;
                    }}
                  >
                    Continuar editando
                  </Button>
                  <Button variant="primary" onClick={s.confirmLoad}>
                    Carregar perfil
                  </Button>
                </div>
              </Panel>
            )}
            <EditingLock.Provider
              value={s.hardwareBusy || s.closing || s.initializing}
            >
              <fieldset
                className="editor-body"
                inert={s.hardwareBusy || s.closing || s.initializing}
                disabled={s.hardwareBusy || s.closing || s.initializing}
              >
                {s.page === "overview" && <Overview s={s} />}{" "}
                {s.page === "keys" && <Keys s={s} />}{" "}
                {s.page === "lighting" && <Lighting s={s} />}{" "}
                {s.page === "live" && <Live s={s} />}{" "}
                {s.page === "screen" && <Screen s={s} />}{" "}
                {s.page === "macros" && <Macros s={s} />}{" "}
                {s.page === "device" && <Device s={s} />}{" "}
                {s.page === "profiles" && <Profiles s={s} />}
              </fieldset>
            </EditingLock.Provider>
            <footer className="content-footer">
              <span>Configurações locais. Controle nas suas mãos.</span>
              <span className="inline-icon">
                <Usb size={12} />
                Envio ao teclado por USB
              </span>
            </footer>
          </div>
        </div>
      </main>
      {s.toast && (
        <div className="toast" role="status">
          <Badge variant="success">
            <Save size={13} /> {s.toast}
          </Badge>
        </div>
      )}
    </div>
  );
}
