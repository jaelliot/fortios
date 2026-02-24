---
applyTo: "libs/keriwasm/**/*.{html,toml,py}"
---

# PyScript Configuration — Package Management & File Mounting

**Authority:** Pattern 04 (PyScript Config & WASM Wheel Management)
**Reference:** ADR-017 (Browser Async Event Loop Integration)
**Applies To:** All PyScript/Pyodide browser application configuration

---

## 🚨 CRITICAL MANDATE

**NEVER deploy PyScript applications without proper `pyscript.toml` configuration.**

Missing package declarations or incorrect file mounting will cause "ModuleNotFoundError" at runtime. Always declare dependencies explicitly.

---

## Do

### ✅ Use Explicit Package Declaration

**Always list packages in `pyscript.toml`:**

```toml
packages = [
    # Local WASM wheels (relative paths)
    "./static/blake3-1.0.8-cp313-cp313-emscripten_4_0_9_wasm32.whl",

    # PyPI packages (built-in or WASM-compatible)
    "micropip",
    "pychloride",  # libsodium for WASM
    "jsonschema",
    "msgpack",
]
```

**Decision tree for package type:**

```python
if has_c_extensions:
    if wasm_wheel_exists_on_pypi:
        packages.append("package-name")  # PyPI WASM
    elif wasm_wheel_local:
        packages.append("./static/package-*.whl")  # Local
    else:
        # Must compile with Emscripten (see wasm-wheel-packaging.instructions.md)
        raise NotImplementedError("Compile WASM wheel first")
elif pure_python:
    if in_pyodide_distribution:
        packages.append("package-name")  # Built-in
    else:
        packages.append("package-name")  # micropip will fetch from PyPI
else:
    raise ValueError("Unknown package type")
```

---

### ✅ Mount Files Explicitly

**List every Python file in `[files]` section:**

```toml
[files]
# Source path (disk) = Target path (Pyodide VFS)
"./python/main.py" = "./main.py"
"./python/wallet.py" = "./wallet.py"
"./python/storage.py" = "./storage.py"

# Packages must match import paths
"./python/hio/__init__.py" = "./hio/__init__.py"
"./python/hio/base/doing.py" = "./hio/base/doing.py"
"./python/hio/help/timing.py" = "./hio/help/timing.py"
```

**Key rules:**

1. **Left side** = Physical file path (relative to `pyscript.toml`)
2. **Right side** = Virtual filesystem path (where Python imports from)
3. **Must match import** — If code says `import hio.base.doing`, need `"./hio/base/doing.py" = "./hio/base/doing.py"`
4. **Not recursive** — Must list each file individually

---

### ✅ Use Consistent pyscript.toml Location

**Place `pyscript.toml` at project root:**

```
my-wallet/
├── index.html           # Entry point
├── pyscript.toml        # ← Always here
├── python/              # Python source
│   ├── main.py
│   └── wallet.py
└── static/              # WASM wheels
    └── blake3-*.whl
```

**Why:** All relative paths in `pyscript.toml` resolve from its location.

---

### ✅ Reference pyscript.toml in HTML

**Every `<script type="py">` must reference config:**

```html
<!DOCTYPE html>
<html>
  <head>
    <title>KERI Wallet</title>
    <!-- Load PyScript core -->
    <link
      rel="stylesheet"
      href="https://pyscript.net/releases/2025.11.2/core.css"
    />
    <script
      type="module"
      src="https://pyscript.net/releases/2025.11.2/core.js"
    ></script>
  </head>
  <body>
    <h1>KERI Browser Wallet</h1>
    <button py-click="init_wallet">Initialize</button>

    <!-- ✅ CORRECT: config attribute -->
    <script type="py" src="./python/main.py" config="pyscript.toml"></script>
  </body>
</html>
```

**Without `config` attribute:** Packages won't install, files won't mount.

---

### ✅ Use CORS Server for Local Development

**Always test with HTTP server (not `file://`):**

