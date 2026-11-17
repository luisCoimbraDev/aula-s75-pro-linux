use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub name: String,
    pub vendor_id: String,
    pub product_id: String,
    pub connection: String,
    pub confirmed_model: bool,
    pub interfaces: Vec<HidInterface>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidInterface {
    pub node: String,
    pub driver: String,
    pub physical_path: String,
    pub node_visible: bool,
    pub descriptor_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub platform: String,
    pub devices: Vec<Device>,
    pub configuration_writes_enabled: bool,
    pub protocol_status: String,
}

fn read(path: impl AsRef<Path>) -> String {
    fs::read_to_string(path)
        .unwrap_or_default()
        .trim()
        .to_owned()
}

pub fn scan() -> Diagnostics {
    scan_roots(Path::new("/sys"), Path::new("/dev"))
}

pub fn scan_roots(sys: &Path, dev: &Path) -> Diagnostics {
    let mut devices = Vec::new();
    if let Ok(entries) = fs::read_dir(sys.join("bus/usb/devices")) {
        for entry in entries.flatten() {
            let path = entry.path();
            let vendor = read(path.join("idVendor")).to_lowercase();
            let product = read(path.join("idProduct")).to_lowercase();
            let (connection, confirmed) = match (vendor.as_str(), product.as_str()) {
                ("0c45", "800a") => ("USB com fio", true),
                ("0c45", "fefe") => ("Receptor 2,4 GHz", false),
                ("05ac", "024f") => ("Receptor 2,4 GHz · modelo a confirmar", false),
                _ => continue,
            };
            let mut interfaces = Vec::new();
            let wanted = format!(
                ":{:08X}:{:08X}",
                u32::from_str_radix(&vendor, 16).unwrap_or(0),
                u32::from_str_radix(&product, 16).unwrap_or(0)
            );
            if let Ok(hids) = fs::read_dir(sys.join("class/hidraw")) {
                for hid in hids.flatten() {
                    let events = read(hid.path().join("device/uevent"));
                    let field = |key: &str| {
                        events
                            .lines()
                            .find_map(|line| line.strip_prefix(&format!("{key}=")))
                            .unwrap_or("")
                            .to_owned()
                    };
                    if !field("HID_ID").to_uppercase().ends_with(&wanted) {
                        continue;
                    }
                    let node = dev.join(hid.file_name());
                    interfaces.push(HidInterface {
                        node: node.to_string_lossy().into_owned(),
                        driver: field("DRIVER"),
                        physical_path: field("HID_PHYS"),
                        node_visible: node.exists(),
                        descriptor_bytes: fs::read(hid.path().join("device/report_descriptor"))
                            .map(|b| b.len())
                            .unwrap_or(0),
                    });
                }
            }
            interfaces.sort_by(|a, b| a.node.cmp(&b.node));
            devices.push(Device {
                name: read(path.join("product")),
                vendor_id: vendor,
                product_id: product,
                connection: connection.into(),
                confirmed_model: confirmed,
                interfaces,
            });
        }
    }
    devices.sort_by_key(|d| !d.confirmed_model);
    Diagnostics {
        platform: std::env::consts::OS.into(),
        devices,
        configuration_writes_enabled: true,
        protocol_status:
            "Protocolo AULA 04 disponível por USB; use Testar comunicação para verificar acesso"
                .into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_enumeration_from_hidden_hidraw_and_unknown_receiver() {
        let root = std::env::temp_dir().join(format!("s75-discovery-{}", std::process::id()));
        let sys = root.join("sys");
        for (name, vendor, product) in [
            ("1-2", "0c45", "800a"),
            ("1-3", "05ac", "024f"),
            ("1-4", "1532", "008a"),
        ] {
            let p = sys.join("bus/usb/devices").join(name);
            fs::create_dir_all(&p).unwrap();
            fs::write(p.join("idVendor"), vendor).unwrap();
            fs::write(p.join("idProduct"), product).unwrap();
        }
        let hid = sys.join("class/hidraw/hidraw2/device");
        fs::create_dir_all(&hid).unwrap();
        fs::write(
            hid.join("uevent"),
            "HID_ID=0003:00000C45:0000800A\nDRIVER=hid-generic\n",
        )
        .unwrap();
        let result = scan_roots(&sys, &root.join("dev"));
        assert_eq!(result.devices.len(), 2);
        assert!(result.devices[0].confirmed_model);
        assert!(!result.devices[1].confirmed_model);
        assert_eq!(result.devices[0].interfaces.len(), 1);
        assert!(!result.devices[0].interfaces[0].node_visible);
        assert!(result.configuration_writes_enabled);
        fs::remove_dir_all(root).unwrap();
    }
}
