#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio;
mod battery;
mod desktop;
mod gif;
mod hardware;
mod instance;
mod native_media;
mod panel;
use s75_core::{discovery, profile::Profile};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

struct StoreLock(Mutex<()>);

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("profiles.json"))
        .map_err(|e| e.to_string())
}

fn read_profiles(path: &PathBuf) -> Result<Vec<Profile>, String> {
    match fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > 32 * 1024 * 1024 {
                return Err("Arquivo de perfis acima do limite local".into());
            }
            serde_json::from_slice(&bytes)
                .map_err(|e| format!("Não foi possível ler os perfis: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_diagnostics() -> Result<discovery::Diagnostics, String> {
    tauri::async_runtime::spawn_blocking(discovery::scan)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_profiles(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
) -> Result<Vec<Profile>, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    read_profiles(&store_path(&app)?)
}

#[tauri::command]
fn save_profile(
    app: tauri::AppHandle,
    lock: tauri::State<StoreLock>,
    profile: Profile,
) -> Result<Vec<Profile>, String> {
    profile.validate()?;
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let path = store_path(&app)?;
    let mut profiles = read_profiles(&path)?;
    profiles.retain(|p| p.id != profile.id);
    if profiles.len() >= 20 {
        return Err("Limite local de 20 perfis atingido".into());
    }
    profiles.push(profile);
    let bytes = serde_json::to_vec_pretty(&profiles).map_err(|e| e.to_string())?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Perfis acima do limite local de 32 MiB".into());
    }
    fs::create_dir_all(path.parent().ok_or("Diretório de perfis inválido")?)
        .map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())?;
    Ok(profiles)
}

#[tauri::command]
fn export_profile(app: tauri::AppHandle, profile: Profile) -> Result<String, String> {
    profile.validate()?;
    let directory = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path = directory.join(format!("s75-perfil-{timestamp}.json"));
    let data = serde_json::to_vec_pretty(&profile).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(&data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn main() {
    if std::env::args().any(|a| a == "--battery-json") {
        let value = battery::diagnostic();
        println!(
            "{}",
            serde_json::json!({"percent":value.percent,"charging":value.charging,"source":value.source,"message":value.message})
        );
        return;
    }
    let ui = std::env::args().any(|a| a == "--ui");
    let command = if std::env::args().any(|a| a == "--quick") {
        "quick"
    } else if std::env::args().any(|a| a == "--tray") {
        "tray"
    } else {
        "main"
    };
    let instance = match instance::acquire(command, ui) {
        Ok(Some(instance)) => instance,
        Ok(None) => return,
        Err(e) => {
            eprintln!("Não foi possível abrir o S75 Studio: {e}");
            return;
        }
    };
    let app = tauri::Builder::default()
        .manage(StoreLock(Mutex::new(())))
        .manage(hardware::HardwareState::default())
        .manage(desktop::DesktopState::default())
        .manage(panel::PanelState::default())
        .manage(battery::BatteryState::default())
        .manage(instance::RuntimeMode { ui })
        .setup(move |app| {
            if !ui {
                desktop::setup_tray(app.handle())?;
            }
            instance::listen(instance, app.handle().clone());
            if command != "tray" {
                desktop::show_panel(app.handle(), command)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_diagnostics,
            battery::get_keyboard_battery,
            load_profiles,
            save_profile,
            export_profile,
            desktop::get_quick_context,
            desktop::remember_quick_media,
            desktop::save_editor_draft,
            desktop::load_editor_draft,
            desktop::read_dropped_media,
            desktop::show_editor,
            desktop::drag_panel,
            desktop::close_panel,
            desktop::exit_application,
            desktop::get_desktop_integration,
            desktop::enable_gnome_tray,
            desktop::install_gnome_panel,
            hardware::set_quick_color,
            hardware::apply_keyboard,
            hardware::upload_screen,
            hardware::cancel_upload,
            hardware::sync_keyboard_clock,
            hardware::read_keyboard_colors,
            hardware::probe_keyboard,
            hardware::live_lighting,
            hardware::stop_live_lighting
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.emit_to(window.label(), "request-panel-close", ());
            }
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                if let Ok(mut drops) = window
                    .app_handle()
                    .state::<desktop::DesktopState>()
                    .drops
                    .lock()
                {
                    drops.insert(
                        window.label().into(),
                        paths.iter().take(1).cloned().collect(),
                    );
                }
            }
            tauri::WindowEvent::Destroyed => {
                if let Ok(mut drops) = window
                    .app_handle()
                    .state::<desktop::DesktopState>()
                    .drops
                    .lock()
                {
                    drops.remove(window.label());
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("Não foi possível iniciar o S75 Studio");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None,
            ref api,
            ..
        } = event
        {
            if !app.state::<instance::RuntimeMode>().ui {
                api.prevent_exit();
            }
        }
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<hardware::HardwareState>().shutdown();
            if app.state::<instance::RuntimeMode>().ui {
                let _ = instance::notify(false, "idle");
            }
        }
    });
}
