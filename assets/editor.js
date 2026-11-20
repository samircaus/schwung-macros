/*
 * Macros editor: edits a Set's macros.json in the browser.
 *
 * Served by schwung-manager from the module folder, so it shares the manager's
 * origin and uses its own endpoints:
 *   /ws/remote-ui              what is loaded where, each module's parameters and
 *                              their current values; set_param for auditioning
 *   /files/download?path=      read macros.json, active_set.txt, defaults.json
 *   /files/upload              write macros.json (multipart, overwrites)
 *   /files?path=               list Sets (HTML directory pages)
 */
"use strict";

const STATE = "/data/UserData/schwung/set_state/";
const SETS = "/data/UserData/UserLibrary/Sets";
const ACTIVE = "/data/UserData/schwung/active_set.txt";
const MODULE_DIR = "/data/UserData/schwung/modules/overtake/macros";
const COLORS = ["#f2c94c", "#f2994a", "#eb5757", "#bb6bd9", "#2d9cdb", "#56ccf2", "#27ae60", "#9b9b9b"];

const $ = (sel, el = document) => el.querySelector(sel);
const state = {
    sets: [], uuid: "", activeUuid: "", doc: null, saved: "", dirty: false,
    comps: new Map(),       /* "m|fx1" or "3|fx1" -> { label, module, params: [...] } */
    values: new Map(),      /* "<slot>|<key>" -> number */
    ws: null, wsReady: false, knobs: Array(8).fill(0),
};

/* ---- files --------------------------------------------------------------- */
async function readText(path) {
    const r = await fetch("/files/download?path=" + encodeURIComponent(path), { credentials: "same-origin" });
    if (!r.ok) return null;
    return r.text();
}
function csrf() { return (document.cookie.match(/(^| )csrf_token=([^;]+)/) || [])[2] || ""; }
async function ensureCsrf() {
    if (!csrf()) await fetch("/config", { credentials: "same-origin" });   /* the manager sets the cookie */
    if (!csrf()) throw new Error("schwung-manager did not hand out a CSRF token");
}
async function writeText(dir, name, text) {
    await ensureCsrf();
    const fd = new FormData();
    fd.append("csrf_token", csrf());
    fd.append("path", dir);
    fd.append("file", new Blob([text], { type: "application/json" }), name);
    const r = await fetch("/files/upload", { method: "POST", body: fd, credentials: "same-origin",
                                             headers: { "X-CSRF-Token": csrf(), "HX-Request": "true" } });
    if (!r.ok) throw new Error("upload failed (" + r.status + ")");
}
async function listDirs(path) {
    const r = await fetch("/files?path=" + encodeURIComponent(path), { credentials: "same-origin" });
    if (!r.ok) return [];
    const html = await r.text();
    const prefix = path.replace(/\/$/, "") + "/";
    const out = new Set();
    for (const m of html.matchAll(/href="\/files\?path=([^"]+)"/g)) {
        const p = decodeURIComponent(m[1]);
        if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) out.add(p.slice(prefix.length));
    }
    return [...out];
}

async function loadSets() {
    const active = (await readText(ACTIVE)) || "";
    state.activeUuid = active.split("\n")[0].trim();
    const uuids = await listDirs(SETS);
    const sets = [];
    for (const u of uuids) {
        const names = await listDirs(SETS + "/" + u);
        if (names.length) sets.push({ uuid: u, name: names[0] });
    }
    sets.sort((a, b) => (b.uuid === state.activeUuid) - (a.uuid === state.activeUuid) || a.name.localeCompare(b.name));
    state.sets = sets;
    const picker = $("#set-picker");
    picker.innerHTML = "";
    for (const s of sets) {
        const o = document.createElement("option");
        o.value = s.uuid;
        o.textContent = s.name + (s.uuid === state.activeUuid ? " (open on Move)" : "");
        picker.append(o);
    }
}

