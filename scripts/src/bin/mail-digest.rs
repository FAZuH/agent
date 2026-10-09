use clap::Parser;
use mail_digest::setup::SetupArgs;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // `setup` manages the octask timer; everything else is the legacy post form:
    // `mail-digest '<json>' [--ping]`.
    if args.first().is_some_and(|first| first == "setup") {
        let setup = SetupArgs::try_parse_from(
            std::iter::once("mail-digest setup".to_owned()).chain(args.into_iter().skip(1)),
        )
        .unwrap_or_else(|e| e.exit());
        if let Err(e) = mail_digest::setup::run_setup(&setup) {
            eprintln!("mail-digest: {e:#}");
            std::process::exit(1);
        }
        return;
    }
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
