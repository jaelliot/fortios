# ADR-027: KERI Foundation Brand Identity & UI Integration

Date: 2026-02-21

## Context

The iOS KeriWallet app is functionally complete (Pyodide boots, crypto operations work, bridge protocol operational) but **completely unbranded**:

- `AppIcon.appiconset` has empty slots — no icon is displayed on the home screen.
- `AccentColor.colorset` has no color value — uses iOS system blue default.
- `LaunchScreen.storyboard` is a stock Xcode template — blank white screen.
- `index.html` (web payload) shows "KeriWasm iOS Payload" in plain text with generic dark-theme styling.

The KERI Foundation has provided an official logo pack (`docs/branding/ExportsDarker/`) containing the **Triquetra (Trinity knot)** mark in 6 variants across multiple formats, plus a brand usage guide (`docs/branding/brand-guide.md`).

This ADR codifies the brand identity (colors, logo variants, usage rules) and records the specific UI decisions for applying it to the iOS app and web payload.

## Decision

### 1. Official Brand Colors

Extracted from the SVG `<style>` blocks in `docs/branding/ExportsDarker/SVG/`:

| Name | Hex | CSS Class | Usage |
|------|-----|-----------|-------|
| **KERI Olive Green** | `#61783e` | `.cls-2` (FullLogo), `.cls-1` (NameLogo) | Primary — text, UI accents, AccentColor |
| **KERI Gold/Bronze** | `#986c32` | `.cls-1` (FullLogo/SymbolLogo) | Secondary — inner triquetra knot elements |
| **Black** | `#000000` | (Black variants) | Monochrome treatment for light backgrounds |

These are the **only** approved brand colors. Do not approximate, lighten, or derive variants without explicit approval.

### 2. Logo Variants & Selection

The logo pack contains 6 variants, each in color and monochrome black:

| Variant | File | Dimensions | Description | Use When |
|---------|------|-----------|-------------|----------|
| **FullLogo** | `FullLogo.svg` | 342×94 | Triquetra + "KERI" serif text | Main UI header, splash screens, about screens |
| **SymbolLogo** | `SymbolLogo.svg` | 94×94 (square) | Triquetra only | App icon, loading state, compact contexts |
| **NameLogo** | `NameLogo.svg` | 250×94 | "KERI" serif text only | Text-heavy contexts, README badges |

Available formats:
- **SVG** (canonical vector source) — `ExportsDarker/SVG/`
- **PDF** (vector, Xcode-compatible) — `ExportsDarker/PDF/`
- **PNG** at 0.5x, 0.75x, 1x, 1.5x, 2x, 3x — `ExportsDarker/{scale}/`
- **JPG** at 4x — `ExportsDarker/4x/`

### 3. iOS App Integration

| Asset | Source | Location |
|-------|--------|----------|
| **App Icon** | `SymbolLogo` (1024×1024 re-export or 4x JPG) | `AppIcon.appiconset` |
| **AccentColor** | `#61783e` (KERI Olive Green) | `AccentColor.colorset` |
| **LaunchScreen** | `SymbolLogo` centered on dark background | `LaunchScreen.storyboard` |

### 4. Web Payload Integration

| Context | Logo Variant | Behavior |
|---------|-------------|----------|
| **Loading state** (Pyodide booting) | `SymbolLogo.svg` | Centered, subtle pulse animation |
| **Post-boot header** | `FullLogo.svg` | Top of page, horizontal layout |

CSS custom properties for brand colors:
```css
:root {
  --keri-green: #61783e;
  --keri-gold: #986c32;
  --keri-black: #000000;
}
```

SVG assets served via `app://` scheme handler (MIME type `image/svg+xml` already configured).

### 5. Brand Guide Compliance

The usage guide (`docs/branding/brand-guide.md`) states "never use the logo as an app icon." This restriction is interpreted as applying to **third-party** products. The KERI Foundation's own iOS app (`com.kerifoundation.wallet`) is exempt — the SymbolLogo is the appropriate app icon for the Foundation's official wallet.

Text-only references in third-party contexts remain governed by the brand guide:
- "Compatible with KERI Suite"
- "Built on KERI Suite"
- "Uses the KERI Suite open-source software"

### 6. Diagram Palette Independence

The diagram standards (`docs-diagram-standards-polyglot.instructions.md`) use a separate WCAG-optimized palette (Emerald `#10b981`, Sky Blue `#38bdf8`, Amber `#fbbf24`, Purple `#a78bfa`). These are **not brand colors** — they are chosen for AA contrast compliance on dark backgrounds. Diagrams are not governed by the brand identity and must not be modified to match brand colors.

## Alternatives Rejected

| Alternative | Why Rejected |
|---|---|
| **Use brand colors for diagrams** | Brand colors (`#61783e`, `#986c32`) fail WCAG AA contrast on dark backgrounds; diagram palette serves a different purpose (accessibility) |
| **Custom app icon design** | SymbolLogo (triquetra) is already recognizable and on-brand; a custom icon would violate the brand guide's prohibition on creating "inspired by" variations |
| **Defer all branding** | The app is functional and approaching TestFlight; unbranded submissions create a poor first impression and make the app harder to identify |
| **NameLogo as app icon** | Text renders illegibly at small icon sizes; SymbolLogo's square triquetra is visually clear at all scales |

## Consequences

- Consistent KERI Foundation visual identity across the iOS app and bundled web payload.
- Brand colors (`#61783e`, `#986c32`) are documented with authoritative hex values extracted from official SVGs — no guessing.
- Clear governance: canonical asset location (`docs/branding/ExportsDarker/SVG/`), usage rules, and exemptions documented.
- Diagram standards remain independent — no risk of breaking WCAG compliance.
- Future contributors can apply brand identity without hunting through SVG source files for color values.

## Status

Accepted.

## References

- [brand-guide.md](../branding/brand-guide.md): Official KERI Suite logo usage guide
- [docs/branding/ExportsDarker/SVG/](../branding/ExportsDarker/SVG/): Canonical vector logo source
- [ADR-022](ADR-022-ios-wkwebview-pyodide-bundled-payload.md): iOS bundled payload architecture
- [ADR-023](ADR-023-ios-wrapper-architecture.md): iOS wrapper architecture
- `.github/instructions/branding-visual-identity.instructions.md`: Implementation rules for brand asset usage
