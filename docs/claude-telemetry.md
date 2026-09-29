# Advanced Claude telemetry

Normal setup needs only local transcripts. OTLP is optional and provides request-level API cost estimates when Claude emits them.

1. Run an independent collector with a private config containing `database`, `bind`, `port`, a random `token` of at least 24 characters, and `sources`, e.g. `[{"device":"local"}]`. Store it outside the repo with mode `0600`. `python3 electron/claude_collector.py --config /absolute/path/collector.json` starts the authenticated OTLP/HTTP JSON listener. `--scan-only` opens no listener; `scan-once` imports once and exits.
2. Preserve existing Claude settings and merge into `env`: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=none`, `OTEL_LOGS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:4318/v1/logs`, and `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>,X-Kiosk-Device=local`. Restart the sending Claude sessions for environment changes. Do not enable prompt or tool-content logging.
3. Set `claude.managedCollector: false`, `claude.database` to the collector database and `claude.expectedSources` to its device labels. Restart Clankiosk after configuration changes.

For other devices, prefer an SSH tunnel or TLS proxy. If you use a private-network HTTP listener, keep it on a trusted network; bearer tokens are unencrypted over HTTP. Each device sends its configured `X-Kiosk-Device` header. A transcript source may include `sshHost` and `sshIdentityFile`; remote scans run Python read-only and return normalized usage, not conversation text. The remote needs Python 3.9+ and noninteractive SSH access.

SQLite deduplicates by source and request ID. Matching telemetry supersedes the transcript row and supplies cost. Records without matching identifiers cannot be joined heuristically. Verify an actual request on each integration before assuming that a harness emits OTLP. The standalone CLI and T3's harness can have separate authentication/environment behavior.
