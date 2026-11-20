# macros.json

One file per Move Set at `/data/UserData/schwung/set_state/<set uuid>/macros.json`. The browser editor writes it; you can also edit it by hand. Macros re-reads it every two seconds while open.

```json
{
  "v": 1,
  "ensure": [
    { "slot": 4, "comp": "fx1", "module": "tapedelay",
      "path": "/data/UserData/schwung/modules/audio_fx/tapedelay/tapedelay.so",
      "params": { "mix": 0, "division": "1/8d" } }
  ],
  "macros": [
    { "name": "Dub Arp", "color": "#f2994a", "value": 0, "targets": [
      { "slot": 4, "comp": "fx1", "param": "mix", "module": "tapedelay", "from": 0, "to": 0.55 },
      { "bus": "master", "comp": "fx2", "param": "cutoff", "module": "filter", "from": 1, "to": 0.55, "curve": 0.7 }
    ] },
    { "name": "DJ", "bipolar": true, "targets": [
      { "bus": "master", "comp": "fx2", "param": "cutoff", "module": "filter", "from": 1, "to": 0.15, "side": "neg" },
      { "bus": "master", "comp": "fx1", "param": "cutoff", "module": "filter", "from": 0, "to": 0.65, "side": "pos" }
    ] }
  ]
}
```

## Macros

Up to 8; macro *n* is knob *n*.

| Field | |
| --- | --- |
| `name` | Up to 12 characters; the screen shows the first 5 in the grid |
| `color` | Editor only |
| `bipolar` | Two-sided: rests at 0, runs −1…+1 |
| `value` | The knob position, written by Macros. Signed when two-sided |
| `targets` | What the knob moves |

## Targets

| Field | |
| --- | --- |
| `slot` | 1–4, the chain slot (track N feeds slot N with Move->Schwung on) |
| `bus` | Instead of `slot`: `"master"`, `"send1"` or `"send2"` |
| `comp` | Position: `synth`, `fx1`…`fx8`, `midi_fx1`…; or `slot` for slot settings such as `volume` |
| `param` | The module's parameter key (as in its module.json) |
| `module` | Optional module id. The target only moves while that module is loaded there |
| `from`, `to` | The setting at knob 0 and at 100% (or ±100% for two-sided) |
| `curve` | 1 linear (default), 2 slow start, 0.5 fast start |
| `side` | Two-sided only: `"neg"` (turning left), `"pos"` (right), `"both"` (default) |
| `int` | Round the value |

A setting moved by several macros starts at the `from` of the first target that names it and adds every macro's `(to − from) × amount`, kept between the lowest and highest `from`/`to` seen for it.

## ensure

Effects the macros need. When Macros opens, each entry whose position is **empty** gets the module loaded and its `params` set. A different module already there is left alone. Schwung saves the result with the Set.

Master FX positions load by `path`; slots and sends by `module` id.