async function loadDoc(uuid) {
    let text = await readText(STATE + uuid + "/macros.json");
    let fromDefaults = false;
    if (!text) { text = await readText(MODULE_DIR + "/defaults.json"); fromDefaults = true; }
    let doc;
    try { doc = JSON.parse(text || "{}"); } catch (e) { throw new Error("macros.json does not parse: " + e.message); }
    if (!Array.isArray(doc.macros)) doc.macros = [];
    while (doc.macros.length < 8) doc.macros.push({ name: "", targets: [] });
    doc.macros = doc.macros.slice(0, 8);
    state.uuid = uuid;
    state.doc = doc;
    state.knobs = doc.macros.map((m) => Number(m.value) || 0);
    state.saved = fromDefaults ? "" : JSON.stringify(doc);
    setDirty(fromDefaults);
    status(fromDefaults ? "This Set has no macros yet: showing the defaults. Save to use them." : "");
    render();
}

/* ---- the live chain -------------------------------------------------------- */
/* One socket per subscription: the manager serves one subscription at a time
 * per connection, so four slots plus the master bus on one socket lose most of
 * their replies. The master socket also carries the audition writes. */
function connect(sub) {
    if (sub === undefined) { for (const s of [0, 1, 2, 3, "master"]) connect(s); return; }
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/remote-ui");
    if (sub === "master") state.ws = ws;
    ws.onopen = () => {
        if (sub === "master") { state.wsReady = true; live(true); }
        ws.send(JSON.stringify(sub === "master" ? { type: "subscribe_master_fx" } : { type: "subscribe", slot: sub }));
    };
    ws.onclose = () => {
        if (sub === "master") { state.wsReady = false; live(false); }
        setTimeout(() => connect(sub), 2000);
    };
    ws.onmessage = (e) => { for (const line of String(e.data).split("\n")) if (line.trim()) onMessage(line); };
}

let renderSoon = 0;
function scheduleRender() { clearTimeout(renderSoon); renderSoon = setTimeout(render, 150); }

function onMessage(line) {
    let m; try { m = JSON.parse(line); } catch (e) { return; }
    if (m.type === "slot_info") {
        for (const comp of ["synth", "fx1", "fx2", "midi_fx1"]) {
            const id = m[comp] || "";
            const key = m.slot + "|" + comp;
            if (!id) state.comps.delete(key);
            else state.comps.set(key, { ...(state.comps.get(key) || { params: [] }), module: id,
                                        label: "Track " + (m.slot + 1) + " · " + comp + " · " + id });
        }
        scheduleRender();
    } else if (m.type === "master_fx_info") {
        for (let i = 1; i <= 8; i++) {
            if (!("fx" + i in m)) continue;
            const id = m["fx" + i], key = "m|fx" + i;
            if (!id) state.comps.delete(key);
            else state.comps.set(key, { ...(state.comps.get(key) || { params: [] }), module: id,
                                        label: "Master FX " + i + " · " + id });
        }
        scheduleRender();
    } else if (m.type === "chain_params" && Array.isArray(m.data)) {
        const master = String(m.component).startsWith("master_fx:");
        const key = master ? "m|" + m.component.slice(10) : m.slot + "|" + m.component;
        const params = m.data.filter((p) => p.type === "float" || p.type === "int")
            .map((p) => ({ key: p.key, name: p.name || p.label || p.key, type: p.type, min: p.min, max: p.max }));
        state.comps.set(key, { ...(state.comps.get(key) || { label: key, module: "" }), params });
        scheduleRender();
    } else if (m.type === "param_update" && m.params) {
        for (const [k, v] of Object.entries(m.params)) {
            const n = Number(v);
            if (Number.isFinite(n)) state.values.set(m.slot + "|" + k, n);
        }
    }
}

