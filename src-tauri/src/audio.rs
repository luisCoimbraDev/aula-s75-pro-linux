// SPDX-License-Identifier: GPL-3.0-only
//! System output monitor via PipeWire. PCM is never persisted or transmitted over a network.
use std::{
    io::Read,
    os::fd::AsRawFd,
    process::{Child, ChildStdout, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub fn sink_name(inspect: &str) -> Result<String, String> {
    inspect
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once('=')?;
            if key.trim().trim_start_matches('*').trim() != "node.name" {
                return None;
            }
            let v = value.trim().trim_matches('"');
            if v.is_empty() || v.contains('\0') {
                None
            } else {
                Some(v.into())
            }
        })
        .ok_or("A saída de áudio padrão não foi identificada pelo WirePlumber".into())
}
fn default_sink() -> Result<String, String> {
    let mut child = Command::new("wpctl")
        .args(["inspect", "@DEFAULT_AUDIO_SINK@"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("WirePlumber (wpctl) não disponível: {e}"))?;
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(3) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("A sessão de áudio não respondeu em 3 segundos".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if !status.success() {
        return Err("Não foi possível acessar a saída de áudio desta sessão. Verifique PipeWire/WirePlumber e execute o app como usuário normal.".into());
    }
    let mut out = String::new();
    child
        .stdout
        .take()
        .ok_or("Saída do wpctl indisponível")?
        .take(65536)
        .read_to_string(&mut out)
        .map_err(|e| e.to_string())?;
    sink_name(&out)
}
pub struct Capture {
    child: Child,
    stdout: ChildStdout,
    pending: [u8; 4096],
    filled: usize,
}
impl Capture {
    pub fn open() -> Result<Self, String> {
        let target = default_sink()?;
        let mut child = Command::new("pw-record")
            .args([
                "--raw",
                "--rate=48000",
                "--channels=2",
                "--format=s16",
                "--latency=50ms",
                "--target",
                &target,
                "--properties",
                "stream.capture.sink=true",
                "-",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Captura PipeWire (pw-record) indisponível: {e}"))?;
        let stdout = child.stdout.take().ok_or("PCM indisponível")?;
        // SAFETY: stdout owns this valid pipe descriptor. Only its O_NONBLOCK flag is changed.
        let flags = unsafe { libc::fcntl(stdout.as_raw_fd(), libc::F_GETFL) };
        if flags < 0
            || unsafe { libc::fcntl(stdout.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) }
                < 0
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Não foi possível preparar o fluxo de áudio".into());
        }
        Ok(Self {
            child,
            stdout,
            pending: [0; 4096],
            filled: 0,
        })
    }
    pub fn next(&mut self, stop: &AtomicBool) -> Result<Option<Vec<f32>>, String> {
        let deadline = Instant::now() + Duration::from_secs(3);
        while self.filled < self.pending.len() {
            if stop.load(Ordering::SeqCst) {
                return Ok(None);
            }
            if Instant::now() > deadline {
                return Err("O monitor da saída de áudio não entregou amostras. Verifique a saída padrão do sistema.".into());
            }
            let mut poll = libc::pollfd {
                fd: self.stdout.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: one valid pollfd is borrowed while its owning ChildStdout remains live.
            let ready = unsafe { libc::poll(&mut poll, 1, 100) };
            if ready < 0 {
                let e = std::io::Error::last_os_error();
                if e.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(e.to_string());
            }
            if ready == 0 {
                continue;
            }
            match self.stdout.read(&mut self.pending[self.filled..]) {
                Ok(0) => {
                    return Err(
                        "A captura PipeWire foi encerrada. Nenhum áudio é salvo pelo aplicativo."
                            .into(),
                    )
                }
                Ok(n) => self.filled += n,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
        self.filled = 0;
        Ok(Some(
            self.pending
                .chunks_exact(4)
                .map(|b| {
                    (f32::from(i16::from_le_bytes([b[0], b[1]]))
                        + f32::from(i16::from_le_bytes([b[2], b[3]])))
                        / 65536.0
                })
                .collect(),
        ))
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct Spectrum {
    levels: [f32; 15],
    phase: f32,
}
impl Default for Spectrum {
    fn default() -> Self {
        Self {
            levels: [0.; 15],
            phase: 0.,
        }
    }
}
fn hsv(h: f32, s: f32, v: f32) -> [u8; 3] {
    let h = h.rem_euclid(1.) * 6.;
    let i = h.floor() as i32;
    let f = h - i as f32;
    let p = v * (1. - s);
    let q = v * (1. - s * f);
    let t = v * (1. - s * (1. - f));
    let rgb = match i {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    };
    rgb.map(|c| (c.clamp(0., 1.) * 255.).round() as u8)
}
impl Spectrum {
    pub fn colors(&mut self, mono: &[f32], palette: u8, gain: u8, base: [u8; 3]) -> Vec<[u8; 3]> {
        let frequencies = [
            55., 85., 130., 200., 300., 450., 650., 1000., 1500., 2200., 3300., 5000., 7500.,
            10000., 14000.,
        ];
        let n = mono.len().max(1) as f32;
        let window = mono
            .iter()
            .enumerate()
            .map(|(i, s)| s * (0.5 - 0.5 * (2. * std::f32::consts::PI * i as f32 / n).cos()))
            .collect::<Vec<_>>();
        for (band, frequency) in frequencies.iter().enumerate() {
            let coefficient = 2. * (2. * std::f32::consts::PI * frequency / 48000.).cos();
            let (mut a, mut b) = (0., 0.);
            for sample in &window {
                let next = sample + coefficient * a - b;
                b = a;
                a = next;
            }
            let magnitude = (a * a + b * b - coefficient * a * b).max(0.).sqrt() / n;
            let target = (magnitude * f32::from(gain) * 12.).sqrt().clamp(0., 1.);
            self.levels[band] = target.max(self.levels[band] * 0.82);
        }
        self.phase = (self.phase + 0.006) % 1.;
        s75_core::protocol::keys()
            .iter()
            .map(|k| {
                let column = (((k.x + k.width / 2.) / 640.) * 15.).floor().clamp(0., 14.) as usize;
                let row = ((k.y + k.height / 2.) / 264.).clamp(0., 1.);
                let height = self.levels[column];
                if height <= 0.01 || 1. - row > height {
                    return [0, 0, 0];
                }
                let value = (height * 1.5).clamp(0., 1.);
                let hue = match palette {
                    0 => column as f32 / 15. + self.phase,
                    1 => 0.35 + column as f32 / 60.,
                    2 => 0.01 + column as f32 / 150.,
                    3 => 0.5 + column as f32 / 100.,
                    4 => 0.25 + column as f32 / 150.,
                    5 => 0.97 + column as f32 / 100.,
                    6 => 0.75 + column as f32 / 30.,
                    7 => 0.52,
                    8 => 0.78,
                    9 => 0.1,
                    _ => 0.,
                };
                if palette == 11 {
                    return base.map(|c| (f32::from(c) * value) as u8);
                }
                hsv(
                    hue,
                    if palette == 10 {
                        0.
                    } else if palette == 7 {
                        0.4
                    } else {
                        0.9
                    },
                    value,
                )
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn picks_default_sink_without_shell_evaluation() {
        assert_eq!(
            sink_name("id 42, type PipeWire\n * node.name = \"alsa_output.sink\"\n").unwrap(),
            "alsa_output.sink"
        );
        assert!(sink_name("nothing").is_err());
    }
    #[test]
    fn silence_is_dark_and_tone_produces_led_colors() {
        let mut spectrum = Spectrum::default();
        assert!(spectrum
            .colors(&vec![0.; 1024], 0, 4, [255, 0, 0])
            .iter()
            .all(|c| *c == [0, 0, 0]));
        let tone = (0..1024)
            .map(|i| (2. * std::f32::consts::PI * 2200. * i as f32 / 48000.).sin() * 0.8)
            .collect::<Vec<_>>();
        let colors = spectrum.colors(&tone, 11, 4, [255, 0, 0]);
        assert_eq!(colors.len(), 80);
        assert!(colors.iter().any(|c| c[0] > 0));
        assert!(colors.iter().all(|c| c[1] == 0 && c[2] == 0));
    }
}
