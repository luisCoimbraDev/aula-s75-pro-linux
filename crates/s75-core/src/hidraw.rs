// SPDX-License-Identifier: GPL-3.0-only
//! Linux hidraw transport. No device names supplied by the renderer are accepted.
use crate::device::Transport;
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::{
        fd::AsRawFd,
        unix::fs::{FileTypeExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Descriptor {
    pub pages: Vec<u32>,
    pub input: BTreeMap<u8, usize>,
    pub output: BTreeMap<u8, usize>,
    pub feature: BTreeMap<u8, usize>,
}
#[derive(Clone, Copy, Default)]
struct Global {
    size: usize,
    count: usize,
    id: u8,
    page: u32,
}
pub fn descriptor(data: &[u8]) -> Result<Descriptor, String> {
    let mut result = Descriptor::default();
    let mut state = Global::default();
    let mut stack = Vec::new();
    let mut p = 0;
    while p < data.len() {
        let header = data[p];
        p += 1;
        if header == 0xfe {
            if p + 2 > data.len() {
                return Err("Descritor HID truncado".into());
            }
            let len = usize::from(data[p]);
            p += 2 + len;
            if p > data.len() {
                return Err("Descritor HID truncado".into());
            }
            continue;
        }
        let len = match header & 3 {
            3 => 4,
            x => x as usize,
        };
        if p + len > data.len() {
            return Err("Descritor HID truncado".into());
        }
        let mut bytes = [0; 4];
        bytes[..len].copy_from_slice(&data[p..p + len]);
        let value = u32::from_le_bytes(bytes);
        p += len;
        let kind = (header >> 2) & 3;
        let tag = header >> 4;
        if kind == 1 {
            match tag {
                0 => {
                    state.page = value;
                    if !result.pages.contains(&value) {
                        result.pages.push(value);
                    }
                }
                7 => state.size = value as usize,
                8 => state.id = u8::try_from(value).map_err(|_| "ID HID inválido")?,
                9 => state.count = value as usize,
                10 => {
                    if stack.len() >= 16 {
                        return Err("Descritor HID profundo demais".into());
                    }
                    stack.push(state)
                }
                11 => state = stack.pop().ok_or("Pilha HID inválida")?,
                _ => {}
            }
        }
        if kind == 0 {
            let target = match tag {
                8 => Some(&mut result.input),
                9 => Some(&mut result.output),
                11 => Some(&mut result.feature),
                _ => None,
            };
            if let Some(target) = target {
                let bits = state
                    .size
                    .checked_mul(state.count)
                    .filter(|n| *n <= 131072)
                    .ok_or("Tamanho HID inválido")?;
                let entry = target.entry(state.id).or_default();
                *entry = entry
                    .checked_add(bits)
                    .filter(|n| *n <= 131072)
                    .ok_or("Tamanho HID inválido")?;
            }
        }
    }
    for map in [&mut result.input, &mut result.output, &mut result.feature] {
        for value in map.values_mut() {
            *value = value.div_ceil(8);
        }
    }
    Ok(result)
}
#[derive(Debug, Clone)]
pub struct Ports {
    pub control: PathBuf,
    pub screen: Option<PathBuf>,
}
pub fn discover_ports() -> Result<Ports, String> {
    discover_at(Path::new("/sys/class/hidraw"), Path::new("/dev"))
}
fn discover_at(root: &Path, dev: &Path) -> Result<Ports, String> {
    let mut main = Vec::new();
    let mut screens = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|e| format!("Não foi possível enumerar HID: {e}"))?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name
            .strip_prefix("hidraw")
            .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        {
            continue;
        }
        let info = fs::read_to_string(entry.path().join("device/uevent")).unwrap_or_default();
        let field = |key: &str| {
            info.lines()
                .find_map(|l| l.strip_prefix(&format!("{key}=")))
                .unwrap_or("")
        };
        if field("HID_ID") != "0003:00000C45:0000800A"
            || !field("HID_NAME").to_uppercase().contains("AULA-S75PRO")
        {
            continue;
        }
        let Ok(raw) = fs::read(entry.path().join("device/report_descriptor")) else {
            continue;
        };
        let d = descriptor(&raw)?;
        // Vendor feature and display collections only. Never open boot/consumer input collections.
        if d.pages.contains(&0xff13) && d.feature.get(&0) == Some(&64) {
            main.push((
                entry
                    .path()
                    .join("device")
                    .canonicalize()
                    .map_err(|e| e.to_string())?,
                dev.join(&name),
            ));
        }
        if d.pages.contains(&0xff68)
            && d.output.get(&0) == Some(&4096)
            && d.input.get(&0) == Some(&64)
        {
            screens.push((
                entry
                    .path()
                    .join("device")
                    .canonicalize()
                    .map_err(|e| e.to_string())?,
                dev.join(&name),
            ));
        }
    }
    if main.len() != 1 {
        return Err(if main.is_empty() {
            "Interface de controle do S75 Pro não encontrada. Conecte por cabo USB no modo com fio."
        } else {
            "Mais de um S75 Pro conectado; deixe somente o teclado que deseja configurar."
        }
        .into());
    }
    let (control_sys, control) = main.remove(0);
    let usb_parent = |path: &Path| {
        path.ancestors()
            .find(|p| p.join("idVendor").exists())
            .map(Path::to_path_buf)
    };
    let physical = usb_parent(&control_sys);
    let mut matching = screens
        .into_iter()
        .filter(|(sys, _)| physical.is_some() && usb_parent(sys) == physical)
        .map(|(_, node)| node);
    let screen = matching.next();
    if matching.next().is_some() {
        return Err("Interface de tela ambígua".into());
    }
    Ok(Ports { control, screen })
}