/* ---- targets --------------------------------------------------------------- */
function compKeyOf(t) { return t.bus === "master" ? "m|" + t.comp : (Number(t.slot) - 1) + "|" + t.comp; }
function liveKeyOf(t) { return t.bus === "master" ? "0|master_fx:" + t.comp + ":" + t.param : (Number(t.slot) - 1) + "|" + t.comp + ":" + t.param; }
function describe(t) {
    const where = t.bus === "master" ? "Master FX " + String(t.comp).replace("fx", "") : t.bus ? t.bus : "Track " + t.slot + " " + t.comp;
    return where + " · " + (t.module ? t.module + " · " : "") + t.param;
}
function optionValue(compKey, param) { return compKey + "|" + param; }
function targetFromOption(value) {
    const [where, comp, param] = value.split("|");
    const info = state.comps.get(where + "|" + comp) || {};
    return where === "m"
        ? { bus: "master", comp, param, module: info.module || undefined }
        : { slot: Number(where) + 1, comp, param, module: info.module || undefined };
}
function paramInfo(t) {
    const c = state.comps.get(compKeyOf(t));
    return c && c.params ? c.params.find((p) => p.key === t.param) : null;
}

/* The device's maths: rest value + every macro's move, two-sided aware. */
function amount(m, knob, t) {
    const c = Number(t.curve) > 0 ? Number(t.curve) : 1;
    if (!m.bipolar) return Math.pow(Math.max(0, knob), c);
    const side = t.side === "neg" || t.side === "pos" ? t.side : "both";
    if (side === "neg" && knob >= 0) return 0;
    if (side === "pos" && knob <= 0) return 0;
    return Math.pow(Math.abs(knob), c);
}
function computeLive(liveKey) {
    let base = null, lo = Infinity, hi = -Infinity, v = 0;
    state.doc.macros.forEach((m, i) => {
        for (const t of m.targets || []) {
            if (liveKeyOf(t) !== liveKey) continue;
            const from = Number(t.from), to = Number(t.to);
            if (base === null) base = from;
            lo = Math.min(lo, from, to); hi = Math.max(hi, from, to);
            v += (to - from) * amount(m, state.knobs[i], t);
        }
    });
    if (base === null) return null;
    return Math.round(Math.max(lo, Math.min(hi, base + v)) * 10000) / 10000;
}
/* Coalesced to one write burst per 30 ms. A timer, not requestAnimationFrame,
 * which browsers pause in background tabs. */
let auditionTimer = 0;
function audition(i) {
    if (!state.wsReady || state.uuid !== state.activeUuid) return;
    clearTimeout(auditionTimer);
    auditionTimer = setTimeout(() => {
        for (const t of state.doc.macros[i].targets || []) {
            const lk = liveKeyOf(t), value = computeLive(lk);
            if (value === null) continue;
            const [slot, key] = [Number(lk.split("|")[0]), lk.slice(lk.indexOf("|") + 1)];
            state.ws.send(JSON.stringify(t.bus === "master"
                ? { type: "set_master_fx_param", key, value: String(value) }
                : { type: "set_param", slot, key, value: String(value) }));
        }
    }, 30);
}

/* ---- rendering --------------------------------------------------------------- */
function render() {
    if (!state.doc) return;
    const grid = $("#grid");
    const focus = document.activeElement && document.activeElement.closest(".card");
    if (focus && grid.contains(focus)) return;          /* do not re-render under the cursor */
    grid.innerHTML = "";
    state.doc.macros.forEach((m, i) => grid.append(renderCard(m, i)));
}

function paramOptions(select, t) {
    select.innerHTML = "";
    const blank = new Option("Choose a setting…", "");
    select.append(blank);
    const current = t ? optionValue(compKeyOf(t), t.param) : "";
    let found = false;
    const comps = [...state.comps.entries()].filter(([, c]) => c.params && c.params.length)
        .sort((a, b) => a[1].label.localeCompare(b[1].label, undefined, { numeric: true }));
    for (const [key, c] of comps) {
        const group = document.createElement("optgroup");
        group.label = c.label;
        const short = key.startsWith("m|") ? "Master " + key.slice(4) : "Track " + (Number(key.split("|")[0]) + 1) + " " + key.split("|")[1];
        for (const p of c.params) {
            const o = new Option(short + " · " + (c.module || "") + " · " + p.name, optionValue(key, p.key));
            if (o.value === current) { o.selected = true; found = true; }
            group.append(o);
        }
        select.append(group);
    }
    if (t && t.param && !found) {
        const o = new Option(describe(t) + " (not loaded now)", current);
        o.selected = true;
        select.prepend(o);
    }
    return found;
}

