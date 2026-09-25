fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (ping, args): (bool, Vec<String>) = match args.iter().position(|a| a == "--ping") {
        Some(pos) => {
            let mut rest = args.clone();
            rest.remove(pos);
            (true, rest)
        }
        None => (false, args),
    };
    if args.len() != 1 {
        eprintln!("usage: mail-digest '<json>' [--ping]");
        std::process::exit(2);
    }
    if let Err(e) = mail_digest::run(&args[0], ping) {
        eprintln!("mail-digest: {e:#}");
        std::process::exit(1);
    }
}
