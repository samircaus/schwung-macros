/*
 * Macros -- 8 performance macros per Move Set.
 *
 * Each of Move's 8 knobs is one macro. A macro drives any number of Schwung
 * parameters (chain slots 1-4, Send A/B, Master FX), each between its own
 * "from" and "to" with an optional curve. Several macros may share a parameter:
 * their moves ADD on top of the parameter's rest value, so Break + Reverb stack.
 *
 * While open, the tool co-runs with Move: it keeps the knobs, knob touch and
 * the screen; pads, steps, transport and track buttons stay with Move, so clips
 * and scenes can be launched as usual. Menu flips the knobs between the macros
 * and Move's own knobs (Move's screen comes back too); Back leaves the tool.
 * Knob rings light up with each macro's amount, so a glance shows what is on.
 *
 * Config per Set: /data/UserData/schwung/set_state/<set uuid>/macros.json
 * (falls back to tool_state/macros/default.json, then to the built-in DEFAULT).
 *
 *   { "v": 1, "macros": [ { "name": "Dub Arp", "value": 0, "targets": [
 *       { "slot": 4, "comp": "fx1", "param": "mix", "module": "tapedelay", "from": 0, "to": 0.5 },
 *       { "bus": "master", "comp": "fx1", "param": "cutoff", "module": "filter", "from": 0, "to": 0.45, "curve": 2 }
 *   ] }, ... ] }
 *
 * slot is 1-4 (as on Move); bus is "master", "send1" or "send2". "module" is
 * optional: when given, the target only moves while that module is loaded there.
 * "curve" bends the knob (1 linear, 2 slow start, 0.5 fast start). "int": true
 * rounds the value.
 *
 * Two-sided macros ("bipolar": true) rest at the centre and run -100%..+100%,
 * like a DJ filter. Each target says which half moves it: "side": "neg" (turning
 * left), "pos" (right) or "both" (either way, by how far from the centre).
 * Turning through the centre stops there for one detent.
 *
 * The file is re-read every ~2 s, so edits from the browser editor (web_ui.html)
 * take effect while the tool is open. Knob positions on the device win.
 * Full reference: docs/macros-json.md.
 */

const SCREEN_W = 128;
const CC_KNOB0 = 71, CC_SHIFT = 49, CC_BACK = 51, CC_MENU = 50;
const TOUCH_MAX = 7;                      /* capacitive knob touch notes 0-7 */
const STATE_DIR = "/data/UserData/schwung/set_state/";
const DEFAULT_FILE = "/data/UserData/schwung/tool_state/macros/default.json";
const MODULE_DEFAULTS = "/data/UserData/schwung/modules/overtake/macros/defaults.json";
const ACTIVE_SET_FILE = "/data/UserData/schwung/active_set.txt";
const WRITES_PER_TICK = 6;                /* each write is one param round trip (~3 ms) */
const WRITE_RETRIES = 10;
const SAVE_DELAY_TICKS = 45;              /* ~1.5 s after the last turn */
const MODULE_CHECK_TICKS = 60;            /* re-read what is loaded every ~2 s */
const SET_CHECK_TICKS = 30;
const RELOAD_CHECK_TICKS = 60;            /* pick up editor saves every ~2 s */
const STEP = 1 / 100, FINE_STEP = 1 / 500;

/* Built in (also shipped as defaults.json): the Master FX chain move_macros.py
 * installs -- HP filter, LP filter, TapeDelay, Freeverb. Knob 1 is a DJ filter. */
