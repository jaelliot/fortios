# ADR-029: Fort-iOS Git Subtree Extraction

Date: 2026-02-24

## Context

The iOS PoC (Phase 3 complete as of 2026-02-21) was built across two directories inside `keri-notes`:

- `projects/ios-wrapper/` — UIKit + WKWebView Swift shell
- `projects/ios-pyodide-payload/` — Vite + TypeScript web payload

Sam Smith created `https://github.com/keri-foundation/Fort-ios` (2026-02-24 dev meeting) as the canonical home for this work within the KERI Foundation GitHub org. The PoC needs to move there so other contributors can see it, and Android PoC planning can begin.

Two structural questions arose:
1. **Repo layout**: Keep the two `projects/` subdirectory structure inside Fort-ios, or merge flat at the repo root?
2. **keri-notes integration**: How should `libs/Fort-ios/` be wired in to preserve the single-workspace workflow?

## Decision

### 1. Flat repo layout in Fort-ios

Both `projects/ios-wrapper/` and `projects/ios-pyodide-payload/` are merged at the Fort-ios root. Rationale:

- There is no ambiguity about which files belong to the Swift app vs the TS payload — the directory names (`KeriWallet/`, `xcodeproj/`, `src/`, `public/`, etc.) are self-descriptive.
- A single `Makefile` and `package.json` at the root is simpler than nested project roots.
- Only one repo to clone, one `make setup`, one `make sync`.
- Eliminates the `cd ../ios-pyodide-payload && ...` cross-directory steps from the `ios-wrapper` README.

The unified `.gitignore` covers both Swift build artifacts (`DerivedData/`, `build/`) and payload build outputs (`dist/`, `node_modules/`, `public/pyodide/`).

### 2. Git subtree under `libs/Fort-ios/`

`keri-notes` uses `git subtree` (not submodules) to embed Fort-ios:

```sh
git subtree add --prefix libs/Fort-ios https://github.com/keri-foundation/Fort-ios main --squash
```

Rationale for subtree over submodule:
- No `.gitmodules` file, no `git submodule update --init` ceremony for new clones.
- `libs/Fort-ios/` files appear as ordinary files in `keri-notes` — `grep`, `find`, semantic search, and VS Code all work without special handling.
- Consistent with how `libs/keripy`, `libs/hio`, and `libs/keriwasm` are managed (plain directory copies).
- Pushing changes back upstream: `git subtree push --prefix libs/Fort-ios https://github.com/keri-foundation/Fort-ios main`.

### 3. Delete `projects/ios-wrapper/` and `projects/ios-pyodide-payload/`

`libs/Fort-ios/` is now the single source of truth. The old `projects/` directories were removed from the `keri-notes` git index in the same commit that wired in the subtree.

### 4. Update workspace, instruction files, and ADRs

`keri-notes.code-workspace` gains a `Fort-ios` named folder pointing to `libs/Fort-ios/`. All path references in instruction files (ios-swift-coding, ios-wkwebview-pyodide-bundled-payload, ios-xcode-workflow, branding-visual-identity, tooling-vscode) and ADRs 022–028 updated from `projects/ios-wrapper/` and `projects/ios-pyodide-payload/` to `libs/Fort-ios/`.

## Consequences

### Positive
- Single public repo for the iOS PoC, visible to all KERI Foundation contributors.
- Android PoC will follow the same pattern: create `keri-foundation/Fort-android`, push content, `git subtree add --prefix libs/Fort-android`.
- `libs/Fort-ios/` behaves like a regular directory in VS Code — no submodule friction.
- `keri-notes.code-workspace` now opens all active libs (keripy, hio, keriwasm, Fort-ios) as named VS Code workspace folders.

### Negative / Accepted
- `git subtree push` is required to propagate changes back upstream (vs `git push` in a plain clone). This is documented in the Fort-ios `README.md`.
- Flat layout means the repo root has both Swift and TypeScript files. Judged acceptable given the self-descriptive directory names.

### Future
- Once Android PoC is approved, add `libs/Fort-android/` via the same subtree pattern.
- `ExportOptions.plist` (App Store export config containing Apple Team ID) remains uncommitted in both Fort-ios and the local subtree copy.

## References

- Sam Smith directive: 2026-02-24 dev meeting — "I created a new repo in the KERI Foundation GitHub"
- `ADR-022` — iOS WKWebView + Pyodide Bundled Payload
- `ADR-023` — iOS Wrapper Architecture
- `ADR-024` — Web Payload Build & Bundling Strategy
- `ADR-025` — iOS Build/CI & Developer Workflow
- `ADR-026` — iOS Logging Strategy
- `ADR-027` — KERI Brand Identity & UI Integration
- `ADR-028` — iOS SwiftLint & Type-Inference Strategy
