# KeriWasm Web Payload (Vite + TypeScript)

This folder contains the **bundled web payload** intended to be embedded into an iOS app bundle.

---

## Requirements

| Tool | Version | Install |
|------|---------|----------|
| mise | latest | `curl https://mise.run \| sh` |
| Node | 22.12.0 | managed by mise via `.tool-versions` |

```sh
# Install mise, then activate the pinned Node version:
curl https://mise.run | sh
mise install
```

---

## Determinism contract

- `dist/` is build output and **must not** be committed.
- Toolchain is pinned via `mise` using `.tool-versions`.
- Dependencies are locked via `package-lock.json`.
- Canonical build is `npm ci && npm run build:ci`.
- Build writes `dist/build-manifest.json` containing:
  - git SHA
  - lockfile hash
  - `dist/` content hash
  - tool versions (Node/npm)

## Commands

- `npm ci`
- `npm run dev` (local preview server; iOS wrapper must still load bundled assets)
- `npm run build:ci` (production build + manifest)

## Notes

The iOS wrapper should serve `dist/` via a custom `WKURLSchemeHandler` so it can provide correct MIME types for `.wasm` (`application/wasm`).
