fn main() {
    println!(
        "{}",
        serde_json::to_string_pretty(&s75_core::discovery::scan()).unwrap()
    );
}
