// SPDX-License-Identifier: GPL-3.0-only
//! Native tray stays resident; both WebViews are created on demand and destroyed on close.
use base64::{engine::general_purpose::STANDARD, Engine};
use s75_core::profile::Profile;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

#[derive(Default)]
pub struct DesktopState {
    installing: Arc<AtomicBool>,
    pub drops: Mutex<HashMap<String, Vec<PathBuf>>>,
    message: Mutex<Option<String>>,
}
pub fn installing(app: &tauri::AppHandle) -> bool {
    app.state::<DesktopState>()
        .installing
        .load(Ordering::SeqCst)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuickSettings {
    pub color: String,
    pub brightness: u8,
    pub updated_at: u64,
    pub media_name: Option<String>,
    pub fit: String,
}
impl Default for QuickSettings {
    fn default() -> Self {
        Self {
            color: "#ff865f".into(),
            brightness: 4,
            updated_at: 0,
            media_name: None,
            fit: "cover".into(),
        }
    }
}
impl QuickSettings {
    fn validate(&self) -> Result<(), String> {
        s75_core::protocol::rgb(&self.color)?;
        if self.brightness > 5
            || !["cover", "contain"].contains(&self.fit.as_str())
            || self
                .media_name
                .as_ref()
                .is_some_and(|n| n.chars().count() > 255)
        {
            return Err("Preferências rápidas inválidas".into());
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorDraft {
    pub profile: Profile,
    pub name: String,
    pub dirty: bool,
    pub page: String,
    pub previous_effect: String,
    pub captured_at: u64,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn data_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join(name))
        .map_err(|e| e.to_string())
}
fn preferences_lock(app: &tauri::AppHandle) -> Result<fs::File, String> {
    use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt};
    let path = data_path(app, "quick-settings.lock")?;
    fs::create_dir_all(path.parent().ok_or("Pasta de dados inválida")?)
        .map_err(|e| e.to_string())?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| e.to_string())?;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(file)
}
fn read_optional<T: serde::de::DeserializeOwned>(
    path: PathBuf,
    limit: u64,
) -> Result<Option<T>, String> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Arquivo local excede o limite".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| format!("Arquivo local inválido: {e}"))
}
fn write_atomic<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or("Diretório de dados inválido")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
pub fn quick_settings(app: &tauri::AppHandle) -> Result<QuickSettings, String> {
    let prefs: QuickSettings =
        read_optional(data_path(app, "quick-settings.json")?, 4096)?.unwrap_or_default();
    prefs.validate()?;
    Ok(prefs)
}
pub fn record_color(
    app: &tauri::AppHandle,
    color: String,
    brightness: u8,
) -> Result<QuickSettings, String> {
    let state = app.state::<crate::StoreLock>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let _file_lock = preferences_lock(app)?;
    let mut prefs = quick_settings(app)?;
    prefs.color = color;
    prefs.brightness = brightness;
    prefs.updated_at = now();
    prefs.validate()?;
    // A hardware ACK precedes this write. Do not claim the device failed if only persistence failed.
    write_atomic(data_path(app, "quick-settings.json")?, &prefs).map_err(|e| {
        format!("A cor foi aplicada, mas não foi possível guardar a preferência: {e}")
    })?;
    let _ = app.emit("quick-color-changed", &prefs);
    if !app.state::<crate::instance::RuntimeMode>().ui {
        let _ = crate::instance::notify(true, "refresh");
    }
    Ok(prefs)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickContext {
    settings: QuickSettings,
    message: Option<String>,
}
#[tauri::command]
pub fn get_quick_context(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<DesktopState>,
) -> Result<QuickContext, String> {
    let message = if window.label() == "quick" {
        let pending = data_path(&app, "tray-error.json")?;
        let disk_message = read_optional::<String>(pending.clone(), 4096)?;
        if disk_message.is_some() {
            let _ = fs::remove_file(pending);
        }
        state
            .message
            .lock()
            .map_err(|e| e.to_string())?
            .take()
            .or(disk_message)
    } else {
        None
    };
    Ok(QuickContext {
        settings: quick_settings(&app)?,
        message,
    })
}
#[tauri::command]
pub fn remember_quick_media(
    app: tauri::AppHandle,
    name: String,
    fit: String,
) -> Result<(), String> {
    let state = app.state::<crate::StoreLock>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let _file_lock = preferences_lock(&app)?;
    let mut prefs = quick_settings(&app)?;
    prefs.media_name = Some(name);
    prefs.fit = fit;
    prefs.validate()?;
    write_atomic(data_path(&app, "quick-settings.json")?, &prefs)
}
#[tauri::command]
pub fn save_editor_draft(app: tauri::AppHandle, mut draft: EditorDraft) -> Result<(), String> {
    draft.profile.validate()?;
    if draft.name.chars().count() > 60 {
        return Err("Nome do rascunho inválido".into());
    }
    s75_core::protocol::lighting_mode(&draft.previous_effect)?;
    draft.captured_at = now();
    let state = app.state::<crate::StoreLock>();
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    write_atomic(data_path(&app, "editor-draft.json")?, &draft)
}
#[tauri::command]
pub fn load_editor_draft(app: tauri::AppHandle) -> Result<Option<EditorDraft>, String> {
    read_optional(data_path(&app, "editor-draft.json")?, 9 * 1024 * 1024)
}

#[derive(Serialize)]
pub struct DroppedMedia {
    pub name: String,
    pub data: String,
}
fn media_mime(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("image/gif")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok("image/jpeg")
    } else {
        Err("Escolha um GIF, PNG ou JPEG válido".into())
    }
}
#[tauri::command]
pub async fn read_dropped_media(
    window: WebviewWindow,
    path: PathBuf,
    state: tauri::State<'_, DesktopState>,
) -> Result<DroppedMedia, String> {
    {
        let mut drops = state.drops.lock().map_err(|e| e.to_string())?;
        let granted = drops.remove(window.label()).unwrap_or_default();
        if !granted.contains(&path) {
            return Err("O arquivo precisa ser arrastado para esta janela".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::os::unix::fs::OpenOptionsExt;
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
            .open(&path)
            .map_err(|e| e.to_string())?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("Arraste um arquivo de imagem".into());
        }
        let mut bytes = Vec::new();
        file.take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("A imagem excede 4 MiB".into());
        }
        let mime = media_mime(&bytes)?;
        let name = path
            .file_name()
            .ok_or("Nome de arquivo inválido")?
            .to_string_lossy()
            .into_owned();
        Ok(DroppedMedia {
            name,
            data: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn show_panel(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if label == "quick"
        && integration_info().native_menu
        && shell_command(
            "gdbus",
            &[
                "call",
                "--session",
                "--dest",
                "org.gnome.Shell",
                "--object-path",
                "/dev/aula/S75Studio/Panel",
                "--method",
                "dev.aula.S75Studio.Panel.Show",
            ],
        )
        .is_ok()
    {
        return Ok(());
    }

    if !["main", "quick"].contains(&label) {
        return Err("Janela desconhecida".into());
    }
    if !app.state::<crate::instance::RuntimeMode>().ui {
        if crate::instance::notify(true, label).is_ok() {
            return Ok(());
        }
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut child = std::process::Command::new(executable)
            .arg("--ui")
            .args(if label == "quick" {
                vec!["--quick"]
            } else {
                vec![]
            })
            .spawn()
            .map_err(|e| format!("Não foi possível abrir o painel: {e}"))?;
        let idle_app = app.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            crate::panel::idle_touch(&idle_app);
        });
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(label) {
        window.show().map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let window = match label {
        "main" => WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])
            .map_err(|e| e.to_string())?
            .build(),
        "quick" => WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("quick.html".into()))
            .title("S75 · Controle rápido")
            .inner_size(440.0, 650.0)
            .resizable(true)
            .min_inner_size(380.0, 480.0)
            .maximizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .transparent(true)
            .background_color(tauri::webview::Color(0, 0, 0, 0))
            .build(),
        _ => return Err("Janela desconhecida".into()),
    }
    .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}
#[tauri::command]
pub fn show_editor(app: tauri::AppHandle) -> Result<(), String> {
    show_panel(&app, "main")
}
pub fn toggle_quick(app: &tauri::AppHandle) -> Result<(), String> {
    if !app.state::<crate::instance::RuntimeMode>().ui {
        if crate::instance::notify(true, "toggle").is_ok() {
            return Ok(());
        }
        return show_panel(app, "quick");
    }
    if let Some(window) = app.get_webview_window("quick") {
        window.close().map_err(|e| e.to_string())
    } else {
        show_panel(app, "quick")
    }
}
#[tauri::command]
pub fn drag_panel(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn close_panel(window: WebviewWindow, next: Option<String>) -> Result<(), String> {
    let app = window.app_handle();
    if app
        .state::<DesktopState>()
        .installing
        .load(Ordering::SeqCst)
    {
        return Err("Aguarde a instalação da integração terminar antes de recolher".into());
    }
    if app.state::<crate::hardware::HardwareState>().is_busy() {
        return Err(
            "Aguarde a operação USB terminar ou pare o efeito antes de recolher a janela".into(),
        );
    }
    if let Some(label) = &next {
        if !["main", "quick"].contains(&label.as_str()) {
            return Err("Janela desconhecida".into());
        }
        show_panel(app, label)?;
    }
    window.destroy().map_err(|e| e.to_string())
}

fn remember_error(app: &tauri::AppHandle, error: String) {
    if app.state::<crate::instance::RuntimeMode>().ui {
        if let Ok(mut message) = app.state::<DesktopState>().message.lock() {
            *message = Some(error);
        }
    } else if let Ok(path) = data_path(app, "tray-error.json") {
        let _ = write_atomic(path, &error);
    }
    let _ = show_panel(app, "quick");
    let _ = app.emit("quick-error", ());
}

#[tauri::command]
pub fn exit_application(app: tauri::AppHandle) {
    app.state::<crate::hardware::HardwareState>().shutdown();
    let ui = app.state::<crate::instance::RuntimeMode>().ui;
    if !ui {
        let _ = crate::instance::notify(true, "quit");
    }
    tauri::async_runtime::spawn(async move {
        for _ in 0..100 {
            if !app.state::<crate::hardware::HardwareState>().is_busy()
                && !app
                    .state::<DesktopState>()
                    .installing
                    .load(Ordering::SeqCst)
                && (ui || !crate::instance::ui_running())
            {
                app.exit(0);
                return;
            }
            tokio_wait().await;
        }
        remember_error(
            &app,
            "A operação USB ainda está terminando. Aguarde e tente sair novamente.".into(),
        );
    });
}

pub fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let quick = MenuItem::with_id(
        app,
        "quick",
        "✦ Controle rápido · GIF e cor",
        true,
        None::<&str>,
    )?;
    let editor = MenuItem::with_id(app, "editor", "Abrir S75 Studio", true, None::<&str>)?;
    let palette = Submenu::new(app, "Cor do teclado", true)?;
    for (id, label) in [
        ("ff865f", "Pêssego"),
        ("80baff", "Azul"),
        ("92d4ba", "Menta"),
        ("b6a1e9", "Lilás"),
        ("ed99bb", "Rosa"),
        ("eeeeef", "Branco"),
    ] {
        palette.append(&MenuItem::with_id(
            app,
            format!("color:{id}"),
            label,
            true,
            None::<&str>,
        )?)?;
    }
    let quit = MenuItem::with_id(app, "quit", "Sair completamente", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &quick,
            &palette,
            &PredefinedMenuItem::separator(app)?,
            &editor,
            &quit,
        ],
    )?;
    // Monochrome keyboard glyph, 24×24 RGBA. No image decoder or asset watcher at idle.
    let mut rgba = vec![0; 24 * 24 * 4];
    for y in 0..24 {
        for x in 0..24 {
            let outline = (3..=20).contains(&x)
                && (6..=17).contains(&y)
                && (x == 3 || x == 20 || y == 6 || y == 17);
            let key = (6..=17).contains(&x) && (9..=11).contains(&y) && x % 4 != 1;
            let space = (8..=15).contains(&x) && y == 14;
            if outline || key || space {
                rgba[(y * 24 + x) * 4..(y * 24 + x) * 4 + 4].copy_from_slice(&[237, 220, 207, 255]);
            }
        }
    }
    TrayIconBuilder::with_id("s75-tray")
        .menu(&menu)
        .icon(tauri::image::Image::new_owned(rgba, 24, 24))
        .tooltip("S75 Studio · GIF e iluminação")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "quick" => {
                    if let Err(e) = show_panel(app, "quick") {
                        eprintln!("{e}");
                    }
                }
                "editor" => {
                    if let Err(e) = show_panel(app, "main") {
                        eprintln!("{e}");
                    }
                }
                "quit" => {
                    if let Some(editor) = app.get_webview_window("main") {
                        let _ = editor.emit_to("main", "request-app-exit", ());
                    } else {
                        exit_application(app.clone());
                    }
                }
                _ => {
                    if let Some(color) = id.strip_prefix("color:") {
                        let color = format!("#{color}");
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let brightness =
                                quick_settings(&app).map(|p| p.brightness).unwrap_or(4);
                            let result = crate::hardware::set_quick_color(
                                app.clone(),
                                app.state(),
                                color,
                                brightness,
                            )
                            .await;
                            if let Err(e) = result {
                                remember_error(&app, e);
                            }
                        });
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

async fn tokio_wait() {
    // No timer exists while idle; only while draining an operation during explicit quit.
    let _ = tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(50))
    })
    .await;
}

