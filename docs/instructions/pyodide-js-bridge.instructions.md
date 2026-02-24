---
applyTo: "libs/keriwasm/**/*.py"
---

# Pyodide JS Bridge Patterns — Python ↔ JavaScript Async Coordination

**Authority:** Pattern 02 (JS Bridge Doer Pattern)
**Reference:** ADR-017 (Browser Async Event Loop Integration)
**Applies To:** All Python code that calls JavaScript async functions from Pyodide

---

## 🚨 CRITICAL MANDATE

**NEVER await JavaScript Promises directly in `Doer.recur()` — Use polling pattern.**

JavaScript async functions return Promises. Python's `await` on Promises requires async context, but HIO's `recur()` is synchronous. Use the state machine polling pattern instead.

---

## Do

### ✅ Use JSBridgeDoer Polling Pattern

**Base pattern for all JavaScript async calls:**

```python
from hio.base.doing import Doer
import uuid

class JSBridgeDoer(Doer):
    """Poll JavaScript async operations from synchronous recur()."""

    def __init__(self, **kwa):
        super().__init__(**kwa)
        self.pending_id = None
        self.results_map_name = "js_results"  # JavaScript Map name

    def _send_request(self, operation, data):
        """Send async request to JavaScript."""
        import js
        req_id = str(uuid.uuid4())

        # Call JavaScript function
        js_function = getattr(js, operation)
        js_function(req_id, data)

        return req_id

    def _check_result(self):
        """Poll for result from JavaScript."""
        import js

        if not self.pending_id:
            return None

        results_map = getattr(js, self.results_map_name)

        if results_map.has(self.pending_id):
            res = results_map.get(self.pending_id)
            py_res = res.to_py()  # Convert JS object to Python dict
            results_map.delete(self.pending_id)  # Cleanup
            self.pending_id = None
            return py_res

        return None  # Not ready yet

    def recur(self, tyme):
        """Poll pattern: send once, check until ready."""
        # Send request
        if not self.pending_id:
            self.pending_id = self._send_request('my_js_function', {'data': 'value'})

        # Poll result
        elif self.pending_id:
            result = self._check_result()
            if result:
                if 'error' in result:
                    raise RuntimeError(f"JS error: {result['error']}")
                self.result = result['output']
                return True  # Done

        return False  # Continue polling
```

---

### ✅ Use UUID Request IDs

**Always generate unique IDs for concurrent requests:**

```python
import uuid

req_id = str(uuid.uuid4())  # e.g., "550e8400-e29b-41d4-a716-446655440000"
```

**Why:** Multiple Doers may send requests concurrently. UUIDs prevent collisions.

---

### ✅ Store Results in JavaScript Map

**JavaScript side contract:**

```javascript
// Create global results Map
const my_results = new Map();

async function my_js_function(reqId, data) {
  try {
    // Do async work
    const result = await fetch(data.url);
    const json = await result.json();

    // Store result for Python to poll
    my_results.set(reqId, { output: json });
  } catch (error) {
    // Store error
    my_results.set(reqId, { error: error.message });
  }
}

// Expose to Pyodide
globalThis.my_js_function = my_js_function;
globalThis.my_results = my_results;
```

**Why:** `Map` provides efficient O(1) lookup by request ID.

---

### ✅ Convert JS Objects to Python Dicts

**Always call `.to_py()` on JavaScript objects:**

```python
import js

# ❌ WRONG: JavaScript proxy object
result_js = js.my_results.get(req_id)
print(result_js.output)  # May not work as expected

# ✅ CORRECT: Convert to Python dict
result_js = js.my_results.get(req_id)
result_py = result_js.to_py()  # Now a Python dict
print(result_py['output'])  # Works correctly
```

**Why:** JavaScript objects in Python are `JsProxy` objects. `.to_py()` converts them to native Python types.

---

### ✅ Clean Up Results After Processing

**Always delete processed results from Map:**

```python
def _check_result(self):
    results_map = js.my_results

    if results_map.has(self.pending_id):
        res = results_map.get(self.pending_id)
        py_res = res.to_py()

        # ✅ CRITICAL: Cleanup to prevent memory leak
        results_map.delete(self.pending_id)

        self.pending_id = None
        return py_res

    return None
```

**Why:** Without cleanup, Map grows indefinitely, causing memory leaks.

---

### ✅ Handle JavaScript Errors

**JavaScript should store errors as dicts:**

```javascript
// JavaScript side
async function my_function(reqId, data) {
  try {
    const result = await doWork(data);
    my_results.set(reqId, { output: result });
  } catch (error) {
    // Store error object
    my_results.set(reqId, { error: error.message });
  }
}
```

**Python side checks for errors:**

