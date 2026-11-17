import type { CSSProperties } from "react";
import type { StudioState } from "../studio";
import type { Key } from "../types";
import { Badge, Button, Tabs, TabsList, TabsTrigger } from "./index";
import { Panel } from "./shared";
export function KeyboardPreview({ s }: { s: StudioState }) {
  const selectable =
    s.page === "keys" || (s.page === "lighting" && s.individualLighting);
  return (
    <Panel
      title={s.page === "keys" ? "Selecione uma tecla" : "Seu S75 Pro"}
      description={
        s.page === "lighting"
          ? s.individualLighting
            ? "As demais teclas usam a cor principal."
            : "A cor principal se aplica ao teclado inteiro."
          : "Layout ANSI · 80 teclas"
      }
      action={
        s.page === "keys" ? (
          <Tabs
            value={s.layer}
            onValueChange={(v) => {
              s.layer = v;
            }}
          >
            <TabsList>
              <TabsTrigger value="base">Principal</TabsTrigger>
              <TabsTrigger value="fn">Fn</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <Badge>{s.effectNames[s.settings.effect]}</Badge>
        )
      }
      className="keyboard-panel"
    >
      <div className="keyboard-stage">
        <div className="keyboard-case">
          <div
            className="keyboard-layout"
            role="group"
            aria-label="Teclado AULA S75 Pro, 80 teclas"
          >
            {s.keys.map((key: Key) => (
              <Button
                key={key.id}
                variant="ghost"
                className={`keycap ${selectable && s.selected.id === key.id ? "selected" : ""}`}
                style={s.keyStyle(key) as CSSProperties}
                aria-label={`Selecionar tecla ${key.label}`}
                aria-pressed={selectable && s.selected.id === key.id}
                onClick={() => s.selectKey(key)}
              >
                <span>{key.label}</span>
                {s.settings.mappings[`${s.layer}:${key.id}`] && <i />}
              </Button>
            ))}
            <div className="device-lcd">
              {s.settings.media ? (
                <img
                  src={s.settings.media.data}
                  alt="Prévia do LCD"
                  style={{ objectFit: s.settings.media.fit }}
                />
              ) : (
                <>
                  <span>S75</span>
                  <small>STUDIO</small>
                </>
              )}
            </div>
            <div className="device-knob">
              <span />
            </div>
            <span className="device-signature">
              AULA <b>S75 PRO</b>
            </span>
          </div>
        </div>
      </div>
      <div className="keyboard-caption">
        <span className="inline-icon">
          <span
            className="color-dot"
            style={{ background: s.settings.color }}
          />
          {selectable
            ? "Clique em uma tecla para editar"
            : "Prévia do perfil em edição"}
        </span>
        <span>75% · ANSI</span>
      </div>
    </Panel>
  );
}