const DEFAULT = { v: 1, macros: [
    { name: "DJ", bipolar: true, targets: [
        { bus: "master", comp: "fx2", param: "cutoff", module: "filter", from: 1, to: 0.15, side: "neg", curve: 0.7 },
        { bus: "master", comp: "fx2", param: "resonance", module: "filter", from: 0.2, to: 0.5, side: "neg" },
        { bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 0.65, side: "pos", curve: 0.7 },
        { bus: "master", comp: "fx1", param: "resonance", module: "filter", from: 0.2, to: 0.5, side: "pos" },
        { bus: "master", comp: "fx4", param: "wet", module: "freeverb", from: 0, to: 0.15, side: "both" }] },
    { name: "Delay", targets: [
        { bus: "master", comp: "fx3", param: "mix", module: "tapedelay", from: 0, to: 0.5 },
        { bus: "master", comp: "fx3", param: "feedback", module: "tapedelay", from: 0.45, to: 0.7 }] },
    { name: "Reverb", targets: [
        { bus: "master", comp: "fx4", param: "wet", module: "freeverb", from: 0, to: 0.5 },
        { bus: "master", comp: "fx4", param: "room_size", module: "freeverb", from: 0.85, to: 0.97 }] },
    { name: "Break", targets: [
        { bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 0.45 },
        { bus: "master", comp: "fx3", param: "mix", module: "tapedelay", from: 0, to: 0.25 },
        { bus: "master", comp: "fx4", param: "wet", module: "freeverb", from: 0, to: 0.35 }] },
    { name: "Build", targets: [
        { bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 0.62, curve: 2 },
        { bus: "master", comp: "fx1", param: "resonance", module: "filter", from: 0.2, to: 0.55 },
        { bus: "master", comp: "fx3", param: "feedback", module: "tapedelay", from: 0.45, to: 0.62 },
        { bus: "master", comp: "fx4", param: "wet", module: "freeverb", from: 0, to: 0.45 }] },
    { name: "Dub", targets: [
        { bus: "master", comp: "fx3", param: "mix", module: "tapedelay", from: 0, to: 0.45 },
        { bus: "master", comp: "fx3", param: "feedback", module: "tapedelay", from: 0.45, to: 0.72 },
        { bus: "master", comp: "fx2", param: "cutoff", module: "filter", from: 1, to: 0.65 }] },
    { name: "Wash", targets: [
        { bus: "master", comp: "fx4", param: "wet", module: "freeverb", from: 0, to: 0.6 },
        { bus: "master", comp: "fx4", param: "room_size", module: "freeverb", from: 0.85, to: 0.98 },
        { bus: "master", comp: "fx2", param: "cutoff", module: "filter", from: 1, to: 0.5 },
        { bus: "master", comp: "fx3", param: "mix", module: "tapedelay", from: 0, to: 0.3 }] },
    { name: "Echo Out", targets: [
        { bus: "master", comp: "fx3", param: "mix", module: "tapedelay", from: 0, to: 0.6 },
        { bus: "master", comp: "fx3", param: "feedback", module: "tapedelay", from: 0.45, to: 0.8 },
        { bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 0.5, curve: 2 },
        { bus: "master", comp: "fx4", param: "wet", module: "freeverb", from: 0, to: 0.4 }] },
] };

/* ---- state ----------------------------------------------------------------- */
let setUuid = "", setName = "", configPath = "", configSource = "";
let macros = [];                 /* [{name, value, targets:[{...resolved}]}] x 8 */
let params = new Map();          /* "slot|key" -> {slot, key, base, lo, hi, isInt, module, comp, bus} */
let moduleOk = new Map();        /* "slot|comp" -> true/false/undefined */
const writeQueue = new Map();    /* "slot|key" -> {slot, key, value, tries} */
let shiftHeld = false, touched = -1, lastTurned = -1, overlayTicks = 0;
let tickCount = 0, saveDue = 0, dirty = true, corunActive = false, corunStarted = false;
let lastFileText = null;         /* what macros.json held when we last read or wrote it */
const clampValue = (m, x) => m.bipolar ? Math.max(-1, Math.min(1, x)) : clamp01(x);

/* ---- helpers ------------------------------------------------------------- */
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function log(msg) { try { console.log("[macros] " + msg); } catch (e) {} }

