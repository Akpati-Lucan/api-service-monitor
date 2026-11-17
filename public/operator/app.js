const view = document.querySelector("#view");
const statusLine = document.querySelector("#status");
const tokenInput = document.querySelector("#token");
tokenInput.value = sessionStorage.getItem("am_token") ?? "";
tokenInput.addEventListener("change", () => {
  sessionStorage.setItem("am_token", tokenInput.value.trim());
  render();
});

const KINDS = [
  "http", "http.flow", "tcp", "tls", "heartbeat", "dns", "domain",
  "postgres", "mysql", "mongodb", "redis", "s3", "elastic", "rabbitmq",
  "sqlite", "memcached", "etcd",
];

const FIELDS = {
  http: [["url", "URL", "url"]],
  "http.flow": [["steps", "Steps JSON", "textarea"]],
  tcp: [["host", "Host", "text"], ["port", "Port", "number"]],
  tls: [["host", "Host", "text"], ["port", "Port", "number"], ["warnDays", "Warn days", "number"], ["downDays", "Down days", "number"]],
  heartbeat: [["graceSeconds", "Grace seconds", "number"]],
  dns: [["name", "Name", "text"], ["type", "Type", "text"], ["expected", "Expected answer", "text"]],
  domain: [["domain", "Domain", "text"], ["warnDays", "Warn days", "number"], ["downDays", "Down days", "number"]],
  postgres: [["host", "Host", "text"], ["port", "Port", "number"], ["database", "Database", "text"], ["user", "User", "text"], ["ssl", "TLS", "text"]],
  mysql: [["host", "Host", "text"], ["port", "Port", "number"], ["user", "User", "text"], ["database", "Database", "text"], ["variant", "Variant", "text"]],
  mongodb: [["uri", "URI", "text"]],
  redis: [["host", "Host", "text"], ["port", "Port", "number"]],
  s3: [["endpoint", "Endpoint", "url"], ["region", "Region", "text"], ["bucket", "Bucket", "text"]],
  elastic: [["address", "Address", "url"], ["variant", "Variant", "text"]],
  rabbitmq: [["managementUrl", "Management URL", "url"], ["user", "User", "text"], ["host", "Host", "text"], ["port", "Port", "number"]],
  sqlite: [["path", "Path inside the probe root", "text"]],
  memcached: [["host", "Host", "text"], ["port", "Port", "number"]],
  etcd: [["url", "URL", "url"]],
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => undefined);
}

window.addEventListener("hashchange", render);
render();

