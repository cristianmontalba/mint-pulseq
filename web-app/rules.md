# MRI Sequence Design — Project Rules

## Work Protocol (READ BEFORE EDITING ANYTHING)

Two mandatory rules for any LLM or agent entering the project:

1. **Before making any change:** evaluate the project structure (read this `rules.md` and review the folder), decide which files you need to modify, and only then load them into your context window to edit them. Don't edit blindly or assume what's in each file — verify it.
2. **After any change:** update this `rules.md` to reflect the new state of the project (new files, moved files, added functions, changed conventions). The `rules.md` must remain the true guide of what exists, where it is, and what it does.

---

## What this app is

Educational web application about MRI sequence design. It is **one learning path in four steps**, and the sidebar is ordered to match. Each module ends with a `.next-step` panel handing the reader to the next one, so the four read as a course rather than as four separate tools:
1. **Learn Pulseq** (landing view) — a seven-page guide to the Pulseq framework itself: why it exists, what a `.seq` file is, the block execution model, the raster clock, what you can check before scanning, the bugs that pass every check, and the full round trip. Carries three interactive widgets, a self-check question per page, saved progress, and "try it" buttons that open the Builder already configured.
2. **Sequence Walkthrough** — a 9-row × 3-column interactive matrix that takes one sequence apart instant by instant: what the magnetization does, what the scanner plays, and the Pulseq code that produces it.
3. **Sequence Builder** — the user selects dimension + trajectory + excitation type + parameters (FOV, resolution, TR, TE, TI, flip angle, spoiler, Venc) and the app composes a Python/PyPulseq script ready to download as `.py`. Running it with Python (pypulseq installed) produces the `.seq` file the scanner reads **and saves, next to the script, three PNG diagrams (RF/ADC, gradients, k-space filling) plus a `.txt` run log**.
4. **Seq Inspector** — the loop closes here. Drop a `.seq` on the page and it is parsed client-side into its sections and explained: header definitions, a pointer-annotated block list, a timing diagram drawn from the events themselves, the k-space trajectory obtained by integrating gradient areas, and a set of **sanity checks** that look for the bugs `check_timing()` cannot see.

**Stack note:** the Inspector reads files with `FileReader` and never uploads anything. Its one network call is the optional bundled example, which needs the page served over http.

**Removed on 2026-09-19:** the *Sequences & Physics* educational library — the "Excitation Types" and "Trajectories" sidebar groups, their rendered content, and the sidebar subtitle of the same name. Three modules became unused and are **no longer loaded by `index.html`**, though the files are kept on disk: `js/data/sequences.js`, `js/diagrams.js` and `js/animations.js`. To bring the library back, restore `app.js` and the three `<script>` tags. Two sources for the old version: the git history (this folder became a repository on 2026-09-19 — the removal predates the first commit, so use the backup for now), and the copy in `C:\Users\neuro\Desktop\proyec_viejo\web-app`, which holds the project exactly as it stood before this change.

**Stack:** HTML + CSS + Vanilla JS (no frameworks). No backend or bundler. Everything runs directly in the browser by opening `index.html`.

---

## Folder structure

```
web-app/
├── index.html              ← Entry point. Loads all scripts and styles.
├── rules.md                ← This file.
│
├── css/
│   ├── main.css            ← Global layout: sidebar, main area, CSS variables, dark theme.
│   └── components.css      ← Reusable component styles: cards, buttons, forms, modals.
│
├── js/
│   ├── app.js              ← Sidebar router. Mounts the four tools, exposes window.openTool.
│   ├── learn.js            ← Learn Pulseq: page renderer, three widgets, progress, self-checks.
│   ├── walkthrough.js      ← Step-by-step matrix: cell pictograms, row highlight, "?" panels, PyPulseq/MATLAB toggle.
│   ├── builder.js          ← Builder logic: form, code preview and .py exporter.
│   ├── inspector.js        ← Seq Inspector: .seq parser, diagram, k-space, sanity checks.
│   ├── simulator.js        ← Builder preview: PSD + k-space trajectory canvases.
│   ├── diagrams.js         ← (NOT LOADED) Static educational diagrams. Kept for a future restore.
│   ├── animations.js       ← (NOT LOADED) Canvas animation system. Kept for a future restore.
│   └── data/
│       ├── learn.js        ← Learn Pulseq content: 7 pages + the widget payloads.
│       ├── walkthrough.js  ← Walkthrough content: 9 rows × (spin / hardware / code / explanation).
│       ├── videos.js       ← Explainer video catalog, consumed by the Builder's video panel.
│       ├── sequences.js    ← (NOT LOADED) Educational sequence database. Kept for a future restore.
│       └── templates/      ← Pulseq/Python code blocks. The composer joins them to form the final .py.
│           ├── composer.js       ← Main function: receives params and assembles the script from blocks.
│           ├── common.js         ← Common blocks: preamble (imports, def main), body (system, FOV) and footer (write .seq).
│           ├── excitations.js    ← Blocks per excitation type: Spin Echo, Gradient Echo, Inversion Recovery.
│           └── trajectories.js   ← Blocks per trajectory: Cartesian, EPI, Radial, Spiral.
│
├── examples/
│   └── spin_echo_example.seq  ← A real 256-line SE, loaded by the Inspector's demo button.
│                               Carries a genuine prephaser defect — kept as a specimen.
│
├── python/
│   └── *.py                ← Reference PyPulseq scripts. Source of truth for the templates.
│
└── matlab/
    └── *.m.txt             ← Legacy Pulseq files in Matlab. Historical reference only.
```

**Current file status** (as of 2026-09-19):
- ✅ `index.html` — loads in order: `main.css`, `components.css`, data (`videos.js`, `learn.js`, `walkthrough.js`), templates (`common.js`, `excitations.js`, `trajectories.js`, `composer.js`), and logic (`simulator.js`, `builder.js`, `learn.js`, `walkthrough.js`, `inspector.js`, `app.js`). The sidebar header is just `MRI Design`; the welcome screen is only a placeholder, since `app.js` opens Learn Pulseq immediately.
- ✅ `css/main.css` — global layout, variables, sidebar and educational view. `.main-content` carries `min-width: 0` so a wide child (the walkthrough table) scrolls inside itself instead of pushing the whole page sideways — a flex item does not shrink below its min-content width without it.
- ✅ `css/components.css` — Builder styles, sidebar separator, section headers (`.nav-section-header`), **group dividers** (`.section-group-divider`), **inline diagrams** (`.diagram-wrapper`), **contrast tables** (`.contrast-table`), download button, **conditional form fields** (`.is-hidden`, `.field-hint`), **sequence walkthrough** (`.wt-*`).
- ✅ `js/app.js` — sidebar router, ~95 lines. Mounts four entries through the `addTool()` helper — **Learn Pulseq**, **Sequence Walkthrough**, **Sequence Builder**, **Seq Inspector** — activates the first on load, and exposes **`window.openTool(id, arg)`** so a module can hand the reader on to the next. `arg` is forwarded to the module's entry point, which is how a lesson opens the Builder with a preset.
- ✅ `js/learn.js` — **Learn Pulseq**: renders a seven-page guide from `learnData` with a tab strip and a prev/next pager, drives three interactive widgets (`seq-anatomy`, `block-anatomy`, `raster-clock`), and adds the course layer — saved progress, a self-check question per page, and the "try it" hand-off. Exposes `window.initLearn(pageId)`.
- ✅ `js/data/learn.js` — the seven pages plus the widget payloads. Exposed as `window.learnData`.
- ✅ `js/inspector.js` — **Seq Inspector**: parses a dropped `.seq` (sections, RLE-compressed shapes, both the 1.4 and 1.5 column layouts), then renders a summary, sanity checks, the header definitions, a timing diagram of the first repetition, a paged block list with a per-block explanation, and the k-space trajectory. Exposes `window.initInspector()`.
- ✅ `js/walkthrough.js` — **Sequence Walkthrough**: a 9-row × 3-column interactive matrix (spin drawings / hardware & pulses / associated code). Paints **17 cell pictograms** on canvas, synchronizes the row highlight across the three columns, unfolds a didactic panel per row and switches every snippet between PyPulseq and Pulseq (MATLAB). Exposes `window.initWalkthrough(id)`.
- ✅ `js/data/walkthrough.js` — walkthrough content keyed by id (currently `se-2ddft`). Exposed as `window.walkthroughData`.
- 💤 `js/diagrams.js` — **not loaded** since the educational library was removed. **6 static diagram types**: `t1-curves` (T1 recovery curves), `t2-curves` (T2/T2* decay), `nutation-recovery` (RF nutation + recovery), `spin-refocus` (180° refocusing), `coherent-incoherent` (spoiled vs balanced SSFP), `ir-recovery` (IR recovery from −M₀ with null points and STIR/FLAIR markers). Exposes `window.drawDiagram(canvasId, type)`.
- 💤 `js/animations.js` — **not loaded** since the educational library was removed. Supports **7 animation types**: 3 RF-only (`gre-rf`, `se-rf`, `ir-rf`) and 4 trajectory (`gre`, `epi`, `radial`, `spiral`).
- ✅ `js/simulator.js` — **Sequence preview for the Builder**: generates a Pulse Sequence Diagram (PSD) showing 5 channels (RF, Gz, Gy, Gx, ADC) that adapt to all 12 excitation×trajectory combinations (GRE/SE/IR × Cartesian/EPI/Radial/Spiral). Also draws k-space trajectory with ADC sample dots. Exposes `window.drawBuilderPreview(params)`.
- ✅ `js/builder.js` — Builder form, code preview, `.py` exporter. Calls `drawBuilderPreview(params)` on every form change to update PSD + k-space canvases. **Conditional fields**: `Venc` follows the `phaseContrast` checkbox; `Inversion Time TI` follows the `Inversion Recovery` excitation option (see "Conditional fields" below).
- 💤 `js/data/sequences.js` — **not loaded** since the educational library was removed. **7 entries with `category` field**: 3 excitations and 4 trajectories. GRE, SE and IR have **expanded sections** with contrast content, tables, inline diagrams, and **thematic groups** (`group` on each section: Introduction, Relaxation, Contrast & Variants, etc.).
- ✅ `js/data/videos.js` — empty catalog with documented schema. Exposed as `window.videoData`.
- ✅ `js/data/templates/*.js` — **Fully implemented** PyPulseq code generators. `common.js` generates the imports + `def main()` preamble, the system setup and the footer with timing check + `.seq` write. `excitations.js` generates RF definitions for GRE/SE/IR with TE delay calculations; the IR block emits `ti` from `params.ti`. `trajectories.js` generates readout gradients and acquisition loops for Cartesian/EPI/Radial/Spiral, adapting the loop to the excitation type. `composer.js` assembles preamble + body + excitation + trajectory + footer into a complete runnable script.
- ✅ `python/*.py` — Reference PyPulseq scripts: `gradient_echo.py`, `spin_echo.py`, `inversion_recovery.py`, `epi.py`, `radial.py`, `spiral.py`, `write_2Dt1_mprage.py`. Source of truth for the template code. Standalone — the app does not import or execute them.
- ✅ `matlab/*.m.txt` — 5 legacy Pulseq scripts: `seq_GE.m.txt`, `seq_SE.m.txt`, `epi.m.txt`, `diametral_par.m.txt`, `spiral.m.txt`. Historical reference; the templates now target Python.

