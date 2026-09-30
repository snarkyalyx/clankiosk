# Clankiosk

A local dashboard for AI token consumption, provider capacity and T3 Code sessions. Runs on macOS and Linux in a resizable desktop window or on a dedicated kiosk display.

Clankiosk keeps the large daily counter, colored model activity, capacity bars and compact session rows from the original kiosk. The first launch helps you choose the sources on your device. No hub or remote machine is required.

## Quick start

Install Node.js **22.12+** (or Node 24 LTS) and npm. Claude history tracking also needs Python 3.9+ and `sqlite3`; T3 session tracking needs `sqlite3`.

```sh
git clone https://github.com/snarkyalyx/clankiosk.git
cd clankiosk
npm ci
npm run build
npm start
```

On macOS, missing prerequisites can be installed with `brew install node python sqlite`. On Debian/Ubuntu, install Python and SQLite with `sudo apt install python3 sqlite3`; install a current Node LTS separately.

On first launch, select Codex, Claude Code and/or T3 Code. Clankiosk reads their existing local history and logins. It does not sign in for you or change your Claude/Codex settings. An optional OpenCodex hub supplies shared provider usage and capacity. Use **Setup…** in the File menu on macOS or Clankiosk menu on Linux (`Cmd/Ctrl+,`), or `npm run setup`, to change sources later.

```sh
npm run doctor                  # local paths, tools and configuration status
npm start -- --desktop          # normal window
npm start -- --kiosk            # configured dedicated display
npm run screenshot -- shot.png  # capture the running app, without restarting it
```

The screenshot command and app must use the same configuration directory. The desktop menu also has **Save screenshot…** (`Cmd/Ctrl+Shift+S`).

## What is tracked

| Source | Tokens and cache | Capacity | Notes |
| --- | --- | --- | --- |
| Codex local | Session JSONL history, by local day and model | Existing Codex app-server login | Default standalone source; includes archived session files. |
| Claude Code local | Transcript usage, plus optional OTLP telemetry | Existing Claude subscription login | macOS Keychain and Linux credential-file support. |
| OpenCodex hub | Hub daily totals and model activity | Hub provider quota reports | Replaces local Codex totals when selected in setup. |
| T3 Code | Session state and linked PRs | — | Optional local SQLite source or explicitly configured SSH remotes. |

Only one source is authoritative for each tracked provider family. `usage.codex` and `usage.claude` can be `local`, `hub`, or `off`; the app excludes the corresponding hub rows when a local source is selected. This choice covers the whole family: a local source cannot represent remote devices that only the hub sees.

The headline and model breakdown use the same merged daily data. Local history uses this device’s calendar days. Hub daily dates use the hub’s timezone; use matching timezones when comparing daily totals. Cached input is included in token consumption; cache hit is cached reads divided by observed input. Reasoning tokens are already part of output and are not added twice. The burn rate is an average over the last hour. Hub hourly buckets may differ from its daily totals; daily totals drive the headline.

Claude transcripts refresh every 30 seconds; local Codex history every 10 seconds; hub daily usage every minute; Claude capacity every two minutes. API value is an estimate, not a subscription bill. A trailing `+` means some requests lack price information; `—` means no price estimate is available. Quota percentages always come from a quota source, never from token counts. API-key-only Claude accounts have no subscription capacity bar. The OAuth usage endpoint and local transcript formats are upstream interfaces that may change.

Local Codex history records tokens but no prices, so an API-equivalent value needs a `pricing.models` table in the config. Each entry names a model or pattern and its rate per million tokens:

```json
"pricing": { "models": [ { "model": "gpt-5.1-codex*", "input": 1.25, "cachedInput": 0.125, "output": 10 } ] }
```

Prices come from the provider's current list pricing; Clankiosk ships no table because published rates change. Cached reads bill at `cachedInput` (defaulting to `input`) and the uncached remainder bills at `input`, so nothing is counted twice. A day whose models are only partly covered keeps its `+` marker instead of presenting a confident total.

## Configuration

Config and usage data stay outside the repository:

| Platform | Config | Usage data |
| --- | --- | --- |
| macOS | `~/Library/Application Support/Clankiosk/config.json` | Same directory |
| Linux | `~/.config/clankiosk/config.json` | `~/.local/share/clankiosk/` |

Linux respects `XDG_CONFIG_HOME` and `XDG_DATA_HOME`. `CLANKIOSK_CONFIG_DIR` and `CLANKIOSK_DATA_DIR` override these paths on either platform. Config files are written with mode `0600`. Invalid config is reported in setup and is not overwritten on read.

