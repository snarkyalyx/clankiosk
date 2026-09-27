# Clankiosk

Clankiosk is BuckiCo’s reference implementation and design standard for a read-only AI usage kiosk. It brings daily token use, model activity, provider capacity and T3 coding sessions together on a dedicated portrait display.

The current design is the standard: warm graphite and ivory, model-specific color, a prominent daily counter, tall activity columns, substantial capacity bars and a dense but legible session rundown. The screen is designed to be understood at a glance and has no touch workflow.

See [DESIGN.md](DESIGN.md) for visual and interaction rules and [AI_AGENT_SETUP.md](AI_AGENT_SETUP.md) for an agent-oriented installation guide. `AGENTS.md` contains implementation rules for future changes.

## Quick start

Requirements: Linux with a portrait display, Node.js 22 LTS, and npm.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173/?preview=normal` to view the synthetic sample. Other fixtures are `?preview=few`, `?preview=busy`, `?preview=empty` and `?preview=stale`.

For the Electron kiosk:

```sh
npm run build
npm start
```

The app opens only on a detected portrait display. It does not take focus from other apps when the display arrangement changes.

## Configure live data

Copy `config.example.json` to `~/.config/ai-kiosk/config.json` and fill in only the providers and T3 sources available on the target machine. Remote T3 access uses SSH; set `t3.remotes`, `t3.readState`, and `t3.sshIdentityFile` for the environment. PR enrichment uses the host's configured Git credential helper. Keep credentials, SSH keys and real session/usage data outside the repository.

Useful checks:

```sh
npm run typecheck
npm test
npm run build
```

The T3 and provider collectors are read-only. Collection runs every few seconds for sessions and on slower independent schedules for usage and capacity.
