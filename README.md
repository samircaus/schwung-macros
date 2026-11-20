# Macros for Schwung

Eight performance macros per [Ableton Move](https://www.ableton.com/move/) Set, as a [Schwung](https://github.com/charlesvestal/schwung) overtake module. Each of Move's knobs becomes one macro, and one macro can move any number of effect settings at once: close the master filter while the Arp's delay opens up, sweep a build, throw everything into reverb.

While Macros is open, Move keeps its pads, step buttons, transport and track buttons, so you launch clips and scenes as usual and play the macros on the knobs. Macros are saved per Set and edited in a browser.

## What you need

- Schwung 1.9.4 or newer.
- **Move's Link turned on** (Move's settings) and **Move->Schwung** turned on (Schwung Global Settings > Audio). Schwung's effects only hear Move's own tracks with both on. Without them a macro turns effects that receive no sound.
- Effects for the macros to move, in Schwung's Master FX, a send, or a track's slot. The default macros expect this Master FX chain: Filter (high-pass), Filter (low-pass), TapeDelay, Freeverb.

## Playing

| Move control | Action |
| --- | --- |
| Tools menu (Shift+Vol+Step 13) → Macros | Open. Knobs 1–8 are macros 1–8 |
| Knob turn | Move that macro. Shift + turn is fine |
| Knob touch | Show what the macro moves, with live values |
| Menu | Knobs and screen go back to Move; again returns to the macros |
| Back | Leave. Effects stay where the macros left them |

Knob rings light up with each macro's amount, so you see at a glance what is on. A `!` before a name means some of its effects are not loaded; `--` means none are.

**Two-sided macros** rest in the middle and run −100% to +100%, like a DJ filter: turning left moves its *Left* targets, turning right its *Right* ones, and *Both* targets move by how far you are from the centre. Turning through the centre stops there for one detent. The default knob 1 is a DJ filter: low-pass to the left, high-pass to the right, a little reverb either way.

Several macros can move the same setting; their moves add up on the setting's rest value.

## Editing in the browser

Open **http://move.local:7700/api/remote-ui/module-assets/macros/web_ui.html** in a browser on the same network as Move, and bookmark it. Schwung Manager does not link it yet: it only links web pages of modules with a DSP part.

- Pick a Set. The one open on Move is listed first.
- Each macro: a name, a colour, two-sided or not, and its targets. A target is any setting of an effect loaded on Move right now, between **From** (knob at 0) and **To** (knob at 100%), with a curve. The ● buttons take the setting's current value on Move.
- Drag a macro's slider to hear it on Move.
- **Save** writes the Set's `macros.json`. The open Set picks it up within two seconds; your knob positions on Move are kept.
- **Copy from…** starts from another Set's macros.

## Files

| Path on Move | What |
| --- | --- |
| `/data/UserData/schwung/set_state/<set>/macros.json` | A Set's macros ([format](docs/macros-json.md)) |
| `modules/overtake/macros/defaults.json` | Used for a Set that has none yet |

## Development

```sh
npm test        # engine tests against a fake Schwung host
npm run build   # dist/macros-module.tar.gz
```

To try a change on a Move with SSH set up:

```sh
tar -cf - module.json ui.js defaults.json help.json web_ui.html assets | ssh ableton@move.local 'tar -C /data/UserData/schwung/modules/overtake/macros -xf -'
```

Releases: push a `v<version>` tag that matches `module.json`; the workflow builds, tests and attaches `macros-module.tar.gz`.

### How it works

`ui.js` runs inside Schwung's shadow UI, which is what lets it write other modules' settings (`shadow_set_param`). It co-runs with Move (`shadow_corun_begin`, Move-native target) keeping only knobs, knob touch, the screen and Menu, and takes the screen back with `shadow_corun_overlay`. Schwung 1.9.x keeps the co-run constants private, so the module carries their values. Writes are coalesced per setting and sent a few per tick.

## Licence

MIT. See [LICENSE](LICENSE).
