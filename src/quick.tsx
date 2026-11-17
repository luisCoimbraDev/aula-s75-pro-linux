import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Check,
  FileImage,
  Keyboard,
  Lightbulb,
  Monitor,
  PanelTop,
  Upload,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./ui";
import {
  BatteryStatus,
  Choice,
  ColorPicker,
  FileButton,
  Range,
} from "./ui/shared";
import { createQuickController } from "./quick-controller";
import { useController } from "./use-controller";
import "./style.css";
import "./quick.css";
export function Quick() {
  const s = useController(createQuickController);
  const locked = s.busy || s.installingPanel;
  return (
    <main className="quick-shell">
      <header className="quick-header">
        <div className="inline-icon">
          <span className="brand-symbol">
            <Keyboard size={21} />
          </span>
          <div>
            <h1>S75 Studio</h1>
            <small>Controle rápido</small>
          </div>
        </div>
        <div className="inline-icon">
          <BatteryStatus battery={s.battery} compact />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Recolher painel"
            disabled={locked}
            onClick={() => {
              void s.close();
            }}
          >
            <X size={16} />
          </Button>
        </div>
      </header>
      <div className="quick-content">
        {s.integration?.gnome && !s.integration.batteryMenu && (
          <Card className="studio-card quick-integration">
            <PanelTop size={17} />
            <p>Fixe o controle na barra do GNOME.</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={locked}
              loading={s.installingPanel}
              onClick={() => {
                void s.installPanel();
              }}
            >
              Ativar
            </Button>
          </Card>
        )}
        <Tabs
          value={s.activeTab}
          onValueChange={(v) => {
            s.activeTab = v as "gif" | "color";
          }}
        >
          <TabsList className="quick-tabs">
            <TabsTrigger value="gif" icon={<Monitor />}>
              Tela LCD
            </TabsTrigger>
            <TabsTrigger value="color" icon={<Lightbulb />}>
              Cor do teclado
            </TabsTrigger>
          </TabsList>
          <TabsContent value="gif">
            <section className="quick-section">
              <div className="quick-section-title">
                <h2>Um novo GIF, um novo visual.</h2>
                <p>Arraste um arquivo para enviar automaticamente.</p>
              </div>
              <div
                className={`quick-drop ${s.dragging ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!locked) s.dragging = true;
                }}
                onDragLeave={() => {
                  s.dragging = false;
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void s.browserDrop(e.nativeEvent);
                }}
              >
                <div className="quick-preview">
                  {s.preview ? (
                    <img src={s.preview} alt="Última imagem enviada ao LCD" />
                  ) : (
                    <>
                      <Monitor size={25} />
                      <span>135 × 240</span>
                    </>
                  )}
                </div>
                <div className="quick-drop-info">
                  <Upload size={24} />
                  <strong>
                    {s.dragging ? "Solte para enviar" : "Arraste seu GIF aqui"}
                  </strong>
                  <small>GIF, PNG ou JPEG · até 4 MiB</small>
                  <FileButton
                    accept="image/gif,image/png,image/jpeg"
                    onChange={s.chooseFile}
                    disabled={locked}
                  >
                    Escolher arquivo
                  </FileButton>
                </div>
              </div>
              {s.lastMedia && (
                <p className="last-media">
                  <FileImage size={13} />
                  <span>{s.lastMedia}</span>
                </p>
              )}
              <Choice
                label="Enquadramento"
                value={s.fit}
                onChange={(v) => {
                  s.fit = v as "cover" | "contain";
                }}
                options={[
                  { value: "cover", label: "Preencher a tela" },
                  { value: "contain", label: "Mostrar imagem inteira" },
                ]}
                disabled={locked}
              />
            </section>
          </TabsContent>
          <TabsContent value="color">
            <section className="quick-section">
              <div className="quick-section-title">
                <h2>A cor do teclado inteiro.</h2>
                <p>Escolha uma cor para aplicar na hora.</p>
              </div>
              <ColorPicker
                value={s.color}
                onChange={(v) => {
                  void s.applyColor(v);
                }}
                colors={s.colors.map((c) => c.value)}
                disabled={locked}
              />
              <Range
                label="Brilho"
                value={s.brightness}
                onChange={(v) => {
                  s.brightness = v;
                }}
                onChangeEnd={() => {
                  void s.applyColor(s.color);
                }}
                disabled={locked}
              />
              <Button
                variant="primary"
                fullWidth
                leftIcon={<Check size={15} />}
                onClick={() => {
                  void s.applyColor(s.color);
                }}
                disabled={locked}
              >
                Aplicar cor e brilho
              </Button>
              <p className="hint">
                As configurações por tecla estão disponíveis no editor completo.
              </p>
            </section>
          </TabsContent>
        </Tabs>
        <div
          className={`quick-feedback ${s.outcome}`}
          role={s.outcome === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="status-dot" />
          <p>{s.message}</p>
          {s.progress && <Progress value={s.percent} size="sm" />}
          {s.cancellable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void s.cancel();
              }}
            >
              Cancelar envio
            </Button>
          )}
        </div>
      </div>
      <footer className="quick-footer">
        <small>Envio por cabo USB</small>
        <Button
          variant="ghost"
          size="sm"
          rightIcon={<ArrowUpRight size={14} />}
          disabled={locked}
          onClick={() => {
            void s.openEditor();
          }}
        >
          Abrir editor
        </Button>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("app")!).render(<Quick />);
