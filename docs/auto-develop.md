# Automating a photograph's develop

**Status (2026-10-02).** §1 is the maintainer's ask, in his words. §2 is FACT,
read in this repository. §3 is the evaluation he asked for, with the five
things he listed merged into the three that are really distinct. §4 records
what was decided in that conversation; §5 to §7 are the plans, one per
approach, sized in commits; §8 is what stays his. He said *"Go, écris le
brief et commence par l'approche 1"*, so §5 is being built in order.

---

## 1. What was asked

> Est-ce possible d'automatiser le montage d'une photo ? Via IA, via un LLM
> branché ou un Claude Code ? Via code automatisé ? Évalue l'approche que l'on
> pourrait prendre.

Then, after the first evaluation:

> J'en vois une dernière : s'entraîner avec la multitude de montages que
> j'aurais pu faire sur mon projet. À force de faire des montages, on pourrait
> créer des weights, un mini-modèle qui pourrait anticiper. Je ne sais pas si
> ça tournerait en local, dans le navigateur, ou si ça créerait juste un
> méga-dump qu'on mettrait dans un autre outil qui créerait un modèle.

> Je vois aussi une autre approche : Bring Your Own Key — laisser le
> développeur ajouter sa clé.

And one fact about his own data: he uses Capture One, *"j'ai pris la
mauvaise habitude de supprimer des projets, je ne garde que les exports"* —
about one time in two. There is no catalogue of his past develops to learn
from.

## 2. What exists today (fact)

**A develop is a record, and the engine is deterministic.** In this suite the
"montage" of a photograph is not pixels: it is `DevelopSettings`
(`src/shared/develop/develop.ts` — exposure, brightness, contrast, the four
tone bands, temperature, tint, saturation, vibrance, curves, levels, the
mixer, mono, grading, the RAW base) and, around it on `RollPicture`
(`roll-types.ts`), the crop (`aspect` + `Framing`), the adjustment layers with
their masks, the repair list, the look, the border. The render core draws that
record identically on the stage, in every export and in every thumbnail
(`render-core.md`). **Automating the develop therefore means producing the
record**, never touching the render, and every approach below shares that
contract. It is also what makes them combinable: one can produce records
that another learns from.

What already produces a record without a hand:

- `auto-develop.ts` — **Auto tone** (a black point, a white point and a
  gamma, written as levels) and **Auto colour** (grey-world, as temperature
  and tint), both measured on the picture AS SHOT so a second press is the
  same answer; the **eyedropper** is the same solve on a pointed pixel
  (`develop.md`, «Auto is TWO verbs»).
- Presets (one personal book), the section clipboard, the Apply-to verbs, the
  house style — the deterministic batch exists.
- The **subject segmenter** (`shared/segment/segmenter.ts`, MediaPipe
  `magic_touch`, 16.9 MB served from our own origin, loaded on first ask):
  a point becomes a mask, a mask becomes a layer.
- **Lensfun** profiles: the lens correction is measured, never invented
  (`lens-profiles.md`).
- The roll travels as `.roll.json` (`roll-file.ts`): a program outside the
  browser can write a whole roll.
- `scripts/check-render.mjs` drives the real WebGL engine in headless
  Chromium on SwiftShader; `libraw-wasm` runs there too.