function renderCard(m, i) {
    const card = $("#card-tpl").content.firstElementChild.cloneNode(true);
    const color = m.color || COLORS[i];
    card.style.setProperty("--c", color);
    card.classList.toggle("bipolar", !!m.bipolar);
    $(".knob-no", card).textContent = i + 1;
    const name = $(".name", card);
    name.value = m.name || "";
    name.placeholder = "Macro " + (i + 1);
    name.oninput = () => { m.name = name.value; setDirty(true); };

    const sw = $(".swatches", card);
    for (const c of COLORS) {
        const b = document.createElement("button");
        b.type = "button"; b.style.background = c; b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(c === color)); b.title = c;
        b.onclick = () => { m.color = c; setDirty(true); card.replaceWith(renderCard(m, i)); };
        sw.append(b);
    }

    const bip = $(".bipolar", card);
    bip.checked = !!m.bipolar;
    bip.onchange = () => {
        m.bipolar = bip.checked;
        state.knobs[i] = 0;
        for (const t of m.targets || []) if (m.bipolar && !t.side) t.side = "both";
        setDirty(true); card.replaceWith(renderCard(m, i));
    };

    const knob = $(".knob", card), out = $(".knob-val", card);
    knob.min = m.bipolar ? "-1" : "0";
    knob.value = String(state.knobs[i]);
    const showKnob = () => { const p = Math.round(state.knobs[i] * 100); out.textContent = (m.bipolar && p > 0 ? "+" : "") + p + "%"; };
    showKnob();
    knob.oninput = () => { state.knobs[i] = Number(knob.value); showKnob(); audition(i); };
    knob.title = state.uuid === state.activeUuid ? "Drag to hear it on Move" : "Open this Set on Move to hear it";

    const list = $(".targets", card);
    (m.targets || []).forEach((t, ti) => list.append(renderTarget(m, i, t, ti, card)));
    $(".add", card).onclick = () => {
        m.targets = m.targets || [];
        m.targets.push({ from: 0, to: 1, side: m.bipolar ? "pos" : undefined });
        setDirty(true);
        const fresh = renderCard(m, i);
        card.replaceWith(fresh);
        fresh.querySelector(".target:last-child .param").focus();
    };
    return card;
}

function renderTarget(m, i, t, ti, card) {
    const li = $("#target-tpl").content.firstElementChild.cloneNode(true);
    const sel = $(".param", li);
    const loaded = paramOptions(sel, t.param ? t : null);
    const warn = $(".warn", li);
    if (t.param && !loaded) { warn.hidden = false; warn.textContent = "That effect is not loaded on Move right now; the target sits out until it is."; }
    const from = $(".from", li), to = $(".to", li);
    const info = t.param ? paramInfo(t) : null;
    for (const inp of [from, to]) {
        if (info) { inp.min = info.min; inp.max = info.max; inp.step = info.type === "int" ? 1 : "any"; }
    }
    from.value = t.from ?? ""; to.value = t.to ?? "";
    sel.onchange = () => {
        if (!sel.value) return;
        const next = targetFromOption(sel.value);
        Object.assign(t, next);
        if (!next.module) delete t.module;
        const p = paramInfo(t);
        const now = state.values.get(liveKeyOf(t));
        if (p && (t.from === 0 && t.to === 1)) {           /* fresh target: start from where it is now */
            t.from = Number.isFinite(now) ? now : p.min;
            t.to = p.max;
        }
        if (p && p.type === "int") t.int = true; else delete t.int;
        setDirty(true); card.replaceWith(renderCard(m, i));
    };
    from.onchange = () => { t.from = Number(from.value); setDirty(true); };
    to.onchange = () => { t.to = Number(to.value); setDirty(true); };
    const grab = (field, input) => () => {
        const v = state.values.get(liveKeyOf(t));
        if (!Number.isFinite(v)) { status("No current value from Move for that setting yet."); return; }
        t[field] = v; input.value = v; setDirty(true);
    };
    $(".grab-from", li).onclick = grab("from", from);
    $(".grab-to", li).onclick = grab("to", to);
    const curve = $(".curve", li);
    curve.value = String(Number(t.curve) > 0 ? Number(t.curve) : 1);
    if (!curve.value) curve.value = "1";
    curve.onchange = () => { const c = Number(curve.value); if (c === 1) delete t.curve; else t.curve = c; setDirty(true); };
    const side = $(".side", li);
    side.value = t.side || "both";
    side.onchange = () => { t.side = side.value; setDirty(true); };
    $(".remove", li).onclick = () => { m.targets.splice(ti, 1); setDirty(true); card.replaceWith(renderCard(m, i)); };
    return li;
}

