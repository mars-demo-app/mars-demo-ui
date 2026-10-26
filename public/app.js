const API_BASE = "/api";
const HOTPATH_EMAIL = "hotpath@example.com";
const statusEl = document.getElementById("status");
const ordersEl = document.getElementById("orders");

/** @type {{ id: string|number, customer_email: string, amount_cents: number, status: string }[]} */
let recentOrders = [];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.dataset.error = isError ? "true" : "false";
}

async function api(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body?.error || res.statusText || "Request failed");
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function refreshOrders() {
  const data = await api("/orders");
  recentOrders = data.orders || [];
  ordersEl.innerHTML = "";
  if (!recentOrders.length) {
    ordersEl.innerHTML = "<li>No orders yet.</li>";
    return;
  }
  for (const order of recentOrders) {
    const li = document.createElement("li");
    li.textContent = `#${order.id} · ${order.customer_email} · $${Number(order.amount_cents / 100).toFixed(2)} · ${order.status}`;
    ordersEl.appendChild(li);
  }
}

function summarizeSettled(results) {
  const ok = results.filter((r) => r.status === "fulfilled");
  const fail = results.filter((r) => r.status === "rejected");
  const times = ok
    .map((r) => r.value?.took_ms)
    .filter((n) => typeof n === "number")
    .sort((a, b) => a - b);
  const p50 = times.length ? times[Math.floor(times.length * 0.5)] : null;
  const p95 = times.length ? times[Math.floor(times.length * 0.95)] : null;
  const statuses = {};
  for (const r of fail) {
    const code = r.reason?.status || "err";
    statuses[code] = (statuses[code] || 0) + 1;
  }
  return { ok: ok.length, fail: fail.length, p50, p95, failStatuses: statuses };
}

document.getElementById("btn-health").addEventListener("click", async () => {
  try {
    const health = await api("/health");
    setStatus(`API healthy\n${JSON.stringify(health, null, 2)}`);
  } catch (err) {
    setStatus(`Health check failed: ${err.message}`, true);
  }
});

document.getElementById("btn-create").addEventListener("click", async () => {
  try {
    const email = `shopper-${Date.now()}@example.com`;
    const order = await api("/orders", {
      method: "POST",
      body: JSON.stringify({
        customer_email: email,
        amount_cents: 1999 + Math.floor(Math.random() * 5000),
      }),
    });
    setStatus(`Created order #${order.id} for ${email}`);
    await refreshOrders();
  } catch (err) {
    setStatus(`Create failed: ${err.message}`, true);
  }
});

document.getElementById("btn-cancel").addEventListener("click", async () => {
  try {
    await refreshOrders();
    const cancellable = recentOrders.find((o) => o.status !== "cancelled");
    if (!cancellable) {
      setStatus("No active orders to cancel. Create an order first.", true);
      return;
    }
    const result = await api("/orders/cancel", {
      method: "POST",
      body: JSON.stringify({ id: Number(cancellable.id) }),
    });
    const order = result.order || result;
    setStatus(
      result.already_cancelled
        ? `Order #${order.id} was already cancelled`
        : `Cancelled order #${order.id} (${order.customer_email})`
    );
    await refreshOrders();
  } catch (err) {
    const body = err.body || {};
    setStatus(
      `Cancel failed (HTTP ${err.status || "?"}): ${err.message}\n${JSON.stringify(body, null, 2)}`,
      true
    );
  }
});

document.getElementById("btn-lookup").addEventListener("click", async () => {
  try {
    const started = performance.now();
    const result = await api(`/orders/by-email?email=${encodeURIComponent(HOTPATH_EMAIL)}`);
    const ms = Math.round(performance.now() - started);
    setStatus(
      `Lookup for ${HOTPATH_EMAIL} completed in ${ms}ms (server took_ms=${result.took_ms})\n${JSON.stringify(result, null, 2)}`
    );
  } catch (err) {
    setStatus(`Lookup failed: ${err.message}`, true);
  }
});

document.getElementById("btn-seed").addEventListener("click", async () => {
  setStatus("Loading sample orders (~80k bulk + hotpath rows; may take a minute)…");
  try {
    const result = await api("/demo/seed-orders", {
      method: "POST",
      body: JSON.stringify({
        confirm: "seed",
        count: 80000,
        hotpath_extra: 200,
        hotpath_email: HOTPATH_EMAIL,
      }),
    });
    setStatus(`Load complete\n${JSON.stringify(result, null, 2)}`);
  } catch (err) {
    setStatus(`Load failed: ${err.message}`, true);
  }
});

