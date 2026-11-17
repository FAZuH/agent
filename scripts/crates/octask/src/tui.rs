use std::io;
use std::time::Duration;

use anyhow::Result;
use crossterm::event;
use crossterm::event::Event;
use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use crossterm::event::KeyEventKind;
use crossterm::execute;
use crossterm::terminal;
use crossterm::terminal::EnterAlternateScreen;
use crossterm::terminal::LeaveAlternateScreen;
use ratatui::Frame;
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Constraint;
use ratatui::layout::Direction;
use ratatui::layout::Layout;
use ratatui::style::Color;
use ratatui::style::Modifier;
use ratatui::style::Style;
use ratatui::text::Line;
use ratatui::text::Span;
use ratatui::widgets::Block;
use ratatui::widgets::Borders;
use ratatui::widgets::Clear;
use ratatui::widgets::ListItem;
use ratatui::widgets::ListState;
use ratatui::widgets::Paragraph;
use ratatui::widgets::Wrap;

use crate::state;
use crate::sys::PREFIX;
use crate::sys::ok;
use crate::sys::stdout_soft;
use crate::sys::unit_dir;
use crate::sys::unit_paths;
use crate::view::TaskView;
use crate::view::collect;

struct App {
    rows: Vec<TaskView>,
    visible: Vec<usize>,
    cursor: usize,
    filter: String,
    filtering: bool,
    help: bool,
    confirm: bool,
    message: String,
    log_text: String,
}

impl App {
    fn new() -> Self {
        let mut app = Self {
            rows: Vec::new(),
            visible: Vec::new(),
            cursor: 0,
            filter: String::new(),
            filtering: false,
            help: false,
            confirm: false,
            message: "ctrl+d? no. press ? for keys".to_owned(),
            log_text: String::new(),
        };
        app.refresh();
        app
    }

    fn refresh(&mut self) {
        self.rows = collect();
        let needle = self.filter.to_lowercase();
        self.visible = self
            .rows
            .iter()
            .enumerate()
            .filter(|(_, r)| {
                needle.is_empty()
                    || r.name.contains(&needle)
                    || r.description.to_lowercase().contains(&needle)
            })
            .map(|(i, _)| i)
            .collect();
        if self.cursor >= self.visible.len() {
            self.cursor = self.visible.len().saturating_sub(1);
        }
        let name = self.selected_name();
        self.log_text = match name {
            Some(name) => stdout_soft(
                "journalctl",
                &[
                    "--user",
                    "-u",
                    &format!("{PREFIX}{name}.service"),
                    "-n",
                    "12",
                    "--no-pager",
                ],
            ),
            None => String::new(),
        };
    }

    fn selected_name(&self) -> Option<String> {
        self.visible
            .get(self.cursor)
            .and_then(|i| self.rows.get(*i))
            .map(|r| r.name.clone())
    }

    fn selected_row(&self) -> Option<&TaskView> {
        self.visible
            .get(self.cursor)
            .and_then(|i| self.rows.get(*i))
    }

    fn move_cursor(&mut self, delta: isize) {
        if self.visible.is_empty() {
            self.cursor = 0;
            return;
        }
        let len = self.visible.len() as isize;
        let next = self.cursor as isize + delta;
        self.cursor = next.clamp(0, len - 1) as usize;
    }

    fn toggle(&mut self, enable: bool) {
        let Some(name) = self.selected_name() else {
            return;
        };
        let unit = format!("{PREFIX}{name}.timer");
        let verb = if enable { "enable" } else { "disable" };
        let action = if enable {
            ("enable", "--now")
        } else {
            ("disable", "--now")
        };
        let done = ok("systemctl", &["--user", action.0, action.1, &unit]);
        self.confirm = false;
        self.message = format!("{verb} {name}: {}", if done { "ok" } else { "FAILED" });
        self.refresh();
    }

    fn toggle_all(&mut self, enable: bool) {
        let verb = if enable { "enabled" } else { "disabled" };
        let action = if enable {
            ("enable", "--now")
        } else {
            ("disable", "--now")
        };
        let mut done = 0;
        for name in self.rows.iter().map(|r| r.name.clone()).collect::<Vec<_>>() {
            let unit = format!("{PREFIX}{name}.timer");
            if ok("systemctl", &["--user", action.0, action.1, &unit]) {
                done += 1;
            }
        }
        self.message = format!("{verb} {done} task(s)");
        self.refresh();
    }

