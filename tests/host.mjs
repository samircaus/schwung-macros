// A fake Schwung host: runs ui.js in a VM with the host functions it calls, and
// records what it writes, so the engine can be tested off the device.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SET = "test-set-uuid";
export const CONFIG = `/data/UserData/schwung/set_state/${SET}/macros.json`;

export function makeHost({ config, loaded = {}, globals = {} } = {}) {
    const files = { "/data/UserData/schwung/active_set.txt": `${SET}\nTest Set` };
    if (config) files[CONFIG] = typeof config === "string" ? config : JSON.stringify(config);
    const host = {
        files, loaded, writes: [], leds: {}, screen: [], corun: null, overlay: null, exited: false,
        shift: false, toMove: [],
    };
    const ctx = {
        console: { log() {} }, Math, JSON, String, Number, Array, Map, Set, Object, Date,
        host_file_exists: (p) => p in files,
        host_read_file: (p) => files[p] ?? null,
        host_write_file: (p, t) => { files[p] = t; },
        shadow_get_param: (slot, key) => loaded[`${slot}|${key}`] ?? loaded[key] ?? null,
        shadow_set_param_timeout: (slot, key, value) => {
            host.writes.push(`${slot} ${key}=${value}`);
            if (key.endsWith(":module")) loaded[`${slot}|${key.replace(":module", "_module")}`] = value;
            return true;
        },
        shadow_corun_begin: (target, id, keep) => { host.corun = { target, id, keep }; },
        shadow_corun_overlay: (active, keep) => { host.corun.keep = keep; host.overlay = active; },
        shadow_corun_state: () => host.corun,
        shadow_corun_end: () => { host.corun = null; },
        shadow_corun_set_led_keep_mask: () => {},
        shadow_set_overtake_suppress_sysex: () => {},
        shadow_set_skip_led_clear: () => {},
        move_midi_internal_send: (p) => { host.leds[p[2]] = p[3]; return true; },
        move_midi_inject_to_move: (p) => { host.toMove.push(p.join(",")); return true; },
        shadow_get_shift_held: () => host.shift,
        host_exit_module: () => { host.exited = true; },
        clear_screen: () => { host.screen = []; },
        print: (x, y, text) => host.screen.push(text),
        fill_rect: () => {},
        ...globals,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "ui.js"), "utf8"), ctx);
    host.ctx = ctx;
    host.tick = (n = 1) => { for (let i = 0; i < n; i++) ctx.tick(); };
    host.turn = (knob, delta, times = 1) => {
        for (let i = 0; i < times; i++) ctx.onMidiMessageInternal([0xB0, 71 + knob, delta > 0 ? delta : 128 + delta]);
    };
    host.press = (cc) => ctx.onMidiMessageInternal([0xB0, cc, 127]);
    host.release = (cc) => ctx.onMidiMessageInternal([0xB0, cc, 0]);
    host.touch = (knob, on) => ctx.onMidiMessageInternal([on ? 0x90 : 0x80, knob, on ? 127 : 0]);
    host.takeWrites = () => host.writes.splice(0);
    host.saved = () => JSON.parse(files[CONFIG]);
    return host;
}

export const MASTER = {
    "master_fx:fx1:name": "filter", "master_fx:fx2:name": "filter",
    "master_fx:fx3:name": "tapedelay", "master_fx:fx4:name": "freeverb",
};
export const ROOT_DIR = ROOT;
