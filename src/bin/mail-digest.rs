fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("usage: mail-digest '<json>'");
        std::process::exit(2);
    }
    if let Err(e) = mail_digest::run(&args[1]) {
        eprintln!("mail-digest: {e:#}");
        std::process::exit(1);
    }
}
