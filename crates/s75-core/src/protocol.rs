// SPDX-License-Identifier: GPL-3.0-only
// Protocol implementation adapted from livvaa/AulaToolkit (GPL-3.0).
// References and provenance: THIRD_PARTY.md and docs/protocol.md.
use crate::profile::Profile;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REPORT: usize = 64;
pub const BLOCK: usize = 576;
pub const PAGE: usize = 4096;
pub const FRAME_BYTES: usize = 135 * 240 * 2;
pub const MAX_SCREEN_BYTES: usize = (256 + FRAME_BYTES * 141).div_ceil(PAGE) * PAGE;
pub const BEGIN: u8 = 0x18;
pub const END: u8 = 0x02;
pub const APPLY: u8 = 0xf0;

#[derive(Clone, Debug, Deserialize)]
pub struct KeyDef {
    pub id: usize,
    pub usage: u8,
    pub led: usize,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

pub fn live_light(colors: &[[u8; 3]]) -> Result<[u8; 512], String> {
    let keys = keys();
    if colors.len() != keys.len() {
        return Err("Quadro aovivo precisa de 80 cores".into());
    }
    let mut block = [0; 512];
    for (i, (key, color)) in keys.iter().zip(colors).enumerate() {
        block[i * 4..i * 4 + 4].copy_from_slice(&[key.led as u8, color[0], color[1], color[2]]);
    }
    Ok(block)
}
pub fn keys() -> Vec<KeyDef> {
    serde_json::from_str(include_str!("../../../src/keyboard.json"))
        .expect("layout validado no build")
}

pub fn command(op: u8, argument: u8, packets: u16) -> [u8; REPORT] {
    let mut b = [0; REPORT];
    b[0] = 4;
    b[1] = op;
    b[2] = argument;
    b[8..10].copy_from_slice(&packets.to_le_bytes());
    b
}
fn tag(data: &mut [u8]) {
    let n = data.len();
    data[n - 2..].copy_from_slice(&[0xaa, 0x55]);
}
pub fn rgb(value: &str) -> Result<[u8; 3], String> {
    if value.len() != 7
        || !value.starts_with('#')
        || !value[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Cor RGB inválida".into());
    }
    Ok([
        u8::from_str_radix(&value[1..3], 16).map_err(|e| e.to_string())?,
        u8::from_str_radix(&value[3..5], 16).map_err(|e| e.to_string())?,
        u8::from_str_radix(&value[5..7], 16).map_err(|e| e.to_string())?,
    ])
}
pub fn number(v: &Value, name: &str, default: u8, min: u8, max: u8) -> Result<u8, String> {
    let n = match v.get(name) {
        None => u64::from(default),
        Some(n) => n
            .as_u64()
            .ok_or_else(|| format!("Valor inválido: {name}"))?,
    };
    if n < u64::from(min) || n > u64::from(max) {
        return Err(format!("{name} deve ficar entre {min} e {max}"));
    }
    Ok(n as u8)
}
pub fn lighting_mode(effect: &str) -> Result<u8, String> {
    match effect {
        "off" => Ok(0),
        "static" => Ok(1),
        "breathing" => Ok(7),
        "wave" => Ok(11),
        "custom" => Ok(0x80),
        value if value.starts_with("mode:") => value[5..]
            .parse::<u8>()
            .ok()
            .filter(|m| (1..=19).contains(m))
            .ok_or("Modo RGB inválido".into()),
        _ => Err("Modo RGB inválido".into()),
    }
}
pub fn lighting(s: &Value) -> Result<[u8; 64], String> {
    let mut p = [0; 64];
    p[0] = lighting_mode(s["effect"].as_str().ok_or("Efeito inválido")?)?;
    p[1..4].copy_from_slice(&rgb(s["color"].as_str().ok_or("Cor inválida")?)?);
    p[8] = u8::from(s["colorful"].as_bool().unwrap_or(false));
    p[9] = number(s, "brightness", 5, 0, 5)?;
    p[10] = number(s, "speed", 3, 0, 5)?;
    p[11] = number(s, "direction", 0, 0, 3)?;
    tag(&mut p);
    Ok(p)
}
pub fn bar(mode: u8) -> Result<[u8; 64], String> {
    if !(0x20..=0x24).contains(&mode) {
        return Err("Modo da luz lateral inválido".into());
    }
    let mut p = [0; 64];
    p[0] = mode;
    tag(&mut p);
    Ok(p)
}
pub fn settings(s: &Value) -> Result<[u8; 64], String> {
    let mut p = [0; 64];
    p[1] = 1;
    for (name, index) in [("winLock", 2), ("altF4", 3), ("altTab", 4)] {
        p[index] = number(s, name, 0, 0, 1)?;
    }
    p[5] = number(s, "fnSwitch", 0, 0, 1)?;
    p[6] = number(s, "sleep", 0, 0, 3)?;
    p[8] = number(s, "response", 1, 1, 5)?;
    tag(&mut p);
    Ok(p)
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clock {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    pub weekday: u8,
}
pub fn clock(t: &Clock) -> Result<[u8; 64], String> {
    let leap =
        t.year.is_multiple_of(4) && (!t.year.is_multiple_of(100) || t.year.is_multiple_of(400));
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(2000..=2099).contains(&t.year)
        || !(1..=12).contains(&t.month)
        || t.day == 0
        || t.day > days[usize::from(t.month.saturating_sub(1)).min(11)]
        || t.hour > 23
        || t.minute > 59
        || t.second > 59
        || t.weekday > 6
    {
        return Err("Data/hora inválida para o teclado".into());
    }
    let mut p = [0; 64];
    p[..11].copy_from_slice(&[
        0,
        1,
        0x5a,
        (t.year % 100) as u8,
        t.month,
        t.day,
        t.hour,
        t.minute,
        t.second,
        0,
        t.weekday,
    ]);
    tag(&mut p);
    Ok(p)
}

pub fn browser_key(code: &str) -> Result<u8, String> {
    if code.len() == 4 && code.starts_with("Key") && code.as_bytes()[3].is_ascii_uppercase() {
        return Ok(4 + code.as_bytes()[3] - b'A');
    }
    if let Some(d) = code.strip_prefix("Digit") {
        if d.len() == 1 && d.as_bytes()[0].is_ascii_digit() {
            return Ok(if d == "0" {
                0x27
            } else {
                0x1d + d.as_bytes()[0] - b'0'
            });
        }
    }
    if let Some(f) = code.strip_prefix('F').and_then(|v| v.parse::<u8>().ok()) {
        if (1..=12).contains(&f) {
            return Ok(0x39 + f);
        }
        if (13..=24).contains(&f) {
            return Ok(0x68 + f - 13);
        }
    }
    let value = match code {
        "Enter" => 0x28,
        "Escape" => 0x29,
        "Backspace" => 0x2a,
        "Tab" => 0x2b,
        "Space" => 0x2c,
        "Minus" => 0x2d,
        "Equal" => 0x2e,
        "BracketLeft" => 0x2f,
        "BracketRight" => 0x30,
        "Backslash" => 0x31,
        "Semicolon" => 0x33,
        "Quote" => 0x34,
        "Backquote" => 0x35,
        "Comma" => 0x36,
        "Period" => 0x37,
        "Slash" => 0x38,
        "CapsLock" => 0x39,
        "PrintScreen" => 0x46,
        "ScrollLock" => 0x47,
        "Pause" => 0x48,
        "Insert" => 0x49,
        "Home" => 0x4a,
        "PageUp" => 0x4b,
        "Delete" => 0x4c,
        "End" => 0x4d,
        "PageDown" => 0x4e,
        "ArrowRight" => 0x4f,
        "ArrowLeft" => 0x50,
        "ArrowDown" => 0x51,
        "ArrowUp" => 0x52,
        "NumLock" => 0x53,
        "NumpadDivide" => 0x54,
        "NumpadMultiply" => 0x55,
        "NumpadSubtract" => 0x56,
        "NumpadAdd" => 0x57,
        "NumpadEnter" => 0x58,
        "Numpad1" => 0x59,
        "Numpad2" => 0x5a,
        "Numpad3" => 0x5b,
        "Numpad4" => 0x5c,
        "Numpad5" => 0x5d,
        "Numpad6" => 0x5e,
        "Numpad7" => 0x5f,
        "Numpad8" => 0x60,
        "Numpad9" => 0x61,
        "Numpad0" => 0x62,
        "NumpadDecimal" => 0x63,
        "IntlBackslash" => 0x64,
        "ContextMenu" => 0x65,
        "ControlLeft" => 0xe0,
        "ShiftLeft" => 0xe1,
        "AltLeft" => 0xe2,
        "MetaLeft" => 0xe3,
        "ControlRight" => 0xe4,
        "ShiftRight" => 0xe5,
        "AltRight" => 0xe6,
        "MetaRight" => 0xe7,
        _ => return Err(format!("Tecla da macro não reconhecida: {code}")),
    };
    Ok(value)
}
fn key_action(usage: u8, mods: u8) -> [u8; 4] {
    if (0xe0..=0xe7).contains(&usage) {
        [2, mods | (1 << (usage - 0xe0)), 0, 0]
    } else {
        [2, mods, usage, 0]
    }
}
fn encode_action(action: &str, macros: &[Value]) -> Result<[u8; 4], String> {
    if action == "disabled" {
        return Ok([5, 3, 0, 0]);
    }
    if let Some(code) = action.strip_prefix("key:") {
        return Ok(key_action(
            code.parse::<u8>().map_err(|_| "Código de tecla inválido")?,
            0,
        ));
    }
    if let Some(code) = action.strip_prefix("shortcut:") {
        let (m, k) = code.split_once(':').ok_or("Combinação inválida")?;
        return Ok(key_action(
            k.parse().map_err(|_| "Tecla inválida")?,
            m.parse().map_err(|_| "Modificadores inválidos")?,
        ));
    }
    if let Some(name) = action.strip_prefix("media:") {
        let usage: u16 = match name {
            "volume-up" => 0xe9,
            "volume-down" => 0xea,
            "mute" => 0xe2,
            "play-pause" => 0xcd,
            "next" => 0xb5,
            "previous" => 0xb6,
            "stop" => 0xb7,
            _ => return Err("Ação multimídia inválida".into()),
        };
        return Ok([3, usage as u8, (usage >> 8) as u8, 0]);
    }
    if let Some(id) = action.strip_prefix("macro:") {
        let index = macros
            .iter()
            .position(|m| m["id"].as_str() == Some(id))
            .ok_or("O mapeamento referencia uma macro inexistente")?;
        if macros[index]["events"].as_array().is_none_or(Vec::is_empty) {
            return Err("Não é possível atribuir uma macro vazia".into());
        }
        return Ok([
            6,
            index as u8,
            number(&macros[index], "playMode", 0, 0, 4)?,
            number(&macros[index], "loops", 1, 1, 255)?,
        ]);
    }
    if let Some(id) = action.strip_prefix("mouse:") {
        let (a, b) = match id {
            "1" => (1, 1),
            "2" => (1, 4),
            "3" => (1, 2),
            "4" => (1, 3),
            "5" => (3, 1),
            "6" => (3, 255),
            "7" => (1, 8),
            "8" => (1, 16),
            _ => return Err("Ação de mouse inválida".into()),
        };
        return Ok([1, a, b, 0]);
    }
    Err(format!("Ação não suportada: {action}"))
}
pub fn keymap(s: &Value, layer: &str) -> Result<[u8; BLOCK], String> {
    let mut p = [0; BLOCK];
    let known = keys();
    let macros = s["macros"].as_array().ok_or("Macros inválidas")?;
    for (k, action) in s["mappings"].as_object().ok_or("Mapeamentos inválidos")? {
        let (l, id) = k.split_once(':').ok_or("Mapeamento inválido")?;
        if l != layer {
            continue;
        }
        let id = id
            .parse::<usize>()
            .map_err(|_| "Índice de tecla inválido")?;
        if !known.iter().any(|k| k.id == id) {
            return Err(format!("Tecla {id} não existe no S75 Pro"));
        }
        p[id * 4..id * 4 + 4].copy_from_slice(&encode_action(
            action.as_str().ok_or("Ação inválida")?,
            macros,
        )?);
    }
    tag(&mut p);
    Ok(p)
}
pub fn per_key(s: &Value) -> Result<[u8; BLOCK], String> {
    let mut p = [0; BLOCK];
    let base = rgb(s["color"].as_str().ok_or("Cor inválida")?)?;
    for k in keys() {
        let c = match s["keyColors"].get(k.id.to_string()) {
            Some(v) => rgb(v.as_str().ok_or("Cor por tecla inválida")?)?,
            None => base,
        };
        p[k.led * 4..k.led * 4 + 4].copy_from_slice(&[k.led as u8, c[0], c[1], c[2]]);
    }
    tag(&mut p);
    Ok(p)
}
pub fn macros(s: &Value) -> Result<Vec<u8>, String> {
    let macros = s["macros"].as_array().ok_or("Lista de macros inválida")?;
    if macros.len() > 100 {
        return Err("Máximo de 100 macros".into());
    }
    let mut p = vec![0; 0xe00];
    let mut offset = 400;
    for (index, m) in macros.iter().enumerate() {
        let events = m["events"].as_array().ok_or("Eventos inválidos")?;
        if events.is_empty() {
            p[index * 4..index * 4 + 4].fill(0xff);
            continue;
        }
        let mut steps = Vec::<[u8; 4]>::new();
        for e in events {
            let delay = e["delay"]
                .as_u64()
                .filter(|v| *v <= 60000)
                .ok_or("Atraso de macro inválido")? as u16;
            if delay > 0 {
                let d = delay.max(10).to_le_bytes();
                steps.push([d[0], d[1], 0, 0x50]);
            }
            let code = browser_key(e["key"].as_str().ok_or("Tecla de macro inválida")?)?;
            let kind = match e["kind"].as_str() {
                Some("down") => 0xb0,
                Some("up") => 0x30,
                _ => return Err("Evento de macro inválido".into()),
            };
            steps.push([0, 0, code, kind]);
        }
        if offset + 8 + steps.len() * 4 > p.len() - 64 {
            return Err("Memória de macros do teclado cheia; reduza eventos ou atrasos".into());
        }
        p[index * 4..index * 4 + 2].copy_from_slice(&(offset as u16).to_le_bytes());
        p[offset..offset + 2].copy_from_slice(&(steps.len() as u16).to_le_bytes());
        for (step, data) in steps.iter().enumerate() {
            p[offset + 8 + step * 4..offset + 12 + step * 4].copy_from_slice(data);
        }
        offset += 8 + steps.len() * 4;
    }
    let packets = offset / 64 + if offset.is_multiple_of(64) { 1 } else { 2 };
    p.truncate(packets * 64);
    tag(&mut p);
    Ok(p)
}
#[derive(Clone, Debug)]
pub struct PreparedProfile {
    pub light: [u8; 64],
    pub colors: Option<[u8; BLOCK]>,
    pub base: [u8; BLOCK],
    pub function: [u8; BLOCK],
    pub macros: Vec<u8>,
    pub settings: [u8; 64],
    pub bar: [u8; 64],
}
pub fn prepare_profile(profile: &Profile) -> Result<PreparedProfile, String> {
    profile.validate()?;
    let s = &profile.settings;
    Ok(PreparedProfile {
        light: lighting(s)?,
        colors: if s["effect"] == "custom" {
            Some(per_key(s)?)
        } else {
            None
        },
        base: keymap(s, "base")?,
        function: keymap(s, "fn")?,
        macros: macros(s)?,
        settings: settings(&s["deviceSettings"])?,
        bar: bar(number(s, "barMode", 0x20, 0x20, 0x24)?)?,
    })
}

pub fn screen_image(pixels: &[u8], delays: &[u16]) -> Result<Vec<u8>, String> {
    if delays.is_empty() || delays.len() > 141 || pixels.len() != delays.len() * FRAME_BYTES {
        return Err("Mídia deve ter de 1 a 141 quadros RGB565 completos de 135×240".into());
    }
    if delays.iter().any(|d| *d == 0 || *d > 510) {
        return Err("Cada intervalo da tela deve ficar entre 1 e 510 ms".into());
    }
    let total = 256 + pixels.len();
    let mut out = vec![0xff; total.div_ceil(PAGE) * PAGE];
    out[0] = delays.len() as u8;
    for (i, delay) in delays.iter().enumerate() {
        out[i + 1] = ((*delay as f32 / 2.0).round() as u16).clamp(1, 255) as u8;
    }
    out[256..256 + pixels.len()].copy_from_slice(pixels);
    if out.len() > MAX_SCREEN_BYTES {
        return Err("Mídia excede a região de tela do S75 Pro".into());
    }
    Ok(out)
}
pub fn validate_screen_image(data: &[u8]) -> Result<(), String> {
    if data.len() < PAGE || data.len() > MAX_SCREEN_BYTES || !data.len().is_multiple_of(PAGE) {
        return Err("Blocos de tela inválidos".into());
    }
    let n = usize::from(data[0]);
    if !(1..=141).contains(&n)
        || data.len() != (256 + n * FRAME_BYTES).div_ceil(PAGE) * PAGE
        || data[1..=n].contains(&0)
    {
        return Err("Cabeçalho de tela inválido".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn reference_packets() {
        assert_eq!(
            &command(0x11, 0, 9)[..10],
            &[4, 0x11, 0, 0, 0, 0, 0, 0, 9, 0]
        );
        let p = lighting(
            &json!({"effect":"breathing","color":"#ff0080","brightness":4,"speed":2,"direction":1}),
        )
        .unwrap();
        assert_eq!(&p[..12], &[7, 255, 0, 128, 0, 0, 0, 0, 0, 4, 2, 1]);
        assert_eq!(&p[62..], &[0xaa, 0x55]);
    }
    #[test]
    fn key_entries_match_reference() {
        assert_eq!(encode_action("key:225", &[]).unwrap(), [2, 2, 0, 0]);
        assert_eq!(encode_action("shortcut:1:4", &[]).unwrap(), [2, 1, 4, 0]);
        assert_eq!(
            encode_action("media:volume-up", &[]).unwrap(),
            [3, 0xe9, 0, 0]
        );
        assert_eq!(encode_action("disabled", &[]).unwrap(), [5, 3, 0, 0]);
        let s = json!({"mappings":{"base:1":"key:41"},"macros":[]});
        assert_eq!(&keymap(&s, "base").unwrap()[4..8], &[2, 0, 41, 0]);
    }
    #[test]
    fn macro_fixture() {
        let s = json!({"macros":[{"id":"a","events":[{"key":"KeyA","kind":"down","delay":0},{"key":"KeyA","kind":"up","delay":50}]}]});
        let p = macros(&s).unwrap();
        assert_eq!(p.len(), 512);
        assert_eq!(&p[..4], &[0x90, 1, 0, 0]);
        assert_eq!(
            &p[400..420],
            &[3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0xb0, 50, 0, 0, 0x50, 0, 0, 4, 0x30]
        );
    }
    #[test]
    fn rejects_overflow_and_malformed_media() {
        let p = vec![0; FRAME_BYTES];
        let s = screen_image(&p, &[100]).unwrap();
        assert_eq!(s.len(), 16 * 4096);
        assert_eq!(&s[..2], &[1, 50]);
        assert!(s[256 + FRAME_BYTES..].iter().all(|b| *b == 255));
        validate_screen_image(&s).unwrap();
        assert!(screen_image(&p, &[100, 100]).is_err());
        assert!(screen_image(&vec![0; FRAME_BYTES * 142], &[100; 142]).is_err());
        let mut bad = s;
        bad[0] = 141;
        assert!(validate_screen_image(&bad).is_err());
    }
    #[test]
    fn calendar_and_keycodes() {
        assert!(clock(&Clock {
            year: 2026,
            month: 2,
            day: 29,
            hour: 0,
            minute: 0,
            second: 0,
            weekday: 0
        })
        .is_err());
        assert_eq!(browser_key("Digit1").unwrap(), 0x1e);
        assert_eq!(browser_key("ShiftRight").unwrap(), 0xe5);
        assert!(browser_key("Unidentified").is_err());
    }
}
