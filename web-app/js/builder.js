/**
 * BUILDER — Sequence Builder.
 *
 * Renders the interactive form, keeps the params object in sync
 * with the controls, regenerates the .py code preview live, and triggers
 * the Python/PyPulseq script download.
 *
 * External coupling:
 *   - window.pulseqTemplates.compose(params)   → generates the .py string
 *   - window.videoData                          → video catalog
 *   - window.initBuilder()                      → exposed for app.js
 */

(function () {
    'use strict';

    // ─── Default state ──────────────────────────────────────────────
    const defaultParams = {
        dimension: '2D',
        nSlices: 1,
        trajectory: 'cartesian',
        excitation: 'gradientEcho',
        nShots: 1,
        nInterleaves: 1,
        fov: { x: 25.6, y: 25.6, z: 5 },
        resolution: { x: 1, y: 1 },
        tr: 500,
        te: 10,
        ti: 150,
        flipAngle: 15,
        inversionRecovery: false,
        spoiler: false,
        phaseContrast: false,
        venc: 100
    };

    let params = JSON.parse(JSON.stringify(defaultParams));

    // ─── Read form into params object ───────────────────────────────
    function readForm() {
        const form = document.getElementById('builder-form');
        if (!form) return;

        const q = (sel) => form.querySelector(sel);
        const num = (sel, fallback) => {
            const v = parseFloat(q(sel).value);
            return Number.isFinite(v) ? v : fallback;
        };
        const int = (sel, fallback) => {
            const v = parseInt(q(sel).value, 10);
            return Number.isFinite(v) ? v : fallback;
        };

        params.dimension     = q('input[name="dimension"]:checked').value;
        // Single-slice 2D has exactly one slice by definition; the field is locked
        // in the UI, but force it here too so params can never disagree with it.
        params.nSlices       = params.dimension === '2D'
            ? 1
            : Math.min(Math.max(int('input[name="nSlices"]', 1), 1), 256);
        params.trajectory    = q('input[name="trajectory"]:checked').value;
        params.excitation    = q('input[name="excitation"]:checked').value;
        params.nShots        = int('input[name="nShots"]', 1);
        params.nInterleaves  = int('input[name="nInterleaves"]', 1);
        // On a spiral each shot IS one interleave, so the two controls address a
        // single number. `syncSpiralShots` keeps the inputs mirrored; this makes
        // the params object agree no matter which one the user touched last.
        if (params.trajectory === 'spiral') {
            params.nShots = params.nInterleaves;
        }
        params.fov.x         = num('input[name="fovX"]', 0);
        params.fov.y         = num('input[name="fovY"]', 0);
        params.fov.z         = num('input[name="fovZ"]', 0);
        params.resolution.x  = num('input[name="resX"]', 0);
        params.resolution.y  = num('input[name="resY"]', 0);
        params.tr            = num('input[name="tr"]', 0);
        params.te            = num('input[name="te"]', 0);
        params.flipAngle     = num('input[name="flipAngle"]', 0);
        // The Inversion Recovery excitation option is the switch for TI: when it
        // is selected the inversion block is emitted and TI is read from the form;
        // otherwise the field stays hidden and its value never reaches the script.
        params.inversionRecovery = (params.excitation === 'inversionRecovery');
        params.ti            = num('input[name="ti"]', defaultParams.ti);
        params.spoiler       = q('input[name="spoiler"]').checked;
        params.phaseContrast = q('input[name="phaseContrast"]').checked;
        params.venc          = num('input[name="venc"]', 0);
    }

    // ─── Spiral: N shots and N interleaves are one and the same ─────
    // A spiral arm IS a shot, so the two inputs mirror each other and the one
    // the user just edited wins. Called before readForm so params sees the
    // settled value.
    function syncSpiralShots(event) {
        const form = document.getElementById('builder-form');
        if (!form) return;
        const traj = form.querySelector('input[name="trajectory"]:checked');
        const shots = form.querySelector('input[name="nShots"]');
        const inter = form.querySelector('input[name="nInterleaves"]');
        if (!traj || !shots || !inter) return;

        const isSpiral = traj.value === 'spiral';
        const hint = document.getElementById('shots-linked-hint');
        if (hint) hint.classList.toggle('is-hidden', !isSpiral);
        if (!isSpiral) return;

        const src = event && event.target;
        if (src === shots) inter.value = shots.value;
        else if (src === inter) shots.value = inter.value;
        else shots.value = inter.value;   // trajectory just switched to spiral
    }

    // ─── UI updates dependent on params ─────────────────────────────
    function applyFieldRules() {
        const fovZ    = document.querySelector('input[name="fovZ"]');
        const venc    = document.querySelector('input[name="venc"]');
        const tiField = document.getElementById('ti-field');
        const ti      = document.querySelector('input[name="ti"]');
        if (fovZ) fovZ.disabled = (params.dimension === '2D');
        if (venc) venc.disabled = !params.phaseContrast;
        // Inversion Time only exists for Inversion Recovery: hidden and disabled
        // for every other excitation, revealed the moment IR is clicked.
        if (tiField) tiField.classList.toggle('is-hidden', !params.inversionRecovery);
        if (ti) ti.disabled = !params.inversionRecovery;

        // Slice count: locked at 1 for single-slice 2D, editable for Multislice
        // (slices excited in turn by RF frequency offset) and for 3D (kz partitions).
        const slices = document.querySelector('input[name="nSlices"]');
        const hint   = document.getElementById('slices-hint');
        if (slices) {
            const single = params.dimension === '2D';
            slices.disabled = single;
            if (single) slices.value = 1;
        }
        if (hint) {
            hint.textContent = params.dimension === '2D'
                ? 'Single slice — locked at 1.'
                : params.dimension === '3D'
                    ? 'Partitions encoded along kz across the slab (FOV Z).'
                    : 'Slices excited in turn by RF frequency offset; they share one TR.';
        }
    }

    function updateVideo() {
        const box = document.getElementById('builder-video');
        if (!box) return;
        const list = (window.videoData || []).filter(v => v.sequenceId === params.trajectory);
        if (list.length === 0) {
            box.innerHTML = `
                <div class="video-placeholder">
                    <p>Explainer video for <strong>${params.trajectory}</strong></p>
                    <p class="hint">No videos available for this trajectory yet.<br>
                       Add an object to <code>videos.js</code> with<br>
                       <code>sequenceId: '${params.trajectory}'</code>.</p>
                </div>`;
            return;
        }
        const v = list[0];
        const isMp4 = /\.mp4($|\?)/i.test(v.embedUrl);
        box.innerHTML = isMp4
            ? `<video src="${v.embedUrl}" controls></video>`
            : `<iframe src="${v.embedUrl}" allowfullscreen></iframe>`;
    }

    function updatePreview(event) {
        syncSpiralShots(event);
        readForm();
        applyFieldRules();
        updateVideo();
        const pre = document.getElementById('builder-preview');
        if (!pre) return;
        try {
            pre.textContent = window.pulseqTemplates.compose(params);
        } catch (err) {
            pre.textContent = '% Error generating code:\n% ' + err.message;
        }
        // Update visual previews (k-space trajectory + simulated image)
        if (window.drawBuilderPreview) {
            window.drawBuilderPreview(params);
        }
    }

    // ─── Download .py ───────────────────────────────────────────────
    function downloadPython() {
        readForm();
        let code;
        try {
            code = window.pulseqTemplates.compose(params);
        } catch (err) {
            alert('Could not generate code: ' + err.message);
            return;
        }
        const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `seq_${params.excitation}_${params.trajectory}_${params.dimension}.py`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ─── Form HTML ──────────────────────────────────────────────────
    function buildHTML() {
        return `
        <div class="builder">
            <h2 class="builder-title">Sequence Builder</h2>
            <p class="builder-subtitle">Configure the parameters and download the Python/PyPulseq script (.py). Running it with Python (pypulseq installed) will produce the .seq file for the scanner.</p>

            <div class="builder-grid">
                <form id="builder-form" class="builder-form" autocomplete="off" onsubmit="return false">

                    <div class="builder-section">
                        <label class="builder-label">Dimension</label>
                        <div class="radio-row">
                            <label><input type="radio" name="dimension" value="2D" checked> 2D (single slice)</label>
                            <label><input type="radio" name="dimension" value="3D"> 3D</label>
                            <label><input type="radio" name="dimension" value="multislice"> Multislice</label>
                        </div>
                        <div class="input-row">
                            <label>Slices <input type="number" name="nSlices" min="1" max="256" step="1" value="1" disabled></label>
                            <span class="field-hint" id="slices-hint">Single slice — locked at 1.</span>
                        </div>
                    </div>

                    <div class="builder-section">
                        <label class="builder-label">Trajectory</label>
                        <div class="radio-col">
                            <label><input type="radio" name="trajectory" value="cartesian" checked> Cartesian</label>
                            <label><input type="radio" name="trajectory" value="epi"> EPI</label>
                            <label><input type="radio" name="trajectory" value="radial"> Radial</label>
                            <label><input type="radio" name="trajectory" value="spiral"> Spiral</label>
                        </div>
                        <div class="input-row">
                            <label>N shots <input type="number" name="nShots" min="1" value="1"></label>
                            <label>N interleaves <input type="number" name="nInterleaves" min="1" value="1"></label>
                            <span class="field-hint" id="shots-linked-hint">On a spiral each shot is one interleave &mdash; these two are the same number.</span>
                        </div>
                    </div>

                    <div class="builder-section">
                        <label class="builder-label">Excitation</label>
                        <div class="radio-col">
                            <label><input type="radio" name="excitation" value="spinEcho"> Spin Echo</label>
                            <label><input type="radio" name="excitation" value="gradientEcho" checked> Gradient Echo</label>
                            <label><input type="radio" name="excitation" value="inversionRecovery"> Inversion Recovery</label>
                        </div>
                        <div id="ti-field" class="input-row is-hidden">
                            <label>Inversion Time TI (ms) <input type="number" name="ti" min="0" step="1" value="150" disabled></label>
                            <span class="field-hint">TI that nulls a tissue &asymp; 0.693 &times; T1</span>
                        </div>
                    </div>

                    <div class="builder-section">
                        <label class="builder-label">FOV (cm)</label>
                        <div class="input-row">
                            <label>X <input type="number" name="fovX" step="0.1" value="25.6"></label>
                            <label>Y <input type="number" name="fovY" step="0.1" value="25.6"></label>
                            <label>Z <input type="number" name="fovZ" step="0.1" value="5" disabled></label>
                        </div>
                    </div>

                    <div class="builder-section">
                        <label class="builder-label">Resolution (mm)</label>
                        <div class="input-row">
                            <label>X <input type="number" name="resX" step="0.1" value="1"></label>
                            <label>Y <input type="number" name="resY" step="0.1" value="1"></label>
                        </div>
                    </div>

                    <div class="builder-section">
                        <label class="builder-label">Timing & Excitation</label>
                        <div class="input-row">
                            <label>TR (ms) <input type="number" name="tr" step="1" value="500"></label>
                            <label>TE (ms) <input type="number" name="te" step="0.1" value="10"></label>
                            <label>Flip Angle (°) <input type="number" name="flipAngle" step="1" value="15"></label>
                        </div>
                    </div>

                    <div class="builder-section">
                        <label class="builder-label">Options</label>
                        <div class="toggle-row">
                            <label><input type="checkbox" name="spoiler"> Spoiler</label>
                            <label><input type="checkbox" name="phaseContrast"> Phase contrast</label>
                            <label>Venc (cm/s) <input type="number" name="venc" value="100" disabled></label>
                        </div>
                    </div>

                </form>

                <aside class="builder-video-panel">
                    <div class="builder-label">Trajectory explainer video</div>
                    <div id="builder-video" class="builder-video"></div>
                </aside>
            </div>

            <div class="builder-output">
                <div class="builder-output-header">
                    <h3>Code Preview (.py)</h3>
                    <button id="builder-download" class="download-btn" type="button">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        Download .py
                    </button>
                </div>
                <pre id="builder-preview" class="builder-preview"></pre>
            </div>

            <div class="builder-sim">
                <div class="builder-sim-header">
                    <h3>Sequence Preview</h3>
                    <p class="builder-sim-hint">Pulse waveforms and k-space trajectory for the selected excitation + trajectory combination.</p>
                </div>
                <div class="builder-sim-stack">
                    <div class="builder-sim-panel-wide">
                        <div class="canvas-title">Pulse Sequence Diagram</div>
                        <canvas id="builder-psd-canvas" width="800" height="360"></canvas>
                    </div>
                    <div class="builder-sim-panel-centered">
                        <div class="canvas-title">K-Space Trajectory</div>
                        <canvas id="builder-traj-canvas" width="400" height="400"></canvas>
                    </div>
                </div>
            </div>

            <div class="next-step">
                <div class="next-step-label">Next in the path</div>
                <h3>Seq Inspector</h3>
                <p>Download the script, run it with Python, and it writes a .seq. Drop that
                   file into the Inspector to see the blocks, the timing diagram and the
                   k-space your parameters actually produced.</p>
                <button type="button" class="next-step-btn" data-tool="inspector">
                    Open the Inspector &rarr;</button>
            </div>
        </div>`;
    }

    // ─── Presets from the Learn section ─────────────────────────────
    /**
     * Apply a partial params object to the form controls.
     *
     * Keys are the control `name` attributes, so a preset reads the way the
     * form looks: `{ excitation: 'spinEcho', te: 20 }`. Unknown keys are
     * ignored, which keeps a stale lesson from breaking the Builder.
     */
    function applyPreset(preset) {
        const form = document.getElementById('builder-form');
        if (!form || !preset) return;

        Object.keys(preset).forEach((key) => {
            const value = preset[key];
            const radios = form.querySelectorAll(`input[type="radio"][name="${key}"]`);
            if (radios.length) {
                Array.prototype.forEach.call(radios, (r) => {
                    r.checked = (r.value === String(value));
                });
                return;
            }
            const field = form.querySelector(`input[name="${key}"]`);
            if (!field) return;
            if (field.type === 'checkbox') field.checked = !!value;
            else field.value = value;
        });
    }

    // ─── Listeners ──────────────────────────────────────────────────
    function attachListeners() {
        const form = document.getElementById('builder-form');
        if (form) {
            form.addEventListener('input', updatePreview);
            form.addEventListener('change', updatePreview);
        }
        const btn = document.getElementById('builder-download');
        if (btn) btn.addEventListener('click', downloadPython);

        // Hand-off buttons ("next in the path") live outside the form
        const container = document.getElementById('content-container');
        if (container) {
            container.addEventListener('click', (ev) => {
                const tool = ev.target.closest('[data-tool]');
                if (tool && window.openTool) window.openTool(tool.dataset.tool);
            });
        }
    }

    // ─── Public entry point ─────────────────────────────────────────
    /**
     * `preset` is optional and additive: calling `initBuilder()` with no
     * argument behaves exactly as before. It carries the configuration a
     * Learn Pulseq lesson wants the reader to land on.
     */
    function initBuilder(preset) {
        const container = document.getElementById('content-container');
        if (!container) return;

        container.classList.add('fade-out');
        setTimeout(() => {
            container.innerHTML = buildHTML();
            if (preset) applyPreset(preset);
            attachListeners();
            updatePreview();
            container.classList.remove('fade-out');
        }, 300);
    }

    window.initBuilder = initBuilder;
})();
