import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { makeHost, MASTER, CONFIG, ROOT_DIR } from "./host.mjs";

const value = (writes, key) => {
    const hit = writes.filter((w) => w.includes(` ${key}=`)).pop();
    return hit === undefined ? undefined : Number(hit.split("=")[1]);
};

const oneMacro = (macro) => ({ v: 1, macros: [macro] });

test("co-run keeps knobs, touch, screen and Note/Session, and takes the screen back", () => {
    const h = makeHost({ loaded: MASTER });
    h.ctx.init(); h.tick(3);
    assert.equal(h.corun.target, 2);
    assert.equal(h.corun.keep, 1 | 64 | 2048 | 1024);
    assert.equal(h.overlay, 1);
});

test("Note/Session presses pass straight to Move, press and release", () => {
    const h = makeHost({ loaded: MASTER });
    h.ctx.init(); h.tick(2);
    h.press(50); h.release(50); h.tick();
    assert.deepEqual(h.toMove, ["11,176,50,127", "11,176,50,0"]);
    assert.equal(h.corun.keep, 3137);                      // still on the macros
});

test("Shift + Note/Session flips the knobs to Move and back, and Move never sees it", () => {
    const h = makeHost({ loaded: MASTER });
    h.ctx.init(); h.tick(2);
    h.shift = true;
    h.press(50); h.release(50); h.tick();
    assert.equal(h.corun.keep, 1024); assert.equal(h.overlay, 0);
    h.press(50); h.release(50); h.tick();
    assert.equal(h.corun.keep, 3137); assert.equal(h.overlay, 1);
    assert.deepEqual(h.toMove, []);
});

test("in Move mode a plain Note/Session press still reaches Move", () => {
    const h = makeHost({ loaded: MASTER });
    h.ctx.init(); h.tick(2);
    h.shift = true; h.press(50); h.release(50); h.shift = false;
    h.press(50); h.release(50); h.tick();
    assert.deepEqual(h.toMove, ["11,176,50,127", "11,176,50,0"]);
    assert.equal(h.corun.keep, 1024);
});

test("macros sharing a parameter add up on its rest value", () => {
    const h = makeHost({ loaded: MASTER, config: { v: 1, macros: [
        { name: "A", targets: [{ bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 0.4 }] },
        { name: "B", targets: [{ bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 0.6 }] },
    ] } });
    h.ctx.init(); h.tick(70); h.takeWrites();
    h.turn(0, 1, 50); h.tick(3);
    assert.equal(value(h.takeWrites(), "master_fx:fx1:cutoff"), 0.2);
    h.turn(1, 1, 50); h.tick(3);
    assert.equal(value(h.takeWrites(), "master_fx:fx1:cutoff"), 0.5);
});

test("a target on a different module is skipped", () => {
    const h = makeHost({ loaded: { ...MASTER, "master_fx:fx4:name": "cloudseed" }, config: oneMacro(
        { name: "Rev", targets: [{ bus: "master", comp: "fx4", param: "wet", module: "freeverb", from: 0, to: 1 }] }) });
    h.ctx.init(); h.tick(70); h.takeWrites();
    h.turn(0, 1, 100); h.tick(3);
    assert.deepEqual(h.takeWrites(), []);
});

test("a two-sided macro moves its neg targets left and pos targets right", () => {
    const dj = { name: "DJ", bipolar: true, targets: [
        { bus: "master", comp: "fx2", param: "cutoff", module: "filter", from: 1, to: 0.2, side: "neg" },
        { bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 0.6, side: "pos" },
        { bus: "master", comp: "fx4", param: "wet", module: "freeverb", from: 0, to: 0.2, side: "both" },
    ] };
    const h = makeHost({ loaded: MASTER, config: oneMacro(dj) });
    h.ctx.init(); h.tick(70); h.takeWrites();
    h.turn(0, -1, 50); h.tick(5);
    let w = h.takeWrites();
    assert.equal(value(w, "master_fx:fx2:cutoff"), 0.6);
    assert.equal(value(w, "master_fx:fx1:cutoff"), 0);
    assert.equal(value(w, "master_fx:fx4:wet"), 0.1);
    // Through the centre: stops at 0 first, then goes right.
    h.turn(0, 1, 50); h.tick(5); h.takeWrites();
    h.turn(0, 1, 1); h.tick(3);
    h.turn(0, 1, 49); h.tick(5);
    w = h.takeWrites();
    assert.equal(value(w, "master_fx:fx1:cutoff"), 0.3);
    assert.equal(value(w, "master_fx:fx2:cutoff"), 1);
});

