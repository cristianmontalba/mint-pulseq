/**
 * BUILDER — Sequence Builder.
 *
 * Renders the interactive form, keeps the params object in sync with the
 * controls, runs the MINT validation pipeline and shows its verdict in the
 * MINT console, regenerates the code preview live, and triggers the script
 * downloads (.py for PyPulseq, .m for Pulseq in MATLAB).
 *
 * External coupling:
 *   - window.pulseqTemplates.compose(params)        → generates the .py string
 *   - window.pulseqTemplates.composeMatlab(params)  → generates the .m string
 *   - window.pulseqTemplates.system                 → scanner presets and limits
 *   - window.pulseqTemplates.names                  → gradient event glossary
 *   - window.mintValidation.validate(params)        → the MINT console's content
 *   - window.videoData                              → video catalog
 *   - window.initConsole()                          → the Console view (js/console.js)
 *   - window.mintDownloads                          → the download bar + .txt summary (js/downloads.js)
 *   - window.initBuilder()                          → exposed for app.js
 */

(function () {
    'use strict';

    const systemData = () => window.pulseqTemplates.system;

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
        venc: 100,
        // Scanner hardware limits; filled from the default preset (system.js)
        // the first time the form is read. Units are the form's: mT/m, T/m/s,
        // uT and microseconds.
        system: null
    };

    let params = JSON.parse(JSON.stringify(defaultParams));

    // Which dialect the code preview shows. Module-level so it survives the
    // re-render that every form change triggers; both downloads are always
    // available whichever one is on screen.
    let previewLang = 'py';

    // Download state for the shared bar (js/downloads.js).
    let lastResult = null;   // the MINT validation verdict, for blocking and the .txt
    let lastSaved = null;    // file name of the last download, for the SAVED line

    const LANGS = {
        py: { label: 'Python (.py)', ext: 'py', compose: (p) => window.pulseqTemplates.compose(p) },
        m:  { label: 'MATLAB (.m)',  ext: 'm',  compose: (p) => window.pulseqTemplates.composeMatlab(p) }
    };

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

        // Scanner limits. An emptied field falls back to the default preset so
        // the generated script never carries a NaN.
        const fallback = systemData().defaults();
        params.system = {};
        systemData().keys.forEach((key) => {
            params.system[key] = num(`input[name="${key}"]`, fallback[key]);
        });
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

    // ─── Scanner presets ────────────────────────────────────────────
    /**
     * Write a preset's limits into the form. A gradient mode carries two
     * values, a scanner preset all six; fields a preset does not name are left
     * as they are.
     */
    function applySystemValues(values) {
        const form = document.getElementById('builder-form');
        if (!form || !values) return;
        systemData().keys.forEach((key) => {
            if (values[key] === undefined) return;
            const field = form.querySelector(`input[name="${key}"]`);
            if (field) field.value = values[key];
        });
    }

    /** Light up the preset buttons whose values the form currently holds. */
    function markActivePresets() {
        const sys = systemData();
        const mode = sys.matchMode(params.system);
        const preset = sys.matchPreset(params.system);
        document.querySelectorAll('.preset-btn[data-mode]').forEach((btn) => {
            const on = btn.dataset.mode === mode;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', String(on));
        });
        document.querySelectorAll('.preset-btn[data-preset]').forEach((btn) => {
            const on = btn.dataset.preset === preset;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', String(on));
        });
        const hint = document.getElementById('system-hint');
        if (hint) hint.textContent = `In use: ${sys.describe(params.system)}.`;
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
        markActivePresets();
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

    // ─── MINT console ───────────────────────────────────────────────
    const escapeHtml = (text) => String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const LEVEL_TAG = { error: 'ERROR', warning: 'WARNING', ok: 'OK', info: 'NOTE' };
    const LEVEL_ORDER = ['error', 'warning', 'info', 'ok'];

    /**
     * Run the validation pipeline and render its verdict.
     *
     * Errors and warnings are listed first and always open; the checks that
     * passed fold away under them, each still stating the number it measured.
     */
    function updateConsole() {
        const box = document.getElementById('mint-console');
        if (!box) return;
        if (!window.mintValidation) {
            box.innerHTML = '<p class="mint-line mint-info">The validation module (validation.js) is not loaded.</p>';
            return;
        }

        let result;
        try {
            result = window.mintValidation.validate(params);
            lastResult = result;
        } catch (err) {
            box.innerHTML = `<p class="mint-line mint-error"><span class="mint-tag">ERROR</span>
                <span class="mint-text"><strong>Validation failed to run</strong>${escapeHtml(err.message)}</span></p>`;
            return;
        }

        const c = result.counts;
        const verdict = c.error
            ? { cls: 'mint-error', text: `${c.error} error${c.error > 1 ? 's' : ''} — the script will stop before building the sequence` }
            : c.warning
                ? { cls: 'mint-warning', text: `${c.warning} warning${c.warning > 1 ? 's' : ''} — the sequence builds, but not the way it reads` }
                : { cls: 'mint-ok', text: 'All checks passed' };

        const line = (m) => `
            <li class="mint-line mint-${m.level}">
                <span class="mint-tag">${LEVEL_TAG[m.level]}</span>
                <span class="mint-text"><strong>${escapeHtml(m.title)}</strong>${escapeHtml(m.detail)}</span>
            </li>`;

        const flagged = result.messages
            .filter((m) => m.level !== 'ok')
            .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
        const passed = result.messages.filter((m) => m.level === 'ok');

        const lobeRows = result.lobes.map((l) => `
            <tr class="${l.onRaster ? '' : 'is-off-raster'}">
                <td><code>${escapeHtml(l.name)}</code></td>
                <td>${escapeHtml(l.label)}</td>
                <td class="num">${l.durationUs.toFixed(0)} µs</td>
                <td class="num">${l.onRaster ? `${Math.round(l.rasters)} × ${result.lobeRasterUs} µs` : 'off raster'}</td>
            </tr>`).join('');

        box.innerHTML = `
            <div class="mint-verdict ${verdict.cls}" role="status">
                <span class="mint-verdict-dot" aria-hidden="true"></span>
                <span>${verdict.text}</span>
                <span class="mint-counts">${c.error} error · ${c.warning} warning · ${c.ok} passed</span>
            </div>
            ${flagged.length ? `<ul class="mint-list">${flagged.map(line).join('')}</ul>` : ''}
            ${passed.length ? `
            <details class="mint-details">
                <summary>${passed.length} check${passed.length > 1 ? 's' : ''} passed</summary>
                <ul class="mint-list">${passed.map(line).join('')}</ul>
            </details>` : ''}
            ${lobeRows ? `
            <details class="mint-details">
                <summary>Gradient events in this sequence (${result.lobes.length})</summary>
                <div class="mint-table-scroll">
                    <table class="mint-table">
                        <thead><tr><th>Event</th><th>What it is</th><th>Duration</th><th>Lobe raster</th></tr></thead>
                        <tbody>${lobeRows}</tbody>
                    </table>
                </div>
            </details>` : ''}`;
    }

    // ─── Code preview ───────────────────────────────────────────────
    function generate(lang) {
        return LANGS[lang].compose(params);
    }

    function updateCode() {
        const pre = document.getElementById('builder-preview');
        if (!pre) return;
        document.querySelectorAll('.seg-btn[data-lang]').forEach((btn) => {
            const on = btn.dataset.lang === previewLang;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', String(on));
        });
        try {
            pre.textContent = generate(previewLang);
        } catch (err) {
            pre.textContent = (previewLang === 'm' ? '% ' : '# ') + 'Error generating code: ' + err.message;
        }
    }

    function updatePreview(event) {
        syncSpiralShots(event);
        readForm();
        applyFieldRules();
        updateVideo();
        updateConsole();
        updateCode();
        updateDownloads();
        // Update visual previews (pulse diagram + k-space trajectory)
        if (window.drawBuilderPreview) {
            window.drawBuilderPreview(params);
        }
    }

    // ─── Downloads (shared bar: js/downloads.js) ─────────────────────
    // The preview and the download go through the same compose function, so
    // the file is always exactly what the preview shows. The bar, its status
    // line and the .txt format are the Console view's too.
    const fileBase = () => window.pulseqTemplates.common.seqBaseName(params);
    const isBlocked = () => !!(lastResult && lastResult.counts && lastResult.counts.error > 0);

    function updateDownloads() {
        window.mintDownloads.update(document.querySelector('#content-container .builder'), {
            blocked: isBlocked(),
            lang: LANGS[previewLang].ext,
            base: fileBase(),
            // A SAVED line only for this sequence's files, not for one built earlier.
            saved: [`${fileBase()}.py`, `${fileBase()}.m`, window.mintDownloads.summaryName(fileBase())].includes(lastSaved) ? lastSaved : null
        });
    }

    const LABEL = {
        dimension: { '2D': '2D (single slice)', '3D': '3D', multislice: 'Multislice' },
        trajectory: { cartesian: 'Cartesian', epi: 'EPI', radial: 'Radial', spiral: 'Spiral' },
        excitation: { spinEcho: 'Spin Echo', gradientEcho: 'Gradient Echo', inversionRecovery: 'Inversion Recovery' }
    };
    const SYS_ROWS = [
        ['maxGrad', 'Max grad', 'mT/m'], ['maxSlew', 'Max slew', 'T/m/s'], ['maxB1', 'Max B1', 'µT'],
        ['rfRingdownTime', 'RF ringdown', 'µs'], ['rfDeadTime', 'RF dead time', 'µs'], ['adcDeadTime', 'ADC dead time', 'µs']
    ];

    /** The form, the scanner, the timing summary and the verdict, as the .txt sections. */
    function summary() {
        const p = params;
        const r = lastResult || { messages: [], timing: {}, counts: {} };
        const sys = systemData();
        const presetId = sys.matchPreset(sys.resolve(p.system));
        const nx = Math.round((p.fov.x / 100) / (p.resolution.x / 1000));
        const ny = Math.round((p.fov.y / 100) / (p.resolution.y / 1000));
        const t = r.timing || {};
        const f2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : `${Number(x.toFixed(3))} ms`);
        const sections = [
            { title: 'Sequence', items: [
                ['Dimension', LABEL.dimension[p.dimension] || p.dimension],
                ['Slices / partitions', String(p.nSlices)],
                ['Trajectory', LABEL.trajectory[p.trajectory] || p.trajectory],
                ['Excitation', LABEL.excitation[p.excitation] || p.excitation]
            ].concat(p.trajectory === 'cartesian' ? [] : [['Shots / interleaves', String(p.trajectory === 'spiral' ? p.nInterleaves : p.nShots)]]) },
            { title: 'Geometry', items: [
                ['FOV x', `${p.fov.x} cm`], ['FOV y', `${p.fov.y} cm`]
            ].concat(p.dimension === '3D' ? [['FOV z (slab)', `${p.fov.z} cm`]] : [])
             .concat([['Resolution x', `${p.resolution.x} mm`], ['Resolution y', `${p.resolution.y} mm`]]) },
            { title: 'Timing & contrast', items: [
                ['TR', `${p.tr} ms`], ['TE', `${p.te} ms`]
            ].concat(p.inversionRecovery ? [['TI', `${p.ti} ms`]] : []).concat([['Flip angle', `${p.flipAngle}°`]]) },
            { title: 'Options', items: [
                ['Spoiler', p.spoiler ? 'on' : 'off'],
                ['Phase contrast', p.phaseContrast ? 'on' : 'off']
            ].concat(p.phaseContrast ? [['Venc', `${p.venc} cm/s`]] : []) },
            { title: 'System', items: [['Scanner', presetId ? sys.scannerPresets.find((x) => x.id === presetId).label : 'Custom limits']]
                .concat(SYS_ROWS.map(([k, label, unit]) => [label, `${p.system[k]} ${unit}`])) },
            { title: 'Summary', items: [
                ['Matrix', `${nx} x ${ny}`],
                ['Voxel', `${p.resolution.x} x ${p.resolution.y} mm`],
                ['TE minimum', f2(t.teMinMs)],
                ['TE played', f2(t.teActualMs)],
                ['TR budget', f2(t.trBudgetMs)]
            ].concat(t.tiMinMs !== null && t.tiMinMs !== undefined ? [['TI minimum', f2(t.tiMinMs)]] : [])
             .concat([['MINT checks', `${r.counts.error || 0} error, ${r.counts.warning || 0} warning, ${r.counts.ok || 0} passed`]]) }
        ];
        const TAG = { error: 'ERROR', warning: 'WARNING', ok: 'OK', info: 'NOTE' };
        const ORDER = ['error', 'warning', 'info', 'ok'];
        const messages = (r.messages || []).slice()
            .sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level))
            .map((m) => ({ level: TAG[m.level] || m.level, text: m.detail ? `${m.title}: ${m.detail}` : m.title }));
        const base = fileBase();
        return window.mintDownloads.summaryText({
            title: 'MINT PROTOCOL SUMMARY',
            meta: [
                ['Protocol', base],
                ['Sequence', `${LABEL.excitation[p.excitation]}, ${LABEL.trajectory[p.trajectory]}, ${LABEL.dimension[p.dimension]}`],
                ['Scanner', sys.describe(p.system)],
                ['Generated', window.mintDownloads.stamp()],
                ['MINT view', 'Free builder']
            ],
            sections,
            messages,
            files: [
                ['MATLAB script', `${base}.m`],
                ['Python script', `${base}.py`],
                ['Scanner file', `${base}.seq`]
            ]
        });
    }

    function downloadFile(kind) {
        if (kind === 'script') kind = previewLang;   // the language the switch shows
        readForm();
        updateConsole();
        if (isBlocked()) { updateDownloads(); return; }
        let text;
        let name;
        try {
            if (kind === 'txt') {
                text = summary();
                name = window.mintDownloads.summaryName(fileBase());
            } else {
                text = generate(kind);
                name = `${fileBase()}.${LANGS[kind].ext}`;
            }
        } catch (err) {
            alert('Could not generate the file: ' + err.message);
            return;
        }
        window.mintDownloads.save(name, text);
        lastSaved = name;
        updateDownloads();
    }

    // ─── Form HTML ──────────────────────────────────────────────────

    function systemSectionHTML() {
        const sys = systemData();
        const d = sys.defaults();
        const modeButtons = sys.gradientModes.map((m) => `
                                <button type="button" class="preset-btn" data-mode="${m.id}" aria-pressed="false"
                                        title="Max grad ${m.maxGrad} mT/m · Max slew ${m.maxSlew} T/m/s">${m.label}</button>`).join('');
        const presetButtons = sys.scannerPresets.map((p) => `
                                <button type="button" class="preset-btn" data-preset="${p.id}" aria-pressed="false"
                                        title="Max grad ${p.maxGrad} mT/m · Max slew ${p.maxSlew} T/m/s · Max B1 ${p.maxB1} µT · RF ringdown ${p.rfRingdownTime} µs · RF dead time ${p.rfDeadTime} µs · ADC dead time ${p.adcDeadTime} µs">${p.label}</button>`).join('');

        // The gradient-mode row only exists while system.js offers modes.
        const modeRow = sys.gradientModes.length ? `
                        <div class="preset-row">
                            <span class="preset-caption">Gradient mode</span>
                            <div class="preset-group" role="group" aria-label="Gradient mode">${modeButtons}
                            </div>
                        </div>` : '';

        return `
                    <div class="builder-section">
                        <label class="builder-label">Scanner &amp; system limits</label>${modeRow}
                        <div class="preset-row">
                            <span class="preset-caption">Scanner preset</span>
                            <div class="preset-group" role="group" aria-label="Scanner preset">${presetButtons}
                            </div>
                        </div>
                        <div class="input-row">
                            <label>Max grad (mT/m) <input type="number" name="maxGrad" min="0" step="0.01" value="${d.maxGrad}"></label>
                            <label>Max slew (T/m/s) <input type="number" name="maxSlew" min="0" step="0.01" value="${d.maxSlew}"></label>
                            <label>Max B1 (µT) <input type="number" name="maxB1" min="0" step="0.1" value="${d.maxB1}"></label>
                        </div>
                        <div class="input-row">
                            <label>RF ringdown (µs) <input type="number" name="rfRingdownTime" min="0" step="1" value="${d.rfRingdownTime}"></label>
                            <label>RF dead time (µs) <input type="number" name="rfDeadTime" min="0" step="1" value="${d.rfDeadTime}"></label>
                            <label>ADC dead time (µs) <input type="number" name="adcDeadTime" min="0" step="1" value="${d.adcDeadTime}"></label>
                        </div>
                        <span class="field-hint" id="system-hint"></span>
                    </div>`;
    }

    function buildHTML() {
        return `
        <div class="builder">
            <div class="builder-title-row">
                <h2 class="builder-title">Sequence Builder</h2>
                <div class="mc-switch" role="group" aria-label="Builder view">
                    <button type="button" class="mc-switch-btn is-active" aria-pressed="true">Free builder</button>
                    <button type="button" class="mc-switch-btn" data-builder-view="console" aria-pressed="false"
                            title="TSE and MPRAGE protocols, edited like a scanner console, with their Pulseq script">Console + Pulseq</button>
                </div>
            </div>
            <p class="builder-subtitle">Configure the parameters and download the sequence as a Python/PyPulseq script (.py) or a MATLAB/Pulseq script (.m). Running either one produces the .seq file for the scanner.</p>

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
                        <span class="field-hint">TE and TR must be multiples of 2 &times; grad_raster_time (0.02 ms).</span>
                    </div>

                    <div class="builder-section">
                        <label class="builder-label">Options</label>
                        <div class="toggle-row">
                            <label><input type="checkbox" name="spoiler"> Spoiler</label>
                            <label><input type="checkbox" name="phaseContrast"> Phase contrast</label>
                            <label>Venc (cm/s) <input type="number" name="venc" value="100" disabled></label>
                        </div>
                    </div>
${systemSectionHTML()}

                </form>

                <aside class="builder-video-panel">
                    <div class="builder-label">Trajectory explainer video</div>
                    <div id="builder-video" class="builder-video"></div>
                </aside>
            </div>

            <div class="builder-console">
                <div class="builder-console-header">
                    <h3>MINT console</h3>
                    <p class="builder-sim-hint">Raster, timing and physical checks, re-run on every change. The same checks travel inside the downloaded script and open its run log.</p>
                </div>
                <div id="mint-console" class="mint-console" aria-live="polite"></div>
            </div>

            <div class="builder-output">
                <div class="builder-output-header">
                    <h3>Code Preview</h3>
                    <div class="seg-switch" role="group" aria-label="Script language">
                        <button type="button" class="seg-btn" data-lang="py" aria-pressed="true">${LANGS.py.label}</button>
                        <button type="button" class="seg-btn" data-lang="m" aria-pressed="false">${LANGS.m.label}</button>
                    </div>
                    ${window.mintDownloads.barHTML()}
                </div>
                ${window.mintDownloads.statusHTML()}
                <p class="builder-sim-hint">Both scripts describe the same sequence with the same event names and write the same .seq file when run: the .py needs Python with PyPulseq, the .m needs MATLAB (R2016b or newer) with the Pulseq toolbox.</p>
                <pre id="builder-preview" class="builder-preview"></pre>
            </div>

            <div class="builder-sim">
                <div class="builder-sim-header">
                    <h3>Sequence Preview</h3>
                    <p class="builder-sim-hint">Pulse waveforms and k-space trajectory for the selected excitation + trajectory combination. Lobes are labelled by function; their full event names are listed in the MINT console.</p>
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
                <p>Download the script, run it, and it writes a .seq. Drop that
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
            // Preset buttons write into the limit fields, then the normal
            // update pass picks the new values up like any other edit.
            form.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.preset-btn');
                if (!btn) return;
                const sys = systemData();
                const values = btn.dataset.mode
                    ? sys.gradientModes.find((m) => m.id === btn.dataset.mode)
                    : sys.scannerPresets.find((p) => p.id === btn.dataset.preset);
                applySystemValues(values);
                updatePreview();
            });
        }


        // Everything below is delegated on the Builder's own root, which is
        // rebuilt on every visit — a listener on #content-container would pile
        // up one copy per visit, since that element outlives the Builder.
        const root = document.querySelector('#content-container .builder');
        if (root) {
            root.addEventListener('click', (ev) => {
                const dl = ev.target.closest('[data-dl]');
                if (dl) {
                    downloadFile(dl.dataset.dl);
                    return;
                }
                const lang = ev.target.closest('.seg-btn[data-lang]');
                if (lang) {
                    previewLang = lang.dataset.lang;
                    updateCode();
                    updateDownloads();
                    return;
                }
                // Switch to the Console view (TSE / MPRAGE protocols).
                if (ev.target.closest('[data-builder-view="console"]')) {
                    if (window.initConsole) window.initConsole();
                    return;
                }
                // Hand-off buttons ("next in the path")
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
