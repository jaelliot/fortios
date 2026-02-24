---
applyTo: "docs/branding/**/*,libs/Fort-ios/**/*"
---

# KERI Foundation Brand Identity — Implementation Rules

> Codifies the official KERI Foundation visual identity for use in the iOS app and web payload.
> Rationale: ADR-027 (`docs/adr/ADR-027-keri-brand-identity-ui-integration.md`).
> Usage restrictions: `docs/branding/brand-guide.md`.

---

## Brand Colors

Extracted from `docs/branding/ExportsDarker/SVG/FullLogo.svg` `<style>` block.

| Semantic Name | Hex | Role |
|---------------|-----|------|
| **KERI Olive Green** | `#61783e` | Primary — text, accents, iOS AccentColor, CSS `--keri-green` |
| **KERI Gold/Bronze** | `#986c32` | Secondary — triquetra knot detail, CSS `--keri-gold` |
| **Black** | `#000000` | Monochrome — for light-background contexts only |

### CSS custom properties (web payload)

```css
:root {
  --keri-green: #61783e;
  --keri-gold: #986c32;
  --keri-black: #000000;
}
```

Use custom properties everywhere — never hardcode hex values in component styles.

### Swift color constants (iOS)

Use the Xcode asset catalog `AccentColor.colorset` for `#61783e`. For additional brand colors in Swift, define them once:

```swift
extension UIColor {
    static let keriGreen = UIColor(red: 0x61/255.0, green: 0x78/255.0, blue: 0x3E/255.0, alpha: 1)
    static let keriGold  = UIColor(red: 0x98/255.0, green: 0x6C/255.0, blue: 0x32/255.0, alpha: 1)
}
```

Place these in a `BrandColors.swift` file alongside `AppLogger.swift` in `KeriWallet/`.

---

## Logo Variants

All logos live in `docs/branding/ExportsDarker/`. SVG is the canonical vector source.

| Variant | File | Aspect | Best For |
|---------|------|--------|----------|
| **FullLogo** | `SVG/FullLogo.svg` | 342×94 (wide) | Headers, splash screens, about pages |
| **SymbolLogo** | `SVG/SymbolLogo.svg` | 94×94 (square) | App icon, loading spinner, compact UI |
| **NameLogo** | `SVG/NameLogo.svg` | 250×94 (wide) | Text-heavy contexts, README badges |

Each variant has a **color** version (triquetra in olive green + gold) and a **Black** version (monochrome).

### Selection guide

- **Dark backgrounds** → color variants (`FullLogo.svg`, `SymbolLogo.svg`)
- **Light backgrounds** → black variants (`FullLogoBlack.svg`, `SymbolLogoBlack.svg`)
- **Square context** (icon, avatar, loading) → `SymbolLogo`
- **Wide context** (header, banner) → `FullLogo`
- **Text-only context** → `NameLogo` or plain text reference

---

## Asset Paths

### Canonical sources (do NOT duplicate)

```
docs/branding/
├── brand-guide.md              # Usage rules & restrictions
└── ExportsDarker/
    ├── SVG/                    # Vector source (canonical)
    │   ├── FullLogo.svg
    │   ├── FullLogoBlack.svg
    │   ├── SymbolLogo.svg
    │   ├── SymbolLogoBlack.svg
    │   ├── NameLogo.svg
    │   └── NameLogoBlack.svg
    ├── PDF/                    # Vector (Xcode-compatible)
    ├── 1x/ 2x/ 3x/            # PNG rasters for iOS device scales
    └── 4x/                    # JPG high-res exports
```

### iOS raster scale mapping

| iOS device scale | Source directory |
|------------------|----------------|
| @1x (non-retina) | `1x/` |
| @2x (retina) | `2x/` |
| @3x (iPhone Plus/Pro) | `3x/` |
| App icon (1024×1024) | Re-export from SVG or use `4x/` JPG |

---

## iOS Integration Points

### App Icon (`AppIcon.appiconset`)

- Source: `SymbolLogo` (triquetra only — square aspect)
- The 1024×1024 master icon goes in: `xcodeproj/KeriWallet/KeriWallet/Assets.xcassets/AppIcon.appiconset/`
- Provide light, dark, and tinted variants per Apple HIG
- Export from `SVG/SymbolLogo.svg` with appropriate padding

### AccentColor (`AccentColor.colorset`)

- Set to `#61783e` (KERI Olive Green)
- This tints system controls (buttons, links, switches) app-wide

### LaunchScreen (`LaunchScreen.storyboard`)

- Center `SymbolLogo` on a dark background
- No animation (static storyboard constraint)
- Keep clear space around the logo per brand guide

---

## Web Payload Integration Points

### Loading state (Pyodide booting)

- Display `SymbolLogo.svg` centered on screen
- Optional subtle CSS animation (pulse or fade)
- Remove or transition when Pyodide reports ready

### Post-boot UI

- Display `FullLogo.svg` in the page header
- Use `--keri-green` and `--keri-gold` for UI accents
- SVG assets served via `app://` scheme handler (`image/svg+xml` MIME already configured)

### Embedding SVGs in the web payload

Copy needed SVGs into `libs/Fort-ios/public/` at build time. The `app://` scheme handler serves them from `WebPayload/` after sync. Do **not** inline large SVG markup in HTML — use `<img src="app://local/SymbolLogo.svg">`.

---

## Anti-Patterns

| ❌ Don't | ✅ Do |
|----------|-------|
| Modify SVG colors or proportions | Use official exports unchanged |
| Create "inspired by" logo variations | Use only the 6 official variants |
| Hardcode `#61783e` in CSS/Swift | Use `--keri-green` / `UIColor.keriGreen` |
| Use brand colors in diagram standards | Diagrams use WCAG-optimized palette (separate concern) |
| Duplicate SVGs into multiple locations | Reference from canonical `docs/branding/ExportsDarker/SVG/` |
| Use FullLogo in square/icon contexts | Use SymbolLogo for compact/square contexts |
| Use color variants on light backgrounds | Use Black variants on light backgrounds |

---

## Brand Guide Summary (from `brand-guide.md`)

### ✅ Do

- Use only official logo files
- Keep colors, proportions, orientation unchanged
- Leave sufficient clear space around the logo

### ❌ Don't

- Recolor, stretch, rotate, crop, or distort
- Add effects (shadows, outlines, gradients, animations to the logo itself)
- Combine with other logos into one mark
- Redraw, simplify, or stylize

### First-Party Exemption

The brand guide's "never use as app icon" rule applies to **third-party products**. The KERI Foundation's own apps (`com.kerifoundation.wallet`) use `SymbolLogo` as the official app icon. See ADR-027 (`docs/adr/ADR-027-keri-brand-identity-ui-integration.md`) §5.
