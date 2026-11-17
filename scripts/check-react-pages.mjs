// Render the actual React + Darwin UI pages without a display or a USB device.
import { build } from "esbuild";
import { mkdir, rm, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const out = resolve("analysis/ui-check/studio.mjs");
await mkdir(resolve("analysis/ui-check"), { recursive: true });
await build({
  entryPoints: ["src/studio.tsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: out,
  jsx: "automatic",
  logLevel: "silent",
});
const { StudioView } = await import(pathToFileURL(out));
const controllerOut = resolve("analysis/ui-check/controller.mjs");
await build({
  entryPoints: ["src/main-controller.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: controllerOut,
  logLevel: "silent",
});
const { createStudioController } = await import(pathToFileURL(controllerOut));
const controller = createStudioController(),
  s = controller.state;
const errors = [];
const oldError = console.error;
console.error = (...args) => errors.push(args.join(" "));
try {
  for (const page of s.pages) {
    s.page = page.id;
    const html = renderToStaticMarkup(createElement(StudioView, { s }));
    assert.ok(html.includes(`<h1>${page.name}</h1>`), `Título de ${page.name}`);
    assert.equal(
      (html.match(/aria-label="Selecionar tecla /g) || []).length,
      ["overview", "keys", "lighting"].includes(page.id) ? 80 : 0,
    );
    assert.ok(html.includes("Navegação principal"));
  }
  s.page = "lighting";
  s.individualLighting = true;
  s.customColor = "#aabbcc";
  let html = renderToStaticMarkup(createElement(StudioView, { s }));
  assert.ok(html.includes("Cor da tecla A"));
  assert.ok(html.includes("#AABBCC"));
  s.individualLighting = false;
  html = renderToStaticMarkup(createElement(StudioView, { s }));
  assert.equal(html.includes("Cor da tecla A"), false);
  s.page = "macros";
  s.addMacro();
  s.macro.events.push({ key: "KeyA", kind: "down", delay: 15 });
  html = renderToStaticMarkup(createElement(StudioView, { s }));
  assert.ok(html.includes("KeyA"));
  assert.ok(html.includes("Atraso do evento 1"));
  s.page = "screen";
  s.settings.media = {
    data: "data:image/gif;base64,R0lGODlh",
    name: "teste.gif",
    frames: 1,
    fit: "contain",
  };
  html = renderToStaticMarkup(createElement(StudioView, { s }));
  assert.ok(html.includes("teste.gif"));
  assert.ok(html.includes("object-fit:contain"));
  s.page = "overview";
  s.battery = {
    percent: null,
    charging: null,
    source: "usb",
    message: "Nível indisponível por USB",
    updatedAt: null,
    deviceId: null,
  };
  html = renderToStaticMarkup(createElement(StudioView, { s }));
  assert.ok(html.includes("Nível indisponível"));
  assert.equal(html.includes("100%"), false);
  s.battery = {
    ...s.battery,
    percent: 42,
    source: "bluetooth",
    updatedAt: Date.now(),
  };
  html = renderToStaticMarkup(createElement(StudioView, { s }));
  assert.ok(html.includes("42%"));
  s.page = "profiles";
  s.pendingProfile = {
    schemaVersion: 1,
    id: "p",
    name: "Outro perfil",
    updatedAt: "",
    settings: JSON.parse(JSON.stringify(s.settings)),
  };
  html = renderToStaticMarkup(createElement(StudioView, { s }));
  assert.ok(html.includes("Há alterações não salvas"));
  assert.ok(html.includes("Continuar editando"));
  assert.deepEqual(
    errors,
    [],
    "Nenhum erro ou aviso React durante a renderização",
  );
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.ok(!pkg.dependencies.vue, "Sem runtime de renderização Vue");
  console.log(
    "React + Darwin UI: 8 páginas renderizadas, 80 teclas, cores individuais, macros, LCD, bateria e confirmação de perfil passaram.",
  );
} finally {
  console.error = oldError;
  controller.dispose();
  await Promise.all([
    rm(out, { force: true }),
    rm(controllerOut, { force: true }),
  ]);
}