function readFile(path) {
    try {
        if (typeof host_file_exists === "function" && !host_file_exists(path)) return null;
        const t = host_read_file(path);
        return (t === null || t === undefined || t === "") ? null : String(t);
    } catch (e) { return null; }
}
function writeFile(path, text) {
    try { host_write_file(path, text); return true; } catch (e) { log("write failed " + path + ": " + e); return false; }
}
function getParam(slot, key) {
    if (typeof shadow_get_param !== "function") return null;
    try { const v = shadow_get_param(slot, key); return (v === null || v === undefined) ? null : String(v); }
    catch (e) { return null; }
}

/* Where a target lives on the param channel: {ipcSlot, key, moduleKey, label}. */
function address(t) {
    const bus = t.bus ? String(t.bus) : "";
    if (bus === "master" || bus === "send1" || bus === "send2") {
        const prefix = bus === "master" ? "master_fx:" : bus + ":";
        return { ipcSlot: 0, key: prefix + t.comp + ":" + t.param,
                 moduleKey: prefix + t.comp + ":name", where: bus === "master" ? "MFX" : (bus === "send1" ? "SndA" : "SndB") };
    }
    const slot = Math.max(1, Math.min(4, Number(t.slot) || 1)) - 1;
    if (t.comp === "slot") return { ipcSlot: slot, key: t.param, moduleKey: null, where: "S" + (slot + 1) };
    const modKey = t.comp === "synth" ? "synth_module" : t.comp + "_module";
    return { ipcSlot: slot, key: t.comp + ":" + t.param, moduleKey: modKey, where: "S" + (slot + 1) };
}

/* ---- config ---------------------------------------------------------------- */
function readActiveSet() {
    const raw = readFile(ACTIVE_SET_FILE);
    if (!raw) return { uuid: "", name: "" };
    const lines = raw.split("\n");
    return { uuid: (lines[0] || "").trim(), name: (lines[1] || "").trim() };
}

function loadConfig() {
    const s = readActiveSet();
    setUuid = s.uuid; setName = s.name;
    configPath = setUuid ? STATE_DIR + setUuid + "/macros.json" : "";
    let doc = null;
    lastFileText = configPath ? readFile(configPath) : null;
    for (const [path, src] of [[configPath, "set"], [DEFAULT_FILE, "default"], [MODULE_DEFAULTS, "module"]]) {
        if (!path) continue;
        const text = readFile(path);
        if (!text) continue;
        try { doc = JSON.parse(text); configSource = src; break; }
        catch (e) { log("bad JSON in " + path + ": " + e); }
    }
    if (!doc || !Array.isArray(doc.macros)) { doc = JSON.parse(JSON.stringify(DEFAULT)); configSource = "built-in"; }
    buildModel(doc);
    planEnsure(doc);
    log("loaded " + configSource + " config for " + (setName || "?") + " (" + macros.length + " macros)");
}

/* ---- "ensure": effects the macros need, loaded on open ---------------------
 *   "ensure": [ { "slot": 4, "comp": "fx1", "module": "tapedelay",
 *                 "path": "/data/UserData/schwung/modules/audio_fx/tapedelay/tapedelay.so",
 *                 "params": { "mix": 0, "division": "1/8d" } } ]
 * Only an EMPTY position is filled; a different module already there is left
 * alone (and that macro's targets show "--"). Schwung's autosave keeps it. */
let ensureSteps = [];            /* [{at, run}] executed in tick order */