```python
def recur(self, tyme):
    if self.pending_id:
        result = self._check_result()
        if result:
            # ✅ CORRECT: Check for error first
            if 'error' in result:
                raise RuntimeError(f"JS operation failed: {result['error']}")

            self.output = result['output']
            return True

    return False
```

---

### ✅ Use State Machine for Multi-Step Operations

**Example: Hash → Sign → Verify sequence:**

```python
class CryptoDoer(Doer):
    """Multi-step crypto operation via JS bridge."""

    def __init__(self, message, **kwa):
        super().__init__(**kwa)
        self.message = message
        self.step = 'hash'  # State: hash, sign, verify, done
        self.pending_id = None
        self.results = {'hash': None, 'signature': None, 'verified': None}

    def recur(self, tyme):
        # State: hash (send)
        if self.step == 'hash' and not self.pending_id:
            self.pending_id = self._send_request('hash_message', {'msg': self.message})

        # State: hash (poll)
        elif self.step == 'hash' and self.pending_id:
            result = self._check_result()
            if result:
                self.results['hash'] = result['hash']
                self.step = 'sign'  # Transition

        # State: sign (send)
        elif self.step == 'sign' and not self.pending_id:
            self.pending_id = self._send_request('sign_hash', {'hash': self.results['hash']})

        # State: sign (poll)
        elif self.step == 'sign' and self.pending_id:
            result = self._check_result()
            if result:
                self.results['signature'] = result['signature']
                self.step = 'verify'  # Transition

        # ... continue for verify step

        return self.step == 'done'
```

---

## Don't

### ❌ Never Await Promises in recur()

```python
# ❌ WRONG: Can't await in synchronous recur()
class BadDoer(Doer):
    def recur(self, tyme):
        import js
        promise = js.fetch("https://api.example.com/data")
        result = await promise  # SyntaxError!
        return True

# ✅ CORRECT: Use polling pattern
class GoodDoer(JSBridgeDoer):
    def recur(self, tyme):
        if not self.pending_id:
            self.pending_id = self._send_request('fetch_data', {'url': 'https://...'})
        elif self.pending_id:
            result = self._check_result()
            if result:
                self.data = result['data']
                return True
        return False
```

---

### ❌ Never Reuse Request IDs

```python
# ❌ WRONG: Hard-coded ID causes race conditions
req_id = "my-request"  # Multiple calls will collide

# ✅ CORRECT: Generate unique ID each time
import uuid
req_id = str(uuid.uuid4())
```

---

### ❌ Never Forget to Check for Errors

```python
# ❌ WRONG: Assumes success
result = self._check_result()
if result:
    self.output = result['output']  # KeyError if error occurred!

# ✅ CORRECT: Check error first
result = self._check_result()
if result:
    if 'error' in result:
        raise RuntimeError(result['error'])
    self.output = result['output']
```

---

### ❌ Never Leave Results in Map

```python
# ❌ WRONG: Memory leak
if results_map.has(self.pending_id):
    res = results_map.get(self.pending_id)
    # Forgot to delete!
    return res.to_py()

# ✅ CORRECT: Always cleanup
if results_map.has(self.pending_id):
    res = results_map.get(self.pending_id)
    py_res = res.to_py()
    results_map.delete(self.pending_id)  # Cleanup
    return py_res
```

---

### ❌ Never Send Request Every Cycle

```python
# ❌ WRONG: Sends duplicate requests
def recur(self, tyme):
    # BUG: No check for pending_id
    self.pending_id = self._send_request(...)  # Duplicate requests!
    result = self._check_result()
    ...

# ✅ CORRECT: Send only once
def recur(self, tyme):
    if not self.pending_id:  # Check first
        self.pending_id = self._send_request(...)
    elif self.pending_id:
        result = self._check_result()
        ...
```

---

## Common Use Cases

### ✅ IndexedDB Operations

```python
class IndexedDBDoer(JSBridgeDoer):
    """Store/retrieve from browser IndexedDB."""

    def __init__(self, operation, key, value=None, **kwa):
        super().__init__(**kwa)
        self.operation = operation  # 'get', 'put', 'delete'
        self.key = key
        self.value = value
        self.result = None
        self.results_map_name = "idb_results"

    def recur(self, tyme):
        if not self.pending_id:
            if self.operation == 'put':
                self.pending_id = self._send_request('idb_put', {
                    'key': self.key,
                    'value': self.value
                })
            elif self.operation == 'get':
                self.pending_id = self._send_request('idb_get', {
                    'key': self.key
                })

        elif self.pending_id:
            result = self._check_result()
            if result:
                if 'error' in result:
                    raise RuntimeError(f"IndexedDB error: {result['error']}")
                self.result = result.get('value')
                return True

        return False
```

