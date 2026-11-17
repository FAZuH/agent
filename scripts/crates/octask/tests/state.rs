use octask::state;

#[test]
fn pause_state_round_trips_and_sorts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pause.json");
    let state = state::PauseState {
        enabled: vec!["zeta".into(), "alpha".into(), "alpha".into()],
    };
    state::save(&path, &state).unwrap();
    let loaded = state::load(&path).unwrap().unwrap();
    assert_eq!(loaded.enabled, vec!["alpha", "zeta"]);
}

#[test]
fn missing_pause_state_is_none() {
    let dir = tempfile::tempdir().unwrap();
    assert!(
        state::load(&dir.path().join("nope.json"))
            .unwrap()
            .is_none()
    );
}

#[test]
fn clear_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pause.json");
    state::save(&path, &state::PauseState::default()).unwrap();
    state::clear(&path).unwrap();
    state::clear(&path).unwrap();
    assert!(state::load(&path).unwrap().is_none());
}