document.getElementById("btn-hammer").addEventListener("click", async () => {
  setStatus(`Running 40 concurrent email lookups for ${HOTPATH_EMAIL}…`);
  const wall = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, async () => {
      const started = performance.now();
      const body = await api(`/orders/by-email?email=${encodeURIComponent(HOTPATH_EMAIL)}`);
      return { took_ms: body.took_ms ?? Math.round(performance.now() - started), body };
    })
  );
  const summary = summarizeSettled(results);
  const wallMs = Math.round(performance.now() - wall);
  setStatus(
    `Email lookup burst finished in ${wallMs}ms wall\n` +
      `ok=${summary.ok} fail=${summary.fail} p50_server_ms=${summary.p50} p95_server_ms=${summary.p95}\n` +
      `failStatuses=${JSON.stringify(summary.failStatuses)}`
  );
});

document.getElementById("btn-stress").addEventListener("click", async () => {
  setStatus("API load test: 40 concurrent creates…");
  const wall = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, (_, i) =>
      api("/orders", {
        method: "POST",
        body: JSON.stringify({
          customer_email: `load-${Date.now()}-${i}@example.com`,
          amount_cents: 500 + i * 10,
        }),
      }).then((body) => ({ took_ms: null, body }))
    )
  );
  const summary = summarizeSettled(results);
  const wallMs = Math.round(performance.now() - wall);
  let healthNote = "";
  try {
    const health = await api("/health");
    healthNote = `\nruntime: ${JSON.stringify(health.demo || {})}`;
  } catch {
    /* ignore */
  }
  setStatus(
    `API load test finished in ${wallMs}ms wall\n` +
      `ok=${summary.ok} fail=${summary.fail} failStatuses=${JSON.stringify(summary.failStatuses)}` +
      healthNote
  );
  try {
    await refreshOrders();
  } catch {
    /* ignore refresh errors after stress */
  }
});

document.getElementById("btn-burn-cpu").addEventListener("click", async () => {
  const btn = document.getElementById("btn-burn-cpu");
  btn.disabled = true;
  setStatus("Starting CPU intensive action…");
  try {
    const result = await api("/demo/burn-cpu", {
      method: "POST",
      body: JSON.stringify({ duration_ms: 90000, duty_cycle: 0.95, slice_ms: 20 }),
    });
    setStatus(
      `CPU intensive action accepted\n` +
        `${JSON.stringify(result, null, 2)}`
    );
    setTimeout(() => {
      btn.disabled = false;
    }, (Number(result.duration_ms) || 90000) + 500);
  } catch (err) {
    btn.disabled = false;
    setStatus(`CPU intensive action failed: ${err.message}`, true);
  }
});

const btnBurnMem = document.getElementById("btn-burn-mem");
const btnBurnCpu = document.getElementById("btn-burn-cpu");

async function refreshBurnButtonState() {
  try {
    const health = await api("/health");
    const d = health.demo || {};
    btnBurnMem.disabled = !!d.mem_burns_active;
    btnBurnCpu.disabled = !!d.cpu_burns_active;
    btnBurnMem.title = d.mem_burns_active
      ? "Memory intensive action already active — wait for it to finish"
      : "Run memory intensive action";
  } catch {
    /* ignore */
  }
}

btnBurnMem.addEventListener("click", async () => {
  btnBurnMem.disabled = true;
  setStatus("Starting memory intensive action…");
  try {
    const result = await api("/demo/burn-memory", {
      method: "POST",
      body: JSON.stringify({ target_pct: 0.95, hold_ms: 60000 }),
    });
    setStatus(
      `Memory intensive action accepted\n` +
        `rss ${result.rss_mb_before} → ${result.rss_mb_after_alloc} MB (allocated ~${result.allocated_mb}MB), hold ${result.hold_ms}ms\n` +
        `${JSON.stringify(result, null, 2)}`
    );
    setTimeout(refreshBurnButtonState, (Number(result.hold_ms) || 60000) + 500);
  } catch (err) {
    setStatus(
      `Memory intensive action failed: ${err.message}${err.body ? "\n" + JSON.stringify(err.body, null, 2) : ""}`,
      true
    );
    refreshBurnButtonState();
  }
});

refreshOrders().catch((err) => setStatus(`Initial load failed: ${err.message}`, true));
refreshBurnButtonState();

document.getElementById("btn-compute").addEventListener("click", async () => {
  const btn = document.getElementById("btn-compute");
  btn.disabled = true;
  setStatus("Running computeAction…");
  try {
    const result = await api("/demo/compute-action", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStatus(
      `computeAction accepted\n` + JSON.stringify(result, null, 2) +
        `\n(API may briefly become unavailable while the instance restarts.)`
    );
  } catch (err) {
    setStatus(`computeAction failed: ${err.message}`, true);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
    }, 3000);
  }
});
