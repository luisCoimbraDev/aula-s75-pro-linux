import { lifecycle, bindController } from "./controller-runtime";
import { ref, computed } from "@vue/reactivity";
import { invoke, isTauri, Channel } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  fileMedia,
  inspectQuickMedia,
  thumbnail,
  type Media,
} from "./quick-media";
import { prepareMedia } from "./screen-encode.mjs";
import type { TransferProgress, KeyboardBattery } from "./types";

interface QuickSettings {
  color: string;
  brightness: number;
  updatedAt: number;
  mediaName: string | null;
  fit: "cover" | "contain";
}
export function createQuickController() {
  const life = lifecycle();
  const { onMounted, onUnmounted } = life;
  const activeTab = ref<"gif" | "color">("gif");
  const battery = ref<KeyboardBattery | null>(null);
  const native = isTauri(),
    color = ref("#ff865f"),
    brightness = ref(4),
    fit = ref<"cover" | "contain">("cover");
  const busy = ref(false),
    dragging = ref(false),
    preview = ref(""),
    lastMedia = ref(""),
    outcome = ref("");
  const progress = ref<TransferProgress | null>(null),
    message = ref(
      native
        ? "Pronto para dar um novo tom ao seu setup."
        : "Prévia visual · abra o app desktop para enviar.",
    );
  const integration = ref<{
      gnome: boolean;
      enabled: boolean;
      anchored: boolean;
      nativeMenu: boolean;
      batteryMenu: boolean;
    } | null>(null),
    installingPanel = ref(false);
  const cancellable = ref(false);
  let cancelled = false,
    disposed = false;
  const listeners: UnlistenFn[] = [];
  const colors = [
    { name: "pêssego", value: "#ff865f" },
    { name: "dourada", value: "#e6c778" },
    { name: "menta", value: "#92d4ba" },
    { name: "azul", value: "#80baff" },
    { name: "lilás", value: "#b6a1e9" },
    { name: "rosa", value: "#ed99bb" },
  ];
  const percent = computed(() =>
    progress.value
      ? Math.min(
          100,
          Math.floor(
            (progress.value.completed / Math.max(1, progress.value.total)) *
              100,
          ),
        )
      : 0,
  );
  const fail = (e: unknown) => {
    outcome.value = "error";
    message.value = String(e instanceof Error ? e.message : e);
  };
  function adopt(settings: QuickSettings) {
    color.value = settings.color;
    brightness.value = settings.brightness;
    fit.value = settings.fit;
    lastMedia.value = settings.mediaName ?? "";
  }
  async function context() {
    const ctx = await invoke<{
      settings: QuickSettings;
      message: string | null;
    }>("get_quick_context");
    adopt(ctx.settings);
    if (ctx.message) fail(ctx.message);
  }
  async function applyColor(value: string) {
    if (busy.value) return;
    if (!native) return fail("Abra o executável desktop para aplicar a cor.");
    const oldColor = color.value;
    busy.value = true;
    outcome.value = "";
    progress.value = { stage: "lighting", completed: 0, total: 1, message: "" };
    message.value = "Ajustando a cor do teclado…";
    try {
      const settings = await invoke<QuickSettings>("set_quick_color", {
        color: value,
        brightness: brightness.value,
      });
      adopt(settings);
      outcome.value = "success";
      message.value = "Cor aplicada no teclado inteiro.";
    } catch (e) {
      color.value = oldColor;
      fail(e);
    } finally {
      busy.value = false;
      progress.value = null;
    }
  }
  const customColor = (event: Event) =>
    applyColor((event.target as HTMLInputElement).value);
  async function sendMedia(load: () => Promise<Media>) {
    if (busy.value)
      return fail(
        "Aguarde o envio atual terminar antes de soltar outra imagem.",
      );
    if (!native)
      return fail("Abra o executável desktop para enviar ao teclado.");
    activeTab.value = "gif";
    busy.value = true;
    cancellable.value = true;
    cancelled = false;
    outcome.value = "";
    message.value = "Lendo sua imagem…";
    progress.value = {
      stage: "convert",
      completed: 0,
      total: 1,
      message: message.value,
    };
    try {
      const media = await load();
      const still = await thumbnail(media);
      const request = await prepareMedia(
        media,
        (completed: number, total: number) => {
          progress.value = {
            stage: "convert",
            completed,
            total,
            message: `Preparando quadro ${completed} de ${total}`,
          };
          message.value = progress.value.message;
        },
        () => cancelled,
      );
      if (cancelled) throw new Error("Envio cancelado.");
      message.value = "Enviando para o LCD. Mantenha o cabo conectado.";
      progress.value = {
        stage: "screen",
        completed: 0,
        total: 1,
        message: message.value,
      };
      const channel = new Channel<TransferProgress>();
      channel.onmessage = (p) => {
        progress.value = p;
        message.value = p.message;
      };
      await invoke("upload_screen", { request, progress: channel });
      preview.value = still;
      lastMedia.value = media.name;
      outcome.value = "success";
      message.value = "Pronto! Sua imagem já está no teclado.";
      try {
        await invoke("remember_quick_media", {
          name: media.name,
          fit: media.fit,
        });
      } catch (e) {
        message.value =
          "Imagem enviada. Não foi possível guardar o nome do arquivo: " +
          String(e);
      }
    } catch (e) {
      fail(e);
    } finally {
      busy.value = false;
      cancellable.value = false;
      progress.value = null;
      dragging.value = false;
    }
  }
  async function chooseFile(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      await sendMedia(() => fileMedia(file, fit.value));
    } finally {
      input.value = "";
    }
  }
  async function browserDrop(event: DragEvent) {
    dragging.value = false;
    const file = event.dataTransfer?.files[0];
    if (file) await sendMedia(() => fileMedia(file, fit.value));
  }
  async function cancel() {
    cancelled = true;
    message.value = "Cancelando envio…";
    if (native && progress.value?.stage === "screen")
      try {
        await invoke("cancel_upload");
      } catch (e) {
        fail(e);
      }
  }
  async function close() {
    if (busy.value || installingPanel.value)
      return fail("Aguarde a operação terminar antes de recolher.");
    if (native)
      try {
        await invoke("close_panel", { next: null });
      } catch (e) {
        fail(e);
      }
  }
  async function openEditor() {
    if (!native || busy.value || installingPanel.value) return;
    try {
      await invoke("close_panel", { next: "main" });
    } catch (e) {
      fail(e);
    }
  }
  async function enableTray() {
    try {
      integration.value = await invoke("enable_gnome_tray");
      message.value = "Ícone ativado na barra do GNOME.";
    } catch (e) {
      fail(e);
    }
  }
  async function drag() {
    if (native)
      try {
        await invoke("drag_panel");
      } catch (e) {
        fail(e);
      }
  }
  async function installPanel() {
    installingPanel.value = true;
    try {
      const result = await invoke<{
        integration: {
          gnome: boolean;
          enabled: boolean;
          anchored: boolean;
          nativeMenu: boolean;
          batteryMenu: boolean;
        };
        requiresRelogin: boolean;
      }>("install_gnome_panel");
      integration.value = result.integration;
      message.value = result.requiresRelogin
        ? "Menu nativo instalado. Saia e entre na sessão GNOME uma vez; depois abra pelo launcher."
        : "Menu nativo ativado. Clique no ícone para abrir ou recolher.";
      outcome.value = "success";
    } catch (e) {
      fail(e);
    } finally {
      installingPanel.value = false;
    }
  }
  onMounted(async () => {
    if (!native) return;
    try {
      listeners.push(
        await getCurrentWindow().listen("request-panel-close", () => {
          void close();
        }),
      );
      listeners.push(
        await listen<QuickSettings>("quick-color-changed", ({ payload }) =>
          adopt(payload),
        ),
      );
      listeners.push(
        await listen("quick-error", () => {
          void context().catch(fail);
        }),
      );
      listeners.push(
        await getCurrentWindow().onDragDropEvent(({ payload }) => {
          if (payload.type === "enter" || payload.type === "over") {
            dragging.value = true;
            return;
          }
          dragging.value = false;
          if (payload.type !== "drop") return;
          if (payload.paths.length !== 1)
            return fail("Arraste uma imagem de cada vez.");
          const path = payload.paths[0];
          void sendMedia(async () => {
            const file = await invoke<{ name: string; data: string }>(
              "read_dropped_media",
              { path },
            );
            return inspectQuickMedia(file.name, file.data, fit.value);
          });
        }),
      );
      await context();
      integration.value = await invoke("get_desktop_integration");
      battery.value = await invoke<KeyboardBattery>("get_keyboard_battery");
    } catch (e) {
      fail(e);
    } finally {
      if (disposed) listeners.splice(0).forEach((fn) => fn());
    }
  });
  onUnmounted(() => {
    disposed = true;
    listeners.splice(0).forEach((fn) => fn());
    preview.value = "";
  });
  return bindController(
    {
      battery,
      activeTab,
      color,
      brightness,
      fit,
      busy,
      dragging,
      preview,
      lastMedia,
      outcome,
      progress,
      message,
      integration,
      cancellable,
      colors,
      percent,
      applyColor,
      customColor,
      chooseFile,
      browserDrop,
      cancel,
      close,
      openEditor,
      enableTray,
      drag,
      installingPanel,
      installPanel,
    },
    life,
  );
}
