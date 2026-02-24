---
applyTo: "libs/keriwasm/notes/*.md,building/pyodide/**/*"
---

# WASM Wheel Packaging — Emscripten Compilation for Pyodide

**Authority:** Pattern 04 (PyScript Config — WASM Wheel section)
**Reference:** `libs/keriwasm/notes/liboqs_python_wheel.md`, `libs/keriwasm/notes/pysodium_wheel.md`
**Applies To:** Building Python packages with C extensions for WebAssembly

---

## 🚨 CRITICAL MANDATE

**NEVER attempt to use native C extension wheels in browser.**

Native wheels (manylinux, macosx) use x86/ARM machine code. Browsers only execute WebAssembly. You MUST compile C extensions with Emscripten toolchain.

---

## Do

### ✅ Use Pyodide Build Environment

**Always build in Pyodide Docker container:**

```bash
# Pull official Pyodide build image
docker pull pyodide/pyodide:0.29.1

# Run interactive container
docker run -it \
    --rm \
    -v $(pwd):/src \
    pyodide/pyodide:0.29.1 \
    bash
```

**Why:** Ensures correct Emscripten version, Python version, and build tools.

---

### ✅ Follow Standard Build Workflow

**7-step process for any C-extension package:**

```bash
# 1. Install pyodide-build tools
pip install pyodide-build

# 2. Activate Emscripten environment
pyodide xbuildenv install 0.29.1
PYODIDE_EMSCRIPTEN_VERSION=$(pyodide config get emscripten_version)
./emsdk activate ${PYODIDE_EMSCRIPTEN_VERSION}
source emsdk_env.sh

# 3. Configure C library with Emscripten
cd /src/packages/my-library
mkdir build && cd build
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=ON \
    -DCMAKE_INSTALL_PREFIX=$(pwd)/install_dir

# 4. Build C library
emmake make -j$(nproc)
emmake make install

# 5. Create WASM side module (.so)
emcc -O3 \
    -s SIDE_MODULE=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -o library.so \
    -Wl,--whole-archive install_dir/lib/library.a -Wl,--no-whole-archive

# 6. Bundle .so with Python package
cp library.so /src/packages/python-binding/package_name/

# 7. Build wheel
cd /src/packages/python-binding
python -m build --wheel
```

**Result:** Wheel in `dist/` with naming like:

```
package_name-1.0.0-cp313-cp313-emscripten_4_0_9_wasm32.whl
```

---

### ✅ Patch Library Loading for Pyodide

**Detect Pyodide environment and load bundled .so:**

```python
# In package_name/__init__.py or package_name/binding.py
import sys
import ctypes as ct
import os

_IS_PYODIDE = sys.platform == "emscripten"

def _load_library_pyodide() -> ct.CDLL:
    """Load bundled .so for Pyodide/WASM."""
    pkg_dir = os.path.dirname(os.path.abspath(__file__))
    lib_path = os.path.join(pkg_dir, "library.so")

    try:
        return ct.cdll.LoadLibrary(lib_path)
    except OSError as e:
        msg = f"Could not load bundled library.so from {lib_path}: {e}"
        raise RuntimeError(msg) from e

def _load_library() -> ct.CDLL:
    """Load library (Pyodide or native)."""
    if _IS_PYODIDE:
        return _load_library_pyodide()

    # Original native loading logic
    for lib_name in ["liblibrary.so", "library.dll", "liblibrary.dylib"]:
        try:
            return ct.cdll.LoadLibrary(lib_name)
        except OSError:
            continue

    raise RuntimeError("Could not find library")

# Load library
_lib = _load_library()
```

**Key pattern:** Check `sys.platform == "emscripten"` to detect Pyodide.

---

### ✅ Define ctypes Argtypes for Pyodide

**CRITICAL: Define function signatures before calling:**

```python
if _IS_PYODIDE:
    # Define argtypes for all functions BEFORE calling them
    _lib.some_function.argtypes = [ct.c_char_p, ct.c_size_t]
    _lib.some_function.restype = ct.c_int

    _lib.another_function.argtypes = [ct.POINTER(ct.c_uint8), ct.c_size_t]
    _lib.another_function.restype = None

# Now safe to call
result = _lib.some_function(b"data", len(b"data"))
```

**Why:** Pyodide requires explicit type information for ctypes. Native Python infers types, but WASM cannot.

**Common types:**

| Python Type   | ctypes Type               | Usage                |
| ------------- | ------------------------- | -------------------- |
| `bytes`       | `ct.c_char_p`             | String/bytes pointer |
| `int`         | `ct.c_int`, `ct.c_size_t` | Integers             |
| `bytearray`   | `ct.POINTER(ct.c_uint8)`  | Mutable byte buffer  |
| `None` (void) | `None`                    | No return value      |

---

### ✅ Bundle .so in Wheel

**Update `pyproject.toml` to include .so file:**

```toml
[tool.hatch.build.targets.wheel]
packages = ["package_name"]

[tool.hatch.build.targets.wheel.force-include]
"package_name/library.so" = "package_name/library.so"
```