**Script load order (important):**
The 3 block files (`common.js`, `excitations.js`, `trajectories.js`) must load **before** `composer.js`. The `composer.js` must load **before** `builder.js`. `diagrams.js` must load **before** `app.js`. `data/walkthrough.js` must load **before** `walkthrough.js`. The `app.js` loads last so that `window.initBuilder`, `window.initWalkthrough` and `window.drawDiagram` are already available when the sidebar is mounted.

---

## File by file

### `index.html`
- **Role:** App shell. Defines the static DOM: fixed sidebar + main content area.
- **Loads:** first CSS (`main.css`, `components.css`), then data (`sequences.js`, `videos.js`, `walkthrough.js`), templates (`common.js`, `excitations.js`, `trajectories.js`, `composer.js`), and logic (`animations.js`, `builder.js`, `walkthrough.js`, `app.js`).
- **Rule:** Don't add logic here. Only HTML structure and script load order.
- **Key elements:**
  - `#nav-list` — sidebar list. `app.js` injects items on init.
  - `#content-container` — main div where all dynamic content is rendered.

---

### `css/main.css`
- **Role:** Global visual theme, CSS variables, two-column layout (sidebar + main).
- **CSS variables defined here** (always use these, don't hardcode colors). These are the names the file actually declares — an earlier revision of this document listed a `--color-*` set that never existed:
  - `--bg-base` — main dark background (`#0f172a`)
  - `--bg-glass` — card, sidebar and panel background (translucent slate)
  - `--border-glass` — hairline border used on every glass surface
  - `--text-primary` — primary text (`#f8fafc`)
  - `--text-secondary` — secondary/muted text (`#94a3b8`)
  - `--accent-color` — primary cyan (`#38bdf8`)
  - `--accent-glow` — accent halo for hover/active shadows
  - `--sidebar-width` — sidebar width (`280px`)
  - `--font-sans` / `--font-display` — Inter and Outfit
- **Layout note:** `.main-content` sets `min-width: 0`. It is a flex item, and without it a wide child cannot shrink below its own min-content width, so the page itself gains a horizontal scrollbar instead of the child scrolling internally.
- **Rule:** Don't add specific component styles here. Only layout and variables.

---

### `css/components.css`
- **Role:** Reusable component styles that appear in multiple sections.
- **Includes:** parameter cards, buttons, simulator forms, export modal, video section, badges, tabs.
- **Form helpers:** `.builder-form .is-hidden` (removes a conditional field from the flow — used by `#ti-field`) and `.field-hint` (small muted note next to an input).
- **Rule:** Each new component goes here, with a section comment (`/* === NAME === */`).

---

### `js/data/sequences.js`
- **Role:** Educational content database. Exports the global variable `mriData` (array).
- **Organization:** Two categories separated by `category` field:
  - `'excitation'` — Excitation types (GRE, SE, IR). Depend on RF pulses. Use `animationType` with `-rf` suffix (`gre-rf`, `se-rf`, `ir-rf`).
  - `'trajectory'` — Trajectories (Cartesian, EPI, Radial, Spiral). Depend on Gx, Gy gradients. Use `animationType` without suffix (`gre`, `epi`, `radial`, `spiral`).
- **Any real MRI sequence combines ONE excitation + ONE trajectory.** The Sequence Builder allows that combination.
- **Structure of each element:**
```js
{
    id: 'gre',               // unique string, lowercase, no spaces
    category: 'excitation',  // 'excitation' | 'trajectory'
    title: 'Gradient Echo',  // Full name
    subtitle: 'Subtitle',    // Short description
    sections: [              // Array of educational text sections
        { group: 'Introduction', heading: 'Physical Principle', content: 'plain text...' },
        { heading: 'RF Characteristics', content: 'text...' },
        { group: 'Contrast', heading: 'Table', content: '<table>...</table>', html: true },
        { heading: 'Relaxation', content: 'text...', diagrams: ['t1-curves'] }
    ],
    parameters: [            // Key parameters shown in cards
        { name: 'RF Pulse', value: 'Single pulse, flip angle α' }
    ],
    equation: 'S = ...',     // LaTeX equation (rendered by KaTeX)
    animationType: 'gre-rf'  // Must match a case in animations.js
}
```
- **Section properties:**
  - `group` (string, optional) — thematic group name. When it changes from the previous section, `app.js` inserts a visual divider (`.section-group-divider`). Sections without `group` inherit the previous section's group. If at least one section has `group`, a "Signal Equation" divider is automatically added before the parameters and equation.
  - `content` (string) — plain text (wrapped in `<p>`; supports `\n\n` to separate paragraphs).
  - `html` (boolean, optional) — if `true`, `content` is injected as raw HTML (tables, lists, etc.).
  - `diagrams` (string[], optional) — array of diagram types to render after the content (see `diagrams.js`).
- **To add a sequence:** Add an object to the `mriData` array with the correct `category`. The `animationType` must have its corresponding case in `animations.js`.
- **Rule:** Don't add logic here, only data. Don't rename `mriData`.

---

### `js/data/templates/` (folder)

The Builder combines dimension × trajectory × excitation, yielding dozens of possible combinations. To avoid one file per combination, the `.py` code is assembled from **modular blocks**. Each block is a function that returns a Python code fragment; `composer.js` assembles them.

Final assembled script structure:
```
[ common.preamble(p) ]          ← column 0: imports + def main(...) + docstring
[ common.body(p) ]        ┐
[ excitations.<type>(p) ] ├─ indented 4 spaces by the composer
[ trajectories.<type>(p) ]│
[ common.footer(p) ]      ┘
[ if __name__ == '__main__': ]  ← column 0
```

#### `composer.js`
- **Role:** Main assembly function. Exposes `window.pulseqTemplates.compose(params)` which receives the params object and returns the complete `.py` string.
- **Logic:** decides which excitation and trajectory function to call based on `params.excitation` and `params.trajectory`, concatenates with preamble, body and footer, and indents the function body by 4 spaces.
- **Rule:** Don't add Python code here. This is orchestration only; code lives in the block files.

#### `common.js`
- **Role:** Defines three functions: `preamble(params)`, `body(params)` and `footer(params)`.
- `preamble` — imports (`pathlib.Path`, `numpy`, `pypulseq`), `def main(...)` signature and docstring (written at column 0). Flags: `plot`, `test_report`, `write_seq`, `save_plots`, `seq_filename`. The docstring reports dimension, FOV, resolution and, when `params.inversionRecovery` is true, the `TI` in ms.
- `body` — declares FOV, matrix size, slice thickness, TE/TR, defines the Pulseq system (`pp.Opts`) and creates the `seq` object.
- `footer` — closes the sequence: timing check, test report, **plot save/show**, definitions, `seq.write(seq_filename)`, `return seq`.
- Exposes: `window.pulseqTemplates.common = { preamble, body, footer }`.

**Output location (in `footer`)** — the footer opens by hoisting the two names every artifact reuses, so the report, the PNGs and their filenames all agree:
```python
out_dir = Path(__file__).resolve().parent   # the script's own folder, NOT the cwd
stem = Path(seq_filename).stem              # shared prefix for every artifact
```

**Report saving (in `footer`)** — the run log is collected into `report_lines` instead of being printed directly, then printed **and** written to `<stem>_report.txt`:
- Contents: the `check_timing()` verdict, followed by `seq.test_report()` when `test_report=True` (blocks, event counts, duration, TE/TR, flip angles, k-space, resolution, max gradient/slew).
- Flag `save_report: bool = True`. It only writes when the report is non-empty, so `test_report=False` on a script without a timing check produces no stray file.
- **Rule:** anything added to the run log goes through `report_lines.append(...)`, never a bare `print()` — a direct print lands on the console but not in the `.txt`.

**K-space figure (in `footer`)** — the footer builds a third figure the app itself draws, not PyPulseq:
```python
k_traj_adc, k_traj, _, _, _ = seq.calculate_kspacePP()
#   k_traj_adc → (3, n_adc)  the points the ADC actually samples
#   k_traj     → (3, n_grad) the continuous path the gradients trace
#   row 0 = kx, row 1 = ky, row 2 = kz
```
Plotted as `k_traj` in grey (the path, including prephasers and rewinders) plus `k_traj_adc` as red dots (what is measured), equal aspect, saved as `<stem>_kspace.png`. **The axes are framed on `k_traj_adc`, not on `k_traj`** — a stray excursion in the grey path (spoiler, rewinder, or a broken trajectory) would otherwise squash the sampled k-space into an unreadable dot. It requires `import matplotlib.pyplot as plt` in the preamble — that is why the generated scripts import pyplot directly.
- Only kx/ky are drawn. Every trajectory the Builder emits fills a 2D plane, so kz carries no information here; a real 3D trajectory would need this figure reworked.
- **Sanity check:** `|k|max` should equal `n_x / (2 · FOV)`. Cartesian and Radial match it exactly; use it to spot a broken trajectory.
- ⚠️ **This figure is NOT authoritative for multi-shot sequences.** `calculate_kspace()` does not restart k at each excitation, so shot 2 onwards can be drawn displaced even when the sequence is correct — a multi-shot spiral shows up as a scattered "flower" of spirals instead of concentric ones. A refocusing pulse masks it (the 180 folds the accumulation back), which is why spiral+SE looks right and spiral+GRE does not, from the *same* trajectory.
  To check a trajectory for real, integrate the block areas instead — this is ground truth, and it is what proved the generated spiral correct:
  ```python
  kx = ky = 0.0
  for i in range(1, len(seq.block_events) + 1):
      b = seq.get_block(i)
      if getattr(b, 'gx', None) is not None: kx += b.gx.area
      if getattr(b, 'gy', None) is not None: ky += b.gy.area
      # k must be 0 at every excitation and back to 0 after the rewinder
  ```

### Big sequences: write first, render maybe

Rendering, not building, is what freezes Python on a large 3D. Measured on a 24576-block 3D (128 × 128 × 32):

| | guarded | rendered |
|---|---|---|
| build the sequence | 15.0 s | 14.5 s |
| `seq.write()` | 1.8 s | 1.8 s |
| `seq.plot()` + `calculate_kspace()` | — | **523.2 s** |
| **total** | **16.8 s** | **539.5 s** |

On a smaller 5940-block sequence the split was `write()` 0.7 s, `calculate_kspace()` 2.1 s, `seq.plot()` **101.2 s**. So `seq.plot()` is the hog by a factor of ~50 — **guarding only `calculate_kspace()` would not fix the freeze**, which is why the guard wraps the whole rendering block.

**With plots already off, the cost moves to the report.** Measured on a 57600-block multislice SE (256 × 256 × 25 slices):

| | time |
|---|---|
| build the loop | 4.0 s |
| `seq.check_timing()` | **101.0 s** |
| `seq.test_report()` | **76.1 s** |
| `seq.write()` | 4.5 s |

`seq.test_report()` calls `self.calculate_kspace()` internally (confirmed in `ext_test_report`), so it carries the same cost as the plots and now sits behind the same `n_repetitions > 1000` guard — the run log says the report was skipped and why.

`seq.check_timing()` is **not** guarded and should not be: it is the verdict on whether the sequence is valid at all, and skipping it to save time on a sequence you intend to run is false economy. It is simply the price of a 57600-block sequence.

Three hypotheses about the build cost were measured and **all three were wrong** — `pp.make_trapezoid` (0.005 ms), `seq.add_block` with fresh vs reused gradient objects (no difference), and `pp.calc_duration` on an RF pair (1.4 µs) are all effectively free. Building blocks is cheap; analysing them is not. Don't micro-optimise the loop.

Three rules follow, all implemented in `common.js`:

1. **`seq.write()` runs BEFORE any rendering**, right after the definitions. Writing is cheap and must not be held hostage by plotting — nor lost if matplotlib dies.
2. **`save_plots` defaults to `False`** whenever `dimension === '3D'` or `nSlices > 1`, decided at generation time in `preamble()`. The docstring says why.
3. **The rendering block is skipped when `n_y * n_slices > 1000`**, printing `Secuencia 3D grande detectada. Se omite la visualización de k-space para evitar saturación de memoria.`

- **Rule:** `composer.js` must not force plots on in the `if __name__ == '__main__':` line for a big sequence — an explicit `save_plots=True` there overrides the preamble default and hands the freeze straight back.
- ⚠️ **Known limitation:** the threshold uses `n_y * n_slices`, which is the true repetition count for Cartesian and EPI but not for Radial (`n_spokes`) or Spiral (`n_interleaves`). A multislice spiral can trip the guard and lose its plots while being small. Switching the test to `len(seq.block_events)` would be exact.
- ⚠️ The skip message is Spanish while the rest of the codebase is English (see *Code conventions*). It is verbatim from the spec.

**Plot saving (in `footer`)** — every generated script writes its own diagrams to disk:
```python
seq_plot = seq.plot(plot_now=False)   # builds figures WITHOUT blocking
#   seq_plot.fig1 → RF magnitude/phase + ADC
#   seq_plot.fig2 → Gx, Gy, Gz
#   seq_plot.show() → opens the interactive windows (blocks)
```
- `plot_now=False` is what makes this possible: it returns a `pypulseq.utils.seq_plot.SeqPlot` instead of calling `plt.show()` immediately, so the figures can be saved **before** being (optionally) shown. Saving after a blocking `show()` yields blank images, so the order matters — never swap it.
- Output: `<seq_filename stem>_rf_adc.png` and `<stem>_gradients.png`, `dpi=200`, into `Path(__file__).resolve().parent` — **the folder of the script itself**, not the current working directory. Each write prints its absolute path.
- `save_plots=True` is the default, so simply running the downloaded `.py` produces the images. `plot` and `save_plots` are independent: saving does not require showing.
- Note: `seq.write(seq_filename)` still resolves against the **current working directory**, so the `.seq` and the PNGs only land together when the script is run from its own folder.
- **Requires a working matplotlib** — `seq.plot()` renders on construction, so a broken matplotlib install crashes the script here whether or not `save_plots` is set.

#### `excitations.js`
- **Role:** RF pulse code blocks and timing. One function per type:
  - `spinEcho(params)` — 90° pulse + 180° refocusing pulse.
  - `gradientEcho(params)` — excitation pulse with arbitrary `flipAngle`, no refocusing.
  - `inversionRecovery(params)` — 180° inversion pulse + TI delay + 90°/180° excitation block. **Emits `ti` from `params.ti`** (ms in the form → seconds in the script), falling back to 150 ms if the params object carries no `ti`.
- **Every block must emit `excitation_duration`** — the total time its prologue occupies in one loop iteration. The trajectory blocks subtract it from TR (see *TR is a period, not a suffix*). Adding a block to a prologue without updating this silently lengthens TR.
- Exposes: `window.pulseqTemplates.excitations = { spinEcho, gradientEcho, inversionRecovery }`.

#### `trajectories.js`
- **Role:** Code blocks defining encoding gradients + readout + acquisition loops. One function per trajectory:
  - `cartesian(params)` — line-by-line phase encoding.
  - `epi(params)` — oscillating readout (zigzag).
  - `radial(params)` — rotated spokes (uses `nShots`).
  - `spiral(params)` — simultaneous oscillating gradients (uses `nInterleaves`). Works for all three excitations; see `python/spiral.py` for the seven corrections it carries (k_radius, ADC coverage, vector slew, shared ADC delay, rewinder, rewinder slew budget, TE/TR accounting). **Keep the two in sync.**
- Each function must respect the `params.dimension` flag (`'2D'`, `'3D'`, `'multislice'`) and emit the corresponding loops — see **Slices and partitions** below. All four go through the shared `sliceWrap()` helper, so the loop exists in one place only.
- Exposes: `window.pulseqTemplates.trajectories = { cartesian, epi, radial, spiral }`.
### Slices and partitions

`params.nSlices` (UI field `nSlices`, 1–256) drives all three dimensions. It used to be documented here but was never implemented — `dimension` only changed `slice_thickness` and the filename.

| `dimension` | UI | What the generated script does |
|---|---|---|
| `2D` | field **disabled, forced to 1** | one slice, no extra loop |
| `multislice` | field editable | `for i_slice in range(n_slices)` setting `rf.freq_offset = gz.amplitude * z_positions[i_slice]` (plus `rf2` for SE/IR and `rf_inv` for IR). Slices **share one TR** |
| `3D` | field editable | `for i_slice in range(n_slices)` building a `gz_phase` trapezoid of area `kz_areas[i_slice]`, played as its own block before the readout. Each partition costs a **full TR** |

- `common.js` → `body()` emits `n_slices` always, plus `z_positions` (multislice) or `delta_kz` / `kz_areas` / `pre_time_z` (3D).
- `trajectories.js` → `sliceWrap(params, exc, bodyLines)` wraps one TR's worth of blocks. **`hasSliceLoop()` and `guardFor()`** go with it: the too-short-TR warning must fire once, not once per slice.
- **Rule:** the per-TR computation (`te_delay`, `iteration_duration`, `tr_delay`) must live **inside** the slice loop, because in 3D it depends on `gz_phase`, which the loop creates.
- **Rule:** `sliceWrap` flattens its input on `\n` before indenting. Entries such as `trDelayCode()` and `rfBlock` are multi-line strings; indenting only the first line of each entry silently emits broken Python — that exact bug appeared while writing this.
- **TR semantics differ by mode** and `trDelayCode()` takes `params` to pick: multislice divides the budget (`tr / n_slices`, since the recovery time of one slice is spent exciting the others); 2D and 3D use the full `tr`.
- Verified by running the generated scripts: 3D cartesian GRE → 48 excitations, **1** RF offset, **3** distinct kz areas; multislice cartesian SE → 48 excitations, **3** RF offsets, no kz encoding. Both pass `check_timing()`.

**TR is a period, not a suffix.** `seq.add_block(pp.make_delay(tr))` at the end of a loop is **wrong** — it appends a whole TR *on top of* everything the iteration already played, so the real TR is TR + prologue + readout. The failure is silent: the sequence builds and `check_timing()` passes; it just scans at the wrong TR. Every trajectory now emits, via the shared `trDelayCode()` helper:

```python
iteration_duration = (
    excitation_duration        # from excitations.js — the whole RF prologue
    + <this trajectory's own block durations>
)
tr_delay = tr - iteration_duration
```

- `excitation_duration` is defined by each block in `excitations.js` and covers exactly what that prologue plays: `calc_duration(gz, rf)` for GRE; the 90 + rephaser + delay1 + 180 + rephaser + delay2 chain for SE; the same plus the inversion pulse, its rephaser and `delay_ti` for IR. **Add a block to a prologue → update its `excitation_duration`.**
- Radial's dummy scans get their own `dummy_delay` so they run at the same TR as the real spokes.
- When TR does not fit, the script **prints a warning naming the shortest achievable TR** (once, on the first iteration) instead of silently clamping.
- Verified by walking `seq.block_durations` between excitation peaks: cartesian+IR, EPI+GRE, radial+GRE and all three spirals land on the requested TR to within one `block_duration_raster` tick (0 µs for the first three).

**TE for gradient echo** follows the same logic — a bare `make_delay(te)` also added a full TE on top. Each trajectory now subtracts what precedes the echo: half the excitation, the prephasers, and half the readout (half the *echo train* for EPI, the *start* of the readout for spiral, since a spiral samples the k-space centre first).

**A negative delay is an error, not something to clamp.** `excitations.js` used to write `delay1 = max(round(...), 0.0)`. When TE is too short for the pulses, that silently pins the delay at zero: the 180 stops sitting at TE/2, the echo never refocuses, and the sequence still builds and still passes `check_timing()`. The SE and IR blocks now **raise `ValueError`** naming the shortest usable TE (10.3 ms with the default 3 ms pulses and 2 ms rephasers), and likewise for a TI shorter than the inversion pulse plus its rephaser. Clamping is only acceptable where the clamped value is still physically meaningful — `tr_delay`, which warns.

- **Rule:** every delay a block emits must be snapped to `system.block_duration_raster` before `pp.make_delay()`. An off-raster delay passes silently at some TE/TI values and fails `check_timing()` with a RASTER error at others — the delays in `excitations.js` do this, and new ones must too.
- **Rule:** when two gradient channels play together, size them against `1/sqrt(2)` of `max_grad`/`max_slew`, or compute the duration from `np.hypot` of the two amplitudes. Giving each channel the full limit puts the combined vector over hardware.

#### `params` object received by all functions
```js
{
    dimension: '2D' | '3D' | 'multislice',
    nSlices: number,     // 1 for 2D; slices (multislice) or kz partitions (3D)
    trajectory: 'cartesian' | 'epi' | 'radial' | 'spiral',
    excitation: 'spinEcho' | 'gradientEcho' | 'inversionRecovery',
    nShots: number,
    nInterleaves: number,
    fov: { x: number, y: number, z: number },  // in cm
    resolution: { x: number, y: number },       // in mm
    tr: number,         // ms
    te: number,         // ms
    ti: number,         // ms, only meaningful if inversionRecovery === true
    flipAngle: number,  // degrees
    inversionRecovery: boolean,  // derived: excitation === 'inversionRecovery'
    spoiler: boolean,
    phaseContrast: boolean,
    venc: number        // cm/s, only if phaseContrast === true
}
```

**`inversionRecovery` / `ti` contract:** `inversionRecovery` is *derived* in `builder.js` from the excitation radio, never stored independently — the radio is the single source of truth. When it is `false` the TI input is hidden and disabled, and no template emits a `ti` symbol. When it is `true`, `excitations.inversionRecovery()` emits `ti = <params.ti / 1000>` and the trajectory loop adds the inversion pulse, the spoilers and the TI delay.

- **Source of truth:** The `.py` files in `python/` are the originals. The blocks here must stay in sync with them.
- **Rule:** Don't rename the namespaces (`window.pulseqTemplates.common`, `.excitations`, `.trajectories`). The composer depends on those names.
- **Rule:** Don't mix one block's code inside another. If a fragment is common to multiple cases, it goes in `common.js`.

---

### `js/data/videos.js`
- **Role:** Educational video catalog. Exports the global variable `videoData` (array).
- **Structure of each element:**
```js
{
    id: 'intro-gre',
    title: 'How to design a GRE sequence',
    description: 'Step-by-step explanation of GRE design in Pulseq.',
    embedUrl: 'https://www.youtube.com/embed/VIDEO_ID',
    sequenceId: 'gre',      // Links the video to a sequence (optional, can be null)
    category: 'basic'       // 'basic' | 'advanced' | 'pulseq'
}
```
- **Rule:** Always use embed URLs (not regular YouTube URLs). Don't rename `videoData`.


---

---

### `js/data/learn.js`
- **Role:** Content for the Learn Pulseq section. Exposes `learnData`, an object with two keys: `widgets` (payloads for the three interactive widgets) and `pages` (an array of seven pages, rendered in order).
- **Source material:** the SWiM / CAMERA deck *Open Pulse sequence programming for MRI* (`Swim_mint_2026.pdf`), plus the `pulseq/pypulseq` example repository and its `STYLE_GUIDE.md`. When either source changes, this file is what needs updating — `learn.js` carries no content.
- **The seven pages:**

  | id | Tab | Covers |
  |---|---|---|
  | `why-pulseq` | Why Pulseq | Vendor lock-in, the four proprietary environments, one `.seq` → five interpreters, Layton et al. MRM 2017 |
  | `seq-file` | The .seq file | `[BLOCKS]` / `[RF]` / `[TRAP]` / `[ADC]` / `[SHAPES]` and the pointer chain between them |
  | `blocks` | Blocks | Blocks in series, events in parallel; the per-block limits; the three-level hierarchy |
  | `clock` | The clock | The three raster times and why an off-grid duration is rejected |
  | `simulate` | Simulate | `plot` / `calculate_kspace` / `check_timing` / `test_report`, PNS & SAR, the three Bloch simulators |
  | `pitfalls` | What breaks | The six silent failures — TR as a suffix, the SE prephaser sign, clamped delays, the SE rewinder, per-axis limits, the spiral that collapses at 16 interleaves |
  | `round-trip` | Round trip | The five stages from design to execution, why it matters, and where this app sits |

  The `pitfalls` page is the one with no equivalent anywhere else: every entry is a bug that
  **passes `check_timing()`** and still ruins the scan. They are transcribed from the ⚠️ notes
  scattered through this document, which is where that knowledge was earned. When a new
  failure mode is discovered and documented here, add it there too.

- **Page schema:** `{ id, nav, title, lead, blocks: [...], check?, task? }`. `nav` is the short tab label; `lead` is the paragraph under the title. `check` and `task` are documented under *The course layer in Learn Pulseq*.
- **Content block types** the renderer understands. Adding a new type means adding a case to `renderBlock()` in `learn.js`:
  - `{ type: 'prose', html }` — free HTML paragraphs.
  - `{ type: 'note', html }` — accent-bordered callout.
  - `{ type: 'cards', title?, columns?, items: [{ title, sub?, body, tag? }] }` — grid of cards; `columns` sets `--lp-cols`.
  - `{ type: 'flow', title?, left, hub, right }` — the "written in → .seq → played by" diagram.
  - `{ type: 'steps', title?, items: [{ title, body }] }` — numbered stages.
  - `{ type: 'table', title?, head, rows, note? }` — plain table; the first column is rendered monospaced.
  - `{ type: 'widget', widget: 'seq-anatomy' | 'block-anatomy' | 'raster-clock' }` — pulls its data from `learnData.widgets`.
- **`html` fields are injected raw.** They are authored here, never user input, so that is safe — but don't wire user-supplied text through them.
- **Widget payloads:**
  - `widgets.seqAnatomy` — an abridged `.seq`. Each `[BLOCKS]` row carries `refs`, a list of `"<section>:<id>"` keys that must match the `key` of a row in `sections`. **A typo in a ref silently lights nothing up**, so keep the two in step.
  - `widgets.blockAnatomy` — the five blocks of one gradient-echo TR, each with its events and a note. The number of entries must stay at five, because `BLOCK_SPAN` in `learn.js` fixes the column widths of the drawn diagram.
  - `widgets.rasterClock` — the three rasters (10 µs / 1 µs / 100 ns) plus the slider's `min`, `max`, `step` and `start`. `step: 0.5` is deliberate: it lets a duration fail the 1 µs RF raster as well as the 10 µs gradient one, which is the point of switching rasters.
- **Rule:** Don't add logic here, only data. Don't rename `learnData`.

---

### `js/learn.js`
- **Role:** Renders the Learn Pulseq pages and drives their widgets.
- **Public function:** `window.initLearn(pageId)` — mounts into `#content-container` with the usual fade. Called with no argument it reopens the last page viewed in this session (module-level `currentPage`), falling back to the first page.
- **Navigation:** the tab strip and the prev/next pager both emit `data-page`, and a single delegated click handler on the section root re-renders. Re-rendering rewires the widgets from scratch, which is why widget state (selected block, slider position) resets on a page change — acceptable, and it keeps the module free of cross-page state.
- **The three widgets:**
  1. **`seq-anatomy`** — hovering or focusing a `[BLOCKS]` row adds `.is-source` to it and `.is-referenced` to every event row its `refs` name, and swaps the caption under the table for that block's label. Pure DOM; no canvas. `mouseleave` on the blocks panel clears it.
  2. **`block-anatomy`** — a 5-block PSD drawn on `#lp-psd` (820 × 300). Selecting a block redraws the canvas with the other four dimmed and fills a detail panel with the events inside it. Selectable three ways: the chip row, a click on the diagram (hit-tested against `blockBounds()`), and on mount it selects block 1.
  3. **`raster-clock`** — a duration slider plus a raster picker. Redraws a trapezoid against the tick grid on `#lp-raster-canvas` (820 × 230), green when `duration / raster` is a whole number and red when it is not, and prints the `check_timing()` verdict — including the exact `np.ceil(...)` line that would fix it. When the tick spacing would fall below 4 px (the 100 ns raster), only every tenth line is drawn.
- **Why the drawing helpers are local:** `learn.js` keeps its own `trapezoid()` / `text()` / palette, as `walkthrough.js` does. Neither exports them, because the code conventions cap the number of globals; the duplication is deliberate and small.
- **Rule:** Don't change the signature of `window.initLearn`. Content goes in `js/data/learn.js` — nothing user-visible should be hardcoded here.
- **Rule:** A new widget needs three things: a payload in `learnData.widgets`, an `xHTML()` + `wireX()` pair here, and a case in `renderBlock()`. Wire functions must tolerate their widget being absent from the current page — they all start with a `querySelector` guard.

---

---

### The learning path

The four modules are one course, not four tools. Two mechanisms hold them together:

1. **`window.openTool(id, arg)`** — exposed by `app.js`. It activates a sidebar entry and forwards `arg` to that module's entry point. Every module listens for clicks on `[data-tool]` and calls it.
2. **The `.next-step` panel** — the last thing each module renders. Learn Pulseq → Walkthrough → Builder → Inspector → back to the Builder.

- **Rule:** a module must never call another module's `init*` directly. Route through `openTool` so the sidebar stays in sync with what is on screen.
- **Rule:** every `.next-step` panel carries `data-tool="<id>"` on its button, and the ids are the ones registered in `app.js`: `learn`, `walkthrough`, `builder`, `inspector`.

### The course layer in Learn Pulseq

- **Progress** lives in `localStorage` under `mint.learn.progress`, a JSON array of completed page ids. Every read and write is wrapped in `try/catch`: a private window or a browser blocking storage must degrade to "progress not remembered", never to a broken page.
- **A lesson counts as completed when its self-check is answered correctly.** A wrong answer reveals the explanation but banks nothing, so the tab keeps its number until the reader retries. This is deliberate — the tick has to mean something.
- **`page.check`** — `{ question, options: [], answer: <index>, explain }`. `question` and `explain` accept HTML.
- **`page.task`** — `{ text, label, preset }`. The preset is handed to `initBuilder` through `openTool('builder', preset)`.

**Preset keys are Builder control `name` attributes**, not `params` keys — they read the way the form looks. The valid names are in `builder.js` → `readForm()`: `dimension`, `nSlices`, `trajectory`, `excitation`, `nShots`, `nInterleaves`, `fovX`, `fovY`, `fovZ`, `resX`, `resY`, `tr`, `te`, `ti`, `flipAngle`, `spoiler`, `phaseContrast`, `venc`. Unknown keys are ignored by `applyPreset`, so a stale lesson cannot break the Builder.

⚠️ **`window.initBuilder` now takes an optional `preset` argument.** The old rule said not to modify its signature; the change is additive and backwards compatible (`initBuilder()` with no argument behaves exactly as before, which is how `app.js` calls it when the user clicks the sidebar). **The rule still stands for making `preset` required, or for changing what the existing call does.**

### Anchored micro-clips

`videos.js` entries may carry an `anchor` pinning a short clip to one exact place:

- `{ module: 'learn', page: '<page id>' }` — folds out at the foot of that Learn page.
- `{ module: 'walkthrough', sequence: '<id>', row: <0-8> }` — adds a ▶ button beside the "?" in that row. `sequence` is optional.

An anchor pointing at nothing renders nothing, so a typo costs a missing video rather than a broken page. Keep the clips to 60–90 s: the point is a clip at the moment of confusion, not a lecture — a full video library is a losing fight against ISMRM's.

---

### `js/inspector.js`
- **Role:** Reads a `.seq` and explains it. The only module that consumes Pulseq rather than producing it.
- **Public function:** `window.initInspector()`.
- **Everything is client-side.** The file is read with `FileReader`; nothing is uploaded. The single network call is the optional bundled example, and it is wrapped so a `file://` page (where `fetch` is blocked) tells the reader to drop their own file instead of failing silently.

**The parser** (`parseSeq`) handles:
- Sections `[VERSION] [DEFINITIONS] [BLOCKS] [RF] [GRADIENTS] [TRAP] [ADC] [SHAPES] [SIGNATURE]`, skipping `#` comments.
- **Both the 1.4 and 1.5 column layouts.** Pulseq 1.5 inserts a `center` column into `[RF]`, which shifts `delay`. The parser switches on the column count (`>= 12` means 1.5) rather than on the declared version, because the version header and the actual columns have been known to disagree.
- **RLE-compressed shapes** (`decompressShape`). Pulseq stores the *derivative*, run-length encoded: two equal consecutive values are followed by a repeat count, and the running sum reconstructs the samples. A shape compression would not shrink is stored raw, which is why the reconstructed length is checked against `num_samples` before being accepted.

**k-space** (`computeKSpace`) integrates trapezoid areas block by block, resetting k at each excitation and mirroring it at each refocusing pulse. This is the ground-truth method `rules.md` recommends elsewhere, and it is deliberately **not** a port of `calculate_kspace()` — that function does not restart k at each excitation, so it draws multi-shot sequences displaced.

**Sanity checks** (`diagnostics`) are the point of the module. They look for what `check_timing()` structurally cannot see:

| Check | Fails when |
|---|---|
| `|k|max` matches the resolution | measured `|k|max` differs from `n_x / (2·FOV)` by more than 10 % |
| k crosses the centre during the readout | kx at the middle of any ADC window is more than 5 % of `|k|max` from the origin |
| TR is constant between excitations | the gap between excitations varies by more than 10 µs |
| Block durations are whole raster ticks | any `[BLOCKS]` duration is not an integer |

- **Rule:** a check must state the number it measured and the number it expected. "Failed" without the two values is useless to someone debugging a sequence.
- **Rule:** the k-space checks are heuristics tuned for Cartesian and radial. Non-Cartesian trajectories can legitimately fail the `|k|max` one, which is why it reports `warn` rather than `fail`.

**The timing diagram** trims trailing event-less blocks before scaling. A TR delay is routinely an order of magnitude longer than everything it follows, so drawing it to scale squashes the entire sequence into a few pixels; the caption names the duration that was left out.

**Block list paging:** 40 rows at a time (`PAGE_SIZE`). A real sequence has thousands of blocks — never render them all.

### `examples/spin_echo_example.seq`
- A real 256-line spin echo (2560 blocks, 128 s, Pulseq 1.5), copied from `se_pypulseq.seq` at the project root.
- ⚠️ **It carries a genuine defect, and that is why it is kept.** Its readout prephaser is `+gx.area/2` while the 180° is played *before* it, so nothing inverts k: kx sits 1004.7 1/m from the origin at every ADC centre and the centre of k-space is never sampled. The sequence is legal, `check_timing()` passes, and the image would be ruined — the exact failure the *What breaks* lesson describes. The Inspector's sanity checks find it.
- **Rule:** it is a specimen, not a reference. Don't copy it into `python/`, and don't "fix" it — it is the demo.

---

### `js/data/walkthrough.js`
- **Role:** Content for the Sequence Walkthrough. Exports the global variable `walkthroughData` — an **object keyed by walkthrough id**, not an array (`sequences.js` and `videos.js` are arrays; this one is not).
- **Current entry:** `'se-2ddft'` — *2D-DFT Cartesian SE*, 9 rows (0–8), one per instant of a single TR.
- **Structure:**
```js
{
    'se-2ddft': {
        id: 'se-2ddft',
        title: '2D-DFT Cartesian SE',
        subtitle: '...',
        intro: 'shown above the table',
        blockOrder: [ { row: 1, label: 'rf, gz' }, ... ],  // real seq.add_block() order
        rows: [
            {
                n: 0,
                spin:     { label, caption, diagram },  // diagram → painter id in walkthrough.js
                hardware: { label, caption, diagram },
                code:     { py: '...', matlab: '...' }, // the same step in both dialects
                explain:  { title, body, formula }      // body is raw HTML, formula is LaTeX
            }
        ]
    }
}
```
- **`blockOrder` exists because the table is didactic, not chronological.** Rows 2 and 4 present the two halves of TE side by side, but in the emitted script the second delay is played *after* the 180°. The strip under the table shows the true order and each chip links back to its row. If you reorder the rows, reorder this too.
- **Writing code snippets:** keep lines **under ~55 characters**. The code column is roughly 400 px wide; longer lines force a horizontal scrollbar inside the `<pre>`. This is why the delays hoist `raster = seq.grad_raster_time` into a local instead of repeating the attribute twice on one line.
- **Source of truth:** `python/spin_echo.py` for the PyPulseq column, `matlab/seq_SE.m.txt` for the MATLAB one. If either reference changes, update the snippets.
  ⚠️ The snippets follow the **python** block order (prephasers before the 180°, prephaser area **positive**). `matlab/seq_SE.m.txt` places the prephasers *after* the 180° and therefore uses a negative area; the MATLAB column here is transliterated from the Python reference, not copied from that file.
- **Rule:** Don't add logic here, only data. Don't rename `walkthroughData`.

---

### `js/walkthrough.js`
- **Role:** Renders and drives the Sequence Walkthrough: a table of 9 numbered rows × 3 columns (spin drawings / hardware & pulses / associated code), plus a leading row-number column.
- **Public function:** `window.initWalkthrough(id)` — mounts the walkthrough into `#content-container` (same fade-out/fade-in pattern as `initBuilder`). Defaults to `'se-2ddft'`.
- **Cell pictograms — 17 painters, registered in the local `painters` object:**
  - Spin column: `spin-b0-align`, `spin-excitation`, `spin-dephase`, `spin-dephase-wide`, `spin-prephase`, `spin-refocus-180`, `spin-rephase`, `spin-echo-peak`, `spin-relax`.
  - Hardware column: `hw-magnet`, `hw-rf-excite`, `hw-rf-refocus`, `hw-waiting` (used by rows 2 and 4), `hw-waiting-tr`, `hw-grad-prephase`, `hw-grad-readout`, `hw-adc-record`.
  - Every canvas is **300 × 160**, scaled to 100 % of its cell by CSS.
- **Why these are not in `diagrams.js`:** `window.drawDiagram` serves the full-width 750 × 300 educational diagrams embedded in `sequences.js` sections. These are small component-specific icons drawn at a different size for a different consumer, so they live with the component. Shared low-level helpers (`arrow`, `trapezoid`, `sinc`, `fan`, `clock`, `stickFigure`, …) are duplicated deliberately rather than exported — neither file exposes them, and the rules forbid new globals.
- **Interactivity:**
  1. **Synchronous row highlight** — pure CSS (`.wt-row:hover td`, `:focus-within`, `.is-linked`). Hovering any of the three columns lights up the whole row and its number badge. No JS is involved, so it also works from the keyboard: every `<tr>` carries `tabindex="0"`.
  2. **"?" button per row** — toggles the `hidden` attribute on `#wt-explain-<n>`, keeping `aria-expanded` in sync. Pressing Enter/Space on a focused row does the same.
  3. **Language toggle** — `PyPulseq` / `Pulseq (MATLAB)`. Rewrites every `<code>` from `row.code[lang]`; the current language lives in the module-level `currentLang`.
  4. **Block-order chips** — hovering one adds `.is-linked` to its row; clicking scrolls to and focuses it.
- **Syntax highlighting** is a ~15-line regex tokenizer (`highlight()`), not a library — no new CDN dependency. It runs **after** `escapeHtml()`, and matches comments and strings first so keywords inside them are left alone. Token classes: `.tok-comment`, `.tok-string`, `.tok-kw`, `.tok-ns`, `.tok-fn`, `.tok-num`, all styled in `components.css`.
- **KaTeX:** the `formula` of each explanation is rendered by calling `window.renderMathInElement` after `innerHTML`, same as `app.js` does.
- **Rule:** Don't change the signature of `window.initWalkthrough`. To add a pictogram, write the painter inside the IIFE and register it in `painters`; to add a row, add it to `data/walkthrough.js` — the component needs no change.
- **Rule:** The content of a row (labels, captions, code, explanations) lives in `data/walkthrough.js`. Don't hardcode any of it here.

---
---

### `js/diagrams.js`
- **Role:** Static educational diagrams drawn on canvas. Used as inline illustrations inside content sections.
- **Public function:** `window.drawDiagram(canvasId, type)` — draws a static diagram on the specified canvas.
- **Supported types:**
  - `t1-curves` — T1 recovery curves (Mz vs time) for fat, white matter, gray matter and CSF. Includes short/long TR markers and legend with T1 values at 1.5T.
  - `t2-curves` — T2 decay curves (solid) and T2* (dashed) for the same tissues. Short/long TE markers.
  - `nutation-recovery` — 4 panels showing: equilibrium (M₀ along z) → RF pulse (nutation) → Mxy in transverse plane → T1 recovery (Mz grows, Mxy decays).
  - `spin-refocus` — 4 panels of the xy plane seen from above: spins in phase → dephasing (T2*) → 180° inverts phases → refocusing (echo).
  - `coherent-incoherent` — 2 side-by-side panels: Spoiled/Incoherent (FLASH) vs Balanced/Coherent (TrueFISP), showing simplified gradient diagrams with spoiler vs symmetric refocusing.
  - `ir-recovery` — IR recovery curves (Mz from −M₀ toward +M₀) for fat, white matter, gray matter and CSF. Shows null points (Mz = 0) for each tissue and clinical markers for STIR (~150 ms) and FLAIR (~2770 ms). Y axis from -1 to +1.
- **Integration with sequences.js:** each section can have a `diagrams: ['type1', 'type2']` field. `app.js` creates a canvas per diagram and calls `drawDiagram()` after innerHTML.
- **Canvas:** internal resolution 750×300, scaled to 100% of the container via CSS.
- **Rule:** Don't modify the signature of `window.drawDiagram`. To add a new type, add the drawing function inside the IIFE and register it in the `handlers` object.

---

### `js/animations.js`
- **Role:** HTML5 canvas animation system. Shows pulse sequence diagrams (PSD) and animated k-space trajectories.
- **Public function:** `window.initAnimation(animationType)` — the only function `app.js` calls externally. Finds canvases by ID (`psd-canvas`, `kspace-canvas`, `kspace-full-canvas`).
- **Two operation modes:**
  - **RF-only (excitations):** types `gre-rf`, `se-rf`, `ir-rf`. Only uses `#psd-canvas`. Draws static PSD showing RF pulses, Gz, and Gx (readout). No Play button, no k-space. Gy always 0.
  - **Trajectories:** types `gre`, `epi`, `radial`, `spiral`. Uses all 3 canvases. Animated PSD + live k-space + full k-space with Play/Pause button.
- **3 possible canvases:**
  - `#psd-canvas` (800x380) — Wide PSD. Shows 4 lines (RF, Gz, Gy, Gx) with faint guide + highlighting up to the time cursor.
  - `#kspace-canvas` (500x500) — Live k-space. Draws cumulative trajectory (NOT cleared between cycles). Only present for trajectories.
  - `#kspace-full-canvas` (500x500) — Full static k-space. Shows ALL lines/spokes/spirals. Only present for trajectories.
- **Speed:** `speed = 1` (one time step per frame). Each cycle takes ~6.7s at 60fps.
- **kScale per type:** `{ gre: 3.0, spinecho: 3.0, epi: 6, radial: 2.0, spiral: 4.0 }`. If a trajectory looks too large or small, adjust only the corresponding value in `kScaleMap`.
- **RF-only types in `getGradients()`:**
  - `gre-rf`: sinc pulse scaled to 0.6 (angle α < 90°) + Gz slice select + Gx dephase/readout.
  - `se-rf`: 90° pulse (t=50) + 180° pulse (t=200) + Gz on both + Gx dephase/readout.
  - `ir-rf`: 180° inversion pulse (t=40) + TI wait + 90° pulse (t=160) + 180° refocus pulse (t=270) + Gz on all three + Gx dephase/readout.
- **How to add a new animation type:**
  1. Add a block in `getGradients()` defining rf, gz, gy, gx as a function of `t`.
  2. For trajectories: add the key to `kScaleMap` and to `cycleConfig` in `drawFullKSpace()`.
  3. For RF-only: no kScale or cycleConfig needed (drawn statically).
  4. The `animationType` must match the `animationType` field in `sequences.js`.
- **Critical rule:** Don't modify the signature of `window.initAnimation`. Don't touch the drawing utility functions (`drawGrid`, `drawKSpaceAxes`, `getTrapezoidValue`) unless you understand how it affects ALL existing animations.

---

### `js/simulator.js`
- **Role:** Visual preview for the Sequence Builder. Draws a Pulse Sequence Diagram (PSD) and k-space trajectory that update live when the user changes parameters.
- **Public function:** `window.drawBuilderPreview(params)` — called by `builder.js` on every form change.
- **PSD generation:** `generateWaveforms(params)` computes 5 channels (RF, Gz, Gy, Gx, ADC) as Float32Arrays with 1200 samples. The excitation determines RF pulse shapes and Gz slice-select waveforms (GRE: single sinc at flip angle; SE: 90°+180° sinc pair with TE/2 timing; IR: 180° inversion + TI + 90° + 180° refocusing). The trajectory determines Gy, Gx and ADC (Cartesian: prephase + single readout; EPI: oscillating Gx train with Gy blips; Radial: rotated Gx/Gy; Spiral: sinusoidal with increasing amplitude).
- **PSD drawing:** `drawPSD(canvas, params)` renders 5 color-coded channel strips (RF=red, Gz=blue, Gy=green, Gx=amber, ADC=cyan) with filled waveform areas, baselines, channel labels, time axis in ms, vertical grid, and sequence-type label (e.g. "SE + EPI").
- **K-space trajectories:** Cartesian (color-coded lines + green ADC dots), EPI (zigzag path + ADC dots), Radial (diametral spokes with center glow + ADC dots), Spiral (Archimedean arms with interleave colors + ADC dots).
- **Canvases:** `#builder-psd-canvas` (800×360, full width) and `#builder-traj-canvas` (400×400, centered), stacked vertically inside `.builder-sim`.
- **Rule:** `simulator.js` must load before `builder.js` so `window.drawBuilderPreview` is available.

---

### `js/builder.js`
- **Role:** Sequence Builder logic (the interactive tab). Renders the form, validates inputs, shows the code preview and triggers the `.py` download.
- **Public functions:**
  - `window.initBuilder()` — called by `app.js` when the user opens the Builder tab. Mounts the complete form inside `#content-container`.
- **Internal functions:** `readForm()` (DOM → `params`), `applyFieldRules()` (conditional field visibility), `updateVideo()`, `updatePreview()` (regenerates the `<pre>`), `downloadPython()` (calls `pulseqTemplates.compose(params)` and downloads `seq_<excitation>_<trajectory>_<dimension>.py`).
- **Form layout** (see Builder Tab below for visual detail):
  1. **Dimension** — radio buttons: `2D (single slice)` / `3D` / `Multislice`, plus the `Slices` numeric input (1–256, disabled and pinned to 1 for `2D`) with a hint that changes per mode.
  2. **Trajectory** — radio buttons: `Cartesian` / `EPI` / `Radial` / `Spiral`. Below, two numeric inputs: `N shots` and `N interleaves`. **On `Spiral` these two are one and the same number** — editing either mirrors it into the other and a hint says so; they stay independent for the other trajectories.
  3. **Excitation** — radio buttons: `Spin Echo` / `Gradient Echo` / `Inversion Recovery`. Directly below, the conditional `#ti-field` row with the `Inversion Time TI (ms)` input.
  4. **FOV** — three numeric inputs: `X cm`, `Y cm`, `Z cm` (Z disabled if dimension = 2D).
  5. **Resolution** — two numeric inputs: `mm` (X) and `mm` (Y).
  6. **TR** / **TE** / **Flip Angle** — three numeric inputs (ms, ms, degrees).
  7. **Spoiler** — checkbox.
  8. **Phase contrast** — checkbox. When active, the `Venc` input (cm/s) is enabled.
  9. **Right side panel:** explainer video player that changes based on the selected trajectory (searches `videoData` by `sequenceId` equal to the trajectory).
  10. **Code preview:** `<pre>` area showing live the `.py` to be downloaded. Regenerated with every form change.
  11. **Download button** — downloads the `.py` with `downloadPython()`.
- **Conditional fields** — all handled in `applyFieldRules()`, which runs after `readForm()` on every `input`/`change` event:

  | Field | Controlled by | Hidden | Disabled |
  |---|---|---|---|
  | `fovZ` | `dimension === '2D'` | no | yes |
  | `venc` | `phaseContrast` unchecked | no | yes |
  | `ti` (`#ti-field`) | `excitation !== 'inversionRecovery'` | yes (`.is-hidden`) | yes |
  | `nSlices` | `dimension === '2D'` | no | yes (and forced to 1) |

  TI is both hidden **and** disabled so it can never leak into `params` while another excitation is selected. Clicking `Inversion Recovery` reveals and enables it in the same event pass, so the code preview updates in the same tick.
- **Rule:** Don't mix export logic with form logic. `downloadPython` only orchestrates `compose` + `download`. All code generation lives in `js/data/templates/`.
- **Rule:** The code preview and download must use **the same** `compose(params)` function. Never duplicate the logic.
- **Rule:** New conditional fields go through `applyFieldRules()` and the `.is-hidden` class. Don't set inline `style.display` from the form handlers.

---

### `js/app.js`
- **Role:** Sidebar router. Mounts the tool entries and decides which one is open. It no longer renders content of its own — each tool renders itself.
- **Sidebar (in order):**
  1. `Sequence Walkthrough` → `window.initWalkthrough('se-2ddft')`
  2. `Sequence Builder` → `window.initBuilder()`
- **Key functions:**
  - `addTool(label, id, open, moduleName)` — creates one `<li class="nav-item">`, wires the click (clears `.active` on every item, sets it on this one, calls `open`) and returns the element. When `open` is `null` — the module's script failed to load — the entry renders a "module is not loaded" message instead of silently doing nothing.
  - `initSidebar()` — mounts both entries, then `click()`s the first so the walkthrough is the landing view.
- **Rule:** `app.js` is the only file that *owns* `#content-container`; the tools write into it through their own entry points (`initWalkthrough`, `initBuilder`), which is the same arrangement as before.
- **Rule:** To add a third tool, call `addTool()` — don't reintroduce bespoke `<li>` construction per entry.
- **History:** `renderContent(sequence)` and `addSectionHeader(label)` lived here and rendered the educational library (grouped sidebar, section dividers, PSD/k-space canvases). They were removed on 2026-09-19; the backup at `C:\Users\neuro\Desktop\proyec_viejo\web-app\js\app.js` has the previous version verbatim.

---

### `python/`
- **Role:** Repository of reference PyPulseq scripts (one per sequence family, plus `write_2Dt1_mprage.py`).
- **They are the source of truth** for the templates in `js/data/templates/`.
- When a `.py` is updated here, update the corresponding template.
- **Standalone:** the web app never imports, fetches or executes them — the app is 100% client-side and only *generates* equivalent code as text. There is no backend and no HTTP endpoint.
- **All 7 save their diagrams**, using the same block the Builder emits (see `common.js` → *Plot saving*): flag `save_plots: bool = True`, `seq.plot(..., plot_now=False)`, the k-space figure, and three PNGs written to `Path(__file__).resolve().parent` — i.e. into this folder. Each script keeps whatever arguments it already passed to `seq.plot()` (the six sequence references use `time_range=(0.0, tr)` to show a single TR; `write_2Dt1_mprage.py` plots the whole sequence).
- **All 7 also save their run log** as `<stem>_report.txt` via `save_report: bool = True`, same mechanism as the Builder's footer. Six of them contribute a `check_timing()` verdict first; `write_2Dt1_mprage.py` has no timing-check block, so its report is the `test_report()` output alone. Note its `test_report` defaults to `False`, so it writes no `.txt` unless you pass `test_report=True`.
- Artifact names come from the stem of each script's `seq_filename`, so they differ per file: `gre_1_rf_adc.png`, `epi_1_gradients.png`, `spin_echo_report.txt`, `2d_mprage_pypulseq_report.txt`, etc.
- **Rule:** the generated PNGs and `.txt` reports are build output, not sources — don't commit them; keep this folder to `.py` files only.
**⚠️ `spiral.py` is currently OUT OF SYNC with `trajectories.js`.** The template was rebuilt around a single continuous base arm plus a rotation matrix (see the *Spiral geometry* rules below); `spiral.py` still carries the older per-interleave construction. Port it before treating it as the reference again.

### Spiral geometry — how the arms are built

- **One continuous base arm, rotated per interleave.** Design a single Archimedean arm (`r = k_max * t`, `theta = 2*pi*n_turns*t`), reparametrise it **once**, then place each interleave with a plain 2D rotation matrix. The timing depends only on `|g|` and `|slew|`, both rotation-invariant, so all arms share it.
- ❌ **Never fold the rotation into the angle as `theta = a * round(8 / n_interleaves) + phi`.** That factor hits **zero for `n_interleaves >= 16`**, which freezes `theta` and degenerates every arm into a **straight radial line** — this is the "k-space collapses to a line" failure, and it strikes at exactly the 16 interleaves recommended for a 256×256 matrix. (The `np.mod()` in that formula is *not* the problem: `cos`/`sin` are 2π-periodic and the wrap is always a whole multiple of 2π, so the position stays continuous — measured max step only 2× the median.)
- **Sample the base arm finely: `n_base = 20000`.** With 1000 points the resampling onto the gradient raster overshoots the slew limit by ~10% (151.9 vs 150 T/m/s) and `seq.write()` refuses the sequence. It converges by ~5000; 20000 is cheap because it runs once for all arms.
- **Ramp in as well as out.** An Archimedean arm leaves the origin at finite speed, so its first gradient sample is non-zero (~2 mT/m here) and pypulseq rejects a delayed gradient that starts non-zero. A slew-limited ramp-in costs 2 raster steps.

- **`spiral.py`** — Archimedean spiral. Should be kept in sync with `trajectories.js` → `spiral(params)`; both carry the same corrections, and any change to one must be mirrored in the other:
  1. `k_max = n_x / (2 * fov_x)` and `n_turns = ceil(n_x / (2 * n_interleaves))` — Nyquist needs the arms together to cover `k_max` in steps of `delta_k = 1/FOV`.
  2. ADC — one sample per gradient raster point (`dwell = grad_raster_time`), covering the whole waveform including both ramps. The ramps are part of the trajectory, so sampling through them costs nothing and keeps samples in lock-step with the gradient the reconstruction reads. ⚠️ This drops the segmented ADC, so there is no `MaxAdcSegmentLength` definition any more; a scanner that needs a segmented ADC for long spiral readouts must reinstate both together.
  3. Ramp-down sized by `np.hypot(last_gx, last_gy)`, not `max(|gx|, |gy|)` — x and y ramp together, so the **vector** slew is what must respect the limit (the `max` form overshoots by up to √2).
  4. The spiral waveform and its ADC share `delay=system.adc_dead_time`. Passing the slice rephaser's duration double-counts it — the rephaser is already its own block.
  5. **Rewinder after the readout — GRADIENT ECHO ONLY.** A trapezoid pair of area `-k_end`, where `k_end = np.sum(spiral_grad_shape, axis=1) * grad_raster_time`. A gradient echo has nothing to refocus k, so without it each shot starts where the previous one ended.
     ⚠️ **A spin echo must NOT get a rewinder.** Its 180° already inverts k to `(-kx, -ky)`; adding gradient area on top double-corrects, destroys the symmetry the reconstruction relies on, and collapses the image to a line/point through the centre. The same applies to Inversion Recovery, which also carries a refocusing pulse. Verified: with no rewinder the 8 SE arms end at `|k| = 125.9 1/m` spaced exactly 45° apart — a symmetric rosette.
  6. The rewinder is built from a derived `pp.Opts` with `max_grad` and `max_slew` divided by `sqrt(2)` — x and y play together, so each channel gets only its share of the vector budget.
  7. TE runs to the **start** of the readout (a spiral samples the centre of k-space first), and TR subtracts the readout and rewinder durations rather than adding a further full TR.

  8. **Readout length ≤ 6 ms per arm.** Off-resonance and T2* dephase across a spiral readout, so a long arm blurs the image. The script warns once when an arm exceeds 6 ms and names the interleave count that would fix it. Rules of thumb: **8 interleaves for 128×128, 16 for 256×256.**

  TR accounting is shared with every other trajectory — see **TR is a period, not a suffix** below.

  **N shots = N interleaves.** On a spiral each shot *is* one arm, so the Builder's `N shots` and `N interleaves` inputs address a single number: `syncSpiralShots()` in `builder.js` mirrors whichever the user edited into the other, and `readForm()` forces `params.nShots = params.nInterleaves`. The two are independent for every other trajectory.
- **`write_2Dt1_mprage.py`** — 2D T1-weighted MPRAGE (IR-prepared gradient echo). Signature:
  `main(plot, test_report, write_seq, seq_filename, *, n_x, n_y, n_slices, fov, slice_thickness, slice_gap, te, ti, tr, inversion_recovery)`.
  - `inversion_recovery=True` (default) → a real 180° block pulse (`rf_prep`, `use='preparation'`), the x/y/z spoilers and `ti_delay` are played before every excitation.
  - `inversion_recovery=False` → those three blocks are skipped and `ti` is ignored; the sequence reduces to a plain spoiled gradient echo.
  - **TI is peak-to-peak**: measured from the centre of the inversion pulse to the centre of the excitation pulse, which is what TI means physically.
    `ti_delay = ti - prep_tail - spoil_duration - exc_head`, rounded to `system.block_duration_raster`, where
    `prep_tail = calc_duration(rf_prep) - (rf_prep.delay + calc_rf_center(rf_prep)[0])` and
    `exc_head = rf.delay + calc_rf_center(rf)[0]`.
    Use `pp.calc_rf_center(rf)[0] + rf.delay` for an RF peak inside its block — **never `calc_duration(rf)/2`**, which ignores the dead time and the ringdown and drifts by ~1 ms for a 2 ms pulse.
    A TI shorter than `prep_tail + spoil_duration + exc_head` raises `ValueError`.
  - Sets the `TI` definition in the `.seq` and names the sequence `2D T1 MPRAGE` or `2D T1 GRE` accordingly.
- **Rule:** Don't modify these files from JavaScript. They are read-only for the app.

---

### `matlab/`
- **Role:** Legacy Pulseq files in Matlab, kept as historical reference.
- **No longer the source of truth** — the Builder generates Python/PyPulseq. Use `python/` instead.
- **Rule:** Don't modify these files from JavaScript. They are read-only for the app.

---

## External dependencies (CDN)

Loaded in `index.html`. No installation required:

| Library | Version | Use |
|---|---|---|
| Google Fonts | — | Inter and Outfit typefaces |
| KaTeX | 0.16.11 | LaTeX equation rendering |

**Don't add new CDN libraries without documenting them here.**

---

## Reference material (outside the repo)

Not dependencies — the sources the educational content is written against. Check them before editing content that claims a fact about Pulseq.

| Source | Where | Used by |
|---|---|---|
| *Open Pulse sequence programming for MRI* (SWiM / CAMERA deck) | `C:\Users\neuro\Documents\Swim_mint_2026.pdf` | All six Learn Pulseq pages |
| PyPulseq example scripts | `github.com/pulseq/pypulseq/tree/master/examples/scripts` | The reference scripts in `python/` |
| PyPulseq example **style guide** | `examples/scripts/STYLE_GUIDE.md` in the same repo | The code the Builder generates |
| Pulseq tutorials | `github.com/pulseq/tutorials` | Background for the Learn Pulseq pages; not quoted directly |
| Layton et al., *Pulseq: A rapid and hardware-independent pulse sequence prototyping framework*, MRM 2017 | — | The *Why Pulseq* page |

**Style-guide conformance of the generated code** (audited 2026-09-19): the templates follow it on naming (`n_x`, `n_y`, `n_slices`, `te_delay`, `tr_delay`, separate `delta_kx` / `delta_ky`, `i_phase`), on `import pypulseq as pp`, on `np.deg2rad`, on the `main(...)` signature with a bare `*`, on splitting the raster rounding into its own statement, and on calling `set_definition` unconditionally. Two known deviations:

- `common.js` line ~198 prints a **Spanish** warning in otherwise-English code (already flagged in the `common.js` notes above).
- The guide orders the tail as *timing → report → plot → definitions → write*; this project writes the `.seq` **before** rendering. That is deliberate and measured — see *Big sequences: write first, render maybe* — and should not be "fixed".

---

## Code conventions

- **Global variables:** Only `pulseqTemplates`, `videoData`, `learnData`, `walkthroughData`, `initBuilder`, `initLearn`, `initWalkthrough`, `initInspector`, `openTool`, `drawBuilderPreview`. Everything else goes inside functions or IIFEs. (`mriData`, `drawDiagram` and `initAnimation` still exist in the three dormant files, but nothing loads them — don't write new code against them without re-adding their `<script>` tags.)
- **Styles:** Always use CSS variables from `main.css`. Never hardcode colors or font sizes.
- **Language:** All content, comments and UI text in English. Variable and function names in English (camelCase).
- **No frameworks:** Pure vanilla JS. Don't add React, Vue, jQuery or others.
- **No bundler:** Code must run directly in the browser. Don't use ES Module `import/export`, use global variables (`window.X` or `const X` in global scope).

---

## Builder Tab — Form layout

Visual schema (based on the project sketch):

```
┌─────────────────────────────────────────────┬────────────────────────┐
│ Dimension:    [2D] [3D] [Multislice]        │  Trajectory explainer  │
│                                             │  video                 │
│ Trajectory:  [Cartesian][EPI][Radial][Spiral]  ┌──────────────┐     │
│   N shots:        [____]                    │   │              │     │
│   N interleaves:  [____]                    │   │   ▶  player  │     │
│                                             │   │              │     │
│ Excitation:   [Spin Echo][Gradient Echo][IR]│   └──────────────┘     │
│   Inversion Time TI [__] ms  ← only when IR │                        │
│                                             │                        │
│ FOV:    X [__] cm   Y [__] cm   Z [__] cm   │  (videos live in      │
│ Resol:  X [__] mm   Y [__] mm               │   videos.js, filtered │
│ TR [__] ms   TE [__] ms   Flip Angle [__] ° │   by the active       │
│ Spoiler: [x]   Phase contrast: [x]          │   trajectory)          │
│ Venc [__] cm/s  ← only when phase contrast  │                        │
├─────────────────────────────────────────────┴────────────────────────┤
│  Code Preview (.py)                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  # code generated live from the form                           │ │
│  │  ...                                                            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                           [ ⬇ Download .py ]         │
└──────────────────────────────────────────────────────────────────────┘
```

**Note on the downloaded file:** the button downloads a `.py` (Python/PyPulseq script). To obtain the `.seq` file the scanner reads, the user must run that script with Python and `pypulseq` installed. If in the future you want to generate the `.seq` directly from the browser, the Pulseq logic would need to be ported to JS (non-trivial).

---

## Data flow

```
app.js (initSidebar)  —  exposes window.openTool(id, arg)
    ├─→ "Learn Pulseq"         → learn.js (initLearn)           ← opened on load
    ├─→ "Sequence Walkthrough" → walkthrough.js (initWalkthrough)
    ├─→ "Sequence Builder"     → builder.js (initBuilder(preset?))
    └─→ "Seq Inspector"        → inspector.js (initInspector)

the path (each module's .next-step button routes through openTool)
    learn ──→ walkthrough ──→ builder ──→ inspector ──┐
      ↑                          ↑                    │
      └── "try it" presets ──────┘                    │
                                 └──────── back ──────┘

inspector.js (initInspector)
    ├─→ FileReader / fetch(examples/…)  → parseSeq()
    ├─→ computeKSpace()   → integrates gradient areas, resets k at each excitation
    ├─→ diagnostics()     → the checks check_timing() cannot make
    └─→ #content-container (summary, checks, definitions, PSD, block list, k-space)

data/learn.js (learnData)
    └─→ learn.js (initLearn)
            ├─→ #content-container (tab strip + page body + pager)
            ├─→ renderBlock()  → prose / note / cards / flow / steps / table
            └─→ widgets:
                    ├─→ seq-anatomy    → block row hover lights the events it points at
                    ├─→ block-anatomy  → PSD canvas + per-block detail panel
                    └─→ raster-clock   → duration slider vs the tick grid, live verdict

builder.js (initBuilder)
    ├─→ form in #content-container
    ├─→ videos.js (videoData filtered by trajectory) → player
    └─→ on input / on change:
            ├─→ readForm()          → DOM values into params
            ├─→ applyFieldRules()   → show/hide TI, Venc, FOV Z
            └─→ pulseqTemplates.compose(params)  ← composer.js
                    ├─→ common.preamble(params)
                    ├─→ common.body(params)
                    ├─→ excitations.<type>(params)
                    ├─→ trajectories.<type>(params)
                    └─→ common.footer(params)
            └─→ final string → preview <pre>  or  download .py

videos.js (videoData)
    └─→ builder.js (updateVideo, filtered by the selected trajectory)
            └─→ #builder-video

data/walkthrough.js (walkthroughData)
    └─→ walkthrough.js (initWalkthrough)
            ├─→ #content-container (table: 9 rows × 3 columns)
            ├─→ paintCell()   → 17 canvas pictograms
            ├─→ highlight()   → tokenized code, per language
            └─→ on interaction:
                    ├─→ "?" button      → toggles #wt-explain-<n>
                    ├─→ language toggle → rewrites every <code> from row.code[lang]
                    └─→ block chip      → highlights / focuses its row
```

---

## How to add new content

### New educational sequence (dormant — the library is not loaded)
The educational library was removed from the UI on 2026-09-19. These steps only apply after you re-add the `<script>` tags for `sequences.js`, `diagrams.js` and `animations.js` and restore `renderContent()` in `app.js` (see the backup named in *What this app is*).
1. Add object to `mriData` in `sequences.js` with the correct `category` (`'excitation'` or `'trajectory'`).
2. For excitations: add RF-only block in `getGradients()` of `animations.js` (with `animationType` ending in `-rf`).
3. For trajectories: add gradient block in `getGradients()`, key in `kScaleMap` and in `cycleConfig`.
4. Add the reference `.py` in `python/` if applicable.

### New excitation type in the Builder
1. Add function to the `window.pulseqTemplates.excitations` object in `templates/excitations.js`.
2. Add the option to the Excitation radio button in `builder.js`.
3. Make sure `composer.js` maps the new id to the function name.

### New trajectory in the Builder
1. Add function to the `window.pulseqTemplates.trajectories` object in `templates/trajectories.js`.
2. Add the option to the Trajectory radio button in `builder.js`.
3. Make sure `composer.js` maps the new id to the function name.

### New form parameter
1. Add the field to the form inside `builder.js` → `buildHTML()`.
2. Add the default to `defaultParams` and the read line to `readForm()`.
3. Add the property to the `params` object documented in the templates section.
4. Update the block functions that need that parameter (common, excitation or trajectory).
5. If the field is conditional, wrap it in a container with `.is-hidden` and toggle it in `applyFieldRules()` — never with inline styles.

### New Learn Pulseq page
1. Add an object to `learnData.pages` in `js/data/learn.js` with `id`, `nav` (short tab label), `title`, `lead` and `blocks`.
2. Compose the page out of the existing block types (`prose`, `note`, `cards`, `flow`, `steps`, `table`, `widget`). Nothing else is needed — the tab strip, the pager and the progress bar pick the page up automatically from the array.
3. Give it a `check`. A page with no self-check can never be marked complete, so it silently caps the progress bar below 100 %.
4. Add a `task` when the lesson has something the Builder can demonstrate. Preset keys are control `name` attributes; see *The course layer in Learn Pulseq*.
5. A genuinely new block type also needs a case in `renderBlock()` in `js/learn.js` and its styles in `components.css`.
6. Keep the page count sane: the tab strip wraps, but past eight or so tabs it stops reading as a path.

### New anchored micro-clip
1. Add an entry to `videoData` in `js/data/videos.js` with an `anchor`.
2. `{ module: 'learn', page: '<page id>' }` or `{ module: 'walkthrough', sequence: '<id>', row: <n> }`.
3. Keep it to 60–90 s. Nothing else is needed — both renderers look the anchor up themselves.

### New sequence walkthrough
1. Add an entry to `walkthroughData` in `js/data/walkthrough.js`, keyed by a new id, following the row schema documented above (`spin`, `hardware`, `code.py`, `code.matlab`, `explain`).
2. Reuse the existing painter ids where the step is the same (a delay is a delay); add new painters only for genuinely new pictograms — write the drawing function inside the IIFE in `js/walkthrough.js` and register it in `painters`.
3. Add a sidebar entry in `app.js` calling `window.initWalkthrough('<new-id>')`, next to the existing one.
4. Keep the snippet lines under ~55 characters and keep `blockOrder` in step with the rows.

### New video
1. Add object to `videoData` in `videos.js`. Use embed URL.
2. If it's a Builder video, set `sequenceId` equal to the trajectory (`'cartesian'`, `'epi'`, etc.) so it appears when that trajectory is selected.

---

## What NOT to do

- Don't edit `index.html` to add JavaScript logic.
- Don't modify the signature of `window.initAnimation`, `window.initWalkthrough`, `window.initInspector` or `window.pulseqTemplates.compose`. `window.initBuilder(preset?)` gained one optional argument on 2026-09-19 for the Learn hand-off — don't make it required, and don't change what a no-argument call does.
- Don't mix content data with rendering logic.
- Don't write Python/Pulseq code outside the files in `js/data/templates/` or in `python/`.
- Don't hardcode colors or sizes in CSS; use the variables from `main.css`.
- Don't add new data files without documenting them here and in `index.html`.
