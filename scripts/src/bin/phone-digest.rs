fn main() {
    if let Err(e) = phone_digest::run() {
        eprintln!("phone-digest: {e:#}");
        std::process::exit(1);
    }
}
