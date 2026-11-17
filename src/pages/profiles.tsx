import type { StudioState } from "../studio";
import { Badge, Button, Card, Input } from "../ui";
import { Empty, Field, FileButton, Panel } from "../ui/shared";

import { ArrowRight, Download, FolderOpen, Plus, Save } from "lucide-react";
export function Profiles({ s }: { s: StudioState }) {
  return (
    <>
      <Panel
        title="Perfil em edição"
        description="Salvar guarda as configurações neste computador."
        action={
          <Badge variant={s.dirty ? "warning" : "success"}>
            {s.dirty ? "Alterações pendentes" : "Salvo"}
          </Badge>
        }
      >
        <div className="profile-editor">
          <Field label="Nome do perfil">
            <Input
              aria-label="Nome do perfil"
              value={s.profileName}
              onChange={(e) => {
                s.profileName = e.target.value;
              }}
              maxLength={60}
              placeholder="Meu setup"
            />
          </Field>
          <Button
            leftIcon={<Save size={15} />}
            variant="primary"
            onClick={() => {
              void s.save();
            }}
            loading={s.saving}
          >
            Salvar perfil
          </Button>
          <Button leftIcon={<Plus size={15} />} onClick={s.newProfile}>
            Novo perfil
          </Button>
        </div>
      </Panel>
      <Panel
        title="Biblioteca de perfis"
        description="Carregue um perfil para continuar a personalização."
        action={<Badge>{s.profiles.length} / 20</Badge>}
      >
        {s.profiles.length ? (
          <div className="profile-grid">
            {s.profiles.map((p) => (
              <Card
                key={p.id}
                className={`studio-card profile-card ${s.profileId === p.id ? "current" : ""}`}
              >
                <div className="spread">
                  <span
                    className="profile-color"
                    style={{ background: p.settings.color }}
                  />
                  <Badge>
                    {s.profileId === p.id
                      ? "Em edição"
                      : s.formatDate(p.updatedAt)}
                  </Badge>
                </div>
                <h3>{p.name}</h3>
                <p>
                  {Object.keys(p.settings.mappings).length} remapeamentos ·{" "}
                  {p.settings.macros.length} macros
                </p>
                <Button
                  variant="ghost"
                  fullWidth
                  rightIcon={<ArrowRight size={14} />}
                  onClick={() => s.chooseProfile(p)}
                >
                  Carregar no editor
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <Empty
            icon={<FolderOpen size={28} />}
            title="Seus setups ficam aqui"
            description="Salve o primeiro perfil para encontrá-lo nesta biblioteca."
          />
        )}
        <div className="actions start">
          <Button
            leftIcon={<Download size={14} />}
            onClick={() => {
              void s.exportProfile();
            }}
          >
            Exportar perfil
          </Button>
          <FileButton
            accept=".json,application/json"
            onChange={s.importProfile}
          >
            Importar perfil
          </FileButton>
          <small className="muted">Formato S75 Studio · JSON</small>
        </div>
      </Panel>
    </>
  );
}
