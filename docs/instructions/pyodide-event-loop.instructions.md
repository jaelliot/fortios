---
applyTo: "libs/keriwasm/**/*.py"
---

# Pyodide Event Loop Integration — Browser Async Patterns

**Authority:** ADR-017 (Browser Async Event Loop Integration)
**Reference:** Pattern 01 (hio_bridge Annotated)
**Applies To:** All Python code running in Pyodide/PyScript browser environment

---

## 🚨 CRITICAL MANDATE

**NEVER use synchronous blocking operations in browser Python code.**

Python runs on the browser's main thread. Blocking operations freeze the UI, trigger "Not Responding" warnings, and create a broken user experience.

---

## Do

### ✅ Use WebDoist for HIO Scheduling

**Always use `WebDoist` wrapper instead of bare `Doist` in browser:**

```python
from hio_bridge import WebDoist
from hio.base.doing import Doer

# ✅ CORRECT: Browser-compatible
web_doist = WebDoist(doers=[my_doer], tock=0.01, real=True)
await web_doist.do()

# ❌ WRONG: Will freeze browser
doist = doing.Doist(doers=[my_doer], real=True)
doist.do()  # BLOCKS FOREVER
```

**Why:** `WebDoist` yields to JavaScript event loop via `await asyncio.sleep()` between HIO cycles.

---

### ✅ Use `await asyncio.sleep()` for Yielding

**Yield control to browser explicitly in long operations:**

```python
async def process_large_kel(events):
    results = []
    for i, event in enumerate(events):
        result = validate_event(event)
        results.append(result)

        # ✅ CORRECT: Yield every 10 events
        if i % 10 == 0:
            await asyncio.sleep(0)  # Minimal yield

    return results
```

**Yield frequency guidelines:**

| Operation Type          | Yield Every | Rationale                         |
| ----------------------- | ----------- | --------------------------------- |
| Lightweight (<1ms/item) | 10-50 items | Minimal overhead                  |
| Medium (1-10ms/item)    | 5-10 items  | Balance throughput/responsiveness |
| Heavy (>10ms/item)      | 1-5 items   | Keep UI smooth                    |

---

### ✅ Set Appropriate `tock` Parameter

**Match `tock` to workload complexity:**

```python
# Fast mode: Tests, batch processing
web_doist = WebDoist(doers=[doer], tock=0.0, real=False)

# Balanced: General UI operations
web_doist = WebDoist(doers=[doer], tock=0.01, real=True)  # 100 Hz

# Smooth: Heavy crypto, animations
web_doist = WebDoist(doers=[doer], tock=0.03125, real=True)  # 32 FPS

# Very smooth: Continuous background work
web_doist = WebDoist(doers=[doer], tock=0.05, real=True)  # 20 Hz
```

**Decision tree:**

```python
if testing or batch_processing:
    tock = 0.0  # As fast as possible (still yields)
elif light_work_per_cycle:  # <5ms
    tock = 0.01  # 100 Hz
elif medium_work_per_cycle:  # 5-20ms
    tock = 0.02  # 50 Hz
elif heavy_work_per_cycle:  # >20ms
    tock = 0.05  # 20 Hz
```

---

### ✅ Use Async Entry Points

**All browser entry points must be `async def`:**

```python
# ✅ CORRECT: Async function for button handler
async def run_tests(event):
    from hio_bridge import WebDoist
    from test_runner_doer import TestRunnerDoer

    doer = TestRunnerDoer(test_queue=tests)
    web_doist = WebDoist(doers=[doer], tock=0.01, real=True)
    await web_doist.do()

# Button binding (in HTML or Python)
document.getElementById("btn").addEventListener("click", run_tests)
```

**For PyScript `py-click` handlers:**

```html
<button py-click="run_tests">Run Tests</button>

<script type="py">
  async def run_tests(event):
      # ... async code
</script>
```

---

### ✅ Preserve HIO Doer Patterns

**HIO Doers work unchanged in browser with WebDoist:**