**Or for `setup.py`:**

```python
from setuptools import setup

setup(
    name="package-name",
    packages=["package_name"],
    package_data={
        "package_name": ["library.so"]
    },
    include_package_data=True,
)
```

**Verify wheel contents:**

```bash
unzip -l dist/package_name-*.whl
# Should show:
#   package_name/__init__.py
#   package_name/library.so  ← Must be present
```

---

### ✅ Use Appropriate Emscripten Flags

**Key flags for side modules:**

```bash
emcc -O3 \                          # Optimize for speed
    -s SIDE_MODULE=1 \               # Dynamic module (not main)
    -s ALLOW_MEMORY_GROWTH=1 \       # Enable heap growth
    -s EXPORTED_FUNCTIONS='[...]' \  # Optional: explicit exports
    -o library.so \
    -Wl,--whole-archive library.a -Wl,--no-whole-archive
```

**Flag reference:**

| Flag                       | Purpose                | When to Use                                 |
| -------------------------- | ---------------------- | ------------------------------------------- |
| `-s SIDE_MODULE=1`         | Create loadable module | Always (for Python C extensions)            |
| `-s ALLOW_MEMORY_GROWTH=1` | Dynamic heap           | When memory needs vary (crypto, large data) |
| `-Wl,--whole-archive`      | Include all symbols    | Ensures no missing symbols at runtime       |
| `-O3`                      | Max optimization       | Production builds (use `-O0` for debug)     |
| `-g`                       | Debug symbols          | Development only (increases size)           |

---

### ✅ Test Wheel in Browser

**1. Copy wheel to PyScript project:**

```bash
cp dist/package_name-*.whl ../keriwasm/static/
```

**2. Add to `pyscript.toml`:**

```toml
packages = [
    "./static/package_name-1.0.0-cp313-cp313-emscripten_4_0_9_wasm32.whl",
]
```

**3. Test import:**

```html
<script type="py" config="pyscript.toml">
  import package_name
  print(f"✅ Loaded: {package_name.__version__}")
</script>
```

**4. Check browser console for errors**

---

## Don't

### ❌ Never Use Native Wheels in Browser

```toml
# ❌ WRONG: Native wheel won't work
packages = [
    "./static/package_name-1.0.0-cp313-cp313-manylinux_2_17_x86_64.whl",
]
# Error: "dynamic module does not define init function"

# ✅ CORRECT: WASM wheel
packages = [
    "./static/package_name-1.0.0-cp313-cp313-emscripten_4_0_9_wasm32.whl",
]
```

---

### ❌ Never Skip ctypes Argtypes on Pyodide

```python
# ❌ WRONG: No argtypes defined
if _IS_PYODIDE:
    pass  # Forgot to define argtypes

result = _lib.my_function(data, size)  # TypeError or segfault

# ✅ CORRECT: Always define argtypes
if _IS_PYODIDE:
    _lib.my_function.argtypes = [ct.c_char_p, ct.c_size_t]
    _lib.my_function.restype = ct.c_int

result = _lib.my_function(data, size)  # Works
```

---

### ❌ Never Mix Emscripten Versions

```bash
# ❌ WRONG: Build with Emscripten 3.x for Pyodide 0.29.x
./emsdk activate 3.1.58  # Old version
emcc -s SIDE_MODULE=1 -o library.so ...
# Wheel fails to load in PyScript

# ✅ CORRECT: Match Pyodide's Emscripten version
PYODIDE_EMSCRIPTEN_VERSION=$(pyodide config get emscripten_version)
./emsdk activate ${PYODIDE_EMSCRIPTEN_VERSION}  # e.g., 4.0.9
emcc -s SIDE_MODULE=1 -o library.so ...
```

**Check Pyodide's Emscripten version:**

```bash
pyodide config get emscripten_version
# Output: 4.0.9 (for Pyodide 0.29.x)
```

---

### ❌ Never Forget `-Wl,--whole-archive`

```bash
# ❌ WRONG: Missing symbols at runtime
emcc -s SIDE_MODULE=1 -o library.so library.a
# Error: "undefined symbol: some_internal_function"

# ✅ CORRECT: Include all symbols
emcc -s SIDE_MODULE=1 -o library.so \
    -Wl,--whole-archive library.a -Wl,--no-whole-archive
```

---

### ❌ Never Build Without Pyodide Docker

```bash
# ❌ WRONG: Build on native system
emcc -s SIDE_MODULE=1 -o library.so ...
# ABI mismatch, symbol resolution failures

# ✅ CORRECT: Use Pyodide Docker image
docker run -it pyodide/pyodide:0.29.1 bash
# ... build inside container
```

**Why:** Pyodide Docker ensures exact Python version, Emscripten version, and toolchain compatibility.

---

### ❌ Never Bundle Secrets in Wheel

