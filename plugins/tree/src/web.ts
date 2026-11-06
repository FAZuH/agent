const CSS = `
:root {
  --bg: #0b0b0d;
  --panel: #111114;
  --panel-2: #18181c;
  --border: #26262c;
  --text: #e4e4e7;
  --muted: #9b9ba4;
  --root: #475569;
  --subagent: #3b82f6;
  --fork: #8b5cf6;
  --user: #d4d4d8;
  --ellipsis: #52525b;
  --busy: #22c55e;
  --failed: #ef4444;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
header {
  display: flex;
  align-items: center;
  gap: 8px 12px;
  flex-wrap: nowrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  overflow-x: auto;
  scrollbar-width: none;
}
header::-webkit-scrollbar { display: none; }
.spacer { flex: 1 1 0; min-width: 0; }
label.control { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); white-space: nowrap; flex: 0 0 auto; }
select, button {
  font: inherit;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
}
select { flex: 0 1 auto; min-width: 0; }
#roots { max-width: min(22vw, 300px); }
#labels { padding: 4px 4px; }
button { cursor: pointer; white-space: nowrap; flex: 0 0 auto; }
button:hover, select:hover { border-color: #3a3a44; }
button:active { transform: translateY(1px); }
.icon { width: 26px; padding: 4px 0; text-align: center; font-weight: 600; }
.counts { color: var(--muted); white-space: nowrap; }
.counts b { color: var(--text); font-weight: 600; }
.links { color: var(--muted); white-space: nowrap; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; flex: 0 0 auto; }
main { position: relative; flex: 1; min-height: 0; }
#cy { position: absolute; inset: 0; }
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--muted);
}
.legend {
  position: absolute;
  left: 14px;
  bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  align-items: center;
  max-width: min(70vw, 620px);
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--muted);
  pointer-events: none;
}
.legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; border: 2px solid transparent; }
.dot.root { background: var(--root); }
.dot.subagent { background: var(--subagent); }
.dot.fork { background: var(--fork); border-style: dashed; border-color: #c4b5fd; }
.dot.user { background: var(--user); }
.dot.assistant { background: var(--subagent); }
.dot.ellipsis { background: var(--ellipsis); width: 6px; height: 6px; }
.dot.busy { background: transparent; border-color: var(--busy); }
.dot.failed { background: transparent; border-color: var(--failed); }
.line { width: 22px; height: 0; border-top: 2px solid var(--muted); display: inline-block; }
.line.flow { border-top-width: 1px; border-color: #3f3f46; }
.line.fork { border-top-style: dashed; border-top-width: 1px; border-color: var(--fork); }
.line.spawn { border-top-style: dotted; border-top-width: 1px; border-color: var(--subagent); }
.line.merge { border-top-width: 2px; border-color: var(--subagent); }
.tooltip {
  position: absolute;
  z-index: 5;
  max-width: 340px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
  pointer-events: none;
}
.tooltip .tt-title { font-weight: 600; margin-bottom: 2px; }
.tooltip .tt-id { color: var(--muted); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; margin-bottom: 6px; }
.tooltip dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.tooltip dt { color: var(--muted); }
.tooltip dd { margin: 0; overflow-wrap: anywhere; }
.dialog-backdrop { position: absolute; inset: 0; z-index: 6; background: rgba(0, 0, 0, .35); }
.dialog {
  position: absolute;
  z-index: 7;
  width: min(380px, 92vw);
  max-height: min(70vh, 560px);
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: 0 14px 36px rgba(0, 0, 0, .55);
}
.dialog .dlg-head { display: flex; align-items: flex-start; gap: 8px; }
.dialog .tt-title { font-weight: 600; flex: 1; overflow-wrap: anywhere; }
.dialog .dlg-close { padding: 2px 8px; }
.dialog .tt-id { color: var(--muted); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; margin: 2px 0 8px; overflow-wrap: anywhere; }
.dialog dl { margin: 0 0 8px; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.dialog dt { color: var(--muted); }
.dialog dd { margin: 0; overflow-wrap: anywhere; }
.dialog .dlg-msg { border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; margin: 0 0 8px; }
.dialog .dlg-msg p { margin: 4px 0 0; overflow-wrap: anywhere; }
.dialog .dlg-recent { margin: 0 0 8px; padding-left: 18px; }
.dialog .dlg-recent li { margin: 2px 0; overflow-wrap: anywhere; }
.dialog .dlg-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dialog .dlg-open { color: var(--text); background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px; text-decoration: none; }
.dialog .dlg-open:hover { border-color: #3a3a44; }
.dialog .dlg-group-link { color: var(--muted); font-size: 12px; }
.error {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 10px;
  border: 1px solid var(--failed);
  border-radius: 6px;
  background: #2a1214;
  color: #fecaca;
  max-width: 80vw;
}
[hidden] { display: none !important; }
`