function planEnsure(doc) {
    ensureSteps = [];
    const list = Array.isArray(doc.ensure) ? doc.ensure : [];
    let at = tickCount + 3;
    for (const e of list) {
        if (!e || !e.comp || !e.path || !e.module) continue;
        const bus = e.bus ? String(e.bus) : "";
        const isBus = bus === "master" || bus === "send1" || bus === "send2";
        const ipc = isBus ? 0 : Math.max(1, Math.min(4, Number(e.slot) || 1)) - 1;
        const prefix = bus === "master" ? "master_fx:" : (isBus ? bus + ":" : "");
        const modKey = isBus ? prefix + e.comp + ":name" : (e.comp === "synth" ? "synth_module" : e.comp + "_module");
        const where = isBus ? bus + " " + e.comp : "slot " + (ipc + 1) + " " + e.comp;
        ensureSteps.push({ at, run: () => {
            const loaded = getParam(ipc, modKey);
            if (loaded === null) { log("ensure " + where + ": no answer, skipped"); return false; }
            const id = loaded.split("/").pop().replace(/\.so$/, "");
            if (loaded === e.module || id === e.module) return false;          /* already there */
            if (loaded !== "" && loaded !== "none") { log("ensure " + where + ": holds " + loaded + ", left alone"); return false; }
            /* Master FX positions load by DSP path; chain slots and send buses
             * load by module id (shadow_ui's own picker writes item.id). */
            const value = bus === "master" ? e.path : e.module;
            try { shadow_set_param_timeout(ipc, prefix + e.comp + ":module", value, 400); } catch (err) {
                try { shadow_set_param(ipc, prefix + e.comp + ":module", value); } catch (e2) {} }
            log("ensure " + where + ": loaded " + e.module);
            const params = e.params || {};
            ensureSteps.push({ at: tickCount + 20, run: () => {
                for (const [k, v] of Object.entries(params))
                    writeQueue.set(ipc + "|" + prefix + e.comp + ":" + k,
                                   { slot: ipc, key: prefix + e.comp + ":" + k, value: String(v), tries: 0 });
                return true;
            } });
            return true;
        } });
        at += 10;
    }
}

function tickEnsure() {
    if (!ensureSteps.length) return;
    const due = ensureSteps.filter((s) => s.at <= tickCount);
    if (!due.length) return;
    ensureSteps = ensureSteps.filter((s) => s.at > tickCount);
    let changed = false;
    for (const s of due) { try { changed = s.run() || changed; } catch (e) { log("ensure failed: " + e); } }
    if (changed) { moduleOk.clear(); ensureSteps.push({ at: tickCount + 30, run: () => { refreshModules(); dirty = true; return false; } }); }
}

function buildModel(doc, keepValues) {
    const previous = keepValues ? macros.map((m) => m.value) : null;
    macros = []; params = new Map(); moduleOk = new Map();
    for (let i = 0; i < 8; i++) {
        const m = doc.macros[i] || { name: "--", targets: [] };
        const targets = [];
        for (const t of (Array.isArray(m.targets) ? m.targets : [])) {
            if (!t || !t.param || (!t.comp && !t.bus)) continue;
            const a = address(t);
            const from = Number(t.from), to = Number(t.to);
            if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
            const pk = a.ipcSlot + "|" + a.key;
            if (!params.has(pk)) {
                params.set(pk, { slot: a.ipcSlot, key: a.key, base: from, lo: Math.min(from, to), hi: Math.max(from, to),
                                 isInt: !!t.int, module: t.module || "", moduleKey: a.moduleKey });
            } else {
                const p = params.get(pk);
                p.lo = Math.min(p.lo, from, to); p.hi = Math.max(p.hi, from, to); p.isInt = p.isInt || !!t.int;
            }
            const side = t.side === "neg" || t.side === "pos" ? t.side : "both";
            targets.push({ pk, from, to, side, curve: Number(t.curve) > 0 ? Number(t.curve) : 1,
                           label: a.where + " " + (t.comp === "slot" ? "" : t.comp + " ") + t.param });
        }
        const macro = { name: String(m.name || ("Macro " + (i + 1))).slice(0, 12),
                        bipolar: !!m.bipolar, value: 0, targets };
        macro.value = clampValue(macro, previous ? previous[i] : (Number(m.value) || 0));
        macros.push(macro);
    }
    refreshModules();
}