**JavaScript side:**

```javascript
const idb_results = new Map();

async function idb_put(reqId, data) {
  try {
    const db = await openDB("keri-wallet");
    await db.put("store", data.value, data.key);
    idb_results.set(reqId, { success: true });
  } catch (error) {
    idb_results.set(reqId, { error: error.message });
  }
}

globalThis.idb_put = idb_put;
globalThis.idb_results = idb_results;
```

---

### ✅ Fetch API Calls

```python
class FetchDoer(JSBridgeDoer):
    """Make HTTP requests via browser Fetch API."""

    def __init__(self, url, method='GET', body=None, **kwa):
        super().__init__(**kwa)
        self.url = url
        self.method = method
        self.body = body
        self.response = None
        self.results_map_name = "fetch_results"

    def recur(self, tyme):
        if not self.pending_id:
            self.pending_id = self._send_request('fetch_call', {
                'url': self.url,
                'method': self.method,
                'body': self.body
            })

        elif self.pending_id:
            result = self._check_result()
            if result:
                if result.get('status') != 200:
                    raise RuntimeError(f"HTTP {result['status']}")
                self.response = result['text']
                return True

        return False
```

---

### ✅ Crypto Operations

```python
class LibsodiumDoer(JSBridgeDoer):
    """Call libsodium via pychloride."""

    def __init__(self, operation, data, **kwa):
        super().__init__(**kwa)
        self.operation = operation
        self.data = data
        self.result = None
        self.results_map_name = "sodium_results"

    def recur(self, tyme):
        if not self.pending_id:
            self.pending_id = self._send_request('sodium_call', {
                'op': self.operation,
                'data': self.data
            })

        elif self.pending_id:
            result = self._check_result()
            if result:
                if 'error' in result:
                    raise RuntimeError(f"Crypto error: {result['error']}")
                self.result = result['output']
                return True

        return False
```

---

## Performance Characteristics

**Latency per operation:**

| Operation      | JS Time | Polling Overhead            | Total  |
| -------------- | ------- | --------------------------- | ------ |
| IndexedDB get  | ~1ms    | ~10ms (1 cycle @ tock=0.01) | ~11ms  |
| IndexedDB put  | ~5ms    | ~10ms                       | ~15ms  |
| Fetch (local)  | ~50ms   | ~10ms                       | ~60ms  |
| Ed25519 sign   | ~0.1ms  | ~10ms                       | ~10ms  |
| Dilithium sign | ~100ms  | ~20ms (2 cycles)            | ~120ms |

**Overhead:** ~10ms per operation from polling (acceptable for UI operations).

---

## Testing Patterns

### ✅ Mock JavaScript Functions

```python
async def test_js_bridge():
    """Test with mock JavaScript."""
    import js

    # Setup mock
    js.mock_results = js.Map.new()

    def mock_js_call(req_id, data):
        js.setTimeout(
            lambda: js.mock_results.set(req_id, {"result": data["input"] * 2}),
            5  # 5ms delay
        )

    js.mock_call = mock_js_call

    # Test Doer
    class TestDoer(JSBridgeDoer):
        def __init__(self, **kwa):
            super().__init__(**kwa)
            self.results_map_name = "mock_results"
            self.output = None

        def recur(self, tyme):
            if not self.pending_id:
                self.pending_id = self._send_request('mock_call', {"input": 21})
            elif self.pending_id:
                result = self._check_result()
                if result:
                    self.output = result['result']
                    return True
            return False

    # Run test
    from hio_bridge import WebDoist
    doer = TestDoer(tock=0.01)
    web_doist = WebDoist(doers=[doer], tock=0.01, real=True, limit=1.0)
    await web_doist.do()

    assert doer.output == 42
```

---

## Related Patterns

- **Pattern 01:** hio_bridge — WebDoist scheduling
- **Pattern 02:** JS Bridge Doer — Complete pattern documentation
- **Pattern 03:** Generic Doer Queue — Batch JS operations
- **ADR-017:** Browser Async Event Loop Integration
- **pyodide-event-loop.instructions.md:** Event loop yielding patterns

---

## Summary

**Golden Rules for JS Bridge:**

1. **Use JSBridgeDoer pattern** — Never await Promises in recur()
2. **Generate UUID request IDs** — Prevent collisions
3. **Store results in JS Map** — Efficient polling
4. **Always call `.to_py()`** — Convert JS objects to Python
5. **Clean up results** — Prevent memory leaks
6. **Check for errors first** — Handle JS exceptions gracefully
7. **Use state machines** — Multi-step operations

**Performance Target:** ~10ms overhead per operation (acceptable for UI).