/* ---- saving ------------------------------------------------------------------ */
function cleanDoc() {
    const doc = JSON.parse(JSON.stringify(state.doc));
    doc.v = 1;
    doc.macros = doc.macros.map((m, i) => {
        const out = { ...m, name: (m.name || "").trim() || "Macro " + (i + 1) };
        if (!m.bipolar) delete out.bipolar;
        out.targets = (m.targets || []).filter((t) => t.param && (t.comp || t.bus)).map((t) => {
            const c = { ...t };
            if (!m.bipolar) delete c.side;
            for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
            return c;
        });
        return out;
    });
    return doc;
}

async function save() {
    try {
        const doc = cleanDoc();
        await writeText(STATE + state.uuid, "macros.json", JSON.stringify(doc, null, 2) + "\n");
        state.doc = doc;
        state.saved = JSON.stringify(doc);
        setDirty(false);
        status(state.uuid === state.activeUuid ? "Saved. Move picks it up within two seconds." : "Saved. It applies when this Set is opened on Move.");
        render();
    } catch (e) { status(e.message, true); }
}

async function copyFrom() {
    const others = state.sets.filter((s) => s.uuid !== state.uuid);
    const names = others.map((s, n) => (n + 1) + ". " + s.name).join("\n");
    const pick = prompt("Copy macros from which Set? (number)\n" + names);
    const s = others[Number(pick) - 1];
    if (!s) return;
    const text = await readText(STATE + s.uuid + "/macros.json");
    if (!text) { status(s.name + " has no macros to copy.", true); return; }
    const src = JSON.parse(text);
    state.doc.macros = src.macros.slice(0, 8);
    while (state.doc.macros.length < 8) state.doc.macros.push({ name: "", targets: [] });
    if (src.ensure) state.doc.ensure = src.ensure;
    setDirty(true); status("Copied from " + s.name + ". Save to keep it."); render();
}

/* ---- chrome ------------------------------------------------------------------- */
function setDirty(d) {
    state.dirty = d;
    $("#save").classList.toggle("dirty", d);
}
function status(text, error) { const s = $("#status"); s.textContent = text || ""; s.classList.toggle("error", !!error); }
function live(on) { const p = $("#live"); p.textContent = on ? "live" : "offline"; p.className = "pill " + (on ? "on" : "off"); }

window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

async function main() {
    if (window.top !== window) {
        $("#framed").hidden = false;
        $("#open-tab").href = location.pathname;
    }
    $("#save").onclick = save;
    $("#revert").onclick = () => loadDoc(state.uuid).catch((e) => status(e.message, true));
    $("#copy-from").onclick = () => copyFrom().catch((e) => status(e.message, true));
    $("#set-picker").onchange = async (e) => {
        if (state.dirty && !confirm("Discard unsaved changes?")) { e.target.value = state.uuid; return; }
        await loadDoc(e.target.value).catch((err) => status(err.message, true));
    };
    connect();
    try {
        await loadSets();
        if (!state.sets.length) { status("No Sets found on this Move.", true); return; }
        await loadDoc($("#set-picker").value);
    } catch (e) { status(e.message, true); }
}
main();