What does NOT exist: a vignette of the picture *as shot* kept beside its
record (the roll's thumbnail is the picture as DELIVERED, `roll-thumb.ts`);
any call to a language model; any way to render a roll from the command line.

## 3. The approaches

His five — heuristics, a local model, an LLM with vision, a Claude Code
agent, a model trained on his own montages — are three. The fifth IS the
second, with one difference that matters: the dataset is made by Atelier
itself, going forward, not found in a catalogue. "Bring your own key" is not
an approach: it is the answer to *where the key lives* inside the third. The
agent is the third approach run outside the browser, in batch.

| | 1. Heuristics | 2. A model learned on HIS develops | 3. An LLM with vision, his own key |
|---|---|---|---|
| What it is | Code that measures the picture and writes numbers | A small network predicting his sliders from a vignette, trained on (picture as shot → his record) pairs accumulated roll after roll | Claude is shown a reduced proxy, the histogram, the EXIF and the sliders' spec, answers a record as structured output, then sees the render and corrects |
| Runs | In the browser, pure, tested in node | Collection in the browser; training OUTSIDE it (an exported dump, PyTorch, minutes); inference in the browser (ONNX from our origin, like the segmenter) | Interactive: the browser calls the API. Batch: an agent on his machine reads the folder, writes the roll, renders headless, iterates |
| Local-first | Yes | Yes — the dump is a file he exports himself | **No**: a reduced proxy (never the RAW) leaves for Anthropic. A fourth network exception, opt-in, off by default, said in the README |
| Brings | The routine develop: exposure, balance, levels, lens, horizon | HIS taste, constant from one picture to the next, with nothing said | INTENT in words («plus chaud, sors les ombres du visage»), a critique of the image, masks without drawing (it answers POINTS; the segmenter makes the mask) |
| Limits | Corrects; has no taste | Worth what the dataset is worth: a few hundred develops before it predicts anything; learns the average of him | Values poorly calibrated on the first try (hence the render loop), inconstant over 300 pictures (anchor on a preset), ≈ 1–2 cents a picture |
| Key / data | None | His, at home | Key in `localStorage` (never on a document) or relayed by a Winnow that keeps it |
| Size | 3 commits | 2 commits in Atelier + a training script outside the repo + 1 commit of inference | 4 commits; the batch mode needs one more brick, «render this roll with no screen» |

Cost of 3, measured against the API's published prices (Opus-class model,
$4 per million input tokens, $20 per million output): a 1024 px image is
about 1 000 tokens, the prompt is cached, the answer ≈ 300 tokens — about one
cent a picture a pass, ≈ $10 for 500 pictures in two passes, half that
through the Batch API. Price is not the issue; local-first is.

## 4. Decisions (2026-10-02)

1. **The record is the contract.** Whatever decides (code, a model, a
   language model, a person), it writes `DevelopSettings` and the picture's
   crop, layers and repair; nothing ever writes pixels. Preview = export holds
   by construction, and undo, presets, apply-to and the house style work on
   what any of them wrote.
2. **The order is 1 → the collection half of 2 → 3.** Approach 1 needs no
   product decision. The two collection commits of approach 2 cost nothing
   and every day without them is dataset lost, so they come before any model
   and before approach 3. Approach 2's model trains when there is enough; 3
   accelerates that moment, since what it writes and he corrects is data.
3. **Approach 3 is NOT decided.** It is the suite's fourth network exception
   (`local-first.md`): opt-in, off by default, a reduced proxy only, the RAW
   never, stated in the README's callout. Where the key lives (browser
   `localStorage`, or relayed by his Winnow, which keeps "Atelier is a
   client") is his call — see §8.
4. **An automatic verb SETS, says, and never invents.** The rules Auto tone
   fixed (`develop.md`) hold for every verb here: measured on the picture as
   shot so a second press is the same answer; solved against this suite's own
   maths, never a textbook's; a clamp or a refusal said out loud; nothing
   written where nothing was measured.

## 5. Approach 1 — three commits

Each verb lives in a pure module beside a `.test.ts`, is drawn by the panel
it belongs to, and reports what it did (or why not) through the told line.

**A1 — Auto bands** (`auto-develop.ts`, the Auto row). The two verbs there
touch the ENDS (levels) and the CAST (white balance); nothing yet touches the
two bands between them. `autoBands(stats)` reads the as-shot bins: where the
10th percentile sits below a dark threshold the picture leans dark and
`shadows` lifts it part of the way to the target; where the 90th sits above a
bright threshold `highlights` pulls it down likewise. Each is SOLVED against
`toneCurve`'s band weight at that percentile (`bandWeights`, the shift being
`value/100 × reach × weight`), so what is written lands where it aimed; the
pull is partial, like Auto tone's, so a picture dark on purpose keeps its
character; a picture that leans neither way gets null and "nothing to
recover"; whites and blacks stay Auto tone's. A third button, never folded
into the first: a stretch and a compression are different answers and a
person wants one without the other.