async function render() {
  const route = location.hash.replace(/^#/, "") || "/monitors";
  statusLine.textContent = "";
  try {
    if (route === "/monitors") return paint(await monitorList());
    if (route === "/monitors/new") return paint(monitorForm());
    if (route.startsWith("/monitors/")) return paint(await monitorForm(route.slice("/monitors/".length)));
    if (route.startsWith("/incidents/")) return paint(await incidentPage(route.slice("/incidents/".length)));
    if (route === "/groups") return paint(await groupsPage());
    if (route === "/pages") return paint(await pagesPage());
    if (route === "/alerts") return paint(await alertsPage());
    if (route === "/maintenance") return paint(await maintenancePage());
    paint("<p>That page is not in the operator console.</p>");
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : "The request failed.";
  }
}

function paint(html) {
  view.innerHTML = html;
  view.querySelectorAll("form").forEach((form) => form.addEventListener("submit", onSubmit));
  const kind = view.querySelector("[name=kind]");
  if (kind) kind.addEventListener("change", () => swapFields(kind.value));
}

async function monitorList() {
  const [monitors, groups] = await Promise.all([api("/services"), api("/groups")]);
  const names = new Map(groups.map((group) => [group.id, group.name]));
  const rows = monitors.map((monitor) => `<article class="row row-${escapeHtml(monitor.status)}">
      <h3><span class="lamp lamp-${escapeHtml(monitor.status)}" aria-hidden="true"></span><a href="#/monitors/${escapeHtml(monitor.id)}">${escapeHtml(monitor.name)}</a></h3>
      <p>${escapeHtml(word(monitor.status))}</p>
      <p class="meta">${escapeHtml(monitor.kind)}</p>
      <p class="meta">${escapeHtml(names.get(monitor.groupId) ?? "No group")}</p>
      <p class="meta">${monitor.responseTimeMs == null ? "No latency yet" : `${escapeHtml(String(monitor.responseTimeMs))} ms`}</p>
      <p class="meta">${monitor.lastCheckedAt ? escapeHtml(monitor.lastCheckedAt) : "Not checked yet"}</p>
    </article>`).join("");
  return `<p><a href="#/monitors/new">New monitor</a></p>${rows || "<p class=\"note\">No monitors yet.</p>"}`;
}

function monitorForm(existing) {
  return existing ? loadMonitor(existing) : formHtml({ kind: "http" });
}

async function loadMonitor(id) {
  const monitor = await api(`/services/${id}`);
  return formHtml(monitor);
}

function formHtml(monitor) {
  const kind = monitor.kind ?? "http";
  const options = KINDS.map((item) => `<option value="${item}"${item === kind ? " selected" : ""}>${item}</option>`).join("");
  return `<h2>${monitor.id ? "Edit monitor" : "New monitor"}</h2>
    <form data-action="${monitor.id ? "save" : "create"}" data-id="${escapeHtml(monitor.id ?? "")}">
      <label>Name<input name="name" required value="${escapeHtml(monitor.name ?? "")}"></label>
      <label>Kind<select name="kind">${options}</select></label>
      <div id="kind-fields">${kindFields(kind, monitor.config ?? {}, monitor.url)}</div>
      <label>Secret reference<input name="secretRef" value="${escapeHtml(monitor.secretRef ?? "")}" pattern="[A-Z0-9_]*" autocomplete="off">
        <span class="note">The name of an environment variable. The password stays on the server and is never stored in the monitor.</span>
      </label>
      <label>Interval seconds<input name="intervalSeconds" type="number" value="${escapeHtml(String(monitor.intervalSeconds ?? 60))}"></label>
      <label>Timeout ms<input name="timeoutMs" type="number" value="${escapeHtml(String(monitor.timeoutMs ?? 5000))}"></label>
      <label>Failure threshold<input name="failureThreshold" type="number" value="${escapeHtml(String(monitor.failureThreshold ?? 3))}"></label>
      <label>Success threshold<input name="successThreshold" type="number" value="${escapeHtml(String(monitor.successThreshold ?? 1))}"></label>
      <button type="submit">${monitor.id ? "Save" : "Create"}</button>
    </form>`;
}

function kindFields(kind, config, url) {
  const fields = FIELDS[kind] ?? [];
  return fields.map(([name, label, type]) => {
    const value = name === "url" ? (url ?? config.url ?? "") : (config[name] ?? "");
    const shown = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    if (type === "textarea") {
      return `<label>${label}<textarea name="config.${name}">${escapeHtml(shown)}</textarea></label>`;
    }
    return `<label>${label}<input name="config.${name}" type="${type}" value="${escapeHtml(shown)}"></label>`;
  }).join("");
}

function swapFields(kind) {
  const box = document.querySelector("#kind-fields");
  if (box) box.innerHTML = kindFields(kind, {}, "");
}

async function incidentPage(id) {
  const incident = await api(`/incidents/${id}`);
  const checks = (incident.checks ?? []).map((check) => `<li>${escapeHtml(check.checkedAt)} ${escapeHtml(check.status)} ${escapeHtml(check.error ?? "")}</li>`).join("");
  const updates = (incident.updates ?? []).map((update) => `<li>${escapeHtml(update.createdAt)} ${escapeHtml(update.state)}: ${escapeHtml(update.message)}</li>`).join("");
  const notes = (incident.acknowledgements ?? []).map((note) => `<li>${escapeHtml(note.createdAt)} ${escapeHtml(note.actor)}: ${escapeHtml(note.note)}</li>`).join("");
  return `<h2>${escapeHtml(incident.serviceName ?? "Incident")}</h2>
    <p>${escapeHtml(incident.reason)}</p>
    <h2>Checks</h2>
    ${checks ? `<ul>${checks}</ul>` : "<p class=\"note\">No checks recorded.</p>"}
    <h2>Updates</h2>
    ${updates ? `<ul>${updates}</ul>` : "<p class=\"note\">No updates yet.</p>"}
    <form data-action="update" data-id="${escapeHtml(incident.id)}">
      <label>State<select name="state"><option>investigating</option><option>identified</option><option>monitoring</option><option>resolved</option></select></label>
      <label>Message<textarea name="message" required></textarea></label>
      <button type="submit">Add update</button>
    </form>
    <h2>Acknowledgements</h2>
    ${notes ? `<ul>${notes}</ul>` : "<p class=\"note\">No acknowledgements yet.</p>"}`;
}

async function groupsPage() {
  const groups = await api("/groups");
  const rows = groups.map((group) => `<article class="row"><h3>${escapeHtml(group.name)}</h3><p class="meta">${escapeHtml(group.slug)}</p></article>`).join("");
  return `${rows || "<p class=\"note\">No groups yet.</p>"}
    <h2>New group</h2>
    <form data-action="group"><label>Name<input name="name" required></label><button type="submit">Create group</button></form>`;
}

async function pagesPage() {
  const [pages, groups, monitors] = await Promise.all([api("/status-pages"), api("/groups"), api("/services")]);
  const rows = pages.map((page) => `<article class="row"><h3>${escapeHtml(page.title)}</h3><p class="meta">${escapeHtml(page.slug)}</p><p class="meta">${escapeHtml(page.visibility)}</p><p><a href="/status/${escapeHtml(page.slug)}">Open status page</a></p></article>`).join("");
  const groupOptions = groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join("");
  const monitorOptions = monitors.map((monitor) => `<option value="${escapeHtml(monitor.id)}">${escapeHtml(monitor.name)}</option>`).join("");
  return `${rows || "<p class=\"note\">No status pages yet.</p>"}
    <h2>New status page</h2>
    <form data-action="page">
      <label>Group<select name="groupId">${groupOptions}</select></label>
      <label>Title<input name="title" required></label>
      <label>Slug<input name="slug" required></label>
      <label>Visibility<select name="visibility"><option>public</option><option>private</option></select></label>
      <button type="submit">Create page</button>
    </form>
    <h2>Add a component</h2>
    <form data-action="component">
      <label>Page<select name="pageId">${pages.map((page) => `<option value="${escapeHtml(page.id)}">${escapeHtml(page.title)}</option>`).join("")}</select></label>
      <label>Monitor<select name="serviceId">${monitorOptions}</select></label>
      <label>Display name<input name="displayName" required></label>
      <button type="submit">Add component</button>
    </form>`;
}

async function alertsPage() {
  const routes = await api("/alert-routes");
  const rows = routes.map((route) => `<article class="row"><h3>${escapeHtml(route.kind)}</h3><p class="meta">${route.secretRef ? `Secret reference ${escapeHtml(route.secretRef)}` : "No secret reference"}</p></article>`).join("");
  return `${rows || "<p class=\"note\">No alert routes yet.</p>"}
    <h2>New alert route</h2>
    <form data-action="alert">
      <label>Kind<select name="kind"><option>log</option><option>webhook</option><option>slack</option><option>email</option></select></label>
      <label>Webhook URL<input name="url" type="url"></label>
      <label>Email recipients<input name="to" placeholder="one@example.com"></label>
      <label>Secret reference<input name="secretRef" pattern="[A-Z0-9_]*" autocomplete="off"></label>
      <button type="submit">Create route</button>
    </form>`;
}

async function maintenancePage() {
  const windows = await api("/maintenance-windows");
  const rows = windows.map((item) => `<article class="row"><h3>${escapeHtml(item.note || "Maintenance")}</h3><p class="meta">${escapeHtml(item.startsAt)} to ${escapeHtml(item.endsAt)}</p></article>`).join("");
  return `${rows || "<p class=\"note\">No maintenance windows.</p>"}
    <h2>New window</h2>
    <form data-action="maintenance">
      <label>Starts<input name="startsAt" type="datetime-local" required></label>
      <label>Ends<input name="endsAt" type="datetime-local" required></label>
      <label>Note<input name="note"></label>
      <button type="submit">Schedule</button>
    </form>`;
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  statusLine.textContent = "";
  try {
    const action = form.dataset.action;
    if (action === "create" || action === "save") {
      const body = readMonitor(data);
      if (action === "create") {
        const created = await api("/services", { method: "POST", body });
        location.hash = `#/monitors/${created.id}`;
      } else {
        await api(`/services/${form.dataset.id}`, { method: "PATCH", body });
        statusLine.textContent = "Saved.";
      }
      return;
    }
    if (action === "update") {
      await api(`/incidents/${form.dataset.id}/updates`, { method: "POST", body: { state: data.get("state"), message: data.get("message") } });
      render();
      return;
    }
    if (action === "group") {
      await api("/groups", { method: "POST", body: { name: data.get("name") } });
      render();
      return;
    }
    if (action === "page") {
      await api("/status-pages", { method: "POST", body: { groupId: data.get("groupId"), title: data.get("title"), slug: data.get("slug"), visibility: data.get("visibility") } });
      render();
      return;
    }
    if (action === "component") {
      await api(`/status-pages/${data.get("pageId")}/components`, { method: "POST", body: { serviceId: data.get("serviceId"), displayName: data.get("displayName") } });
      render();
      return;
    }
    if (action === "alert") {
      const kind = String(data.get("kind"));
      const config = {};
      if (kind === "webhook" && data.get("url")) config.url = data.get("url");
      if (kind === "email" && data.get("to")) config.to = String(data.get("to")).split(",").map((item) => item.trim()).filter(Boolean);
      await api("/alert-routes", { method: "POST", body: { kind, config, secretRef: data.get("secretRef") || null } });
      render();
      return;
    }
    if (action === "maintenance") {
      await api("/maintenance-windows", { method: "POST", body: { startsAt: new Date(data.get("startsAt")).toISOString(), endsAt: new Date(data.get("endsAt")).toISOString(), note: data.get("note") || null } });
      render();
    }
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : "The request failed.";
  }
}

function readMonitor(data) {
  const kind = String(data.get("kind"));
  const config = {};
  for (const [key, value] of data.entries()) {
    if (!String(key).startsWith("config.")) continue;
    const name = String(key).slice("config.".length);
    if (value === "") continue;
    if (name === "steps") config.steps = JSON.parse(String(value));
    else if (name === "port" || name === "warnDays" || name === "downDays" || name === "graceSeconds") config[name] = Number(value);
    else if (name === "url") continue;
    else config[name] = value;
  }
  const body = {
    name: data.get("name"),
    kind,
    intervalSeconds: Number(data.get("intervalSeconds")),
    timeoutMs: Number(data.get("timeoutMs")),
    failureThreshold: Number(data.get("failureThreshold")),
    successThreshold: Number(data.get("successThreshold")),
    config,
  };
  if (kind === "http") body.url = data.get("config.url");
  const secretRef = String(data.get("secretRef") ?? "");
  if (secretRef) body.secretRef = secretRef;
  return body;
}

async function api(path, options = {}) {
  const headers = { accept: "application/json" };
  const token = tokenInput.value.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (options.body) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method: options.method ?? "GET", headers, body });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

function word(status) {
  if (status === "UP") return "Up";
  if (status === "DEGRADED") return "Degraded";
  if (status === "DOWN") return "Down";
  return "Unknown";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}