    fn pause(&mut self) {
        let enabled: Vec<String> = self
            .rows
            .iter()
            .filter(|r| r.enabled)
            .map(|r| r.name.clone())
            .collect();
        if let Err(e) = state::save(
            &state::state_path(),
            &state::PauseState {
                enabled: enabled.clone(),
            },
        ) {
            self.message = format!("pause failed: {e}");
            return;
        }
        self.toggle_all(false);
        self.message = format!("paused {} task(s); P resumes", enabled.len());
    }

    fn resume(&mut self) {
        let path = state::state_path();
        let Ok(Some(saved)) = state::load(&path) else {
            self.message = "nothing to resume".to_owned();
            return;
        };
        let wanted: Vec<String> = saved.enabled;
        let names: Vec<String> = self.rows.iter().map(|r| r.name.clone()).collect();
        for name in &names {
            let enable = wanted.contains(name);
            let action = if enable {
                ("enable", "--now")
            } else {
                ("disable", "--now")
            };
            ok(
                "systemctl",
                &[
                    "--user",
                    action.0,
                    action.1,
                    &format!("{PREFIX}{name}.timer"),
                ],
            );
        }
        let _ = state::clear(&path);
        self.message = format!("resumed {} task(s)", wanted.len());
        self.refresh();
    }

    fn run_selected(&mut self) {
        let Some(name) = self.selected_name() else {
            return;
        };
        let service = format!("{PREFIX}{name}.service");
        let done = ok("systemctl", &["--user", "start", "--no-block", &service]);
        self.message = format!("start {name}: {}", if done { "ok" } else { "FAILED" });
        self.refresh();
    }

    fn remove_selected(&mut self, confirmed: bool) {
        let Some(name) = self.selected_name() else {
            return;
        };
        if !confirmed {
            self.confirm = true;
            self.message = format!("remove {name}? press y to confirm, n to cancel");
            return;
        }
        self.confirm = false;
        let dir = unit_dir();
        let (service, timer) = unit_paths(&dir, &name);
        ok(
            "systemctl",
            &["--user", "stop", &format!("{PREFIX}{name}.timer")],
        );
        ok(
            "systemctl",
            &["--user", "disable", &format!("{PREFIX}{name}.timer")],
        );
        let _ = std::fs::remove_file(&timer);
        let _ = std::fs::remove_file(&service);
        ok("systemctl", &["--user", "daemon-reload"]);
        self.message = format!("removed {name}");
        self.refresh();
    }
}

