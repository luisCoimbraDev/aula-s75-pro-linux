import { lifecycle, bindController } from "./controller-runtime";
import { ref, reactive, computed } from "@vue/reactivity";
import { invoke, isTauri, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import keyboard from "./keyboard.json" with { type: "json" };
import { inspectGif } from "./media.mjs";
import { prepareMedia, prepareLiveMedia } from "./screen-encode.mjs";
import { defaults, clone, validateProfile } from "./profiles";
import type {
  Diagnostics,
  Key,
  Profile,
  Settings,
  TransferProgress,
  KeyboardBattery,
} from "./types";

export function createStudioController() {
  const life = lifecycle();
  const { onMounted, onUnmounted } = life;
  const native = isTauri();
  const pages = [
    {
      id: "overview",
      name: "Visão geral",
      icon: "▦",
      subtitle: "Seu espaço de controle",
    },
    {
      id: "keys",
      name: "Teclas e camadas",
      icon: "⌘",
      subtitle: "Cada tecla, do seu jeito",
    },
    {
      id: "lighting",
      name: "Iluminação",
      icon: "✳",
      subtitle: "Dê cor ao seu setup",
    },
    {
      id: "live",
      name: "Efeitos ao vivo",
      icon: "♫",
      subtitle: "Cor que acompanha o seu ritmo",
    },
    {
      id: "macros",
      name: "Macros",
      icon: "≋",
      subtitle: "Menos repetição, mais possibilidades",
    },
    {
      id: "screen",
      name: "Tela LCD",
      icon: "▣",
      subtitle: "Um pequeno espaço para sua identidade",
    },
    {
      id: "device",
      name: "Opções do teclado",
      icon: "⚙",
      subtitle: "Ajustes que fazem a diferença",
    },
    {
      id: "profiles",
      name: "Perfis",
      icon: "☷",
      subtitle: "Seu teclado em diferentes momentos",
    },
  ];
  const page = ref("overview");
  const currentPage = computed(() => pages.find((p) => p.id === page.value)!);
  const settings = reactive<Settings>(defaults());
  const profileName = ref("Meu setup");
  const profileId = ref<string>(crypto.randomUUID());
  const profiles = ref<Profile[]>([]);
  const saved = ref("");
  const dirty = computed(
    () => saved.value !== JSON.stringify({ name: profileName.value, settings }),
  );
  const saving = ref(false),
    refreshing = ref(false),
    toast = ref(""),
    error = ref("");
  const closing = ref(false),
    initializing = ref(true);
  const desktopIntegration = ref<{
    gnome: boolean;
    enabled: boolean;
    anchored: boolean;
    nativeMenu: boolean;
    batteryMenu: boolean;
  } | null>(null);
  const installingPanel = ref(false);
  const unlisteners: UnlistenFn[] = [];
  async function enableTray() {
    try {
      desktopIntegration.value = await invoke("enable_gnome_tray");
      notify("Suporte à bandeja ativado no GNOME.");
    } catch (e) {
      failure(e);
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
      desktopIntegration.value = result.integration;
      notify(
        result.requiresRelogin
          ? "Menu nativo instalado. Saia e entre no GNOME uma vez; depois abra pelo launcher."
          : "Menu nativo ativado na barra do GNOME.",
      );
    } catch (e) {
      failure(e);
    } finally {
      installingPanel.value = false;
    }
  }
  async function recollect(next?: string, exit = false) {
    if (closing.value) return;
    if (installingPanel.value)
      return failure("Aguarde a instalação da integração terminar.");
    if (initializing.value)
      return failure("Aguarde o perfil terminar de carregar.");
    if (hardwareBusy.value)
      return failure(
        "Aguarde o envio terminar ou pare o efeito antes de recolher a janela.",
      );
    if (!native) return;
    closing.value = true;
    try {
      const profile = validateProfile({
        schemaVersion: 1,
        id: profileId.value,
        name: profileName.value.trim() || "Meu setup",
        updatedAt: new Date().toISOString(),
        settings: clone(settings),
      });
      await invoke("save_editor_draft", {
        draft: {
          profile,
          name: profileName.value,
          dirty: dirty.value,
          page: page.value,
          previousEffect: wholeKeyboardEffect.value,
          capturedAt: 0,
        },
      });
      if (exit) await invoke("exit_application");
      else await invoke("close_panel", { next: next ?? null });
    } catch (e) {
      failure(e);
      closing.value = false;
    }
  }
  const diagnostics = ref<Diagnostics | null>(null);
  const battery = ref<KeyboardBattery | null>(null);
  const device = computed(() =>
    diagnostics.value?.devices.find((d) => d.confirmedModel),
  );
  const possibleReceiver = computed(() =>
    diagnostics.value?.devices.find((d) => !d.confirmedModel),
  );
  const interfaces = computed(() => device.value?.interfaces ?? []);
  const visibleNodes = computed(
    () => interfaces.value.filter((i) => i.nodeVisible).length,
  );
  const connectionLabel = computed(() =>
    !native
      ? "Prévia no navegador"
      : device.value
        ? "USB conectado"
        : possibleReceiver.value
          ? "Receptor detectado"
          : "Teclado não detectado",
  );
  const keys: Key[] = keyboard;
  const selected = ref(keys.find((k) => k.label === "A")!);
  const layer = ref("base");
  const mappingKey = computed(() => `${layer.value}:${selected.value.id}`);
  const mapping = computed({
    get: () => settings.mappings[mappingKey.value] ?? "",
    set: (value: string) => {
      if (value) settings.mappings[mappingKey.value] = value;
      else delete settings.mappings[mappingKey.value];
    },
  });
  const customColor = computed({
    get: () => settings.keyColors[selected.value.id] ?? settings.color,
    set: (value: string) => {
      settings.keyColors[selected.value.id] = value;
      settings.effect = "custom";
    },
  });
  const wholeKeyboardEffect = ref("static");
  const individualLighting = computed({
    get: () => settings.effect === "custom",
    set: (enabled: boolean) => {
      if (enabled) {
        wholeKeyboardEffect.value = settings.effect;
        settings.effect = "custom";
        settings.colorful = false;
      } else settings.effect = wholeKeyboardEffect.value;
    },
  });
  const baseColor = computed({
    get: () => settings.color,
    set: (value: string) => {
      settings.color = value;
      settings.colorful = false;
    },
  });
  const effectNames: Record<string, string> = {
    static: "Cor estática",
    wave: "Onda",
    breathing: "Respiração",
    off: "Desligado",
    custom: "Cor por tecla",
  };
  const hardwareModes = [
    "Desligado",
    "Cor estática",
    "Acender ao tocar",
    "Apagar ao tocar",
    "Cintilante",
    "Flutuação",
    "Colorido",
    "Respiração",
    "Espectro",
    "Expansão",
    "Rolagem",
    "Onda",
    "Rotação",
    "Explosão",
    "Lançamento",
    "Ondulações",
    "Fluxo",
    "Pulsação",
    "Inclinação",
    "Lançadeira",
  ];
  for (let i = 1; i <= 19; i++) effectNames["mode:" + i] = hardwareModes[i];
  const shortcutMods = ref(1),
    shortcutKey = ref(6);
  const effects = [
    { id: "static", name: "Cor estática", icon: "●" },
    { id: "wave", name: "Onda", icon: "≈" },
    { id: "breathing", name: "Respiração", icon: "◉" },
    { id: "off", name: "Desligado", icon: "○" },
  ];
  const colors = [
    "#ff865f",
    "#e6c778",
    "#92d4ba",
    "#80baff",
    "#b6a1e9",
    "#ed99bb",
    "#eeeeef",
  ];
  let toastTimer: ReturnType<typeof setTimeout>;
  const notify = (message: string) => {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = "";
    }, 4000);
  };
  const failure = (e: unknown) => {
    error.value = String(e instanceof Error ? e.message : e);
  };
  async function refresh() {
    if (!native) return;
    refreshing.value = true;
    try {
      const [info, level] = await Promise.all([
        invoke<Diagnostics>("get_diagnostics"),
        invoke<KeyboardBattery>("get_keyboard_battery"),
      ]);
      diagnostics.value = info;
      battery.value = level;
    } catch (e) {
      failure(e);
    } finally {
      refreshing.value = false;
    }
  }
  const snapshot = (): Profile =>
    validateProfile({
      schemaVersion: 1,
      id: profileId.value,
      name: profileName.value.trim(),
      updatedAt: new Date().toISOString(),
      settings: clone(settings),
    });
  async function save() {
    saving.value = true;
    try {
      const profile = snapshot();
      if (native)
        profiles.value = await invoke<Profile[]>("save_profile", { profile });
      else {
        const next = [
          ...profiles.value.filter((p) => p.id !== profile.id),
          profile,
        ];
        if (next.length > 20) throw new Error("Limite local de 20 perfis.");
        localStorage.setItem("s75-profiles-v1", JSON.stringify(next));
        profiles.value = next;
      }
      profileName.value = profile.name;
      saved.value = JSON.stringify({ name: profileName.value, settings });
      notify(
        native
          ? "Perfil salvo neste computador."
          : "Perfil salvo neste navegador.",
      );
    } catch (e) {
      failure(e);
    } finally {
      saving.value = false;
    }
  }
  function loadProfile(profile: Profile) {
    try {
      const p = validateProfile(profile);
      profileId.value = p.id;
      profileName.value = p.name;
      Object.assign(settings, defaults(), p.settings);
      wholeKeyboardEffect.value =
        settings.effect === "custom" ? "static" : settings.effect;
      saved.value = profiles.value.some((local) => local.id === p.id)
        ? JSON.stringify({ name: profileName.value, settings })
        : "";
      selectedMacro.value = null;
      notify(`Perfil “${p.name}” carregado no editor.`);
    } catch (e) {
      failure(e);
    }
  }
  const pendingProfile = ref<Profile | null>(null);
  function chooseProfile(p: Profile) {
    if (dirty.value) pendingProfile.value = p;
    else loadProfile(p);
  }
  function confirmLoad() {
    if (pendingProfile.value) loadProfile(pendingProfile.value);
    pendingProfile.value = null;
  }
  function newProfile() {
    // Preserva o trabalho atual como ponto de partida, sem descartá-lo.
    profileId.value = crypto.randomUUID();
    profileName.value = "Novo perfil";
    saved.value = "";
    page.value = "profiles";
    notify("Novo perfil criado a partir das configurações atuais.");
  }
  async function exportProfile() {
    try {
      const profile = snapshot();
      if (native) {
        const path = await invoke<string>("export_profile", { profile });
        notify(`Perfil exportado: ${path}`);
        return;
      }
      const blob = new Blob([JSON.stringify(profile, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "s75-perfil.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      failure(e);
    }
  }
  async function importProfile(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("O perfil excede 8 MiB.");
      const p = validateProfile(JSON.parse(await file.text()));
      // Importações recebem outro ID para preservar perfis locais existentes.
      p.id = crypto.randomUUID();
      p.name = p.name.slice(0, 50) + " (importado)";
      if (dirty.value) pendingProfile.value = p;
      else loadProfile(p);
    } catch (e) {
      failure(e);
    } finally {
      input.value = "";
    }
  }
  const selectedMacro = ref<string | null>(null),
    recording = ref(false),
    macroInput = ref<HTMLElement | null>(null);
  const macro = computed(() =>
    settings.macros.find((m) => m.id === selectedMacro.value),
  );
  let lastEvent = 0;
  function addMacro() {
    if (settings.macros.length >= 100)
      return failure("Limite local de 100 macros.");
    const id = crypto.randomUUID();
    settings.macros.push({
      id,
      name: `Macro ${settings.macros.length + 1}`,
      events: [],
      playMode: 0,
      loops: 1,
    });
    selectedMacro.value = id;
  }
  function startRecording() {
    if (!macro.value) return;
    recording.value = true;
    lastEvent = performance.now();
    macroInput.value?.focus();
  }
  function recordKey(event: KeyboardEvent, kind: "down" | "up") {
    if (!recording.value || !macro.value) return;
    if (event.code === "Escape") {
      recording.value = false;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || !event.code) return;
    if (macro.value.events.length >= 500) {
      recording.value = false;
      return failure("Limite local de 500 eventos atingido.");
    }
    const now = performance.now();
    macro.value.events.push({
      key: event.code,
      kind,
      delay: Math.min(60000, Math.round(now - lastEvent)),
    });
    lastEvent = now;
  }
  function deleteMacro() {
    if (!macro.value) return;
    const action = `macro:${macro.value.id}`;
    settings.macros = settings.macros.filter((m) => m.id !== macro.value!.id);
    for (const key of Object.keys(settings.mappings))
      if (settings.mappings[key] === action) delete settings.mappings[key];
    selectedMacro.value = null;
    recording.value = false;
  }
  async function importMedia(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      if (!["image/png", "image/jpeg", "image/gif"].includes(file.type))
        throw new Error("Escolha PNG, JPEG ou GIF.");
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Limite local de 4 MiB por imagem.");
      let frames = 1;
      if (file.type === "image/gif") {
        frames = inspectGif(new Uint8Array(await file.arrayBuffer())).frames;
        if (frames > 141) throw new Error("Este GIF tem mais de 141 quadros.");
      }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Falha na leitura da imagem."));
        reader.readAsDataURL(file);
      });
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Imagem inválida."));
        image.src = data;
      });
      settings.media = { data, name: file.name, frames, fit: "cover" };
      notify("Imagem carregada na prévia local.");
    } catch (e) {
      failure(e);
    } finally {
      input.value = "";
    }
  }
  const hardwareBusy = ref(false),
    progress = ref<TransferProgress | null>(null),
    hardwareOutcome = ref("");
  const conversionCancelled = ref(false);
  const livePalette = ref(0),
    liveGain = ref(4);
  const livePalettes = [
    "Arco-íris",
    "Aurora",
    "Lava",
    "Oceano",
    "Floresta",
    "Pôr do sol",
    "Neon",
    "Gelo",
    "Violeta",
    "Âmbar",
    "Branco",
    "Cor do perfil",
  ];
  const transferPercent = computed(() =>
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
  const canCancel = computed(
    () =>
      hardwareBusy.value &&
      ["screen", "convert", "live"].includes(progress.value?.stage ?? ""),
  );
  function progressChannel() {
    const channel = new Channel<TransferProgress>();
    channel.onmessage = (p) => {
      progress.value = p;
    };
    return channel;
  }
  async function withHardware(label: string, work: () => Promise<void>) {
    if (!native)
      return failure(
        "Abra o executável desktop para enviar configurações por USB.",
      );
    if (!device.value)
      return failure("Conecte o AULA S75 Pro pelo cabo USB no modo com fio.");
    if (hardwareBusy.value || closing.value || initializing.value) return;
    hardwareBusy.value = true;
    hardwareOutcome.value = "";
    error.value = "";
    conversionCancelled.value = false;
    progress.value = {
      stage: "connect",
      completed: 0,
      total: 1,
      message: label,
    };
    try {
      await work();
      hardwareOutcome.value = "success";
      notify("Operação concluída: o teclado respondeu aos comandos.");
    } catch (e) {
      hardwareOutcome.value = "error";
      failure(e);
      if (progress.value)
        progress.value.message =
          "Falha: " + String(e instanceof Error ? e.message : e);
    } finally {
      hardwareBusy.value = false;
    }
  }
  async function screenWork() {
    if (!settings.media)
      throw new Error("Selecione uma imagem ou um GIF antes de enviar.");
    const media = clone(settings.media);
    const request = await prepareMedia(
      media,
      (n: number, total: number) => {
        progress.value = {
          stage: "convert",
          completed: n,
          total,
          message: `Convertendo quadro ${n} de ${total}`,
        };
      },
      () => conversionCancelled.value,
    );
    progress.value = {
      stage: "screen",
      completed: 0,
      total: 1,
      message: "Iniciando transferência USB da tela…",
    };
    await invoke("upload_screen", { request, progress: progressChannel() });
  }
  const currentClock = () => {
    const d = new Date();
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      weekday: d.getDay(),
    };
  };
  function sendToKeyboard(scope: string) {
    return withHardware("Preparando configuração…", async () => {
      await invoke("apply_keyboard", {
        profile: snapshot(),
        scope,
        progress: progressChannel(),
      });
      if (scope === "profile") {
        await invoke("sync_keyboard_clock", { time: currentClock() });
        if (settings.media) await screenWork();
      }
      if (scope === "settings" || scope === "bar")
        progress.value = {
          stage: scope,
          completed: 1,
          total: 1,
          message: "Comando aceito pelo teclado",
        };
    });
  }
  const sendScreen = () => withHardware("Preparando imagem…", screenWork);
  const syncClock = () =>
    withHardware("Sincronizando relógio…", async () => {
      await invoke("sync_keyboard_clock", { time: currentClock() });
      progress.value = {
        stage: "clock",
        completed: 1,
        total: 1,
        message: "Data e hora enviadas ao teclado",
      };
    });
  const probeKeyboard = () =>
    withHardware("Testando acesso USB…", async () => {
      await invoke("probe_keyboard");
      progress.value = {
        stage: "probe",
        completed: 1,
        total: 1,
        message: "Resposta HID recebida do S75 Pro",
      };
    });
  async function readColors() {
    return withHardware("Lendo cores atuais…", async () => {
      const colors = await invoke<number[][]>("read_keyboard_colors");
      for (const [id, r, g, b] of colors)
        settings.keyColors[id] =
          "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      settings.effect = "custom";
      progress.value = {
        stage: "read",
        completed: 1,
        total: 1,
        message: "Cores lidas do teclado e carregadas no editor",
      };
    });
  }
  async function cancelTransfer() {
    conversionCancelled.value = true;
    const live = progress.value?.stage === "live";
    if (progress.value)
      progress.value.message = live
        ? "Parando efeito…"
        : "Cancelando transferência…";
    if (native) await invoke(live ? "stop_live_lighting" : "cancel_upload");
  }
  const startLive = (mode: string) =>
    withHardware("Preparando efeito ao vivo…", async () => {
      let animation = {
        framesRgbBase64: null as string | null,
        delaysMs: [] as number[],
      };
      if (mode === "animation") {
        if (!settings.media)
          throw new Error("Escolha uma imagem ou GIF em Tela LCD.");
        animation = await prepareLiveMedia(
          clone(settings.media),
          keys,
          (n: number, total: number) => {
            progress.value = {
              stage: "convert",
              completed: n,
              total,
              message: `Projetando quadro ${n} de ${total} nas teclas`,
            };
          },
          () => conversionCancelled.value,
        );
      }
      if (conversionCancelled.value) throw new Error("Efeito cancelado.");
      progress.value = {
        stage: "live",
        completed: 0,
        total: 0,
        message: "Iniciando efeito ao vivo…",
      };
      await invoke("live_lighting", {
        profile: snapshot(),
        request: {
          mode,
          ...animation,
          palette: livePalette.value,
          gain: liveGain.value,
        },
        progress: progressChannel(),
      });
    });
  function keyStyle(key: Key) {
    return {
      left: `${(key.x / 740) * 100}%`,
      top: `${(key.y / 264) * 100}%`,
      width: `${(key.width / 740) * 100}%`,
      height: `${(key.height / 264) * 100}%`,
      "--key-color": individualLighting.value
        ? (settings.keyColors[key.id] ?? settings.color)
        : settings.color,
      "--key-light":
        settings.effect === "off" ? "0" : String(settings.brightness / 5),
    };
  }
  function selectKey(key: Key) {
    if (page.value === "lighting" && !individualLighting.value) return;
    selected.value = key;
    if (page.value === "overview") page.value = "keys";
  }
  const formatDate = (date: string) =>
    date
      ? new Date(date).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
        })
      : "Agora";
  let poll: ReturnType<typeof setInterval>;
  onMounted(async () => {
    try {
      if (native) {
        unlisteners.push(
          await getCurrentWindow().listen("request-panel-close", () => {
            void recollect();
          }),
        );
        unlisteners.push(
          await getCurrentWindow().listen("request-app-exit", () => {
            void recollect(undefined, true);
          }),
        );
        unlisteners.push(
          await listen<{ color: string; brightness: number }>(
            "quick-color-changed",
            ({ payload }) => {
              settings.color = payload.color;
              settings.brightness = payload.brightness;
              settings.effect = "static";
              settings.colorful = false;
            },
          ),
        );
        invoke<{
          gnome: boolean;
          enabled: boolean;
          anchored: boolean;
          nativeMenu: boolean;
          batteryMenu: boolean;
        }>("get_desktop_integration")
          .then((info) => {
            desktopIntegration.value = info;
          })
          .catch(failure);
      }
      await refresh();
      try {
        const loaded = native
          ? await invoke<Profile[]>("load_profiles")
          : JSON.parse(localStorage.getItem("s75-profiles-v1") ?? "[]");
        profiles.value = loaded.map(validateProfile);
        if (profiles.value[0]) loadProfile(profiles.value[0]);
        else
          saved.value = JSON.stringify({ name: profileName.value, settings });
        if (native) {
          const draft = await invoke<{
            profile: Profile;
            name: string;
            dirty: boolean;
            page: string;
            previousEffect: string;
            capturedAt: number;
          } | null>("load_editor_draft");
          if (draft) {
            loadProfile(draft.profile);
            profileName.value = draft.name;
            saved.value = draft.dirty
              ? ""
              : JSON.stringify({ name: profileName.value, settings });
            if (pages.some((p) => p.id === draft.page)) page.value = draft.page;
            if (draft.previousEffect !== "custom")
              wholeKeyboardEffect.value = draft.previousEffect;
          }
          const context = await invoke<{
            settings: { color: string; brightness: number; updatedAt: number };
          }>("get_quick_context");
          if (context.settings.updatedAt > (draft?.capturedAt ?? 0)) {
            settings.color = context.settings.color;
            settings.brightness = context.settings.brightness;
            settings.effect = "static";
            settings.colorful = false;
          }
        }
      } catch (e) {
        failure(e);
      }
      if (native) poll = setInterval(refresh, 5000);
    } finally {
      initializing.value = false;
    }
  });
  onUnmounted(() => {
    clearInterval(poll);
    clearTimeout(toastTimer);
    unlisteners.forEach((unlisten) => unlisten());
  });
  return bindController(
    {
      battery,
      initializing,
      closing,
      recollect,
      desktopIntegration,
      enableTray,
      installPanel,
      installingPanel,
      native,
      pages,
      page,
      currentPage,
      settings,
      profileName,
      profiles,
      profileId,
      dirty,
      saving,
      save,
      refresh,
      refreshing,
      diagnostics,
      device,
      possibleReceiver,
      interfaces,
      visibleNodes,
      connectionLabel,
      keys,
      selected,
      layer,
      mapping,
      customColor,
      individualLighting,
      baseColor,
      effects,
      effectNames,
      colors,
      keyStyle,
      selectKey,
      toast,
      error,
      newProfile,
      exportProfile,
      importProfile,
      chooseProfile,
      pendingProfile,
      confirmLoad,
      selectedMacro,
      macro,
      recording,
      macroInput,
      addMacro,
      startRecording,
      recordKey,
      deleteMacro,
      importMedia,
      formatDate,
      hardwareModes,
      shortcutMods,
      shortcutKey,
      hardwareBusy,
      progress,
      hardwareOutcome,
      transferPercent,
      canCancel,
      sendToKeyboard,
      sendScreen,
      syncClock,
      probeKeyboard,
      readColors,
      cancelTransfer,
      livePalette,
      liveGain,
      livePalettes,
      startLive,
    },
    life,
  );
}
