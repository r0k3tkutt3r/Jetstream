use ccshell_core::session::coalesce_deltas;
use ccshell_core::session::SessionEvent;
use std::time::Duration;
use tokio::sync::mpsc;

#[tokio::test]
async fn merges_rapid_deltas_into_one_per_tick() {
    let (tx, rx)   = mpsc::channel::<SessionEvent>(64);
    let (out_tx, mut out_rx) = mpsc::channel::<SessionEvent>(64);

    // Push 5 deltas for the same msg_id, faster than tick interval
    for ch in ["H","e","l","l","o"] {
        tx.send(SessionEvent::Assistant {
            msg_id: "m1".into(),
            delta: ch.into(),
        }).await.unwrap();
    }
    drop(tx);

    tokio::spawn(coalesce_deltas(rx, out_tx, Duration::from_millis(16)));

    let mut combined = String::new();
    while let Some(SessionEvent::Assistant { delta, .. }) =
          tokio::time::timeout(Duration::from_millis(200), out_rx.recv()).await.ok().flatten()
    {
        combined.push_str(&delta);
    }
    assert_eq!(combined, "Hello");
}
