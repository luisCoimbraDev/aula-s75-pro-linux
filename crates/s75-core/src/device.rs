// SPDX-License-Identifier: GPL-3.0-only
use crate::protocol::{self as p, Clock, PreparedProfile};
use serde::Serialize;
use std::time::Duration;

pub trait Transport {
    fn send_feature(&mut self, data: &[u8; 64]) -> Result<(), String>;
    fn get_feature(&mut self) -> Result<[u8; 64], String>;
    fn flush_screen(&mut self) -> Result<(), String>;
    fn write_screen(&mut self, data: &[u8]) -> Result<(), String>;
    fn screen_ack(&mut self, timeout: Duration) -> Result<(), String>;
    fn wait(&mut self, duration: Duration);
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: String,
    pub completed: usize,
    pub total: usize,
    pub message: String,
}
impl Progress {
    pub fn new(stage: &str, completed: usize, total: usize, message: &str) -> Self {
        Self {
            stage: stage.into(),
            completed,
            total,
            message: message.into(),
        }
    }
}
pub struct Session<T: Transport> {
    pub io: T,
}
impl<T: Transport> Session<T> {
    pub fn new(io: T) -> Self {
        Self { io }
    }
    fn wait(&mut self, ms: u64) {
        self.io.wait(Duration::from_millis(ms))
    }
    fn send(&mut self, payload: &[u8; 64]) -> Result<(), String> {
        self.wait(35);
        self.io.send_feature(payload)
    }
    fn command(&mut self, op: u8, arg: u8, count: u16, ack: bool) -> Result<(), String> {
        let frame = p::command(op, arg, count);
        for attempt in 0..3 {
            self.send(&frame)?;
            if !ack {
                return Ok(());
            }
            self.wait(35);
            let response = self.io.get_feature()?;
            if response[0] == 4 && response[1] == op && response[3] == 1 {
                return Ok(());
            }
            if response[0] == 4 && response[1] == op && response[3] == 255 && attempt < 2 {
                continue;
            }
            return Err(format!(
                "O teclado recusou o comando {op:02x}: {:02x?}",
                &response[..10]
            ));
        }
        Err("Teclado ocupado".into())
    }
    fn block(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.is_empty() || !bytes.len().is_multiple_of(64) {
            return Err("Bloco de configuração inválido".into());
        }
        for chunk in bytes.chunks_exact(64) {
            self.send(chunk.try_into().map_err(|_| "Pacote inválido")?)?;
        }
        Ok(())
    }
    fn transaction(
        &mut self,
        start: u8,
        action: impl FnOnce(&mut Self) -> Result<(), String>,
    ) -> Result<(), String> {
        self.command(start, 0, 0, true)?;
        let result = action(self);
        let end = self.command(p::END, 0, 0, true);
        result.and(end)
    }
    pub fn write_single(
        &mut self,
        op: u8,
        arg: u8,
        payload: &[u8; 64],
        apply: bool,
    ) -> Result<(), String> {
        self.transaction(p::BEGIN, |this| {
            this.command(op, arg, 1, true)?;
            this.send(payload)
        })?;
        if apply {
            self.command(p::APPLY, 0, 0, false)?;
        }
        Ok(())
    }
    pub fn write_block(&mut self, op: u8, bytes: &[u8]) -> Result<(), String> {
        let n = u16::try_from(bytes.len() / 64).map_err(|_| "Muitos pacotes")?;
        self.transaction(p::BEGIN, |this| {
            this.command(op, 0, n, true)?;
            this.block(bytes)
        })?;
        self.command(p::APPLY, 0, 0, true)
    }
    pub fn write_macros(&mut self, bytes: &[u8]) -> Result<(), String> {
        let n = u16::try_from(bytes.len() / 64).map_err(|_| "Muitas macros")?;
        self.transaction(0x19, |this| {
            this.command(0x15, 0, n, true)?;
            this.wait(30);
            this.block(bytes)?;
            this.wait(30);
            Ok(())
        })
    }
    pub fn sync_clock(&mut self, time: &Clock) -> Result<(), String> {
        let data = p::clock(time)?;
        self.transaction(p::BEGIN, |this| {
            this.command(0x28, 0, 1, true)?;
            this.send(&data)?;
            this.wait(35);
            this.io.get_feature()?;
            Ok(())
        })
    }
    pub fn apply_profile(
        &mut self,
        prepared: &PreparedProfile,
        mut progress: impl FnMut(Progress),
    ) -> Result<(), String> {
        let total = if prepared.colors.is_some() { 8 } else { 7 };
        let mut done = 0;
        macro_rules! stage {
            ($name:expr,$operation:expr) => {{
                progress(Progress::new("profile", done, total, $name));
                $operation?;
                done += 1;
            }};
        }
        stage!("Gravando macros", self.write_macros(&prepared.macros));
        stage!(
            "Gravando camada principal",
            self.write_block(0x11, &prepared.base)
        );
        stage!(
            "Gravando camada Fn",
            self.write_block(0x27, &prepared.function)
        );
        stage!(
            "Aplicando opções do teclado",
            self.write_single(0x17, 1, &prepared.settings, false)
        );
        stage!(
            "Aplicando iluminação",
            self.write_single(0x13, 0, &prepared.light, true)
        );
        if let Some(colors) = &prepared.colors {
            stage!("Gravando cores por tecla", self.write_block(0x23, colors));
        }
        stage!(
            "Aplicando luz lateral",
            self.write_single(0x13, 0, &prepared.bar, true)
        );
        // Completion only follows acknowledged commands; no artificial timer-based success.
        done += 1;
        progress(Progress::new(
            "profile",
            done,
            total,
            "Configuração enviada e aceita pelo teclado",
        ));
        Ok(())
    }
    pub fn upload_screen(
        &mut self,
        data: &[u8],
        cancelled: impl Fn() -> bool,
        mut progress: impl FnMut(Progress),
    ) -> Result<(), String> {
        p::validate_screen_image(data)?;
        let pages = data.len() / p::PAGE;
        let count = u16::try_from(pages).map_err(|_| "Muitas páginas de tela")?;
        self.transaction(p::BEGIN,|this|{this.command(0x72,1,count,true)?;
            for(index,page)in data.chunks_exact(p::PAGE).enumerate(){if cancelled(){return Err("Envio cancelado; envie novamente uma imagem completa para substituir a mídia parcial".into());}
                this.io.flush_screen()?;this.io.write_screen(page)?;this.io.screen_ack(Duration::from_millis(1000))?;
                progress(Progress::new("screen",index+1,pages+1,&format!("Página {} de {pages} confirmada",index+1)));
            }Ok(())
        })?;
        progress(Progress::new(
            "screen",
            pages + 1,
            pages + 1,
            "GIF enviado; transferência finalizada pelo teclado",
        ));
        Ok(())
    }
    pub fn read_colors(&mut self) -> Result<Vec<[u8; 4]>, String> {
        let mut bytes = [0; p::BLOCK];
        self.command(0xf5, 0, 9, true)?;
        let result: Result<(), String> = (|| {
            for chunk in bytes.chunks_exact_mut(64) {
                self.wait(1);
                chunk.copy_from_slice(&self.io.get_feature()?);
            }
            Ok(())
        })();
        let end = self.command(p::END, 0, 0, true);
        result.and(end)?;
        Ok(p::keys()
            .iter()
            .map(|k| {
                [
                    k.id as u8,
                    bytes[k.led * 4 + 1],
                    bytes[k.led * 4 + 2],
                    bytes[k.led * 4 + 3],
                ]
            })
            .collect())
    }
    pub fn probe(&mut self) -> Result<Vec<u8>, String> {
        self.io.get_feature().map(|v| v.to_vec())
    }