const INDICATOR_UUID: &str = "appindicatorsupport@rgcjonas.gmail.com";
const PANEL_UUID: &str = "s75-studio@luisdev.local";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIntegration {
    gnome: bool,
    enabled: bool,
    anchored: bool,
    native_menu: bool,
    battery_menu: bool,
}
fn integration_info() -> DesktopIntegration {
    let gnome = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_uppercase()
        .contains("GNOME");
    let enabled = !gnome
        || shell_command(
            "gsettings",
            &["get", "org.gnome.shell", "enabled-extensions"],
        )
        .is_ok_and(|text| text.contains(INDICATOR_UUID));
    let info = if gnome {
        shell_command("gnome-extensions", &["info", PANEL_UUID]).unwrap_or_default()
    } else {
        String::new()
    };
    let anchored = info
        .lines()
        .any(|line| matches!(line.trim(), "State: ACTIVE" | "State: ENABLED"));
    let native_menu = anchored
        && info
            .lines()
            .any(|line| matches!(line.trim(), "Version: 2" | "Version: 3"));
    let battery_menu = anchored && info.lines().any(|line| line.trim() == "Version: 3");
    DesktopIntegration {
        gnome,
        enabled,
        anchored,
        native_menu,
        battery_menu,
    }
}

fn shell_command(program: &str, args: &[&str]) -> Result<String, String> {
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let mut child = Command::new(program)
        .args(args)
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(3) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("O GNOME não respondeu em 3 segundos".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if !status.success() {
        return Err("Não foi possível ativar o suporte à bandeja. Verifique a extensão AppIndicator no aplicativo Extensões do GNOME.".into());
    }
    let mut out = String::new();
    child
        .stdout
        .take()
        .ok_or("Saída do comando indisponível")?
        .take(65536)
        .read_to_string(&mut out)
        .map_err(|e| e.to_string())?;
    Ok(out)
}
#[tauri::command]
pub async fn get_desktop_integration() -> Result<DesktopIntegration, String> {
    tauri::async_runtime::spawn_blocking(integration_info)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn enable_gnome_tray() -> Result<DesktopIntegration, String> {
    tauri::async_runtime::spawn_blocking(|| {
        shell_command("gnome-extensions", &["enable", INDICATOR_UUID])?;
        Ok(integration_info())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelInstallation {
    integration: DesktopIntegration,
    requires_relogin: bool,
}
#[tauri::command]
pub async fn install_gnome_panel(
    state: tauri::State<'_, DesktopState>,
) -> Result<PanelInstallation, String> {
    let activity = crate::hardware::Activity::claim(&state.installing)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _activity = activity;
        let before = integration_info();
        if !before.gnome {
            return Err("O painel fixo é específico do GNOME".into());
        }
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        if !executable.is_file() {
            return Err("Reabra a versão atual do Studio antes de instalar a integração".into());
        }
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
            .ok_or("Diretório de dados do usuário indisponível")?;
        let directory = data.join("gnome-shell/extensions").join(PANEL_UUID);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let files = [
            (
                "metadata.json",
                include_str!("../../gnome/s75-studio@luisdev.local/metadata.json"),
            ),
            (
                "extension.js",
                include_str!("../../gnome/s75-studio@luisdev.local/extension.js"),
            ),
            (
                "geometry.js",
                include_str!("../../gnome/s75-studio@luisdev.local/geometry.js"),
            ),
        ];
        let files = files.into_iter().chain([
            (
                "popover.js",
                include_str!("../../gnome/s75-studio@luisdev.local/popover.js"),
            ),
            (
                "panel-utils.js",
                include_str!("../../gnome/s75-studio@luisdev.local/panel-utils.js"),
            ),
            (
                "stylesheet.css",
                include_str!("../../gnome/s75-studio@luisdev.local/stylesheet.css"),
            ),
        ]);
        let mut changed = false;
        for (name, content) in files {
            let path = directory.join(name);
            if fs::read_to_string(&path).ok().as_deref() != Some(content) {
                let temporary = path.with_extension("s75-tmp");
                fs::write(&temporary, content).map_err(|e| e.to_string())?;
                fs::rename(temporary, path).map_err(|e| e.to_string())?;
                changed = true;
            }
        }
        write_atomic(
            directory.join("config.json"),
            &serde_json::json!({"executable":executable}),
        )?;
        shell_command("gnome-extensions", &["enable", INDICATOR_UUID])?;
        // A fresh extension may only be discovered when the Wayland session restarts.
        let _ = shell_command("gnome-extensions", &["enable", PANEL_UUID]);
        let integration = integration_info();
        let requires_relogin = !integration.battery_menu || (before.anchored && changed);
        Ok(PanelInstallation {
            integration,
            requires_relogin,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_bad_media_and_quick_preferences() {
        assert_eq!(media_mime(b"GIF89a123").unwrap(), "image/gif");
        assert_eq!(media_mime(b"\x89PNG\r\n\x1a\n").unwrap(), "image/png");
        assert!(media_mime(b"MZnot-an-image").is_err());
        assert!(QuickSettings {
            brightness: 6,
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(QuickSettings {
            color: "red".into(),
            ..Default::default()
        }
        .validate()
        .is_err());
    }
}
