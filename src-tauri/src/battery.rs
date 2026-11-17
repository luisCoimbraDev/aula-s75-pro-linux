// SPDX-License-Identifier: GPL-3.0-only
//! Read-only battery acquisition: exact keyboard power-supplies, BlueZ Battery1,
//! or the documented 32-byte AULA receiver battery request. USB has no known level.
use gtk::{gio, glib};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::{
        fd::AsRawFd,
        unix::fs::{FileTypeExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Battery {
    pub percent: Option<u8>,
    pub charging: Option<bool>,
    pub source: String,
    pub message: String,
    pub updated_at: Option<u64>,
    pub device_id: Option<String>,
}
impl Battery {
    fn unknown(source: &str, message: &str) -> Self {
        Self {
            percent: None,
            charging: None,
            source: source.into(),
            message: message.into(),
            updated_at: None,
            device_id: None,
        }
    }
    fn reading(percent: u8, charging: Option<bool>, source: &str, id: Option<String>) -> Self {
        Self {
            percent: Some(percent),
            charging,
            source: source.into(),
            message: "Leitura informada pelo teclado".into(),
            updated_at: Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            ),
            device_id: id,
        }
    }
}
#[derive(Default)]
pub struct BatteryState {
    cached: Mutex<Option<(Instant, Battery)>>,
}
pub async fn get(app: tauri::AppHandle, force: bool) -> Result<Battery, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BatteryState>();
        let mut cache = state.cached.lock().map_err(|e| e.to_string())?;
        if !force {
            if let Some((time, reading)) = cache.as_ref() {
                if time.elapsed() < Duration::from_secs(30) {
                    return Ok(reading.clone());
                }
            }
        }
        let busy = app.state::<crate::hardware::HardwareState>().is_busy();
        let reading = read(busy);
        *cache = Some((Instant::now(), reading.clone()));
        Ok(reading)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn get_keyboard_battery(app: tauri::AppHandle) -> Result<Battery, String> {
    get(app, true).await
}
fn text(path: impl AsRef<Path>) -> String {
    fs::read_to_string(path)
        .unwrap_or_default()
        .trim()
        .to_owned()
}
fn is_s75(name: &str) -> bool {
    let value = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();
    value.contains("S75PRO") || value == "S75" || value == "AULAS75"
}

fn kernel(root: &Path) -> Option<Battery> {
    let mut values = Vec::new();
    for entry in fs::read_dir(root).ok()?.flatten() {
        let p = entry.path();
        if text(p.join("type")) != "Battery" || text(p.join("present")) == "0" {
            continue;
        }
        let identity = format!(
            "{} {} {}",
            text(p.join("model_name")),
            text(p.join("device/name")),
            text(p.join("device/uevent"))
        );
        if !is_s75(&identity) {
            continue;
        }
        let value = text(p.join("capacity"))
            .parse::<u8>()
            .ok()
            .filter(|v| *v <= 100);
        if let Some(percent) = value {
            let charging = match text(p.join("status")).as_str() {
                "Charging" => Some(true),
                "Discharging" | "Full" | "Not charging" => Some(false),
                _ => None,
            };
            values.push(Battery::reading(percent, charging, "linux", None));
        }
    }
    if values.len() == 1 {
        values.pop()
    } else {
        None
    }
}
type Props = HashMap<String, glib::Variant>;
type Interfaces = HashMap<String, Props>;
type Objects = HashMap<glib::variant::ObjectPath, Interfaces>;
fn bluez_objects(objects: Objects) -> Option<Battery> {
    let mut values = Vec::new();
    for (path, interfaces) in objects {
        let Some(device) = interfaces.get("org.bluez.Device1") else {
            continue;
        };
        if device.get("Connected").and_then(|v| v.get::<bool>()) != Some(true) {
            continue;
        }
        let matches = ["Name", "Alias"]
            .iter()
            .filter_map(|key| device.get(*key).and_then(|v| v.get::<String>()))
            .any(|name| is_s75(&name));
        if !matches {
            continue;
        }
        let Some(percent) = interfaces
            .get("org.bluez.Battery1")
            .and_then(|p| p.get("Percentage"))
            .and_then(|v| v.get::<u8>())
            .filter(|n| *n <= 100)
        else {
            continue;
        };
        values.push(Battery::reading(
            percent,
            None,
            "bluetooth",
            Some(path.as_str().into()),
        ));
    }
    if values.len() == 1 {
        values.pop()
    } else {
        None
    }
}
fn bluez() -> Option<Battery> {
    let bus = gio::bus_get_sync(gio::BusType::System, None::<&gio::Cancellable>).ok()?;
    let response = bus
        .call_sync(
            Some("org.bluez"),
            "/",
            "org.freedesktop.DBus.ObjectManager",
            "GetManagedObjects",
            None,
            None,
            gio::DBusCallFlags::NONE,
            1000,
            None::<&gio::Cancellable>,
        )
        .ok()?;
    let (objects,) = response.get::<(Objects,)>()?;
    bluez_objects(objects)
}
const fn request(direction: u64, number: u64, len: u64) -> libc::c_ulong {
    ((direction << 30) | (len << 16) | ((b'H' as u64) << 8) | number) as libc::c_ulong
}
fn radio_descriptor(bytes: &[u8]) -> bool {
    let Ok(d) = s75_core::hidraw::descriptor(bytes) else {
        return false;
    };
    d.pages.iter().any(|p| *p >= 0xff00)
        && d.input.len() == 1
        && d.output.len() == 1
        && d.input.get(&0) == Some(&32)
        && d.output.get(&0) == Some(&32)
}
fn battery_request() -> [u8; 33] {
    let mut frame = [0; 33];
    frame[1] = 0x20;
    frame[2] = 1;
    frame[32] = 0x21;
    frame
}
fn battery_response(bytes: &[u8]) -> Option<u8> {
    let b = if bytes.len() == 33 && bytes[0] == 0 {
        &bytes[1..]
    } else {
        bytes
    };
    if b.len() != 32 || b[..3] != [0x20, 1, 0] || !(1..=100).contains(&b[3]) {
        None
    } else {
        Some(b[3])
    }
}
struct Port {
    path: PathBuf,
    vendor: u16,
    product: u16,
    descriptor: Vec<u8>,
}
fn ports(root: &Path) -> Vec<Port> {
    let mut result = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return result;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name
            .strip_prefix("hidraw")
            .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        {
            continue;
        }
        let event = text(entry.path().join("device/uevent"));
        let id = event
            .lines()
            .find_map(|l| l.strip_prefix("HID_ID="))
            .unwrap_or("");
        let pair = match id.to_uppercase().as_str() {
            "0003:00000C45:0000FEFE" => (0x0c45, 0xfefe),
            "0003:000005AC:0000024F" => (0x05ac, 0x024f),
            _ => continue,
        };
        let Ok(bytes) = fs::read(entry.path().join("device/report_descriptor")) else {
            continue;
        };
        // Receiver MI_03, vendor unnumbered 32-byte I/O. Never send this frame to USB control or input keys.
        let interface = entry
            .path()
            .join("device")
            .canonicalize()
            .ok()
            .and_then(|p| {
                p.ancestors()
                    .find_map(|a| fs::read_to_string(a.join("bInterfaceNumber")).ok())
            })
            .unwrap_or_default();
        if interface.trim() != "03" || !radio_descriptor(&bytes) {
            continue;
        }
        result.push(Port {
            path: Path::new("/dev").join(name),
            vendor: pair.0,
            product: pair.1,
            descriptor: bytes,
        });
    }
    result
}
fn open(port: &Port) -> Result<File, String> {
    let file=OpenOptions::new().read(true).write(true).custom_flags(libc::O_CLOEXEC|libc::O_NONBLOCK|libc::O_NOFOLLOW).open(&port.path).map_err(|e|if e.kind()==std::io::ErrorKind::PermissionDenied{"Permissão do receptor ausente: execute scripts/instalar-acesso-usb.sh e reconecte o receptor".into()}else{e.to_string()})?;
    if !file
        .metadata()
        .map_err(|e| e.to_string())?
        .file_type()
        .is_char_device()
    {
        return Err("Receptor HID inválido".into());
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
    // SAFETY: live fd, exact Linux hidraw_info UAPI buffer.
    if unsafe { libc::ioctl(file.as_raw_fd(), request(2, 3, 8), &mut info) } < 0
        || info.bus != 3
        || info.vendor != port.vendor
        || info.product != port.product
    {
        return Err("O receptor conectado mudou".into());
    }
    #[repr(C)]
    struct Descriptor {
        size: u32,
        bytes: [u8; 4096],
    }
    let mut d = Descriptor {
        size: 4096,
        bytes: [0; 4096],
    };
    // SAFETY: the descriptor UAPI buffer is 4100 bytes and includes its capacity.
    if unsafe { libc::ioctl(file.as_raw_fd(), request(2, 2, 4100), &mut d) } < 0
        || d.size > 4096
        || d.bytes[..d.size as usize] != port.descriptor
        || !radio_descriptor(&d.bytes[..d.size as usize])
    {
        return Err("A interface do receptor mudou".into());
    }
    Ok(file)
}
fn query(port: &Port) -> Result<Option<u8>, String> {
    let lock_path = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(format!("s75-studio-{}-usb.lock", unsafe {
            libc::geteuid()
        }));
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    // SAFETY: lock owns this live fd. Only advisory locking, no hardware access.
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("Teclado ocupado: atualize a bateria depois do envio".into());
    }
    let mut file = open(port)?;
    let mut buffer = [0u8; 65];
    for n in 0..64 {
        match file.read(&mut buffer) {
            Ok(0) => return Err("Receptor desconectado".into()),
            Ok(_) => {
                if n == 63 {
                    return Err("O receptor está ocupado".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    if file.write(&battery_request()).map_err(|e| e.to_string())? != 33 {
        return Err("Consulta HID incompleta".into());
    }
    let deadline = Instant::now() + Duration::from_millis(350);
    loop {
        let remain = deadline.saturating_duration_since(Instant::now());
        if remain.is_zero() {
            return Ok(None);
        }
        let mut poll = libc::pollfd {
            fd: file.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: one valid pollfd; its owning File remains alive.
        let result = unsafe {
            libc::poll(
                &mut poll,
                1,
                remain.as_millis().min(i32::MAX as u128) as i32,
            )
        };
        if result == 0 {
            return Ok(None);
        }
        if result < 0 {
            let e = std::io::Error::last_os_error();
            if e.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(e.to_string());
        }
        if poll.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
            return Err("Receptor desconectado".into());
        }
        match file.read(&mut buffer) {
            Ok(0) => return Err("Receptor desconectado".into()),
            Ok(n) => {
                if let Some(percent) = battery_response(&buffer[..n]) {
                    return Ok(Some(percent));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}
pub fn diagnostic() -> Battery {
    read(false)
}
fn wired() -> bool {
    fs::read_dir("/sys/bus/usb/devices")
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| {
            text(e.path().join("idVendor")) == "0c45"
                && text(e.path().join("idProduct")) == "800a"
                && is_s75(&text(e.path().join("product")))
        })
}
fn read(busy: bool) -> Battery {
    if let Some(value) = bluez() {
        return value;
    }
    if let Some(value) = kernel(Path::new("/sys/class/power_supply")) {
        return value;
    }
    let candidates = ports(Path::new("/sys/class/hidraw"));
    if candidates.len() > 1 {
        return Battery::unknown(
            "2.4g",
            "Mais de um receptor compatível: deixe conectado apenas o do S75 Pro",
        );
    }
    if let Some(port) = candidates.first() {
        if busy {
            return Battery::unknown(
                "2.4g",
                "Aguarde a transferência terminar para atualizar a bateria",
            );
        }
        match query(port) {
            Ok(Some(value)) => return Battery::reading(value, None, "2.4g", None),
            Ok(None) => {}
            Err(error) => return Battery::unknown("2.4g", &error),
        }
        if !wired() {
            return Battery::unknown(
                "2.4g",
                "O teclado não respondeu. Acorde-o e clique na bateria para atualizar",
            );
        }
    }
    if wired() {
        Battery::unknown(
            "usb",
            "Nível indisponível por USB. Use 2,4 GHz ou Bluetooth para consultar",
        )
    } else {
        Battery::unknown("unavailable","Conecte por 2,4 GHz ou Bluetooth. O nível depende do receptor ou do serviço Battery1 do teclado")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gtk::glib::variant::ToVariant;
    #[test]
    fn receiver_frame_and_percent_are_strict() {
        let frame = battery_request();
        assert_eq!(&frame[..4], &[0, 0x20, 1, 0]);
        assert_eq!(frame[32], 0x21);
        let mut r = [0u8; 32];
        r[..4].copy_from_slice(&[0x20, 1, 0, 67]);
        assert_eq!(battery_response(&r), Some(67));
        r[3] = 0;
        assert_eq!(battery_response(&r), None);
        r[3] = 255;
        assert_eq!(battery_response(&r), None);
        r[3] = 67;
        r[0] = 19;
        assert_eq!(battery_response(&r), None);
    }
    #[test]
    fn ignores_laptop_and_unrelated_bluetooth_batteries() {
        let device = |name: &str, connected: bool| {
            HashMap::from([
                ("Name".into(), name.to_variant()),
                ("Connected".into(), connected.to_variant()),
            ])
        };
        let entry = |name: &str, connected: bool| {
            HashMap::from([
                ("org.bluez.Device1".into(), device(name, connected)),
                (
                    "org.bluez.Battery1".into(),
                    HashMap::from([("Percentage".into(), 73u8.to_variant())]),
                ),
            ])
        };
        let path =
            glib::variant::ObjectPath::try_from("/org/bluez/hci0/dev_00_11_22_33_44_55").unwrap();
        assert!(
            bluez_objects(HashMap::from([(path.clone(), entry("Headphones", true))])).is_none()
        );
        assert!(bluez_objects(HashMap::from([(
            path.clone(),
            entry("AULA-S75Pro-1", false)
        )]))
        .is_none());
        assert_eq!(
            bluez_objects(HashMap::from([(path, entry("AULA-S75Pro-1", true))]))
                .unwrap()
                .percent,
            Some(73)
        );
        assert!(!is_s75("Notebook Battery"));
    }
}
