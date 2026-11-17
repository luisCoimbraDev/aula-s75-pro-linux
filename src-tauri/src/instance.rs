// SPDX-License-Identifier: GPL-3.0-only
//! One native tray per user. A second launch asks the existing process to show a panel.
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, Read, Write},
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
        net::{UnixListener, UnixStream},
    },
    path::PathBuf,
};
use tauri::{Emitter, Manager};

pub struct RuntimeMode {
    pub ui: bool,
}

fn directory(ui: bool) -> PathBuf {
    let uid = unsafe { libc::geteuid() };
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(format!("s75-studio-{uid}{}", if ui { "-ui" } else { "" }))
}
pub fn notify(ui: bool, command: &str) -> Result<(), String> {
    let mut stream =
        UnixStream::connect(directory(ui).join("control.sock")).map_err(|e| e.to_string())?;
    stream
        .write_all(format!("{command}\n").as_bytes())
        .map_err(|e| e.to_string())
}
pub fn ui_running() -> bool {
    use std::os::fd::AsRawFd;
    let Ok(lock) = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(directory(true).join("instance.lock"))
    else {
        return false;
    };
    unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) != 0 }
}

pub struct Instance {
    _lock: File,
    listener: UnixListener,
}
pub fn acquire(command: &str, ui: bool) -> Result<Option<Instance>, String> {
    let uid = unsafe { libc::geteuid() };
    let dir = directory(ui);
    match fs::create_dir(&dir) {
        Ok(()) => fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.to_string()),
    }
    let metadata = fs::symlink_metadata(&dir).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return Err("Diretório da sessão não é privado deste usuário".into());
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(dir.join("instance.lock"))
        .map_err(|e| e.to_string())?;
    use std::os::fd::AsRawFd;
    let socket = dir.join("control.sock");
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        notify(ui, command)
            .map_err(|e| format!("O Studio já está aberto, mas não respondeu: {e}"))?;
        return Ok(None);
    }
    match fs::remove_file(&socket) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let listener = UnixListener::bind(&socket).map_err(|e| e.to_string())?;
    fs::set_permissions(socket, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    Ok(Some(Instance {
        _lock: lock,
        listener,
    }))
}
pub fn listen(instance: Instance, app: tauri::AppHandle) {
    app.manage(instance._lock);
    std::thread::spawn(move || {
        for connection in instance.listener.incoming() {
            let Ok(stream) = connection else {
                break;
            };
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(1)));
            let mut bytes = Vec::new();
            if std::io::BufReader::new(&stream)
                .take(8193)
                .read_until(b'\n', &mut bytes)
                .is_err()
                || bytes.len() > 8192
            {
                continue;
            }
            let Ok(command) = String::from_utf8(bytes) else {
                continue;
            };
            if command.trim_start().starts_with('{') {
                let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(2)));
                crate::panel::dispatch(app.clone(), command.trim(), stream);
                continue;
            }
            let cloned = app.clone();
            let _ = app.run_on_main_thread(move || match command.trim() {
                "toggle" => {
                    let _ = crate::desktop::toggle_quick(&cloned);
                }
                "quick" | "main" => {
                    let _ = crate::desktop::show_panel(&cloned, command.trim());
                    let _ = cloned.emit("quick-error", ());
                }
                "refresh" => {
                    if let Ok(prefs) = crate::desktop::quick_settings(&cloned) {
                        let _ = cloned.emit("quick-color-changed", prefs);
                    }
                }
                "idle" => crate::panel::idle_touch(&cloned),
                "quit" => {
                    if let Some(main) = cloned.get_webview_window("main") {
                        let _ = main.emit_to("main", "request-app-exit", ());
                    } else {
                        crate::desktop::exit_application(cloned);
                    }
                }
                _ => {}
            });
        }
    });
}
