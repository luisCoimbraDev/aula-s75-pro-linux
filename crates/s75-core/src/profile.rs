use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub updated_at: String,
    pub settings: Value,
}

impl Profile {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Versão do perfil não suportada".into());
        }
        if self.id.is_empty()
            || self.id.len() > 80
            || !self
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err("Identificador de perfil inválido".into());
        }
        if self.name.trim().is_empty() || self.name.chars().count() > 60 {
            return Err("O nome deve ter entre 1 e 60 caracteres".into());
        }
        let s = &self.settings;
        for (name, max) in [("brightness", 5), ("speed", 5)] {
            if s[name].as_u64().is_none_or(|v| v > max) {
                return Err(format!("Valor inválido para {name}"));
            }
        }
        let color = s["color"].as_str().unwrap_or("");
        if color.len() != 7
            || !color.starts_with('#')
            || !color[1..].chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err("Cor RGB inválida".into());
        }
        crate::protocol::lighting_mode(s["effect"].as_str().ok_or("Efeito inválido")?)?;
        let macros = s["macros"].as_array().ok_or("Lista de macros inválida")?;
        if macros.len() > 100 {
            return Err("Limite local de 100 macros excedido".into());
        }
        for m in macros {
            let events = m["events"].as_array().ok_or("Eventos da macro inválidos")?;
            if events.len() > 500 {
                return Err("Limite local de 500 eventos por macro excedido".into());
            }
            for event in events {
                if event["delay"].as_u64().is_none_or(|v| v > 60000) {
                    return Err("Atraso de macro inválido".into());
                }
                if !matches!(event["kind"].as_str(), Some("down" | "up"))
                    || !event["key"]
                        .as_str()
                        .is_some_and(|v| !v.is_empty() && v.len() <= 40)
                {
                    return Err("Evento de macro inválido".into());
                }
            }
        }
        let mappings = s["mappings"].as_object().ok_or("Mapeamento inválido")?;
        if mappings.len() > 160 {
            return Err("Número de mapeamentos inválido".into());
        }
        for (key, value) in mappings {
            let Some((layer, index)) = key.split_once(':') else {
                return Err("Identificador de tecla inválido".into());
            };
            if !matches!(layer, "base" | "fn")
                || !index.parse::<u16>().is_ok_and(|v| (1..=120).contains(&v))
                || !value
                    .as_str()
                    .is_some_and(|v| !v.is_empty() && v.len() <= 80)
            {
                return Err("Mapeamento de tecla inválido".into());
            }
        }
        if self.settings.to_string().len() > 8 * 1024 * 1024 {
            return Err("Perfil acima do limite local de 8 MiB".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile() -> Profile {
        Profile {
            schema_version: 1,
            id: "profile-1".into(),
            name: "Meu teclado".into(),
            updated_at: "".into(),
            settings: serde_json::json!({"brightness":5,"speed":3,"color":"#ff774e","effect":"static","macros":[],"mappings":{}}),
        }
    }
    #[test]
    fn rejects_out_of_range_color_path_and_delay() {
        assert!(profile().validate().is_ok());
        let mut p = profile();
        p.id = "../../other".into();
        assert!(p.validate().is_err());
        let mut p = profile();
        p.settings["brightness"] = 6.into();
        assert!(p.validate().is_err());
        let mut p = profile();
        p.settings["color"] = "red".into();
        assert!(p.validate().is_err());
        let mut p = profile();
        p.settings["macros"] =
            serde_json::json!([{"events":[{"key":"KeyA","kind":"down","delay":60001}]}]);
        assert!(p.validate().is_err());
    }
}