pub fn run() -> Result<()> {
    terminal::enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let mut app = App::new();

    let result = event_loop(&mut terminal, &mut app);

    terminal::disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn event_loop(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> Result<()> {
    loop {
        terminal.draw(|f| draw(f, app))?;
        if !event::poll(Duration::from_millis(200))? {
            continue;
        }
        if let Event::Key(key) = event::read()?
            && key.kind == KeyEventKind::Press
            && handle_key(app, key)
        {
            break;
        }
    }
    Ok(())
}

fn handle_key(app: &mut App, key: KeyEvent) -> bool {
    if app.confirm {
        match key.code {
            KeyCode::Char('y') => {
                app.remove_selected(true);
                return false;
            }
            KeyCode::Char('n') | KeyCode::Esc => {
                app.confirm = false;
                app.message = "cancelled".to_owned();
                return false;
            }
            _ => return false,
        }
    }

    if app.filtering {
        match key.code {
            KeyCode::Esc | KeyCode::Enter => app.filtering = false,
            KeyCode::Backspace => {
                app.filter.pop();
                app.refresh();
            }
            KeyCode::Char(c) => {
                app.filter.push(c);
                app.refresh();
            }
            _ => {}
        }
        return false;
    }

    match key.code {
        KeyCode::Char('q') | KeyCode::Esc => return true,
        KeyCode::Char('j') | KeyCode::Down => app.move_cursor(1),
        KeyCode::Char('k') | KeyCode::Up => app.move_cursor(-1),
        KeyCode::Char('/') => app.filtering = true,
        KeyCode::Char('e') => app.toggle(true),
        KeyCode::Char('d') => app.toggle(false),
        KeyCode::Char('a') => app.toggle_all(true),
        KeyCode::Char('A') => app.toggle_all(false),
        KeyCode::Char('p') => app.pause(),
        KeyCode::Char('P') => app.resume(),
        KeyCode::Char('r') => app.run_selected(),
        KeyCode::Char('x') => app.remove_selected(false),
        KeyCode::Char('?') => app.help = !app.help,
        KeyCode::Char('c') => {
            app.refresh();
            app.message = "refreshed".to_owned();
        }
        _ => {}
    }
    false
}

fn draw(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(6),
            Constraint::Length(3),
        ])
        .split(f.area());

    let enabled = app.rows.iter().filter(|r| r.enabled).count();
    let failed = app.rows.iter().filter(|r| r.failed).count();
    let paused = state::load(&state::state_path())
        .map(|s| s.is_some())
        .unwrap_or(false);
    let title = Line::from(vec![
        Span::styled(
            " octask ",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(format!(
            " {} task(s)  {} enabled  {} failed  {}",
            app.rows.len(),
            enabled,
            failed,
            if paused { "PAUSED" } else { "RUNNING" }
        )),
    ]);
    f.render_widget(
        Paragraph::new(title).block(Block::default().borders(Borders::ALL)),
        chunks[0],
    );

    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
        .split(chunks[1]);

    let items: Vec<ListItem> = app
        .visible
        .iter()
        .map(|&i| {
            let row = &app.rows[i];
            let glyph = if row.failed {
                Span::styled("[!]", Style::default().fg(Color::Red))
            } else if row.enabled {
                Span::styled("[+]", Style::default().fg(Color::Green))
            } else {
                Span::styled("[-]", Style::default().fg(Color::Yellow))
            };
            let name = Span::raw(format!(
                " {:<18} {:<6} {:<20} {}",
                row.name, row.kind, row.oncalendar, row.next
            ));
            ListItem::new(Line::from(vec![glyph, name]))
        })
        .collect();

    let list = ratatui::widgets::List::new(items)
        .block(Block::default().borders(Borders::ALL).title(format!(
            " tasks {}",
            if app.filter.is_empty() {
                String::new()
            } else {
                format!("/{}", app.filter)
            }
        )))
        .highlight_style(
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::REVERSED),
        )
        .highlight_symbol("> ");
    let mut list_state = ListState::default();
    list_state.select(Some(app.cursor));
    f.render_stateful_widget(list, panes[0], &mut list_state);

    let detail_lines: Vec<Line> = match app.selected_row() {
        Some(row) => {
            let mut lines = vec![
                Line::from(Span::styled(
                    row.name.clone(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                )),
                Line::from(format!("kind: {}", row.kind)),
                Line::from(format!("schedule: {}", row.oncalendar)),
                Line::from(format!("next: {}", row.next)),
                Line::from(format!("workdir: {}", row.workdir)),
                Line::from(format!("description: {}", row.description)),
                Line::from("--- journal ---".to_string()),
            ];
            for line in app.log_text.lines() {
                lines.push(Line::from(line.to_owned()));
            }
            lines
        }
        None => vec![Line::from("no task selected")],
    };
    f.render_widget(
        Paragraph::new(detail_lines)
            .wrap(Wrap { trim: false })
            .block(Block::default().borders(Borders::ALL).title(" detail ")),
        panes[1],
    );

    let footer = Line::from(vec![Span::styled(
        format!(
            " j/k move  / filter  e/d enable/disable  a/A all on/off  p/P pause/resume  r run  x remove  ? help  q quit | {}",
            app.message
        ),
        Style::default().fg(Color::DarkGray),
    )]);
    f.render_widget(
        Paragraph::new(footer).block(Block::default().borders(Borders::ALL)),
        chunks[2],
    );

    if app.help {
        let area = centered_rect(60, 50, f.area());
        f.render_widget(Clear, area);
        let help = vec![
            Line::from("octask keys"),
            Line::from("j/k or arrows  move selection"),
            Line::from("/              filter by name or description"),
            Line::from("e / d          enable / disable selected timer"),
            Line::from("a / A          enable / disable all timers"),
            Line::from("p / P          pause / resume (remembers enabled set)"),
            Line::from("r              run selected service now"),
            Line::from("x, then y      remove selected task"),
            Line::from("c              refresh"),
            Line::from("q or Esc       quit"),
        ];
        f.render_widget(
            Paragraph::new(help).block(Block::default().borders(Borders::ALL).title(" help ")),
            area,
        );
    }
}

fn centered_rect(
    percent_x: u16,
    percent_y: u16,
    area: ratatui::layout::Rect,
) -> ratatui::layout::Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vertical[1])[1]
}
