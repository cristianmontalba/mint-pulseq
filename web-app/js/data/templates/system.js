/**
 * SYSTEM — scanner hardware limits, presets and raster clocks.
 *
 * Data only. `builder.js` renders the preset buttons from it, the templates
 * print it into `pp.Opts(...)` / `mr.opts(...)`, and `validation.js` checks the
 * sequence against it.
 *
 * `params.system` (see builder.js) carries the six editable values, in the
 * units the form shows:
 *
 *   maxGrad         mT/m
 *   maxSlew         T/m/s
 *   maxB1           uT
 *   rfRingdownTime  us
 *   rfDeadTime      us
 *   adcDeadTime     us
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    // The four clocks every event must land on. They are the Pulseq defaults
    // and what a Siemens interpreter expects; they are written into the
    // generated script explicitly so the raster checks have a visible source.
    const RASTERS = {
        grad: 10e-6,    // [s] gradient raster
        rf: 1e-6,       // [s] RF raster
        adc: 100e-9,    // [s] ADC raster — the dwell must be a whole multiple
        block: 10e-6    // [s] block duration raster
    };

    // Gradient performance modes: they move max gradient and max slew only.
    // None are offered at the moment — Fast and Whisper were dropped and the
    // former Normal mode became the Disc Scanner preset below. The Builder
    // hides the "Gradient mode" row while this list is empty; add an entry
    // ({ id, label, maxGrad, maxSlew }) and the row comes back.
    const GRADIENT_MODES = [];

    // Full scanner presets: they set all six limits at once. The first entry
    // is the Builder's default.
    const SCANNER_PRESETS = [
        {
            id: 'chile', label: 'Chile Scanner',
            maxGrad: 28, maxSlew: 150, maxB1: 22,
            rfRingdownTime: 20, rfDeadTime: 100, adcDeadTime: 10
        },
        {
            // Gradient limits of the former "Normal" mode. The B1 and dead-time
            // values are the Chile Scanner's, pending this scanner's own.
            id: 'disc', label: 'Disc Scanner',
            maxGrad: 22, maxSlew: 100, maxB1: 22,
            rfRingdownTime: 20, rfDeadTime: 100, adcDeadTime: 10
        }
    ];

    const KEYS = ['maxGrad', 'maxSlew', 'maxB1', 'rfRingdownTime', 'rfDeadTime', 'adcDeadTime'];

    function pick(source) {
        const out = {};
        KEYS.forEach((k) => { if (source[k] !== undefined) out[k] = source[k]; });
        return out;
    }

    /** The Builder's default system: the Chile Scanner preset. */
    function defaults() {
        return pick(SCANNER_PRESETS[0]);
    }

    /** Fill any missing limit from the defaults (old presets carry no system). */
    function resolve(system) {
        return Object.assign(defaults(), pick(system || {}));
    }

    const same = (a, b) => Math.abs(a - b) < 1e-9;

    /** id of the gradient mode whose two limits match `system`, or null. */
    function matchMode(system) {
        const hit = GRADIENT_MODES.find((m) =>
            same(m.maxGrad, system.maxGrad) && same(m.maxSlew, system.maxSlew));
        return hit ? hit.id : null;
    }

    /** id of the scanner preset all six of whose limits match `system`, or null. */
    function matchPreset(system) {
        const hit = SCANNER_PRESETS.find((p) => KEYS.every((k) => same(p[k], system[k])));
        return hit ? hit.id : null;
    }

    /** One-line description for the generated script's header. */
    function describe(system) {
        const s = resolve(system);
        const preset = matchPreset(s);
        const mode = matchMode(s);
        if (preset) return SCANNER_PRESETS.find((p) => p.id === preset).label + ' preset';
        if (mode) return GRADIENT_MODES.find((m) => m.id === mode).label + ' gradient mode';
        return 'custom limits';
    }

    window.pulseqTemplates.system = {
        gamma: 42.576e6,   // [Hz/T] the value Pulseq and PyPulseq default to
        rasters: RASTERS,
        gradientModes: GRADIENT_MODES,
        scannerPresets: SCANNER_PRESETS,
        keys: KEYS,
        defaults,
        resolve,
        matchMode,
        matchPreset,
        describe
    };
})();
