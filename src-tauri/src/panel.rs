// SPDX-License-Identifier: GPL-3.0-only
//! Private per-user JSON IPC for the native GNOME menu; no WebView or network server.
use gtk::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Write,
    os::unix::net::UnixStream,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub busy: bool,
    pub message: String,
    pub completed: usize,
    pub total: usize,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            busy: false,
            message: "Pronto para personalizar".into(),
            completed: 0,
            total: 1,
        }
    }
}
struct Idle {
    pending: usize,
    last: Instant,
    armed: bool,
    stopping: bool,
}
impl Default for Idle {
    fn default() -> Self {
        Self {
            pending: 0,
            last: Instant::now(),
            armed: false,
            stopping: false,
        }
    }
}
#[derive(Default)]
pub struct PanelState {
    status: Mutex<Status>,
    idle: Arc<(Mutex<Idle>, Condvar)>,
    started: AtomicBool,
}
struct Pending(Arc<(Mutex<Idle>, Condvar)>);
impl Drop for Pending {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0 .0.lock() {
            state.pending = state.pending.saturating_sub(1);
            state.last = Instant::now();
            state.armed = true;
            self.0 .1.notify_one();
        }
    }
}
fn pending(app: &tauri::AppHandle) -> Result<Pending, String> {
    let panel = app.state::<PanelState>();
    let idle = panel.idle.clone();
    if let Ok(mut state) = idle.0.lock() {
        if state.stopping {
            return Err("O componente USB está reiniciando".into());
        }
        state.pending += 1;
        state.last = Instant::now();
        state.armed = true;
        idle.1.notify_one();
    }
    if !panel.started.swap(true, Ordering::SeqCst) {
        let app = app.clone();
        let wait = idle.clone();
        std::thread::spawn(move || {
            let (lock, cv) = &*wait;
            let Ok(mut state) = lock.lock() else {
                return;
            };
            loop {
                while !state.armed || state.pending > 0 {
                    state = match cv.wait(state) {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                }
                let remaining = Duration::from_secs(12).saturating_sub(state.last.elapsed());
                if !remaining.is_zero() {
                    state = match cv.wait_timeout(state, remaining) {
                        Ok((s, _)) => s,
                        Err(_) => return,
                    };
                    continue;
                }
                if crate::instance::ui_running()
                    || app.state::<crate::hardware::HardwareState>().is_busy()
                    || crate::desktop::installing(&app)
                {
                    state.armed = false;
                    continue;
                }
                state.stopping = true;
                drop(state);
                app.exit(0);
                return;
            }
        });
    }
    Ok(Pending(idle))
}
pub fn idle_touch(app: &tauri::AppHandle) {
    let panel = app.state::<PanelState>();
    if panel.started.load(Ordering::SeqCst) {
        if let Ok(mut state) = panel.idle.0.lock() {
            state.last = Instant::now();
            state.armed = true;
            panel.idle.1.notify_one();
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Context,
    Battery,
    Color { color: String, brightness: u8 },
    Upload { path: PathBuf, fit: String },
    Pick { fit: String },
    Cancel,
    Open,
    Quit,
}
type Writer = Arc<Mutex<UnixStream>>;
fn send(writer: &Writer, value: Value) {
    if let Ok(mut stream) = writer.lock() {
        let _ = writeln!(stream, "{value}");
    }
}
async fn context(app: &tauri::AppHandle) -> Result<Value, String> {
    let battery = crate::battery::get(app.clone(), false).await?;
    let settings = crate::desktop::quick_settings(app)?;
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let thumbnail = std::fs::read_dir(directory)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.starts_with("quick-thumbnail-") && name.ends_with(".png")
        })
        .map(|entry| entry.path())
        .max();
    let status = app
        .state::<PanelState>()
        .status
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    Ok(
        json!({"kind":"context","settings":settings,"status":status,"battery":battery,"thumbnail":thumbnail.map(|p|p.to_string_lossy().into_owned())}),
    )
}
fn status(app: &tauri::AppHandle, busy: bool, message: &str, completed: usize, total: usize) {
    if let Ok(mut state) = app.state::<PanelState>().status.lock() {
        *state = Status {
            busy,
            message: message.into(),
            completed,
            total,
        };
    }
}
async fn choose_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let dialog = gtk::FileChooserNative::new(
            Some("Escolher GIF ou imagem para o S75 Pro"),
            None::<&gtk::Window>,
            gtk::FileChooserAction::Open,
            Some("Enviar ao teclado"),
            Some("Cancelar"),
        );
        let filter = gtk::FileFilter::new();
        filter.set_name(Some("GIF, PNG e JPEG"));
        for mime in ["image/gif", "image/png", "image/jpeg"] {
            filter.add_mime_type(mime);
        }
        dialog.add_filter(filter);
        dialog.connect_response(move |dialog, response| {
            let result = if response == gtk::ResponseType::Accept {
                dialog
                    .filename()
                    .ok_or_else(|| "Selecione um arquivo local".into())
            } else {
                Err("Seleção cancelada".into())
            };
            let _ = tx.send(result);
            dialog.destroy();
        });
        dialog.show();
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?
}
pub fn dispatch(app: tauri::AppHandle, message: &str, stream: UnixStream) {
    let writer = Arc::new(Mutex::new(stream));
    let request: Request = match serde_json::from_str(message) {
        Ok(r) => r,
        Err(e) => {
            send(
                &writer,
                json!({"kind":"error","message":format!("Solicitação inválida: {e}")}),
            );
            return;
        }
    };
    let activity = match pending(&app) {
        Ok(activity) => activity,
        Err(error) => {
            send(
                &writer,
                json!({"kind":"error","message":error,"retry":true}),
            );
            return;
        }
    };
    tauri::async_runtime::spawn(async move {
        let _activity = activity;
        let result: Result<(), String> = async {
            match request {
                Request::Context => send(&writer, context(&app).await?),
                Request::Battery => {
                    let battery = crate::battery::get(app.clone(), true).await?;
                    send(&writer, json!({"kind":"battery","battery":battery}));
                }
                Request::Color { color, brightness } => {
                    status(&app, true, "Aplicando cor…", 0, 1);
                    crate::hardware::set_quick_color(app.clone(), app.state(), color, brightness)
                        .await?;
                    status(&app, false, "Cor aplicada no teclado", 1, 1);
                    send(&writer, context(&app).await?);
                }
                Request::Upload { path, fit } => upload(&app, path, fit, &writer).await?,
                Request::Pick { fit } => {
                    let path = choose_file(&app).await?;
                    upload(&app, path, fit, &writer).await?;
                }
                Request::Cancel => {
                    crate::hardware::cancel_upload(app.state());
                    send(&writer, json!({"kind":"done"}));
                }
                Request::Open => {
                    crate::desktop::show_panel(&app, "main")?;
                    send(&writer, json!({"kind":"done"}));
                }
                Request::Quit => {
                    crate::desktop::exit_application(app.clone());
                    send(&writer, json!({"kind":"done"}));
                }
            }
            Ok(())
        }
        .await;
        if let Err(error) = result {
            status(&app, false, &error, 0, 1);
            send(&writer, json!({"kind":"error","message":error}));
        }
    });
}
async fn upload(
    app: &tauri::AppHandle,
    path: PathBuf,
    fit: String,
    writer: &Writer,
) -> Result<(), String> {
    status(app, true, "Preparando imagem…", 0, 1);
    let cloned = app.clone();
    let target = writer.clone();
    crate::hardware::upload_native_file(app.clone(), app.state(), path, fit, move |p| {
        status(&cloned, true, &p.message, p.completed, p.total);
        send(
            &target,
            json!({"kind":"progress","message":p.message,"completed":p.completed,"total":p.total}),
        );
    })
    .await?;
    status(app, false, "GIF / imagem enviado ao teclado", 1, 1);
    send(writer, context(app).await?);
    Ok(())
}