function configDoc() {
    /* Rebuilt from the file each save so hand edits to targets are never lost:
     * only "value" is ours to change. */
    let doc = null;
    const text = configPath ? readFile(configPath) : null;
    if (text) { try { doc = JSON.parse(text); } catch (e) { doc = null; } }
    if (!doc || !Array.isArray(doc.macros)) {
        const src = configSource === "default" ? readFile(DEFAULT_FILE) : null;
        try { doc = src ? JSON.parse(src) : JSON.parse(JSON.stringify(DEFAULT)); }
        catch (e) { doc = JSON.parse(JSON.stringify(DEFAULT)); }
    }
    for (let i = 0; i < 8; i++) {
        if (!doc.macros[i]) doc.macros[i] = { name: "--", targets: [] };
        doc.macros[i].value = Math.round(macros[i].value * 1000) / 1000;   /* signed when bipolar */
    }
    doc.v = 1;
    return doc;
}

function saveConfig() {
    saveDue = 0;
    if (!configPath) return;
    const text = JSON.stringify(configDoc(), null, 2) + "\n";
    if (writeFile(configPath, text)) { configSource = "set"; lastFileText = text; }
}

/* ---- the engine ------------------------------------------------------------- */
function refreshModules() {
    for (const p of params.values()) {
        if (!p.module || !p.moduleKey) { moduleOk.set(p.slot + "|" + p.key, true); continue; }
        const loaded = getParam(p.slot, p.moduleKey);
        if (loaded === null) continue;                 /* no answer: keep last verdict */
        const id = loaded.split("/").pop().replace(/\.so$/, "");
        moduleOk.set(p.slot + "|" + p.key, loaded === p.module || id === p.module);
    }
}

function curveOf(x, c) { return c === 1 ? x : Math.pow(x, c); }

/* How far a target is moved by its macro, 0..1. A one-sided macro moves every
 * target by its value; a two-sided one moves "neg" targets left of centre, "pos"
 * targets right of it and "both" targets by the distance from the centre. */
function amountOf(m, t) {
    if (!m.bipolar) return curveOf(Math.max(0, m.value), t.curve);
    if (t.side === "neg" && m.value >= 0) return 0;
    if (t.side === "pos" && m.value <= 0) return 0;
    return curveOf(Math.abs(m.value), t.curve);
}

/* Every parameter = its rest value + the sum of every macro's move on it. */
function computeParam(pk) {
    const p = params.get(pk);
    let v = p.base;
    for (const m of macros) for (const t of m.targets) {
        if (t.pk === pk) v += (t.to - t.from) * amountOf(m, t);
    }
    v = Math.max(p.lo, Math.min(p.hi, v));
    return p.isInt ? Math.round(v) : Math.round(v * 10000) / 10000;
}

function queueMacro(i) {
    for (const t of macros[i].targets) {
        if (moduleOk.get(t.pk) === false) continue;
        const p = params.get(t.pk);
        writeQueue.set(t.pk, { slot: p.slot, key: p.key, value: String(computeParam(t.pk)), tries: 0 });
    }
}

function queueAll() { for (let i = 0; i < macros.length; i++) queueMacro(i); }

/* The editor saved a new macros.json: take its names and targets, keep the knobs. */
function checkReload() {
    if (!configPath) return;
    const text = readFile(configPath);
    if (text === null || text === lastFileText) return;
    lastFileText = text;
    let doc = null;
    try { doc = JSON.parse(text); } catch (e) { log("macros.json changed but does not parse: " + e); return; }
    if (!doc || !Array.isArray(doc.macros)) return;
    buildModel(doc, true);
    planEnsure(doc);
    queueAll();
    dirty = true;
    log("reloaded macros.json");
}

function flushWrites() {
    let n = 0;
    for (const [pk, w] of writeQueue) {
        if (n++ >= WRITES_PER_TICK) break;
        let ok = false;
        try {
            if (typeof shadow_set_param_timeout === "function") ok = shadow_set_param_timeout(w.slot, w.key, w.value, 50) === true;
            else if (typeof shadow_set_param === "function") ok = shadow_set_param(w.slot, w.key, w.value) === true;
        } catch (e) { ok = false; }
        if (ok || ++w.tries >= WRITE_RETRIES) {
            if (!ok) log("gave up writing " + w.key + " on slot " + w.slot);
            writeQueue.delete(pk);
        }
    }
}