```python
# ❌ WRONG: Hardcoded secrets
API_KEY = "sk_live_abc123..."  # Exposed in wheel

# ✅ CORRECT: Load from environment or IndexedDB
async def get_api_key():
    # Fetch from secure storage
    return await storage.get('api_key')
```

**Why:** WASM wheels are plain text. Anyone can extract files with `unzip`.

---

## Common Packages

### ✅ Blake3 (Hash Function)

**Build recipe:**

```bash
# 1. Clone and build blake3 C library
git clone https://github.com/BLAKE3-team/BLAKE3
cd BLAKE3/c
emcc -O3 -s SIDE_MODULE=1 -o libblake3.so \
    blake3.c blake3_dispatch.c blake3_portable.c \
    -DBLAKE3_NO_AVX2 -DBLAKE3_NO_AVX512 -DBLAKE3_NO_SSE41

# 2. Build Python wheel
pip install blake3  # Get Python source
# Patch binding.py to load libblake3.so for Pyodide
python -m build --wheel
```

**PyPI:** Pre-built wheels available as `blake3-wasm`

---

### ✅ pysodium (libsodium)

**PyPI:** Use `pychloride` (pysodium fork with WASM support)

```toml
packages = ["pychloride"]
```

**Why:** `pychloride` has WASM wheels pre-built, no compilation needed.

---

### ✅ liboqs-python (Post-Quantum Crypto)

**Build recipe:** See `libs/keriwasm/notes/liboqs_python_wheel.md`

**PyPI:** Available as `pyoqs-wasm`

```toml
packages = ["pyoqs-wasm"]
```

---

## Troubleshooting

**Problem:** "`TypeError: Invalid argument type in ToBigInt operation`"

- **Cause:** Missing or incorrect ctypes argtypes
- **Fix:** Define argtypes for all functions when `_IS_PYODIDE`

**Problem:** "`RuntimeError: Could not load bundled library.so`"

- **Cause:** .so not included in wheel or wrong path
- **Fix:** Verify wheel contents with `unzip -l`, check `pyproject.toml` force-include

**Problem:** "`dynamic module does not define init function`"

- **Cause:** Using native wheel instead of WASM wheel
- **Fix:** Rebuild with Emscripten, verify platform tag ends in `wasm32`

**Problem:** "Memory access out of bounds"

- **Cause:** Buffer size mismatch between Python and C
- **Fix:** Verify ctypes pointer types and buffer allocations

**Problem:** "`Module.getRandomValue is not a function`"

- **Cause:** RNG implementation not browser-compatible
- **Fix:** Use `getentropy()` or override with `crypto.getRandomValues()` wrapper

---

## Performance Characteristics

**Compilation time (Docker container):**

| Library Size       | Compilation | Side Module | Wheel Build | Total   |
| ------------------ | ----------- | ----------- | ----------- | ------- |
| Small (blake3)     | ~30s        | ~5s         | ~10s        | ~45s    |
| Medium (libsodium) | ~2min       | ~10s        | ~10s        | ~2.5min |
| Large (liboqs)     | ~15min      | ~30s        | ~10s        | ~16min  |

**Runtime overhead (vs native):**

| Operation      | Native  | WASM    | Overhead |
| -------------- | ------- | ------- | -------- |
| Blake3 hash    | 1ms     | 1.2ms   | ~20%     |
| Ed25519 sign   | 0.05ms  | 0.1ms   | ~100%    |
| Dilithium sign | 80ms    | 100ms   | ~25%     |
| Memory alloc   | 0.001ms | 0.005ms | ~400%    |

**Takeaway:** WASM adds 20-100% overhead for compute, acceptable for browser use.

---

## Related Patterns

- **Pattern 04:** PyScript Config — Using WASM wheels
- **pyodide-config.instructions.md:** Package declaration
- **ADR-017:** Browser Async Event Loop Integration

---

## Reference Documentation

### Internal

- `libs/keriwasm/notes/liboqs_python_wheel.md` — Complete liboqs build guide
- `libs/keriwasm/notes/pysodium_wheel.md` — libsodium build guide

### External

- [Pyodide Building Packages](https://pyodide.org/en/stable/development/building-packages.html)
- [Emscripten Compiler Frontend](https://emscripten.org/docs/tools_reference/emcc.html)
- [Emscripten Linking](https://emscripten.org/docs/compiling/Dynamic-Linking.html)

---

## Summary

**Golden Rules for WASM Wheels:**

1. **Use Pyodide Docker** — Ensures toolchain compatibility
2. **Follow 7-step workflow** — Configure → Build → Side module → Bundle → Wheel
3. **Define ctypes argtypes** — Required for Pyodide
4. **Use `-s SIDE_MODULE=1`** — Create loadable module
5. **Include `-Wl,--whole-archive`** — Prevent missing symbols
6. **Bundle .so in wheel** — Update `pyproject.toml`
7. **Test in browser** — Verify with PyScript before deployment
8. **Match Emscripten versions** — Wheel must match Pyodide version

**Performance Target:** 20-100% overhead vs native (acceptable for browser).
