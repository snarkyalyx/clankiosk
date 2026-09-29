# Contributing

Use Node 22.12+ or 24 LTS and Python 3.9+. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. Keep dependency versions and the lockfile together. Use `npm run dev` and synthetic fixtures for visual work; `npm run check:layout` records multiple viewport checks and PNGs under ignored `artifacts/`.

Create focused changes that preserve provider/source boundaries. Usage counts must survive rescans and must not sum cumulative counters. Capacity requires real provider measurements. Tests should cover behavior such as resets, missing data, retry duplication and day rollover.

A new integration should document its source format, supported platforms, credentials, polling interval, cache semantics and failure behavior. Never send chat content to an analytics service. Credentials stay in the main process, OS credential store or private local config; renderer IPC exposes only necessary settings and normalized data.

Do not attach live usage screenshots or private chat titles to issues. Reproduce with `?preview=normal`, `busy`, `empty`, or `stale`. Installer signing and publication are separate from source checks; do not claim a platform has been tested merely because it has a build target.