```python
from hio.base.doing import Doer

class MyDoer(Doer):
    """Standard HIO Doer - no browser-specific code needed."""

    def __init__(self, data, **kwa):
        super().__init__(**kwa)
        self.data = data
        self.index = 0

    def recur(self, tyme):
        """Called each WebDoist cycle (every tock seconds)."""
        if self.index >= len(self.data):
            return True  # Done

        # Process one item
        process(self.data[self.index])
        self.index += 1

        return False  # Continue
```

**Key insight:** WebDoist handles yielding externally. Your Doer's `recur()` remains synchronous.

---

### ✅ Check `web_doist.done` After Execution

**Verify completion status:**

```python
web_doist = WebDoist(doers=[doer], tock=0.01, real=True, limit=10.0)
await web_doist.do()

if web_doist.done:
    log("✅ Completed successfully")
else:
    log("⚠️ Timeout or stopped early")
```

---

## Don't

### ❌ Never Use `time.sleep()` in Browser

```python
# ❌ WRONG: Freezes browser completely
import time
while processing:
    do_work()
    time.sleep(0.01)  # UI FROZEN

# ✅ CORRECT: Use asyncio.sleep
import asyncio
async def process():
    while processing:
        do_work()
        await asyncio.sleep(0.01)  # UI responsive
```

---

### ❌ Never Use Bare `Doist` in Browser

```python
# ❌ WRONG: Will block
from hio.base.doing import Doist
doist = Doist(doers=[doer], real=True)
doist.do()  # BLOCKS FOREVER

# ✅ CORRECT: Use WebDoist
from hio_bridge import WebDoist
web_doist = WebDoist(doers=[doer], real=True)
await web_doist.do()  # Yields properly
```

---

### ❌ Never Await in `Doer.recur()`

```python
# ❌ WRONG: recur() is synchronous
class BadDoer(Doer):
    async def recur(self, tyme):  # Can't be async!
        await asyncio.sleep(0.1)
        return True

# ✅ CORRECT: recur() is sync, yielding happens in WebDoist
class GoodDoer(Doer):
    def recur(self, tyme):  # Synchronous
        do_work()
        return self.done_flag
```

**Why:** HIO's `recur()` signature is synchronous. WebDoist calls it in a loop with `await asyncio.sleep()` between calls.

---

### ❌ Never Set `tock` Too Low (<0.001)

```python
# ❌ WRONG: Overhead dominates
web_doist = WebDoist(doers=[doer], tock=0.0001, real=True)
# Tests run 10x slower, minimal benefit

# ✅ CORRECT: Use reasonable minimum
web_doist = WebDoist(doers=[doer], tock=0.01, real=True)
# Good balance of responsiveness and speed
```

**Benchmark data (from KeriWasm):**

| tock   | Yield Frequency | Test Time (300 tests) | UI Feel         |
| ------ | --------------- | --------------------- | --------------- |
| 0.0001 | 10000 Hz        | 8 min                 | Smooth but slow |
| 0.001  | 1000 Hz         | 4 min                 | Smooth          |
| 0.01   | 100 Hz          | 90 sec                | ✅ Optimal      |
| 0.05   | 20 Hz           | 50 sec                | Slight jank     |
| 0.1    | 10 Hz           | 45 sec                | Noticeable lag  |

---

### ❌ Never Forget Timeout (`limit=`)

```python
# ❌ WRONG: Can run forever if bug in Doer
web_doist = WebDoist(doers=[doer], tock=0.01, real=True)
await web_doist.do()  # Could hang

# ✅ CORRECT: Always set reasonable timeout
web_doist = WebDoist(doers=[doer], tock=0.01, real=True, limit=60.0)
await web_doist.do()  # Max 60 seconds
```

---

### ❌ Never Block in Tight Loops

```python
# ❌ WRONG: No yielding in hot loop
for i in range(10000):
    expensive_operation()  # UI frozen for duration

# ✅ CORRECT: Yield periodically
for i in range(10000):
    expensive_operation()
    if i % 100 == 0:
        await asyncio.sleep(0)  # Yield every 100 iterations
```

---

## Testing Patterns

### ✅ Use `real=False` for Fast Tests

