// SPDX-License-Identifier: GPL-3.0-only
//! Native image conversion for the GNOME popover. No WebView is opened for USB uploads.
use gdk_pixbuf::{prelude::*, Pixbuf, PixbufLoader};
use std::{fs, io::Read, path::Path};

pub struct Prepared {
    pub pixels: Vec<u8>,
    pub delays: Vec<u16>,
    pub thumbnail: Vec<u8>,
}
fn skip_blocks(bytes: &[u8], cursor: &mut usize) -> Result<(), String> {
    loop {
        let n = *bytes.get(*cursor).ok_or("GIF truncado")? as usize;
        *cursor += 1;
        if n == 0 {
            return Ok(());
        }
        *cursor = cursor.checked_add(n).ok_or("GIF inválido")?;
        if *cursor > bytes.len() {
            return Err("GIF truncado".into());
        }
    }
}
fn gif_frames(bytes: &[u8]) -> Result<usize, String> {
    if bytes.len() < 13 {
        return Err("GIF truncado".into());
    }
    let mut cursor = 13
        + if bytes[10] & 128 != 0 {
            3 * (1usize << ((bytes[10] & 7) + 1))
        } else {
            0
        };
    let mut frames = 0;
    loop {
        match bytes.get(cursor).copied() {
            Some(0x3b) => {
                return if frames > 0 {
                    Ok(frames)
                } else {
                    Err("GIF sem quadros".into())
                }
            }
            Some(0x21) => {
                cursor += 2;
                skip_blocks(bytes, &mut cursor)?;
            }
            Some(0x2c) => {
                let flags = *bytes.get(cursor + 9).ok_or("GIF truncado")?;
                cursor += 10;
                if flags & 128 != 0 {
                    cursor += 3 * (1usize << ((flags & 7) + 1));
                }
                cursor += 1;
                skip_blocks(bytes, &mut cursor)?;
                frames += 1;
                if frames > 141 {
                    return Err("O GIF excede 141 quadros".into());
                }
            }
            _ => return Err("GIF inválido ou truncado".into()),
        }
    }
}
fn dimensions(bytes: &[u8]) -> Result<(usize, usize, usize), String> {
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        if bytes.len() < 10 {
            return Err("GIF truncado".into());
        }
        return Ok((
            u16::from_le_bytes([bytes[6], bytes[7]]) as usize,
            u16::from_le_bytes([bytes[8], bytes[9]]) as usize,
            gif_frames(bytes)?,
        ));
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24 {
        return Ok((
            u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as usize,
            u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as usize,
            1,
        ));
    }
    if bytes.starts_with(&[255, 216, 255]) {
        let mut i = 2;
        while i + 3 < bytes.len() {
            if bytes[i] != 255 {
                break;
            }
            i += 1;
            while bytes.get(i) == Some(&255) {
                i += 1;
            }
            let marker = *bytes.get(i).ok_or("JPEG truncado")?;
            i += 1;
            if [0xda, 0xd9].contains(&marker) {
                break;
            }
            if i + 2 > bytes.len() {
                break;
            }
            let len = u16::from_be_bytes([bytes[i], bytes[i + 1]]) as usize;
            if len < 2 || i + len > bytes.len() {
                break;
            }
            if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) && len >= 7
            {
                return Ok((
                    u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as usize,
                    u16::from_be_bytes([bytes[i + 3], bytes[i + 4]]) as usize,
                    1,
                ));
            }
            i += len;
        }
    }
    Err("Escolha um GIF, PNG ou JPEG válido".into())
}

