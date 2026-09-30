# Agent instructions

Read `DESIGN.md` for the visual standard and `AI_AGENT_SETUP.md` for installation.

- Support macOS and Linux. New installs start with setup and a resizable desktop window. Portrait kiosk mode retains the 40/60 usage/session split; responsive desktop layouts may stack, place panels beside each other, and scroll.
- Keep section visibility independent from usage collection; T3 sessions can be hidden while T3 data continues to refresh.
- Preserve the daily counter, model colors, shared Codex capacity and two-line T3 rows. Keep status time alignment, harness slots and known session priorities.
- Use synthetic previews. Never commit live data, personal hostnames, credentials, SSH keys, databases or real screenshots.
- Keep collectors read-only. Choose one authoritative source per provider family and mark unavailable measurements honestly.
- Keep provider prices in user configuration. Never ship a built-in rate table, and leave models without a configured rate marked unpriced.
- After editing `build/icon.svg`, run `npm run icons` and commit the regenerated PNGs; release workflows build unsigned artifacts only.
- Keep releases unsigned: never add signing, notarization or credential steps. New bundled assets keep their license beside them and are listed in `NOTICE`.
- Keep standard desktop controls and cursor outside kiosk mode. Do not restart a running app to capture a screenshot; use the screenshot command.
- For source changes, run the relevant tests, typecheck and build. For layout changes, inspect portrait, landscape, narrow and dense fixtures using `npm run check:layout`.
- Avoid subagents unless the task benefits from independent work or the user explicitly requests them.
