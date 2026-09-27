# AI agent setup guide

Use this guide when asked to install Clankiosk on a kiosk host.

1. Read `AGENTS.md`, `DESIGN.md` and this guide. Confirm the target is Linux with a portrait display; do not rearrange displays or move other windows.
2. Clone `https://github.com/snarkyalyx/clankiosk.git` into `~/clankiosk`. Use Node.js 22 LTS, then run `npm ci`, `npm run typecheck`, `npm test` and `npm run build`.
3. Copy `config.example.json` to `~/.config/ai-kiosk/config.json`. Configure only the providers and T3 sources the owner requests. For a remote Mac, set its SSH host under `t3.remotes`, set `t3.readState.host` to the same host, and set `t3.sshIdentityFile` to the local private-key path. Configure the host's Git credential helper for private PR enrichment. Verify SSH access without printing credentials. Keep the config file mode `0600`; never add it to Git.
4. Open `npm run dev` with `?preview=normal` and `?preview=busy` to check the standard and dense layout using synthetic data. Stop the preview server when done.
5. Run `npm start` on the kiosk display and verify that the screen stays on the portrait panel, live sources report fresh data, and status colors match `DESIGN.md`.
6. Install persistence only when the task asks for it. On a systemd user session, copy `systemd/clankiosk.service` to `~/.config/systemd/user/`, then run `systemctl --user daemon-reload` and enable/start `clankiosk.service`. Verify the service and display after launch.

Do not invent provider credentials, silently reuse another machine’s config, or commit machine-specific details. If a requested provider or T3 source is unavailable, finish the local setup and report exactly what still needs owner configuration.
