use s75_core::{
    device::Session,
    hidraw::{discover_ports, LinuxTransport},
    profile::Profile,
    protocol,
};
fn run() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args.first().map(String::as_str){
        Some("ports")=>{println!("{:#?}",discover_ports()?);},
        Some("probe")=>{let response=Session::new(LinuxTransport::open(false)?).probe()?;println!("S75 Pro respondeu: {:02x?}",&response[..10]);},
        Some("colors")=>{println!("{}",serde_json::to_string_pretty(&Session::new(LinuxTransport::open(false)?).read_colors()?).map_err(|e|e.to_string())?);},
        Some("verify-screen")|Some("upload-screen")=>{
            let path=args.get(1).ok_or("Informe o arquivo TFT convertido")?;let data=std::fs::read(path).map_err(|e|e.to_string())?;protocol::validate_screen_image(&data)?;
            println!("{} quadros, {} páginas de 4096 bytes",data[0],data.len()/4096);
            if args[0]=="upload-screen"{Session::new(LinuxTransport::open(true)?).upload_screen(&data,||false,|p|println!("{}/{} {}",p.completed,p.total,p.message))?;}
        },
        Some("verify-profile")|Some("apply-profile")=>{let path=args.get(1).ok_or("Informe o JSON exportado do perfil")?;let profile:Profile=serde_json::from_slice(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;let prepared=protocol::prepare_profile(&profile)?;println!("Perfil validado; macros: {} bytes",prepared.macros.len());if args[0]=="apply-profile"{Session::new(LinuxTransport::open(false)?).apply_profile(&prepared,|p|println!("{}/{} {}",p.completed,p.total,p.message))?;}},
        _=>return Err("Uso: usb ports | probe | colors | verify-screen ARQUIVO | upload-screen ARQUIVO | verify-profile JSON | apply-profile JSON".into())
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