```python
#!/usr/bin/env python3
"""serve.py — CORS-enabled HTTP server for PyScript."""

import http.server
import socketserver

PORT = 8000

class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Required for Web Workers
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), CORSHTTPRequestHandler) as httpd:
        print(f"✅ Serving at http://localhost:{PORT}")
        httpd.serve_forever()
```

**Usage:**

```bash
python serve.py
# Open http://localhost:8000 in browser
```

**Why CORS headers matter:**

| Header                                       | Purpose                  | Without It       |
| -------------------------------------------- | ------------------------ | ---------------- |
| `Cross-Origin-Opener-Policy: same-origin`    | Isolate context          | Web Workers fail |
| `Cross-Origin-Embedder-Policy: require-corp` | Enable SharedArrayBuffer | Memory errors    |
| `Access-Control-Allow-Origin: *`             | Allow cross-origin       | Fetch fails      |

---

### ✅ Version Lock PyScript CDN

**Pin specific PyScript version:**

```html
<!-- ✅ CORRECT: Version pinned -->
<link
  rel="stylesheet"
  href="https://pyscript.net/releases/2025.11.2/core.css"
/>
<script
  type="module"
  src="https://pyscript.net/releases/2025.11.2/core.js"
></script>

<!-- ❌ WRONG: Uses "latest" (may break) -->
<link rel="stylesheet" href="https://pyscript.net/latest/core.css" />
<script type="module" src="https://pyscript.net/latest/core.js"></script>
```

**Why:** Latest may introduce breaking changes. Pin to tested version.

---

### ✅ Show Loading Indicator

**Inform users during 30-60s initial load:**

```html
<div id="status">
  ⏳ Loading Python environment... (may take 30-60 seconds first time)
</div>

<script type="py" config="pyscript.toml">
  from pyscript import document

  # Update status when ready
  document.getElementById("status").innerText = "✅ Ready!"
</script>
```

---

### ✅ Use Async Entry Points

**All button handlers must be async:**

```html
<button py-click="run_tests">Run Tests</button>

<script type="py" config="pyscript.toml">
  # ✅ CORRECT: Async function
  async def run_tests(event):
      from hio_bridge import WebDoist
      from test_runner_doer import TestRunnerDoer

      doer = TestRunnerDoer(tests=test_queue)
      web_doist = WebDoist(doers=[doer], tock=0.01, real=True)
      await web_doist.do()

      display_results(doer.results)
</script>
```

---

## Don't

### ❌ Never Use `file://` Protocol

```bash
# ❌ WRONG: Open file directly
open file:///path/to/index.html

# ✅ CORRECT: Use HTTP server
python serve.py
open http://localhost:8000
```

**Why:** Web Workers, CORS, SharedArrayBuffer all require HTTP(S) protocol.

---

### ❌ Never Forget `config` Attribute

```html
<!-- ❌ WRONG: No config -->
<script type="py" src="./python/main.py"></script>

<!-- ✅ CORRECT: Has config -->
<script type="py" src="./python/main.py" config="pyscript.toml"></script>
```

**Impact:** Packages won't install, imports fail with "ModuleNotFoundError".

---

### ❌ Never Load Unnecessary Packages

```toml
# ❌ WRONG: Loading unused packages
packages = [
    "numpy",         # Not used
    "pandas",        # Not used
    "matplotlib",    # Not used
    "scipy",         # Not used
]
# Initial load: 5+ minutes

# ✅ CORRECT: Only what you need
packages = [
    "micropip",
    "jsonschema",
]
# Initial load: 30-60 seconds
```

**Why:** Each package adds to initial load time. Only include what you actually import.

---

### ❌ Never Use Wildcard Imports in pyscript.toml

```toml
# ❌ WRONG: Can't use wildcards
[files]
"./python/**/*.py" = "./**/*.py"  # Not supported

# ✅ CORRECT: List explicitly
[files]
"./python/main.py" = "./main.py"
"./python/wallet.py" = "./wallet.py"
"./python/storage.py" = "./storage.py"
```

**Why:** PyScript doesn't support glob patterns. Must enumerate each file.

---

