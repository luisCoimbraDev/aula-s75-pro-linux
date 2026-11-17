pub mod device;
pub mod discovery;
pub mod hidraw;
pub mod profile;
pub mod protocol;

pub const USB_VENDOR: &str = "0c45";
pub const USB_PRODUCT: &str = "800a";
pub const SCREEN_WIDTH: u32 = 135;
pub const SCREEN_HEIGHT: u32 = 240;
pub const MAX_GIF_FRAMES: usize = 141;
