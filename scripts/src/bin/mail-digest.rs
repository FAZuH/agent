use clap::Parser;
use mail_digest::check;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("setup") => {
            let setup = mail_digest::setup::SetupArgs::try_parse_from(
                std::iter::once("mail-digest setup".to_owned()).chain(args.into_iter().skip(1)),
            )
            .unwrap_or_else(|e| e.exit());
            if let Err(e) = mail_digest::setup::run_setup(&setup) {
                eprintln!("mail-digest: {e:#}");
                std::process::exit(1);
            }
        }
        Some("check") => {
            let trigger = args.iter().any(|a| a == "--trigger");
            if let Err(e) = check::check(trigger) {
                eprintln!("mail-digest check: {e:#}");
                std::process::exit(1);
            }
        }
        Some("preflight") => match check::preflight() {
            Ok(result) => println!("{result}"),
            Err(e) => {
                eprintln!("mail-digest preflight: {e:#}");
                std::process::exit(1);
            }
        },
        Some("pending") => match check::pending() {
            Ok(result) => println!("{result}"),
            Err(e) => {
                eprintln!("mail-digest pending: {e:#}");
                std::process::exit(1);
            }
        },
        Some("body") => {
            let id = args.get(1).cloned();
            let account = args
                .iter()
                .position(|a| a == "--account")
                .and_then(|pos| args.get(pos + 1))
                .cloned();
            let limit = args
                .iter()
                .position(|a| a == "--limit")
                .and_then(|pos| args.get(pos + 1))
                .and_then(|value| value.parse().ok())
                .unwrap_or(check::DEFAULT_BODY_LIMIT);
            match (id, account) {
                (Some(id), Some(account)) => match check::body(&id, &account, limit) {
                    Ok(text) => print!("{text}"),
                    Err(e) => {
                        eprintln!("mail-digest body: {e:#}");
                        std::process::exit(1);
                    }
                },
                _ => {
                    eprintln!("usage: mail-digest body <thread-id> --account <addr> [--limit N]");
                    std::process::exit(2);
                }
            }
        }
        Some("doctor") => match check::doctor() {
            Ok(result) => println!("{result}"),
            Err(e) => {
                eprintln!("mail-digest doctor: {e:#}");
                std::process::exit(1);
            }
        },
        _ => {
            // Legacy post form: `mail-digest '<json>' [--ping]`.
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
    }
}