function turn(i, delta) {
    const m = macros[i];
    const before = m.value;
    let next = clampValue(m, m.value + delta * (shiftHeld ? FINE_STEP : STEP));
    /* Centre detent: crossing zero on a two-sided macro stops at zero first. */
    if (m.bipolar && before !== 0 && Math.sign(next) !== Math.sign(before)) next = 0;
    m.value = next;
    lastTurned = i; overlayTicks = 40; dirty = true;
    if (m.value !== before) { queueMacro(i); saveDue = tickCount + SAVE_DELAY_TICKS; }
}

/* ---- co-run with Move ------------------------------------------------------- */
/* Schwung 1.9.x keeps these as module-private consts in shadow_ui.js, not
 * globals, so a tool carries its own copy (same values as shadow_constants.h;
 * dAVEBOx does the same). A global, where a newer host exports one, wins. */
const num = (name, fallback) => (typeof globalThis[name] === "number") ? globalThis[name] : fallback;
const TARGET_MOVE_NATIVE = num("CORUN_TARGET_MOVE_NATIVE", 2);
const GRP_OLED = num("CORUN_GRP_OLED", 1 << 0);
const GRP_KNOBS = num("CORUN_GRP_KNOBS", 1 << 6);
const GRP_TOUCH = num("CORUN_GRP_TOUCH", 1 << 11);
const GRP_MENU = num("CORUN_GRP_MENU", 1 << 10);
/* Two knob modes, switched with Menu. Everything not kept goes to Move:
 *   MACROS  the tool keeps knobs, knob touch, the screen and Menu
 *   MOVE    the tool keeps only Menu; knobs and screen are Move's own again */
const KEEP_MACROS = GRP_OLED | GRP_KNOBS | GRP_TOUCH | GRP_MENU;
const KEEP_MOVE = GRP_MENU;
let knobMode = "macros";

function beginCorun(mode) {
    if (typeof shadow_corun_begin !== "function") {
        log("co-run unavailable: running as a plain overtake (pads will not reach Move)");
        return;
    }
    const keep = mode === "move" ? KEEP_MOVE : KEEP_MACROS;
    try {
        /* A Move-native co-run always hands the OLED to Move firmware, whatever
         * the keep mask says. shadow_corun_overlay(1, keep) takes the screen back
         * for us WITHOUT ending the co-run; overlay(0, keep) gives it to Move.
         * So the session starts once, and Menu only flips the overlay. */
        if (!corunActive) shadow_corun_begin(TARGET_MOVE_NATIVE, 0, keep);
        if (typeof shadow_corun_overlay === "function") {
            shadow_corun_overlay(mode === "move" ? 0 : 1, keep);
        } else if (corunActive) {                     /* older host: restart instead */
            if (typeof shadow_corun_end === "function") shadow_corun_end();
            shadow_corun_begin(TARGET_MOVE_NATIVE, 0, keep);
        }
        /* LEDs: in MACROS we light the knob rings; Move paints everything else. */
        if (typeof shadow_corun_set_led_keep_mask === "function")
            shadow_corun_set_led_keep_mask(mode === "move" ? GRP_MENU : (GRP_KNOBS | GRP_MENU));
        /* Let Move's RGB pad/clip colours through. */
        if (typeof shadow_set_overtake_suppress_sysex === "function") shadow_set_overtake_suppress_sysex(0);
        corunStarted = true; corunActive = true; knobMode = mode;
        ledCache.fill(-1);
        log("co-run with Move: " + mode + " mode (keep mask " + keep + ")");
    } catch (e) { log("co-run begin failed: " + e); }
}

function toggleKnobMode() {
    beginCorun(knobMode === "macros" ? "move" : "macros");
    dirty = true;
}