test("the centre detent holds a two-sided macro at zero for one detent", () => {
    const h = makeHost({ loaded: MASTER, config: oneMacro({ name: "DJ", bipolar: true, targets: [
        { bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 1, side: "pos" }] }) });
    h.ctx.init(); h.tick(70);
    h.turn(0, -1, 3);                    // -0.03
    h.turn(0, 10, 1);                    // would be +0.07: stops at 0
    h.tick(60);
    assert.equal(h.saved().macros[0].value, 0);
});

test("knob positions are saved per Set, signed for two-sided macros", () => {
    const h = makeHost({ loaded: MASTER, config: oneMacro({ name: "DJ", bipolar: true, targets: [
        { bus: "master", comp: "fx1", param: "cutoff", module: "filter", from: 0, to: 1, side: "pos" }] }) });
    h.ctx.init(); h.tick(70);
    h.turn(0, -1, 25); h.tick(60);
    assert.equal(h.saved().macros[0].value, -0.25);
});

test("an edited macros.json is picked up while open, keeping knob positions", () => {
    const h = makeHost({ loaded: MASTER, config: oneMacro(
        { name: "Old", targets: [{ bus: "master", comp: "fx3", param: "mix", module: "tapedelay", from: 0, to: 0.5 }] }) });
    h.ctx.init(); h.tick(70);
    h.turn(0, 1, 40); h.tick(60); h.takeWrites();
    h.files[CONFIG] = JSON.stringify(oneMacro({ name: "New", targets: [
        { bus: "master", comp: "fx3", param: "mix", module: "tapedelay", from: 0, to: 1 }] }));
    h.tick(130);
    assert.equal(value(h.takeWrites(), "master_fx:fx3:mix"), 0.4);
    h.touch(0, true); h.tick();
    assert.ok(h.screen.some((s) => s.includes("New")), h.screen.join("|"));
});

test("ensure loads an empty slot by module id, never replaces another module", () => {
    const cfg = { v: 1, ensure: [
        { slot: 4, comp: "fx1", module: "tapedelay", path: "/x/tapedelay.so", params: { mix: 0 } },
        { slot: 3, comp: "fx1", module: "tapedelay", path: "/x/tapedelay.so" },
    ], macros: [] };
    const h = makeHost({ config: cfg, loaded: { "3|fx1_module": "", "2|fx1_module": "cloudseed" } });
    h.ctx.init(); h.tick(80);
    const w = h.takeWrites();
    assert.ok(w.includes("3 fx1:module=tapedelay"), w.join(" | "));
    assert.ok(w.includes("3 fx1:mix=0"), w.join(" | "));
    assert.ok(!w.some((x) => x.startsWith("2 ")), w.join(" | "));
});

test("Back (the framework ending the co-run) leaves the tool", () => {
    const h = makeHost({ loaded: MASTER });
    h.ctx.init(); h.tick(10);
    h.corun = null; h.tick();
    assert.equal(h.exited, true);
});

test("defaults.json matches the built-in defaults", () => {
    const src = fs.readFileSync(path.join(ROOT_DIR, "ui.js"), "utf8");
    const builtIn = vm.runInNewContext("(" + src.match(/const DEFAULT = (\{ v: 1, macros: \[[\s\S]*?\n\] \});/)[1] + ")");
    const shipped = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "defaults.json"), "utf8"));
    assert.deepEqual(shipped, JSON.parse(JSON.stringify(builtIn)));
});