**A2 — Auto level** (`auto-level.ts`, the Crop tab's Level row). The horizon
is the dominant straight line near horizontal or vertical: a Sobel over a
512 px luma sample, every gradient's line direction folded to its deviation
from the nearest axis (the same fold `levelDelta` uses), a histogram of those
deviations weighted by gradient magnitude within ±15°, the peak refined by a
weighted mean, and a CONFIDENCE (the peak's share of the mass). Below the
confidence floor the verb says "no line to level on" and writes nothing. It
sets the fine straighten through the crop API's own `straighten`, so the zone
refits from the intent exactly as a drawn Level line does; a flip reverses
the sign. Tested on synthetic two-tone fields at known angles.

**A3 — Crop to the subject** (`subject-crop.ts`, the Crop tab). The subject
is the union of the picture's Subject layers' rasters when it has any — the
author already said what the subject is — else the model is asked about the
CENTRE of the picture, and the told line says so. The mask's bounding box is
taken into the TURNED picture's frame (the zone's), padded, grown to the
locked format's ratio about its centre, fitted inside the picture through
`fitAround`, and written through `setZone` so the chip is kept. A mask that
covers almost nothing or almost everything is refused with the reason. The
model's answer is a task (`tasks.md`) while it comes.

Verified: the pure modules by their specs; the panels driven in headless
Chromium against the dev server where a picture can be dropped on a roll
(the model needs a GPU and a real picture, so A3's segmentation is driven
only where the gate already runs it).

## 6. Approach 2 — collect first, train outside, infer inside

**B1 — The vignette as shot, beside the record.** When a picture is developed
in a roll, a small vignette of it AS SHOT (256 px long edge, JPEG, a few kB)
is baked once and kept in the roll store's thumbs beside the delivered one,
keyed by picture id and never on the document — the same store, the same
pruning. Cheap, local, no document migration. Without it there is no pair.

**B2 — The training dump.** A verb on the roll gallery writes ONE file: every
roll's pictures as `{ vignette, stats, exif summary, develop, crop, layers
without rasters }`, the records normalised. He takes it to a trainer outside
the browser. Nothing leaves by itself.

**B3 — Outside the repo.** A script (PyTorch or similar, not in this
repository) trains a small network — a vignette and the as-shot stats in,
the slider vector out, the curves and the mixer as fixed-size vectors — and
exports ONNX. A few hundred pairs are the floor at which it beats Auto; his
own exports can add to it: where an ORIGINAL survives beside its EXPORT, the
record can be RECOVERED by optimisation (the sliders whose render of the
original is nearest the export, at 256 px, through the real engine — fifteen
parameters, a render a millisecond; the look and the crop complicate, do not
prevent). That recovery is a later brick, not a commit here.

**B4 — Inference in the browser.** `onnxruntime-web` from our own origin, the
model under `public/models/`, loaded on first ask like the segmenter; a verb
*Auto · my own* beside the three of §5 that writes the predicted record
through the same `patch`. Local-first unchanged.

## 7. Approach 3 — the assistant, when decided

**C1 — The seam, opt-in.** `shared/assist/` with ONE function: a reduced
proxy (1024 px), the as-shot stats, the EXIF summary and the sliders' spec
(the doc comments of `develop.ts` are already that spec) in; a
`DevelopSettings` patch out, as structured output validated against the
record's own schema. The key in `localStorage` under a consent flag, never on
a document; the README's callout names what leaves and to whom. Model and
parameters per `shared/live-sources` of the API skill at build time, never
recalled.

**C2 — The loop.** The record is rendered locally, the render goes back once
with "what would you change", the second answer is applied. Two passes, no
more; both said in the told line with the cost.

**C3 — Points, not masks.** The answer may name subjects as points; the
segmenter turns each into a Subject layer with its own develop. The document
stores points and never pixels — the rule `render-layers.md` already fixed.

**C4 — The dialogue.** A field in the Adjust tab: a sentence in, a patch out,
against the current record. This is where the LLM earns its place over §5
and §6.

**C5 — Batch, later.** A `scripts/render-roll.mjs` (headless Chromium, the
real engine, a `.roll.json` in, files out) is the brick an agent on his
machine needs; it is also useful on its own for a batch export and visual
tests, and it goes toward "the browser is the runtime today, not forever".

## 8. His to decide

- The fourth network exception at all: may a reduced proxy leave for
  Anthropic, opt-in?
- If yes, the key's home: the browser (`localStorage`, no Winnow change) or
  a Winnow relay (cleaner, one route on his server).
- Whether B1's vignette may be kept with the roll (a few kB per picture,
  local, pruned with it).
- The A1 thresholds and the A2 confidence floor are taste constants, named
  in their modules; move them from his pictures, not from an argument.