### ❌ Never Mix Pyodide Versions

```toml
# ❌ WRONG: WASM wheel for different Pyodide version
packages = [
    # This wheel is for Pyodide 0.28.x (emscripten 3.x)
    "./static/blake3-1.0.8-cp312-cp312-emscripten_3_1_58_wasm32.whl",
]
# PyScript 2025.11.2 uses Pyodide 0.29.x (emscripten 4.x)
# Result: Load failure

# ✅ CORRECT: Match Pyodide version
packages = [
    # Compiled for Pyodide 0.29.x (emscripten 4.x)
    "./static/blake3-1.0.8-cp313-cp313-emscripten_4_0_9_wasm32.whl",
]
```

**How to check:**

```python
# In PyScript console
import sys
print(sys.version)  # Shows Python version (e.g., 3.13)
import pyodide
print(pyodide.__version__)  # Shows Pyodide version (e.g., 0.29.1)
```

---

### ❌ Never Use Blocking I/O Without Yielding

```python
# ❌ WRONG: Blocks browser
def process_large_file():
    with open('large_file.json') as f:
        data = json.load(f)  # Blocks
    return process(data)

# ✅ CORRECT: Yield during processing
async def process_large_file():
    with open('large_file.json') as f:
        data = json.load(f)

    results = []
    for i, item in enumerate(data):
        results.append(process(item))
        if i % 100 == 0:
            await asyncio.sleep(0)  # Yield

    return results
```

---

## File Mounting Patterns

### ✅ Pattern: Simple Module

```toml
[files]
"./python/wallet.py" = "./wallet.py"
```

```python
# In main.py
import wallet  # Works
```

---

### ✅ Pattern: Package Structure

```toml
[files]
"./python/mypackage/__init__.py" = "./mypackage/__init__.py"
"./python/mypackage/core.py" = "./mypackage/core.py"
"./python/mypackage/utils.py" = "./mypackage/utils.py"
```

```python
# In main.py
import mypackage.core  # Works
from mypackage.utils import helper  # Works
```

---

### ✅ Pattern: Nested Package

```toml
[files]
"./python/keri/__init__.py" = "./keri/__init__.py"
"./python/keri/core/__init__.py" = "./keri/core/__init__.py"
"./python/keri/core/eventing.py" = "./keri/core/eventing.py"
"./python/keri/db/__init__.py" = "./keri/db/__init__.py"
"./python/keri/db/dbing.py" = "./keri/db/dbing.py"
```

```python
# In main.py
from keri.core.eventing import Serder
from keri.db.dbing import Logger
```

---

## Package Installation at Runtime

### ✅ Use micropip for Missing Packages

**Install pure Python packages dynamically:**

```python
import micropip

# Check if package is installed
packages = await micropip.list()
if 'requests' not in packages:
    await micropip.install('requests')

import requests
```

**Use cases:**

- Optional dependencies
- Conditional installation based on feature flags
- Development-only packages

**Limitations:**

- Only works for pure Python packages
- WASM wheels must be pre-declared in `pyscript.toml`

---

## Performance Characteristics

**Initial load time (cold cache):**

| Component            | Time       | Size   | Why                  |
| -------------------- | ---------- | ------ | -------------------- |
| PyScript core        | ~1s        | ~50KB  | CDN download         |
| Pyodide runtime      | 20-30s     | ~15MB  | Python + stdlib      |
| Pure Python packages | 1-5s       | Varies | micropip install     |
| WASM wheels (local)  | 2-5s       | Varies | Faster than PyPI     |
| File mounting        | <1s        | KB     | Virtual FS setup     |
| **Total**            | **30-60s** | ~20MB  | **First visit only** |

**Warm cache (subsequent loads):**

| Component       | Time    | Why                      |
| --------------- | ------- | ------------------------ |
| PyScript core   | <100ms  | Browser cache            |
| Pyodide runtime | ~2s     | Cached, still needs init |
| Packages        | <1s     | Cached                   |
| **Total**       | **~3s** | **Much faster!**         |

---

## Debugging Checklist