const fn ioctl_request(direction: u64, number: u64, len: u64) -> libc::c_ulong {
    ((direction << 30) | (len << 16) | ((b'H' as u64) << 8) | number) as libc::c_ulong
}
fn io_error(operation: &str, error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        format!("Sem permissão para {operation}. Execute scripts/instalar-acesso-usb.sh no terminal e reconecte o S75 Pro; abra o app sem sudo.")
    } else {
        format!("Falha ao {operation}: {error}")
    }
}
fn open_checked(path: &Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| io_error(&format!("abrir {}", path.display()), e))?;
    if !file
        .metadata()
        .map_err(|e| e.to_string())?
        .file_type()
        .is_char_device()
    {
        return Err("O caminho HID não é um dispositivo de caracteres".into());
    }
    #[repr(C)]
    struct Info {
        bus: u32,
        vendor: u16,
        product: u16,
    }
    let mut info = Info {
        bus: 0,
        vendor: 0,
        product: 0,
    };
    // SAFETY: Linux HIDIOCGRAWINFO writes exactly this repr(C), 8-byte UAPI structure.
    let ret = unsafe { libc::ioctl(file.as_raw_fd(), ioctl_request(2, 3, 8), &mut info) };
    if ret < 0 {
        return Err(io_error(
            "identificar o HID",
            std::io::Error::last_os_error(),
        ));
    }
    if info.bus != 3 || info.vendor != 0x0c45 || info.product != 0x800a {
        return Err("O dispositivo conectado mudou; operação cancelada".into());
    }
    let mut name = [0u8; 256];
    // SAFETY: the ioctl encodes exactly name.len() writable bytes; file is owned and live.
    if unsafe {
        libc::ioctl(
            file.as_raw_fd(),
            ioctl_request(2, 4, 256),
            name.as_mut_ptr(),
        )
    } < 0
    {
        return Err(io_error("ler o nome HID", std::io::Error::last_os_error()));
    }
    let end = name.iter().position(|b| *b == 0).unwrap_or(name.len());
    if !String::from_utf8_lossy(&name[..end])
        .to_uppercase()
        .contains("AULA-S75PRO")
    {
        return Err(
            "Nome do teclado não corresponde ao S75 Pro; nenhum comando foi enviado".into(),
        );
    }
    Ok(file)
}
pub fn normalize_feature(data: &[u8]) -> Result<[u8; 64], String> {
    let body = if data.len() == 65 && data[0] == 0 {
        &data[1..]
    } else if data.len() == 64 {
        data
    } else {
        return Err(format!("Resposta HID incompleta: {} bytes", data.len()));
    };
    body.try_into().map_err(|_| "Resposta HID inválida".into())
}
pub struct LinuxTransport {
    _operation_lock: File,
    control: File,
    screen: Option<File>,
}
impl LinuxTransport {
    pub fn open(need_screen: bool) -> Result<Self, String> {
        let ports = discover_ports()?;
        let control = open_checked(&ports.control)?;
        let lock_path = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join(format!("s75-studio-{}-usb.lock", unsafe {
                libc::geteuid()
            }));
        let operation_lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
            .open(lock_path)
            .map_err(|e| format!("Não foi possível criar o bloqueio entre instâncias: {e}"))?;
        // SAFETY: operation_lock owns this live descriptor. Advisory locking writes no file contents.
        if unsafe { libc::flock(operation_lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("Outra instância do S75 Studio está usando o teclado. Feche a outra janela antes de enviar.".into());
        }
        let screen = if need_screen {
            Some(open_checked(
                ports
                    .screen
                    .as_deref()
                    .ok_or("Interface de tela de 4096 bytes não encontrada")?,
            )?)
        } else {
            None
        };
        Ok(Self {
            control,
            screen,
            _operation_lock: operation_lock,
        })
    }
    fn screen(&mut self) -> Result<&mut File, String> {
        self.screen
            .as_mut()
            .ok_or("Interface da tela não foi aberta".into())
    }
}
impl Transport for LinuxTransport {
    fn send_feature(&mut self, data: &[u8; 64]) -> Result<(), String> {
        let mut report = [0; 65];
        report[1..].copy_from_slice(data);
        // SAFETY: report has the exact 65 bytes encoded in this Linux hidraw ioctl.
        let n = unsafe {
            libc::ioctl(
                self.control.as_raw_fd(),
                ioctl_request(3, 6, 65),
                report.as_ptr(),
            )
        };
        if n < 0 {
            return Err(io_error(
                "enviar relatório de controle",
                std::io::Error::last_os_error(),
            ));
        }
        if n < 64 {
            return Err("Relatório de controle enviado parcialmente".into());
        }
        Ok(())
    }
    fn get_feature(&mut self) -> Result<[u8; 64], String> {
        let mut report = [0; 65];
        // SAFETY: report is a live writable 65-byte buffer with unnumbered report ID 0.
        let n = unsafe {
            libc::ioctl(
                self.control.as_raw_fd(),
                ioctl_request(3, 7, 65),
                report.as_mut_ptr(),
            )
        };
        if n < 0 {
            return Err(io_error(
                "receber resposta de controle",
                std::io::Error::last_os_error(),
            ));
        }
        let n = usize::try_from(n).map_err(|e| e.to_string())?;
        if n > report.len() {
            return Err("Resposta HID excedeu o buffer".into());
        }
        normalize_feature(&report[..n])
    }
    fn flush_screen(&mut self) -> Result<(), String> {
        let f = self.screen()?;
        let mut buf = [0; 65];
        for _ in 0..128 {
            match f.read(&mut buf) {
                Ok(0) => return Err("Teclado desconectado".into()),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
                Err(e) => return Err(io_error("limpar respostas da tela", e)),
            }
        }
        Err("Fila da tela não esvazia".into())
    }
    fn write_screen(&mut self, data: &[u8]) -> Result<(), String> {
        if data.len() != 4096 {
            return Err("A página da tela deve ter exatamente 4096 bytes".into());
        }
        let mut frame = vec![0; 4097];
        frame[1..].copy_from_slice(data);
        let n = self
            .screen()?
            .write(&frame)
            .map_err(|e| io_error("enviar página à tela", e))?;
        if n != frame.len() {
            return Err(format!("Página enviada parcialmente: {n}/{}", frame.len()));
        }
        Ok(())
    }
    fn screen_ack(&mut self, timeout: Duration) -> Result<(), String> {
        let f = self.screen()?;
        let deadline = Instant::now() + timeout;
        loop {
            let mut poll = libc::pollfd {
                fd: f.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("A tela não confirmou a página enviada (timeout). A transferência foi interrompida.".into());
            }
            // SAFETY: one live pollfd is provided and its file remains owned throughout poll/read.
            let result = unsafe {
                libc::poll(
                    &mut poll,
                    1,
                    remaining.as_millis().min(i32::MAX as u128) as i32,
                )
            };
            if result < 0 {
                let e = std::io::Error::last_os_error();
                if e.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(io_error("aguardar a tela", e));
            }
            if poll.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
                return Err("Teclado desconectado durante a transferência".into());
            }
            if result > 0 {
                let mut bytes = [0; 65];
                match f.read(&mut bytes) {
                    Ok(0) => return Err("Teclado desconectado".into()),
                    Ok(_) => return Ok(()),
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                    Err(e) => return Err(io_error("receber confirmação da tela", e)),
                }
            }
        }
    }
    fn wait(&mut self, duration: Duration) {
        std::thread::sleep(duration)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptor_selects_vendor_not_keyboard() {
        let source: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/hid-descriptors.json"))
                .unwrap();
        let mut controls = 0;
        let mut screens = 0;
        for d in source["hid"].as_array().unwrap() {
            let hex = d["report_descriptor_hex"].as_str().unwrap();
            let bytes = (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect::<Vec<_>>();
            let parsed = descriptor(&bytes).unwrap();
            if parsed.pages.contains(&0xff13) && parsed.feature.get(&0) == Some(&64) {
                controls += 1;
            }
            if parsed.pages.contains(&0xff68) && parsed.output.get(&0) == Some(&4096) {
                screens += 1;
            }
        }
        assert_eq!(controls, 1);
        assert_eq!(screens, 1);
        assert!(descriptor(&[0x76, 1]).is_err());
    }
    #[test]
    fn feature_report_id_is_not_a_payload_byte() {
        let data = [4; 64];
        assert_eq!(normalize_feature(&data).unwrap(), data);
        let mut prefixed = vec![0];
        prefixed.extend(data);
        assert_eq!(normalize_feature(&prefixed).unwrap(), data);
        assert!(normalize_feature(&[0; 63]).is_err());
        assert!(normalize_feature(&[4; 65]).is_err());
    }
}