See [config.example.json](config.example.json) for advanced options. Paths beginning with `~/` expand to the current user's home. The original `~/.config/ai-kiosk` configuration is separate: `npm run migrate -- --dry-run` lists what would carry over, `npm run migrate` writes it once you agree, and `--from <file>` reads a different profile. The old directory is never modified. [AI_AGENT_SETUP.md](AI_AGENT_SETUP.md) covers the same step for an agent.

### Windows and displays

Desktop mode has a normal frame, visible cursor, resizing, scrolling and standard close behavior. Drag a window edge to resize it. macOS keeps the app available in the Dock after closing the window. Wide landscape windows place usage beside sessions; medium and narrow windows stack the sections. Dedicated portrait kiosk mode retains the original 40/60 split and fixed session rows. Desktop lists can scroll through every session; kiosk overflow shows a count.

In Setup, **Visible sections** independently controls Tokens today, Token activity, Capacity and T3 sessions. For example, hide T3 sessions while continuing to collect them, or disable the T3 source entirely under Local sources. The same switches live in `sections` in `config.json`. At least one section must stay visible; a sessions-only layout requires T3 collection. Source settings and visibility are separate.

Kiosk mode uses `window.display`: `"portrait"`, `"primary"`, or an Electron display ID. With `"portrait"`, disconnecting the target hides the kiosk until it returns. It never falls back to an unrelated display. `window.alwaysOnTop` and `window.preventSleep` are configurable. The Linux X11 cursor guard is used only in kiosk mode.

### T3 and PRs

T3 support is optional. Configure `t3.database`, `t3.readState.profilePath`, and `t3.remotes` for custom paths or additional machines. Remote queries require SSH and SQLite on the remote host. The built-in remote visit-state reader uses the T3 macOS desktop profile. `t3.readState.host` selects that remote profile explicitly; otherwise local visit state is used. All databases are read-only; LevelDB visit state is copied before reading. No timestamps means the app cannot reliably distinguish an unread completion.

PR links come from T3's registered associations; the forge only refreshes those exact records. Set `forge.enabled` to `true` to enrich them. Gitea uses the current user's Git credential helper. GitHub uses a token from `forge.tokens.github.com`, then `GH_TOKEN`/`GITHUB_TOKEN`, then an existing `gh auth login`; GitHub Enterprise hosts also belong in `forge.githubHosts`. GitHub CI state combines check runs with legacy commit statuses, so both modern apps and older CI providers report correctly. `npm run doctor` prints which token source was found, and failures are appended to `forge.log` in the data directory. Subagents come from structured T3 events; per-chat token attribution is not inferred.

### Claude collection

For normal local setup, Electron manages a small Python transcript scanner and stops it when the app quits. It stores usage fields only and opens no network listener. Reopening the app backfills recent history. Collection while Clankiosk is closed requires a separately managed collector.

For multi-device or OTLP setups, see [docs/claude-telemetry.md](docs/claude-telemetry.md). Use `claude.managedCollector: false` when an external service owns the database. Never run two listeners on the same endpoint.

## Develop and package

```sh
npm run dev       # http://localhost:5173/?preview=normal — synthetic data
npm run typecheck
npm test
npm run check:layout  # run with the preview server on port 5173
npm run check:app    # isolated synthetic collector + screenshot smoke check
npm run icons     # regenerate build/icon.png and build/icons from build/icon.svg
npm run package   # unpacked application in release/
npm run dist      # platform installers/archives in release/
```

Preview variants: `normal`, `few`, `busy`, `empty`, `stale`, `setup`. Add `&mode=desktop` to exercise scrolling or `&hide=sessions` to check section visibility; default fixtures use kiosk mode. Previews contain synthetic names and usage, and are excluded from the production bundle.

Electron Builder targets Linux AppImage/tar.gz and macOS DMG/zip, using the committed icon set from `build/icon.svg`. Build macOS artifacts on a Mac. Releases are unsigned by design: builds are neither code signed nor notarized, so macOS asks for confirmation the first time the app is opened. Pushing a `v*` tag builds both platforms on the GitHub mirror and attaches the artifacts to a release; the same command locally is `npm run dist`. Every release is built from its tagged source in this repository, and both the license text and the bundled asset notices ship inside the app. Packaged builds still need the external tools required by enabled sources. CI checks are defined for Gitea and for GitHub mirrors, including a macOS source-check job on GitHub.

[AI_AGENT_SETUP.md](AI_AGENT_SETUP.md) is the short installation guide for an AI agent. [DESIGN.md](DESIGN.md) records the visual standard. [CONTRIBUTING.md](CONTRIBUTING.md) covers changes and data privacy.

## License

MIT license, see [LICENSE](LICENSE). Copyright 2026 BuckiCo. [THIRD-PARTY.md](THIRD-PARTY.md) lists bundled assets and their own terms.