/* Knob rings: off at 0, dim to bright with the macro's value (MACROS mode). */
const ledCache = new Array(9).fill(-1);
function setCcLed(cc, colour, idx) {
    if (ledCache[idx] === colour || typeof move_midi_internal_send !== "function") return;
    try { move_midi_internal_send([0x0B, 0xB0, cc, colour]); ledCache[idx] = colour; } catch (e) {}
}
function updateLeds() {
    if (knobMode !== "macros") return;
    for (let i = 0; i < 8; i++) {
        const v = macros[i] ? Math.abs(macros[i].value) : 0;
        setCcLed(CC_KNOB0 + i, v <= 0 ? 0 : Math.round(16 + 108 * v), i);
    }
    setCcLed(CC_MENU, 124, 8);
}

function endCorun() {
    if (corunActive && typeof shadow_corun_end === "function") { try { shadow_corun_end(); } catch (e) {} }
    /* Leave Move's LEDs as they are when we go. */
    if (typeof shadow_set_skip_led_clear === "function") { try { shadow_set_skip_led_clear(1); } catch (e) {} }
    corunActive = false;
}

function leave() {
    if (saveDue) saveConfig();
    endCorun();
    if (typeof host_exit_module === "function") host_exit_module();
}

/* ---- drawing -------------------------------------------------------------- */
function centered(text, y) { print(Math.max(0, Math.floor((SCREEN_W - text.length * 6) / 2)), y, text, 1); }

/* A 3x5 font for the large readout: digits, '-', '%'. */
const BIG = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001010010010",
    "8": "111101111101111", "9": "111101111001111", "-": "000000111000000", "%": "101001010100101",
    "+": "000010111010000",
};
function drawBig(text, x, y, scale) {
    for (const ch of text) {
        const g = BIG[ch];
        if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++)
            if (g[r * 3 + c] === "1") fill_rect(x + c * scale, y + r * scale, scale, scale, 1);
        x += 4 * scale;
    }
}

/* A level bar: one-sided fills from the left, two-sided from the centre. */
function drawBar(x, y, w, h, m) {
    fill_rect(x, y, w, h, 1); fill_rect(x + 1, y + 1, w - 2, h - 2, 0);
    const inner = w - 2;
    if (!m.bipolar) {
        const fw = Math.round(inner * m.value);
        if (fw > 0) fill_rect(x + 1, y + 1, fw, h - 2, 1);
        return;
    }
    const mid = x + 1 + Math.floor(inner / 2);
    fill_rect(mid, y, 1, h, 1);                                   /* centre mark */
    const fw = Math.round((inner / 2) * Math.abs(m.value));
    if (fw > 0) fill_rect(m.value < 0 ? mid - fw : mid, y + 1, fw, h - 2, 1);
}

function macroState(m) {
    if (!m.targets.length) return "empty";
    const ok = m.targets.filter((t) => moduleOk.get(t.pk) !== false).length;
    return ok === 0 ? "missing" : (ok < m.targets.length ? "partial" : "ok");
}

function pctText(m) {
    const p = Math.round(m.value * 100);
    return (m.bipolar && p > 0 ? "+" : "") + p + "%";
}

function drawGrid() {
    clear_screen();
    print(0, 0, ("MACROS " + (setName || "")).slice(0, 14), 1);
    print(SCREEN_W - 6 * 6, 0, "Menu>M", 1);
    fill_rect(0, 9, SCREEN_W, 1, 1);
    for (let i = 0; i < 8; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        const x = col * 32, y = 12 + row * 26;
        const m = macros[i];
        const st = macroState(m);
        const label = st === "empty" || st === "missing" ? "--" : (st === "partial" ? "!" : "") + m.name;
        print(x + 1, y, label.slice(0, 5), 1);
        drawBar(x + 1, y + 11, 29, 6, m);
        if (i === touched || i === lastTurned && overlayTicks > 0) fill_rect(x + 1, y + 19, 29, 1, 1);
    }
}