const SCRIPT = `
const WEB_BASE = __WEB_BASE__;
const LIMIT = __LIMIT__;
const REFRESH_MS = 3000;
const ROW_H = 26;
const WHEEL_SPEED = 1.5;

const el = (id) => document.getElementById(id);
const rootsEl = el("roots");
const countsEl = el("counts");
const linksEl = el("links");
const labelsEl = el("labels");
const liveEl = el("live");
const emptyEl = el("empty");
const errorEl = el("error");
const tipEl = el("tooltip");
const dialogEl = el("dialog");
const dialogBackdrop = el("dialog-backdrop");

let selected = new URLSearchParams(location.search).get("session") || "";
let baseOverride = new URLSearchParams(location.search).get("base") || "";
let maxOverride = new URLSearchParams(location.search).get("max") || "";
let expanded = new Set(new URLSearchParams(location.search).getAll("expand").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean));
let webBase = WEB_BASE;
let labelMode = "auto";
let labelFrame = 0;
let cy = null;
let pulses = new Set();
let pulseOn = false;
let shape = "";
let lastFocus = "";
let rootsKey = "";
let first = true;
let inFlight = false;
let timer = 0;
let currentGraph = null;
let dialogNodeId = "";

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function rel(ms) {
  if (!ms) return "never";
  const delta = Date.now() - ms;
  if (delta < 0) return "now";
  const s = Math.floor(delta / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

function laneOf(nodesByLane, id) {
  return nodesByLane.get(id) || null;
}

function linkFor(id) {
  return webBase.replace(/\\/+$/, "") + "/session/" + encodeURIComponent(id);
}

function showLinks(data) {
  if (data.webBase) webBase = data.webBase;
  if (!linksEl) return;
  let host = webBase;
  try { host = new URL(webBase).host || webBase; } catch (error) { host = webBase; }
  linksEl.textContent = "links: " + host;
  linksEl.title = data.configuredBase || webBase;
}

function showLinksFields(graph) {
  if (!graph) return;
  const lanes = graph.lanes || [];
  if (graph.webBase) webBase = graph.webBase;
  if (!linksEl) return;
  let host = webBase;
  try { host = new URL(webBase).host || webBase; } catch (error) { host = webBase; }
  linksEl.textContent = "links: " + host;
  linksEl.title = graph.configuredBase || webBase;
}

function syncRoots(roots) {
  const key = roots.map((r) => r.id).join("|");
  if (key !== rootsKey) {
    rootsKey = key;
    rootsEl.replaceChildren();
    for (const root of roots) {
      const option = document.createElement("option");
      option.value = root.id;
      option.textContent = (root.title || "(untitled)") + " — " + rel(root.updated);
      rootsEl.appendChild(option);
    }
  }
  if (focusValue() && rootsEl.value !== focusValue()) rootsEl.value = focusValue();
}

function focusValue() {
  return document.body.dataset.focus || "";
}

function showTip(node, position) {
  const data = node.data();
  const fields = data.tooltipFields || {};
  const title = data.label || data.id;
  const idLine = data.role === "header" ? data.lane : (data.id.split("#m")[1] || data.id);
  const rows = Object.keys(fields).map((key) => [key, fields[key]]);
  tipEl.innerHTML = '<div class="tt-title">' + esc(title) + "</div>"
    + '<div class="tt-id">' + esc(idLine) + "</div>"
    + "<dl>" + rows.map((row) => "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>").join("") + "</dl>";
  tipEl.hidden = false;
  const box = el("cy").getBoundingClientRect();
  const x = Math.min(position.x + 16, box.width - tipEl.offsetWidth - 8);
  const y = Math.min(position.y + 16, box.height - tipEl.offsetHeight - 8);
  tipEl.style.left = Math.max(8, x) + "px";
  tipEl.style.top = Math.max(8, y) + "px";
}

function hideTip() {
  tipEl.hidden = true;
}

function dialogRows(fields) {
  return Object.keys(fields).map((key) => "<dt>" + esc(key) + "</dt><dd>" + esc(fields[key]) + "</dd>").join("");
}

function showDialog(nodeData, position) {
  if (!currentGraph) return;
  const lane = lanesById[nodeData.lane] || {};
  const laneNodes = (currentGraph.nodes || []).filter((n) => n.lane === nodeData.lane);
  const header = laneNodes.find((n) => n.role === "header") || nodeData;
  const headerFields = header.tooltipFields || {};
  const title = header.label || lane.title || header.id;
  const idLine = nodeData.lane || nodeData.id;
  const isGroup = !!lane.group;
  const isMessage = nodeData.role === "user" || nodeData.role === "assistant";
  const msgFields = nodeData.tooltipFields || {};
  const lastFive = laneNodes
    .filter((n) => n.role === "user" || n.role === "assistant")
    .slice()
    .sort((a, b) => a.y - b.y)
    .slice(-5);
  const recent = lastFive.length
    ? '<div class="tt-title">Last messages</div><ol class="dlg-recent">'
      + lastFive.map((n) => "<li><b>" + esc((n.tooltipFields || {}).role || n.role) + "</b> "
        + esc((n.tooltipFields || {}).preview || n.label || "") + "</li>").join("")
      + "</ol>"
    : "";
  const messageBox = isMessage
    ? '<div class="dlg-msg"><div class="tt-title">Message</div><dl>'
      + "<dt>role</dt><dd>" + esc(msgFields.role || nodeData.role) + "</dd>"
      + "<dt>index</dt><dd>" + esc(msgFields.message || "") + "</dd>"
      + "<dt>preview</dt><dd>" + esc(msgFields.preview || nodeData.label || "") + "</dd>"
      + (msgFields.time ? "<dt>time</dt><dd>" + esc(msgFields.time) + "</dd>" : "")
      + "</dl></div>"
    : "";
  let actions;
  if (isGroup) {
    const firstMember = (lane.group.members || [])[0];
    const showHref = firstMember ? linkFor(firstMember) : (lane.linked || "");
    const isExpanded = expanded.has(lane.group.agent);
    actions = '<div class="dlg-actions">'
      + '<button type="button" id="dialog-toggle">' + (isExpanded ? "Collapse" : "Expand") + "</button>"
      + (showHref ? '<a class="dlg-group-link" href="' + esc(showHref) + '" target="_blank" rel="noopener">show in OpenCode</a>' : "")
      + "</div>";
  } else {
    const href = lane.linked || (nodeData.lane ? linkFor(nodeData.lane) : "");
    actions = '<div class="dlg-actions">'
      + (href ? '<a class="dlg-open" href="' + esc(href) + '" target="_blank" rel="noopener">Open in OpenCode</a>' : "")
      + "</div>";
  }
  dialogNodeId = nodeData.id;
  dialogEl.innerHTML = '<div class="dlg-head"><div class="tt-title">' + esc(title) + "</div>"
    + '<button type="button" class="dlg-close" id="dialog-close" aria-label="Close">×</button></div>'
    + '<div class="tt-id">' + esc(idLine) + "</div>"
    + "<dl>" + dialogRows(headerFields) + "</dl>"
    + messageBox + recent + actions;
  dialogEl.hidden = false;
  dialogBackdrop.hidden = false;
  const box = el("cy").getBoundingClientRect();
  const width = dialogEl.offsetWidth || 380;
  const height = dialogEl.offsetHeight || 200;
  const x = Math.min(position.x + 16, Math.max(8, box.width - width - 8));
  const y = Math.min(position.y + 16, Math.max(8, box.height - height - 8));
  dialogEl.style.left = Math.max(8, x) + "px";
  dialogEl.style.top = Math.max(8, y) + "px";
  el("dialog-close").addEventListener("click", hideDialog);
  const toggle = el("dialog-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      if (expanded.has(lane.group.agent)) expanded.delete(lane.group.agent);
      else expanded.add(lane.group.agent);
      hideDialog();
      tick();
    });
  }
  hideTip();
}

function hideDialog() {
  dialogEl.hidden = true;
  dialogBackdrop.hidden = true;
  dialogNodeId = "";
}

function labelWanted(node) {
  const data = node.data();
  if (data.hover === 1 || data.selected === 1 || data.focus === "1") return true;
  if (data.group === "1" && labelMode !== "off") return true;
  if (labelMode === "on") return true;
  if (labelMode === "off") return false;
  return cy.nodes().length <= 60 && cy.zoom() >= 0.75;
}

function applyLabels() {
  if (!cy) return;
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const wanted = labelWanted(node);
      if (wanted !== node.hasClass("lbl")) {
        if (wanted) node.addClass("lbl");
        else node.removeClass("lbl");
      }
    });
  });
}

function scheduleLabels() {
  if (labelFrame) return;
  labelFrame = requestAnimationFrame(() => {
    labelFrame = 0;
    applyLabels();
  });
}

function pulseStep() {
  if (!cy) return;
  pulseOn = !pulseOn;
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      if (!pulses.has(node.id())) return;
      if (pulseOn) node.addClass("pulse");
      else node.removeClass("pulse");
    });
  });
}

let zoomTarget = null;
let zoomAnchor = { x: 0, y: 0 };
let zoomRaf = 0;

function zoomStep() {
  zoomRaf = 0;
  if (zoomTarget == null || !cy) return;
  const z = cy.zoom();
  const next = z + (zoomTarget - z) * 0.22;
  if (Math.abs(zoomTarget - next) < 0.002) {
    cy.zoom({ level: zoomTarget, renderedPosition: zoomAnchor });
    zoomTarget = null;
  } else {
    cy.zoom({ level: next, renderedPosition: zoomAnchor });
    zoomRaf = requestAnimationFrame(zoomStep);
  }
}

function zoomTo(level, anchor) {
  if (!cy) return;
  const clamped = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), level));
  zoomTarget = clamped;
  if (anchor) zoomAnchor = anchor;
  if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
}

function zoomBy(factor, anchor) {
  if (!cy) return;
  const base = zoomTarget != null ? zoomTarget : cy.zoom();
  zoomTo(base * factor, anchor);
}

function wheelhandler(event) {
  if (!cy) return;
  event.preventDefault();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  else if (event.stopPropagation) event.stopPropagation();
  const box = el("cy").getBoundingClientRect();
  zoomBy(Math.exp(-event.deltaY * 0.001 * WHEEL_SPEED), {
    x: event.clientX - box.left,
    y: event.clientY - box.top,
  });
}

function ensureCy() {
  if (cy) return;
  cy = cytoscape({
    container: el("cy"),
    wheelSensitivity: WHEEL_SPEED,
    minZoom: 0.05,
    maxZoom: 4,
    style: [
      {
        selector: "node",
        style: {
          label: "",
          "font-size": 9,
          color: "#e4e4e7",
          "text-valign": "bottom",
          "text-margin-y": 4,
          "text-wrap": "ellipsis",
          "text-max-width": "110px",
          width: 14,
          height: 14,
          "border-width": 1.5,
          "border-color": "#27272a",
          "background-color": "#3f3f46",
        },
      },
      { selector: "node.lbl", style: { label: "data(label)" } },
      { selector: 'node[role = "header"]', style: { width: 26, height: 26 } },
      {
        selector: 'node[role = "header"][group = "1"]',
        style: { shape: "round-rectangle", width: 46, height: 24, "border-width": 2 },
      },
      { selector: 'node[role = "header"][kind = "root"]', style: { "background-color": "#475569" } },
      { selector: 'node[role = "header"][kind = "subagent"]', style: { "background-color": "#3b82f6" } },
      {
        selector: 'node[role = "header"][kind = "fork"]',
        style: { "background-color": "#8b5cf6", "border-style": "dashed", "border-color": "#c4b5fd" },
      },
      { selector: 'node[role = "user"]', style: { "background-color": "#d4d4d8" } },
      { selector: 'node[role = "assistant"][kind = "root"]', style: { "background-color": "#475569" } },
      { selector: 'node[role = "assistant"][kind = "subagent"]', style: { "background-color": "#3b82f6" } },
      {
        selector: 'node[role = "assistant"][kind = "fork"]',
        style: { "background-color": "#8b5cf6" },
      },
      {
        selector: 'node[role = "ellipsis"]',
        style: { width: 10, height: 10, "background-color": "#52525b", "border-width": 1 },
      },
      { selector: 'node[role = "header"][status = "busy"]', style: { "border-color": "#22c55e", "border-width": 2.5 } },
      { selector: 'node[role = "header"][outcome = "failed"]', style: { "border-color": "#ef4444", "border-width": 2.5 } },
      { selector: 'node[focus = "1"]', style: { "border-color": "#fafafa", "border-width": 3 } },
      { selector: "node.pulse", style: { "border-color": "#22c55e", "border-width": 3 } },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": "#3f3f46",
          "target-arrow-color": "#52525b",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.7,
          "curve-style": "bezier",
        },
      },
      {
        selector: 'edge[kind = "flow"]',
        style: { width: 1, "line-color": "#333338", "line-style": "solid" },
      },
      {
        selector: 'edge[kind = "fork"]',
        style: { "line-color": "#8b5cf6", "target-arrow-color": "#8b5cf6", "line-style": "dashed", width: 1.4 },
      },
      {
        selector: 'edge[kind = "spawn"]',
        style: { "line-color": "#3b82f6", "target-arrow-color": "#3b82f6", "line-style": "dotted", width: 1.4 },
      },
      {
        selector: 'edge[kind = "merge"]',
        style: { "line-color": "#3b82f6", "target-arrow-color": "#3b82f6", "line-style": "solid", width: 1.8 },
      },
    ],
    layout: { name: "preset" },
  });
  cy.on("tap", "node", (event) => {
    const node = event.target;
    cy.nodes().forEach((other) => other.data("selected", other.id() === node.id() ? 1 : 0));
    applyLabels();
    showDialog(node.data(), event.renderedPosition || { x: 0, y: 0 });
  });
  cy.on("tap", (event) => {
    if (event.target === cy) {
      hideDialog();
      hideTip();
    }
  });
  cy.on("mouseover", "node", (event) => {
    event.target.data("hover", 1);
    applyLabels();
    showTip(event.target.data(), event.renderedPosition);
  });
  cy.on("mouseout", "node", (event) => {
    event.target.data("hover", 0);
    applyLabels();
    hideTip();
  });
  cy.on("pan zoom", () => {
    hideTip();
    hideDialog();
  });
  cy.on("zoom", scheduleLabels);
}

let lanesById = {};

function focusedLane(graph) {
  const lanes = graph.lanes || [];
  if (!lanes.length) return null;
  if (selected && lanesById[selected]) return lanesById[selected];
  if (selected) {
    const grouped = lanes.find((lane) => lane.group && lane.group.members && lane.group.members.includes(selected));
    if (grouped) return grouped;
  }
  const busy = lanes.find((lane) => lane.live);
  if (busy) return busy;
  const focus = graph.focus || "";
  if (focus && lanesById[focus]) return lanesById[focus];
  return lanes[0];
}

function centerOnFocused(graph) {
  if (!cy) return;
  const lane = focusedLane(graph);
  if (!lane) {
    cy.fit(undefined, 50);
    return;
  }
  const handle = cy.getElementById(lane.id + "#h");
  if (!handle.nonempty()) {
    cy.fit(undefined, 50);
    return;
  }
  cy.zoom(1);
  cy.center(handle);
  applyLabels();
}

function render(data) {
  const graph = data.graph;
  if (!graph) {
    showLinks(data);
    return;
  }
  currentGraph = graph;
  const lanes = graph.lanes || [];
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const focus = graph.focus || data.focus || "";
  showLinksFields(graph);
  document.body.dataset.focus = focus;
  syncRoots(data.roots || []);
  const stats = graph.stats || { lanes: 0, nodes: 0, messages: 0 };
  const laneCount = stats.totalLanes || stats.lanes;
  countsEl.innerHTML = "<b>" + laneCount + "</b> lanes"
    + (stats.groups ? " · <b>" + stats.groups + "</b> groups" : "")
    + " · <b>" + stats.messages.toLocaleString()
    + "</b> messages · <b>" + stats.nodes.toLocaleString() + "</b> nodes";
  emptyEl.hidden = lanes.length > 0;

  lanesById = {};
  for (const lane of lanes) lanesById[lane.id] = lane;

  const newest = new Map();
  for (const node of nodes) {
    const seen = newest.get(node.lane);
    if (!seen || node.y > seen.y) newest.set(node.lane, node);
  }
  pulses = new Set();
  for (const lane of lanes) {
    if (lane.live) {
      const node = newest.get(lane.id);
      if (node) pulses.add(node.id);
    }
  }

  if (!lanes.length) {
    hideTip();
    hideDialog();
    if (cy) cy.elements().remove();
    shape = "";
    first = true;
    return;
  }

  ensureCy();
  const ids = nodes.map((n) => n.id).sort().join("|");
  if (ids !== shape) {
    const changedFocus = focus !== lastFocus;
    const view = { zoom: cy.zoom(), pan: Object.assign({}, cy.pan()) };
    const wasFirst = first;
    shape = ids;
    lastFocus = focus;
    first = false;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(nodes.map((n) => ({
        data: Object.assign({}, n, {
          kind: (lanesById[n.lane] || {}).kind || "root",
          status: (lanesById[n.lane] || {}).status || "idle",
          outcome: (lanesById[n.lane] || {}).outcome || "",
          group: (lanesById[n.lane] || {}).group ? "1" : "0",
          focus: n.id === (focus ? focus + "#h" : "") ? "1" : "0",
        }),
        position: { x: n.x, y: n.y * ROW_H },
      })));
      cy.add(edges.map((e) => ({
        data: { id: e.from + "->" + e.to + ":" + e.kind, source: e.from, target: e.to, kind: e.kind },
      })));
      cy.nodes().forEach((node) => {
        if (pulses.has(node.id()) && pulseOn) node.addClass("pulse");
      });
    });
    cy.layout({ name: "preset", fit: false }).run();
    if (wasFirst) centerOnFocused(graph);
    else if (changedFocus) {
      const total = (graph.stats && graph.stats.totalLanes) || lanes.length;
      if (total < 40) cy.fit(undefined, 50);
      else centerOnFocused(graph);
    } else {
      cy.zoom(view.zoom);
      cy.pan(view.pan);
    }
  } else {
    lastFocus = focus;
    cy.batch(() => {
      for (const node of nodes) {
        const handle = cy.getElementById(node.id);
        if (handle.nonempty()) {
          handle.data(Object.assign({}, node, {
            kind: (lanesById[node.lane] || {}).kind || "root",
            status: (lanesById[node.lane] || {}).status || "idle",
            outcome: (lanesById[node.lane] || {}).outcome || "",
            group: (lanesById[node.lane] || {}).group ? "1" : "0",
            focus: node.id === (focus ? focus + "#h" : "") ? "1" : "0",
          }));
          if (pulses.has(node.id) && pulseOn) handle.addClass("pulse");
          else if (pulses.has(node.id)) handle.removeClass("pulse");
        }
      }
    });
  }
  applyLabels();
  hideTip();
  if (dialogNodeId && !dialogEl.hidden) {
    const stillThere = nodes.find((n) => n.id === dialogNodeId);
    if (stillThere && cy) {
      const handle = cy.getElementById(dialogNodeId);
      if (handle.nonempty()) showDialog(handle.data(), handle.renderedPosition || { x: 0, y: 0 });
      else hideDialog();
    } else hideDialog();
  }
}

async function load() {
  const query = new URLSearchParams();
  if (selected) query.set("session", selected);
  if (baseOverride) query.set("base", baseOverride);
  if (maxOverride) query.set("max", maxOverride);
  for (const agent of expanded) query.append("expand", agent);
  query.set("limit", String(LIMIT));
  query.set("graph", "1");
  const response = await fetch("/api/tree?" + query.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error("HTTP " + response.status);
  render(await response.json());
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    await load();
    errorEl.hidden = true;
  } catch (error) {
    errorEl.textContent = "Viewer unreachable: " + (error && error.message ? error.message : error);
    errorEl.hidden = false;
  } finally {
    inFlight = false;
  }
}

function schedule() {
  clearTimeout(timer);
  if (liveEl.checked) {
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, REFRESH_MS);
  }
}

rootsEl.addEventListener("change", () => {
  selected = rootsEl.value;
  const url = new URL(location.href);
  url.searchParams.set("session", selected);
  history.replaceState(null, "", url);
  tick();
});

liveEl.addEventListener("change", () => {
  if (liveEl.checked) tick();
  schedule();
});

labelsEl.addEventListener("change", () => {
  labelMode = labelsEl.value;
  applyLabels();
});

el("refresh").addEventListener("click", tick);
el("fit").addEventListener("click", () => {
  if (cy) {
    cy.fit(undefined, 50);
    applyLabels();
  }
});
el("zoomin").addEventListener("click", () => {
  if (cy) zoomBy(1.25);
});
el("zoomout").addEventListener("click", () => {
  if (cy) zoomBy(0.8);
});

el("cy").addEventListener("wheel", wheelhandler, { passive: false, capture: true });
dialogBackdrop.addEventListener("click", hideDialog);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideDialog();
    hideTip();
  }
});
setInterval(pulseStep, 500);

tick();
schedule();
`