fn rgb_frame(image: &Pixbuf, fit: &str) -> Result<Vec<u8>, String> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let channels = image.n_channels() as usize;
    let stride = image.rowstride() as usize;
    if width == 0 || height == 0 || ![3, 4].contains(&channels) {
        return Err("Quadro de imagem inválido".into());
    }
    let bytes = image.read_pixel_bytes();
    let source = bytes.as_ref();
    rgb_pixels(source, width, height, channels, stride, fit)
}
fn rgb_pixels(
    source: &[u8],
    width: usize,
    height: usize,
    channels: usize,
    stride: usize,
    fit: &str,
) -> Result<Vec<u8>, String> {
    let scale = if fit == "contain" {
        (135.0 / width as f64).min(240.0 / height as f64)
    } else {
        (135.0 / width as f64).max(240.0 / height as f64)
    };
    let dx = (135.0 - width as f64 * scale) / 2.0;
    let dy = (240.0 - height as f64 * scale) / 2.0;
    let mut out = vec![0; 135 * 240 * 3];
    for y in 0..240 {
        for x in 0..135 {
            let px = (x as f64 + 0.5 - dx) / scale - 0.5;
            let py = (y as f64 + 0.5 - dy) / scale - 0.5;
            if px < -0.5 || py < -0.5 || px >= width as f64 - 0.5 || py >= height as f64 - 0.5 {
                continue;
            }
            let sx = px.clamp(0.0, width as f64 - 1.0);
            let sy = py.clamp(0.0, height as f64 - 1.0);
            let x0 = sx as usize;
            let y0 = sy as usize;
            let x1 = (x0 + 1).min(width - 1);
            let y1 = (y0 + 1).min(height - 1);
            let ax = sx - x0 as f64;
            let ay = sy - y0 as f64;
            let mut rgb = [0.0; 3];
            for (xx, yy, weight) in [
                (x0, y0, (1.0 - ax) * (1.0 - ay)),
                (x1, y0, ax * (1.0 - ay)),
                (x0, y1, (1.0 - ax) * ay),
                (x1, y1, ax * ay),
            ] {
                let offset = yy * stride + xx * channels;
                let pixel = source
                    .get(offset..offset + channels)
                    .ok_or("Quadro truncado")?;
                let alpha = if channels == 4 {
                    pixel[3] as f64 / 255.0
                } else {
                    1.0
                };
                for c in 0..3 {
                    rgb[c] += pixel[c] as f64 * alpha * weight;
                }
            }
            for c in 0..3 {
                out[(y * 135 + x) * 3 + c] = rgb[c].round() as u8;
            }
        }
    }
    Ok(out)
}