function drawDetail(i) {
    clear_screen();
    const m = macros[i];
    print(0, 0, ((i + 1) + " " + m.name).slice(0, 13), 1);
    if (macroState(m) === "partial") print(SCREEN_W - 6, 0, "!", 1);
    const pct = pctText(m);
    drawBig(pct, SCREEN_W - pct.length * 12 - 2, 10, 3);          /* 15 px tall */
    drawBar(0, 28, SCREEN_W, 6, m);
    if (!m.targets.length) { print(0, 40, "No targets yet.", 1); print(0, 50, "Use the web editor", 1); return; }
    let y = 37;
    const visible = m.targets.filter((t) => !m.bipolar || amountOf(m, t) > 0 || t.side === "both").slice(0, 3);
    for (const t of (visible.length ? visible : m.targets.slice(0, 3))) {
        const ok = moduleOk.get(t.pk) !== false;
        const val = ok ? String(computeParam(t.pk)).slice(0, 5) : "--";
        print(0, y, t.label.slice(0, 15), 1);
        print(SCREEN_W - val.length * 6, y, val, 1);
        y += 9;
    }
}

function draw() {
    if (knobMode === "move" && corunActive) return;   /* the screen is Move's */
    const focus = touched >= 0 ? touched : (overlayTicks > 0 ? lastTurned : -1);
    if (focus >= 0) drawDetail(focus); else drawGrid();
}

/* ---- module interface --------------------------------------------------------- */
function init() {
    loadConfig();
    beginCorun("macros");
    dirty = true;
    draw();
}

function tick() {
    tickCount++;
    tickEnsure();
    flushWrites();
    updateLeds();
    if (overlayTicks > 0 && --overlayTicks === 0) dirty = true;
    if (saveDue && tickCount >= saveDue) saveConfig();
    if (tickCount % MODULE_CHECK_TICKS === 0) { refreshModules(); dirty = true; }
    if (tickCount % RELOAD_CHECK_TICKS === 30 && !saveDue) checkReload();
    if (tickCount % SET_CHECK_TICKS === 0) {
        const s = readActiveSet();
        if (s.uuid && s.uuid !== setUuid) {          /* Set changed under us */
            if (saveDue) saveConfig();
            writeQueue.clear();
            loadConfig(); dirty = true;
        }
    }
    /* Back ends the co-run in the framework: follow it out. */
    if (corunStarted && typeof shadow_corun_state === "function" && tickCount > 5) {
        let st = null; try { st = shadow_corun_state(); } catch (e) { st = null; }
        if (!st) { corunActive = false; leave(); return; }
    }
    if (dirty) { draw(); dirty = false; }
}

function onMidiMessageInternal(msg) {
    if (!msg || msg.length < 3) return;
    const status = msg[0] & 0xF0, d1 = msg[1], d2 = msg[2];
    if (status === 0xB0) {
        if (d1 >= CC_KNOB0 && d1 < CC_KNOB0 + 8) {
            const delta = d2 === 0 ? 0 : (d2 < 64 ? d2 : d2 - 128);
            if (delta) turn(d1 - CC_KNOB0, delta);
            return;
        }
        if (d1 === CC_SHIFT) { shiftHeld = d2 > 63; return; }
        if (d1 === CC_MENU && d2 > 63 && corunActive) { toggleKnobMode(); return; }
        if ((d1 === CC_BACK || d1 === CC_MENU) && d2 > 63 && !corunActive) { leave(); return; }
        return;
    }
    if ((status === 0x90 || status === 0x80) && d1 <= TOUCH_MAX) {
        const on = status === 0x90 && d2 > 0;
        if (on) touched = d1; else if (touched === d1) { touched = -1; overlayTicks = 20; lastTurned = d1; }
        dirty = true;
    }
}

function onMidiMessageExternal(msg) { /* external controllers: not used yet */ }

function onUnload() {
    if (saveDue) saveConfig();
    endCorun();
}

globalThis.init = init;
globalThis.tick = tick;
globalThis.onMidiMessageInternal = onMidiMessageInternal;
globalThis.onMidiMessageExternal = onMidiMessageExternal;
globalThis.onUnload = onUnload;
