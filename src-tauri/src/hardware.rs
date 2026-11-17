// SPDX-License-Identifier: GPL-3.0-only
use base64::{engine::general_purpose::STANDARD, Engine};
use s75_core::{
    device::{Progress, Session},
    hidraw::LinuxTransport,
    profile::Profile,
    protocol::{self, Clock},
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{ipc::Channel, Manager, State};

#[derive(Default)]
pub struct HardwareState {
    lock: Arc<Mutex<()>>,
    cancel: Arc<AtomicBool>,
    live_stop: Arc<AtomicBool>,
    live_active: Arc<AtomicBool>,
    upload_active: Arc<AtomicBool>,
    color_active: Arc<AtomicBool>,
}
pub(crate) struct Activity(Arc<AtomicBool>);
impl Activity {
    pub(crate) fn claim(active: &Arc<AtomicBool>) -> Result<Self, String> {
        active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "Já existe uma operação desse tipo em andamento")?;
        Ok(Self(active.clone()))
    }
}
impl Drop for Activity {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl HardwareState {
    pub fn is_busy(&self) -> bool {
        self.live_active.load(Ordering::SeqCst)
            || self.upload_active.load(Ordering::SeqCst)
            || self.color_active.load(Ordering::SeqCst)
            || self.lock.try_lock().is_err()
    }
    pub fn shutdown(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        self.live_stop.store(true, Ordering::SeqCst);
    }
}

pub async fn upload_native_file(
    app: tauri::AppHandle,
    state: State<'_, HardwareState>,
    path: std::path::PathBuf,
    fit: String,
    publish: impl Fn(Progress) + Send + 'static,
) -> Result<(), String> {
    let activity = Activity::claim(&state.upload_active)?;
    let lock = state.lock.clone();
    let cancel = state.cancel.clone();
    cancel.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let _activity = activity;
        let _guard = lock
            .try_lock()
            .map_err(|_| "O teclado está ocupado com outra operação")?;
        let prepared = crate::native_media::prepare(
            &path,
            &fit,
            || cancel.load(Ordering::SeqCst),
            |n, total| {
                publish(Progress::new(
                    "convert",
                    n,
                    total,
                    &format!("Preparando quadro {n} de {total}"),
                ))
            },
        )?;
        let stream = protocol::screen_image(&prepared.pixels, &prepared.delays)?;
        if cancel.load(Ordering::SeqCst) {
            return Err("Envio cancelado".into());
        }
        let mut session = Session::new(LinuxTransport::open(true)?);
        session.upload_screen(&stream, || cancel.load(Ordering::SeqCst), publish)?;
        let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros();
        let thumbnail = directory.join(format!("quick-thumbnail-{stamp:020}.png"));
        crate::native_media::save_thumbnail(prepared.thumbnail, &thumbnail).map_err(|e| {
            format!("A imagem foi enviada; não foi possível guardar a miniatura: {e}")
        })?;
        if let Ok(entries) = std::fs::read_dir(&directory) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("quick-thumbnail-")
                    && name.ends_with(".png")
                    && entry.path() != thumbnail
                {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }

        crate::desktop::remember_quick_media(
            app,
            path.file_name()
                .ok_or("Nome inválido")?
                .to_string_lossy()
                .into_owned(),
            fit,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_quick_color(
    app: tauri::AppHandle,
    state: State<'_, HardwareState>,
    color: String,
    brightness: u8,
) -> Result<crate::desktop::QuickSettings, String> {
    let activity = Activity::claim(&state.color_active)?;
    let light = protocol::lighting(&serde_json::json!({
        "effect":"static", "color":color, "brightness":brightness,
        "speed":3, "direction":0, "colorful":false
    }))?;
    let lock = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _activity = activity;
        let _guard = lock
            .try_lock()
            .map_err(|_| "O teclado está ocupado com outra operação")?;
        let mut session = Session::new(LinuxTransport::open(false)?);
        session.write_single(0x13, 0, &light, true)?;
        crate::desktop::record_color(&app, color, brightness)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveRequest {
    pub mode: String,
    pub frames_rgb_base64: Option<String>,
    pub delays_ms: Vec<u16>,
    pub palette: u8,
    pub gain: u8,
}
#[tauri::command]
pub async fn live_lighting(
    state: State<'_, HardwareState>,
    profile: Profile,
    request: LiveRequest,
    progress: Channel<Progress>,
) -> Result<HardwareResult, String> {
    profile.validate()?;
    if !["music", "animation"].contains(&request.mode.as_str())
        || request.palette > 11
        || !(1..=10).contains(&request.gain)
    {
        return Err("Opções de efeito ao vivo inválidas".into());
    }
    let light = protocol::lighting(&profile.settings)?;
    let colors = if light[0] == 0x80 {
        Some(protocol::per_key(&profile.settings)?)
    } else {
        None
    };
    let base = protocol::rgb(profile.settings["color"].as_str().ok_or("Cor inválida")?)?;
    let frames = if request.mode == "animation" {
        let encoded = request
            .frames_rgb_base64
            .as_deref()
            .ok_or("Nenhum quadro de animação foi enviado")?;
        if encoded.len() > 141 * 80 * 3 * 4 / 3 + 4
            || request.delays_ms.is_empty()
            || request.delays_ms.len() > 141
            || request.delays_ms.contains(&0)
        {
            return Err("Animação de LEDs inválida".into());
        }
        let data = STANDARD.decode(encoded).map_err(|e| e.to_string())?;
        if data.len() != request.delays_ms.len() * 80 * 3 {
            return Err("A animação deve ter exatamente 80 cores por quadro".into());
        }
        data.chunks_exact(240)
            .map(|frame| {
                frame
                    .chunks_exact(3)
                    .map(|c| [c[0], c[1], c[2]])
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let lock = state.lock.clone();
    let stop = state.live_stop.clone();
    let activity = Activity::claim(&state.live_active)?;
    stop.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let _activity = activity;
        let _guard = lock
            .try_lock()
            .map_err(|_| "O teclado está ocupado com outra operação")?;
        let mut session = Session::new(LinuxTransport::open(false)?);
        let mut capture = if request.mode == "music" {
            Some(crate::audio::Capture::open()?)
        } else {
            None
        };
        let mut spectrum = crate::audio::Spectrum::default();
        let mut sent = 0;
        let mut frame = 0;
        let mut dropped = 0;
        let operation: Result<(), String> = (|| {
            while !stop.load(Ordering::SeqCst) {
                let start = std::time::Instant::now();
                let (colors, delay) = if let Some(audio) = capture.as_mut() {
                    let Some(samples) = audio.next(&stop)? else {
                        break;
                    };
                    (
                        spectrum.colors(&samples, request.palette, request.gain, base),
                        50,
                    )
                } else {
                    (
                        frames[frame % frames.len()].clone(),
                        u64::from(request.delays_ms[frame % frames.len()]),
                    )
                };
                if session.live_frame(&colors)? {
                    sent += 1;
                    dropped = 0;
                } else {
                    dropped += 1;
                    if dropped >= 30 {
                        return Err(
                            "O teclado permaneceu ocupado e recusou os quadros ao vivo".into()
                        );
                    }
                }
                if frame % 10 == 0
                    && progress
                        .send(Progress::new(
                            "live",
                            sent,
                            0,
                            &format!("Efeito ao vivo · {sent} quadros confirmados"),
                        ))
                        .is_err()
                {
                    stop.store(true, Ordering::SeqCst);
                }
                frame += 1;
                while start.elapsed() < std::time::Duration::from_millis(delay) {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            }
            Ok(())
        })();
        drop(capture);
        let restore = session.write_single(0x13, 0, &light, true).and_then(|()| {
            if let Some(colors) = &colors {
                session.write_block(0x23, colors)
            } else {
                Ok(())
            }
        });
        operation.and(restore)?;
        let _ = progress.send(Progress::new(
            "live-ended",
            1,
            1,
            "Efeito parado e iluminação do perfil restaurada",
        ));
        Ok(result("Efeito ao vivo encerrado."))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn stop_live_lighting(state: State<'_, HardwareState>) {
    state.live_stop.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    #[test]
    fn refused_second_color_request_does_not_allow_shutdown_during_first() {
        let state = HardwareState::default();
        let pending = Activity::claim(&state.color_active).unwrap();
        assert!(
            state.is_busy(),
            "a queued color command must hold the UI alive before the worker takes the USB lock"
        );
        assert!(Activity::claim(&state.color_active).is_err());
        assert!(
            state.is_busy(),
            "rejecting a duplicate must not release the first command"
        );
        drop(pending);
        assert!(
            !state.is_busy(),
            "completion/error releases the lifecycle guard"
        );
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenUpload {
    pub rgb565_base64: String,
    pub delays_ms: Vec<u16>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareResult {
    pub message: String,
    pub acknowledged: bool,
}
fn result(message: &str) -> HardwareResult {
    HardwareResult {
        message: message.into(),
        acknowledged: true,
    }
}

#[tauri::command]
pub async fn apply_keyboard(
    state: State<'_, HardwareState>,
    profile: Profile,
    scope: String,
    progress: Channel<Progress>,
) -> Result<HardwareResult, String> {
    let prepared = protocol::prepare_profile(&profile)?;
    if !["profile", "lighting", "keys", "macros", "settings", "bar"].contains(&scope.as_str()) {
        return Err("Operação desconhecida".into());
    }
    let lock = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .try_lock()
            .map_err(|_| "O teclado está ocupado com outra operação")?;
        let mut session = Session::new(LinuxTransport::open(false)?);
        let publish = |event| {
            let _ = progress.send(event);
        };
        match scope.as_str() {
            "profile" => session.apply_profile(&prepared, publish)?,
            "lighting" => {
                publish(Progress::new("lighting", 0, 1, "Aplicando iluminação"));
                session.write_single(0x13, 0, &prepared.light, true)?;
                if let Some(colors) = &prepared.colors {
                    session.write_block(0x23, colors)?;
                }
                publish(Progress::new(
                    "lighting",
                    1,
                    1,
                    "Iluminação aceita pelo teclado",
                ));
            }
            "keys" | "macros" => {
                publish(Progress::new("keys", 0, 3, "Gravando macros"));
                session.write_macros(&prepared.macros)?;
                publish(Progress::new("keys", 1, 3, "Gravando camada principal"));
                session.write_block(0x11, &prepared.base)?;
                publish(Progress::new("keys", 2, 3, "Gravando camada Fn"));
                session.write_block(0x27, &prepared.function)?;
                publish(Progress::new(
                    "keys",
                    3,
                    3,
                    "Teclas e macros aceitas pelo teclado",
                ));
            }
            "settings" => session.write_single(0x17, 1, &prepared.settings, false)?,
            "bar" => session.write_single(0x13, 0, &prepared.bar, true)?,
            _ => unreachable!(),
        }
        Ok(result(
            "Configuração enviada; o teclado confirmou os comandos.",
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn upload_screen(
    state: State<'_, HardwareState>,
    request: ScreenUpload,
    progress: Channel<Progress>,
) -> Result<HardwareResult, String> {
    let max_base64 = (protocol::FRAME_BYTES * 141).div_ceil(3) * 4;
    if request.rgb565_base64.len() > max_base64 {
        return Err("Imagem excede o limite do S75 Pro".into());
    }
    let pixels = STANDARD
        .decode(request.rgb565_base64)
        .map_err(|e| format!("Imagem RGB565 inválida: {e}"))?;
    let stream = protocol::screen_image(&pixels, &request.delays_ms)?;
    let lock = state.lock.clone();
    let cancel = state.cancel.clone();
    let activity = Activity::claim(&state.upload_active)?;
    cancel.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let _activity = activity;
        let _guard = lock
            .try_lock()
            .map_err(|_| "O teclado está ocupado com outra operação")?;
        let mut session = Session::new(LinuxTransport::open(true)?);
        session.upload_screen(
            &stream,
            || cancel.load(Ordering::SeqCst),
            |event| {
                let _ = progress.send(event);
            },
        )?;
        Ok(result(
            "Transferência para a tela concluída e finalizada pelo teclado.",
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_upload(state: State<'_, HardwareState>) {
    state.cancel.store(true, Ordering::SeqCst);
}
#[tauri::command]
pub async fn sync_keyboard_clock(
    state: State<'_, HardwareState>,
    time: Clock,
) -> Result<HardwareResult, String> {
    protocol::clock(&time)?;
    let lock = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.try_lock().map_err(|_| "Teclado ocupado")?;
        Session::new(LinuxTransport::open(false)?).sync_clock(&time)?;
        Ok(result("Data e hora enviadas ao teclado."))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_keyboard_colors(state: State<'_, HardwareState>) -> Result<Vec<[u8; 4]>, String> {
    let lock = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.try_lock().map_err(|_| "Teclado ocupado")?;
        Session::new(LinuxTransport::open(false)?).read_colors()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn probe_keyboard(state: State<'_, HardwareState>) -> Result<HardwareResult, String> {
    let lock = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.try_lock().map_err(|_| "Teclado ocupado")?;
        Session::new(LinuxTransport::open(false)?).probe()?;
        Ok(result(
            "Relatório HID recebido do S75 Pro; acesso USB confirmado.",
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