pub fn prepare(
    path: &Path,
    fit: &str,
    cancelled: impl Fn() -> bool,
    progress: impl Fn(usize, usize),
) -> Result<Prepared, String> {
    if !["cover", "contain"].contains(&fit) {
        return Err("Enquadramento inválido".into());
    }
    use std::os::unix::fs::OpenOptionsExt;
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Escolha um arquivo de imagem".into());
    }
    let mut bytes = Vec::new();
    file.take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("A imagem excede 4 MiB".into());
    }
    let (width, height, frames) = dimensions(&bytes)?;
    let pixels = width.checked_mul(height).ok_or("Dimensões inválidas")?;
    if pixels == 0 || pixels > 4_194_304 {
        return Err("Reduza a resolução da imagem ou o número de quadros antes de enviar".into());
    }
    if cancelled() {
        return Err("Envio cancelado".into());
    }
    let mut result = Prepared {
        pixels: Vec::new(),
        delays: Vec::new(),
        thumbnail: Vec::new(),
    };
    let mut count = 0;
    let mut append = |rgb: Vec<u8>, delay: u32| -> Result<(), String> {
        if cancelled() {
            return Err("Envio cancelado".into());
        }
        if count == 0 {
            result.thumbnail = rgb.clone();
        }
        let frame: Vec<u8> = rgb
            .chunks_exact(3)
            .flat_map(|c| {
                (((c[0] as u16 & 248) << 8) | ((c[1] as u16 & 252) << 3) | (c[2] as u16 >> 3))
                    .to_le_bytes()
            })
            .collect();
        let mut remaining = delay;
        while remaining > 0 {
            if result.delays.len() >= 141 {
                return Err("Os intervalos exigem mais de 141 quadros".into());
            }
            let d = remaining.min(510);
            result.pixels.extend_from_slice(&frame);
            result.delays.push(d as u16);
            remaining -= d;
        }
        count += 1;
        progress(count, frames);
        Ok(())
    };
    if bytes.starts_with(b"GIF") {
        crate::gif::decode(&bytes, |w, h, rgba, delay| {
            if cancelled() {
                return Err("Envio cancelado".into());
            }
            append(rgb_pixels(rgba, w, h, 4, w * 4, fit)?, delay)
        })?;
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let mut decoder = png::Decoder::new_with_limits(
            std::io::Cursor::new(&bytes),
            png::Limits {
                bytes: 64 * 1024 * 1024,
            },
        );
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
        let size = reader
            .output_buffer_size()
            .filter(|n| *n <= 4_194_304 * 4)
            .ok_or("PNG grande demais")?;
        let mut buffer = vec![0; size];
        let info = reader.next_frame(&mut buffer).map_err(|e| e.to_string())?;
        let (pixels, channels) = match info.color_type {
            png::ColorType::Rgb => (buffer[..info.buffer_size()].to_vec(), 3),
            png::ColorType::Rgba => (buffer[..info.buffer_size()].to_vec(), 4),
            png::ColorType::Grayscale => (
                buffer[..info.buffer_size()]
                    .iter()
                    .flat_map(|v| [*v, *v, *v])
                    .collect(),
                3,
            ),
            png::ColorType::GrayscaleAlpha => (
                buffer[..info.buffer_size()]
                    .chunks_exact(2)
                    .flat_map(|v| [v[0], v[0], v[0], v[1]])
                    .collect(),
                4,
            ),
            _ => return Err("Formato PNG não suportado".into()),
        };
        append(
            rgb_pixels(
                &pixels,
                info.width as usize,
                info.height as usize,
                channels,
                info.width as usize * channels,
                fit,
            )?,
            100,
        )?;
    } else {
        let loader = PixbufLoader::new();
        loader.write(&bytes).map_err(|e| e.to_string())?;
        loader.close().map_err(|e| e.to_string())?;
        append(
            rgb_frame(&loader.pixbuf().ok_or("Imagem inválida")?, fit)?,
            100,
        )?;
    }
    Ok(result)
}

pub fn save_thumbnail(rgb: Vec<u8>, path: &Path) -> Result<(), String> {
    if rgb.len() != 135 * 240 * 3 {
        return Err("Miniatura inválida".into());
    }
    let file = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut encoder = png::Encoder::new(file, 135, 240);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .map_err(|e| e.to_string())?
        .write_image_data(&rgb)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_gif_matches_frame_count_and_limits() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
        let bytes = fs::read(root.join("disposal-2.gif")).unwrap();
        let count = gif_frames(&bytes).unwrap();
        let result = prepare(&root.join("disposal-2.gif"), "contain", || false, |_, _| {}).unwrap();
        assert_eq!(result.delays.len(), count);
        assert_eq!(result.pixels.len(), count * 135 * 240 * 2);
        assert!(prepare(&root.join("disposal-2.gif"), "cover", || true, |_, _| {}).is_err());
        assert!(gif_frames(&bytes[..bytes.len() - 1]).is_err());
        let thumbnail =
            std::env::temp_dir().join(format!("s75-thumbnail-test-{}.png", std::process::id()));
        save_thumbnail(result.thumbnail, &thumbnail).unwrap();
        assert!(fs::read(&thumbnail)
            .unwrap()
            .starts_with(b"\x89PNG\r\n\x1a\n"));
        let png = prepare(&thumbnail, "cover", || false, |_, _| {}).unwrap();
        assert_eq!(png.delays.len(), 1);
        assert_eq!(png.pixels.len(), 135 * 240 * 2);
        fs::remove_file(thumbnail).unwrap();
    }
}
