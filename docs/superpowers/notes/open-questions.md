# Open questions (acknowledged in spec §15)

- **`list_slash_commands` control_request shape.** v0.1 ships with a curated baseline; revisit when the CLI exposes the structured listing.
- **Mid-session `set_permission_mode` ack on claude 2.1.146.** If unsupported, switch default `mode_strategy = Respawn` and re-cycle via `--resume <uuid> --permission-mode <new>`.
- **`--include-partial-messages` event cadence.** The 16 ms coalescing tick may need tuning (8–33 ms) once we measure real traffic.

These do not block architecture; they are tuning knobs and protocol details to revisit during v0.2.