const escapeHTML = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] as string)

function hostOf(base: string): string {
  try {
    return new URL(base).host || base
  } catch {
    return base
  }
}

export function renderPage(base: string, limit: number, configuredBase?: string): string {
  const configured = configuredBase || base
  const initial = JSON.stringify(base).replace(/</g, "\\u003c")
  const script = SCRIPT.replace("__WEB_BASE__", () => initial).replace("__LIMIT__", () => String(Math.trunc(limit)))
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Session tree</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <label class="control">Root <select id="roots"></select></label>
  <div class="spacer"></div>
  <span class="links" id="links" title="${escapeHTML(configured)}">links: ${escapeHTML(hostOf(base))}</span>
  <div id="counts" class="counts"><b>0</b> lanes</div>
  <label class="control">Labels
    <select id="labels">
      <option value="auto" selected>Auto</option>
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  </label>
  <label class="control"><input type="checkbox" id="live" checked /> Live</label>
  <button id="refresh" type="button">Refresh</button>
  <button id="zoomout" class="icon" type="button" title="Zoom out">−</button>
  <button id="zoomin" class="icon" type="button" title="Zoom in">+</button>
  <button id="fit" type="button">Fit</button>
</header>
<main>
  <div id="cy"></div>
  <div id="empty" class="empty" hidden>No sessions in this family.</div>
  <div id="error" class="error" hidden></div>
  <div id="tooltip" class="tooltip" hidden></div>
  <div id="dialog-backdrop" class="dialog-backdrop" hidden></div>
  <div id="dialog" class="dialog" hidden role="dialog" aria-modal="false"></div>
  <div class="legend">
    <span><i class="dot root"></i>root</span>
    <span><i class="dot subagent"></i>subagent</span>
    <span><i class="dot fork"></i>fork</span>
    <span><i class="dot user"></i>user <i class="dot assistant"></i>assistant <i class="dot ellipsis"></i>pruned</span>
    <span><i class="line flow"></i>flow</span>
    <span><i class="line fork"></i>fork edge</span>
    <span><i class="line spawn"></i>spawn</span>
    <span><i class="line merge"></i>merge</span>
    <span><i class="dot busy"></i>busy</span>
    <span><i class="dot failed"></i>failed</span>
  </div>
</main>
<script src="/vendor/cytoscape.min.js"></script>
<script>${script}</script>
</body>
</html>`
}