    pub fn live_frame(&mut self, colors: &[[u8; 3]]) -> Result<bool, String> {
        let block = p::live_light(colors)?;
        let mut ready = false;
        for attempt in 0..3 {
            if attempt > 0 {
                self.wait(20);
            }
            self.io.send_feature(&p::command(0x20, 0, 8))?;
            self.wait(5);
            let ack = self.io.get_feature()?;
            if ack[0] == 4 && ack[1] == 0x20 && ack[3] == 255 {
                continue;
            }
            if ack[0] != 4 || ack[1] != 0x20 || ack[3] != 1 {
                return Err(format!("Efeito ao vivo recusado: {:02x?}", &ack[..8]));
            }
            ready = true;
            break;
        }
        if !ready {
            return Ok(false);
        }
        let result: Result<(), String> = (|| {
            for chunk in block.chunks_exact(64) {
                self.io
                    .send_feature(chunk.try_into().map_err(|_| "Quadro inválido")?)?;
            }
            Ok(())
        })();
        self.wait(5);
        let end = (|| {
            self.io.send_feature(&p::command(p::END, 0, 0))?;
            self.wait(5);
            let ack = self.io.get_feature()?;
            if ack[0] != 4 || ack[1] != p::END || ![1, 255].contains(&ack[3]) {
                return Err("Finalização do quadro ao vivo recusada".into());
            }
            Ok(())
        })();
        result.and(end)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    #[derive(Default)]
    struct Fake {
        sent: Vec<[u8; 64]>,
        acks: VecDeque<[u8; 64]>,
        pages: usize,
        fail_page: Option<usize>,
    }
    impl Transport for Fake {
        fn send_feature(&mut self, d: &[u8; 64]) -> Result<(), String> {
            self.sent.push(*d);
            Ok(())
        }
        fn get_feature(&mut self) -> Result<[u8; 64], String> {
            self.acks
                .pop_front()
                .ok_or("ACK inesperado no teste".into())
        }
        fn flush_screen(&mut self) -> Result<(), String> {
            Ok(())
        }
        fn write_screen(&mut self, d: &[u8]) -> Result<(), String> {
            assert_eq!(d.len(), 4096);
            self.pages += 1;
            Ok(())
        }
        fn screen_ack(&mut self, _: Duration) -> Result<(), String> {
            if self.fail_page == Some(self.pages) {
                Err("timeout".into())
            } else {
                Ok(())
            }
        }
        fn wait(&mut self, _: Duration) {}
    }
    fn ack(op: u8, status: u8) -> [u8; 64] {
        let mut a = [0; 64];
        a[0] = 4;
        a[1] = op;
        a[3] = status;
        a
    }
    #[test]
    fn rejects_refused_begin_without_sending_data() {
        let io = Fake {
            acks: VecDeque::from([ack(p::BEGIN, 0)]),
            ..Default::default()
        };
        let mut session = Session::new(io);
        assert!(session.write_single(0x13, 0, &[1; 64], true).is_err());
        assert_eq!(session.io.sent.len(), 1);
    }
    #[test]
    fn failed_page_never_reports_success_and_sends_end() {
        let data = p::screen_image(&vec![0; p::FRAME_BYTES], &[100]).unwrap();
        let io = Fake {
            acks: VecDeque::from([ack(p::BEGIN, 1), ack(0x72, 1), ack(p::END, 1)]),
            fail_page: Some(2),
            ..Default::default()
        };
        let mut session = Session::new(io);
        let mut events = Vec::new();
        assert!(session
            .upload_screen(&data, || false, |p| events.push(p))
            .is_err());
        assert_eq!(session.io.pages, 2);
        assert_eq!(session.io.sent.last().unwrap()[1], p::END);
        assert!(!events.iter().any(|p| p.completed == p.total));
    }
    #[test]
    fn complete_image_requires_all_pages_and_end_ack() {
        let data = p::screen_image(&vec![0; p::FRAME_BYTES], &[100]).unwrap();
        let io = Fake {
            acks: VecDeque::from([
                ack(p::BEGIN, 255),
                ack(p::BEGIN, 1),
                ack(0x72, 1),
                ack(p::END, 1),
            ]),
            ..Default::default()
        };
        let mut session = Session::new(io);
        let mut events = Vec::new();
        session
            .upload_screen(&data, || false, |p| events.push(p))
            .unwrap();
        assert_eq!(session.io.pages, 16);
        let last = events.last().unwrap();
        assert_eq!(last.completed, last.total);
        assert_eq!(
            &session.io.sent[2][..10],
            &[4, 0x72, 1, 0, 0, 0, 0, 0, 16, 0]
        );
    }
}