```python
# Test mode: Run as fast as possible (still yields)
async def test_doer_logic():
    doer = MyDoer(test_data)
    web_doist = WebDoist(doers=[doer], tock=0.0, real=False, limit=5.0)
    await web_doist.do()

    assert doer.results == expected
```

**Benefit:** Tests run 5-10x faster while still yielding (prevents browser timeout warnings).

---

### ✅ Mock WebDoist for Unit Tests

```python
# Unit test Doer without browser
def test_doer_recur():
    doer = MyDoer(data=[1, 2, 3])

    # Manually call recur() to test logic
    assert doer.recur(0.0) == False  # Not done
    assert doer.recur(0.0) == False
    assert doer.recur(0.0) == True   # Done

    assert doer.results == [processed(1), processed(2), processed(3)]
```

**Why:** Can test Doer logic without async complexity.

---

## Performance Optimization

### ✅ Batch Operations When Possible

```python
# ❌ SLOW: One operation per cycle
class SlowDoer(Doer):
    def recur(self, tyme):
        if self.index < len(self.items):
            process(self.items[self.index])
            self.index += 1
            return False
        return True

# ✅ FAST: Batch multiple operations per cycle
class FastDoer(Doer):
    def recur(self, tyme):
        batch_size = 10
        for _ in range(batch_size):
            if self.index >= len(self.items):
                return True
            process(self.items[self.index])
            self.index += 1
        return False
```

**Guideline:** Process 5-20 items per cycle (depending on work complexity).

---

### ✅ Measure and Tune

```python
import time

class ProfiledDoer(Doer):
    def recur(self, tyme):
        start = time.perf_counter()

        # Do work
        result = process_item()

        elapsed = time.perf_counter() - start
        if elapsed > 0.05:  # >50ms
            print(f"⚠️ Slow cycle: {elapsed*1000:.1f}ms")
            # Consider: batch smaller, or use Web Worker

        return result
```

---

## Web Worker Integration (Future)

**Deferred to Q2 — For heavy crypto operations:**

```python
# Future pattern (not yet implemented)
class WorkerCryptoDoer(Doer):
    """Offload Dilithium signing to Web Worker."""

    def recur(self, tyme):
        if not self.pending_request:
            # Send to worker (non-blocking)
            self.pending_request = worker.post_message({
                'op': 'dilithium_sign',
                'data': self.message
            })
        else:
            # Poll for result (Pattern 02: JS Bridge)
            result = check_worker_result()
            if result:
                self.signature = result
                return True
        return False
```

---

## Related Patterns

- **Pattern 01:** hio_bridge Annotated — WebDoist implementation details
- **Pattern 02:** JS Bridge Doer — Polling pattern for async JS calls
- **Pattern 03:** Generic Doer Queue — Batch processing architecture
- **ADR-017:** Browser Async Event Loop Integration — Strategic decision rationale
- **ADR-006:** HIO Concurrency Model — Original HIO design

---

## Troubleshooting

**Problem:** "Browser shows 'Page Unresponsive'"

- **Cause:** Not yielding frequently enough
- **Fix:** Decrease `tock` value or add manual `await asyncio.sleep(0)` calls

**Problem:** "Tests run too slowly"

- **Cause:** `tock` too low or `real=True` when not needed
- **Fix:** Use `real=False` for tests, increase `tock` to 0.05+

**Problem:** "`TypeError: object async_generator can't be used in 'await' expression`"

- **Cause:** Trying to `await` a generator instead of async function
- **Fix:** Ensure entry points are `async def`, not generators

**Problem:** "Doer never completes"

- **Cause:** `recur()` not returning `True` when done
- **Fix:** Add explicit `return True` when work complete

---

## Summary

**Golden Rules for Browser Python:**

1. **Always use WebDoist** — Never bare `Doist` in browser
2. **Never use `time.sleep()`** — Use `await asyncio.sleep()` instead
3. **Set appropriate `tock`** — 0.01-0.05 for most use cases
4. **Always set `limit=`** — Prevent infinite loops
5. **Yield in hot loops** — Don't block main thread
6. **Keep `recur()` synchronous** — WebDoist handles async

**Performance Target:** 100+ operations/sec with smooth 60 FPS UI (tock=0.01-0.02).