**Problem:** "ModuleNotFoundError: No module named 'xxx'"

- [ ] Check `packages` list in `pyscript.toml`
- [ ] Verify package exists on PyPI
- [ ] Check if WASM wheel exists for Pyodide version
- [ ] Look for typos in package name
- [ ] Try `await micropip.install('xxx')` manually

**Problem:** "No module named 'my_module'" (your own code)

- [ ] Check `[files]` section has source → target mapping
- [ ] Verify file exists at source path
- [ ] Confirm import statement matches target path
- [ ] Check for typos in file paths
- [ ] Verify `__init__.py` files for packages

**Problem:** "CORS error" or "SharedArrayBuffer is not defined"

- [ ] Using HTTP server (not `file://`)?
- [ ] Check `serve.py` has correct headers
- [ ] Verify server is running
- [ ] Check browser console for specific error

**Problem:** "Timed out waiting for package"

- [ ] Check network connection
- [ ] Verify PyPI package exists
- [ ] Try installing with micropip manually
- [ ] Check browser console for 404 errors

---

## Related Patterns

- **Pattern 01:** hio_bridge — Event loop integration
- **Pattern 04:** PyScript Config — Complete configuration guide
- **pyodide-event-loop.instructions.md:** Async patterns
- **wasm-wheel-packaging.instructions.md:** Building WASM wheels

---

## iOS Bundled Payload Patterns

These patterns apply when running Pyodide inside a WKWebView with bundled assets (the `app://` custom URL scheme). They do **not** apply to the browser-based `libs/keriwasm/` development environment.

### ✅ Use `unpackArchive` for bundled wheel installation

In the iOS app, wheels are served via `app://` scheme handler. micropip cannot reach these URLs (its internal `pyfetch()` uses a different pathway than JS `fetch()`). Use `pyodide.unpackArchive()` instead:

```typescript
// ✅ CORRECT: Works with app:// scheme
async function installWheel(url: string): Promise<void> {
  const resp = await fetch(url);          // JS fetch() → scheme handler
  const buffer = await resp.arrayBuffer();
  pyodide.unpackArchive(buffer, 'wheel'); // Extracts to site-packages
}

await installWheel('pyodide/wheels/blake3-1.0.8-....whl');
await installWheel('pyodide/wheels/pychloride.whl');

// ❌ WRONG: micropip can't reach app:// URLs
await micropip.install('app://local/pyodide/wheels/blake3.whl');
// → pyfetch() fails silently or raises URL parse error
```

See ADR-022 amendment for the full history of why micropip was abandoned.

### ✅ Assign `runPythonAsync` return values to variables

`pyodide.runPythonAsync()` returns the value of the **last expression** in the Python string. However, bare `True`/`False` inside `try/except` blocks are NOT captured — you must assign to a variable and place the variable name on the last line:

```typescript
// ❌ WRONG: Returns undefined
const result = await pyodide.runPythonAsync(`
try:
    verify(sig, msg, pk)
    True
except Exception:
    False
`);
// result === undefined

// ✅ CORRECT: Assign to variable, evaluate on last line
const result = await pyodide.runPythonAsync(`
try:
    verify(sig, msg, pk)
    _vresult = True
except Exception:
    _vresult = False
_vresult
`);
// result === true or false
```

This is a Pyodide-specific behavior. The last **expression statement** in the code block determines the return value, and bare literals inside compound statements (try/except, if/else) are not treated as the block's final expression.

---

## Summary

**Golden Rules for PyScript Config:**

1. **Always declare packages explicitly** — No auto-discovery
2. **Mount files individually** — No wildcard patterns
3. **Use HTTP server** — Never `file://` protocol
4. **Add `config` attribute** — On every `<script type="py">`
5. **Version lock PyScript** — Pin CDN URL
6. **Set CORS headers** — Required for Web Workers
7. **Show loading indicator** — Inform users of 30-60s wait
8. **Match WASM versions** — Wheel must match Pyodide version

**Performance Target:** 30-60s cold load, ~3s warm load.
