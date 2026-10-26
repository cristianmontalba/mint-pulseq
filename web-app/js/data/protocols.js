/**
 * PROTOCOLS — the console protocols: whole sequences, not excitation × trajectory.
 *
 * The Builder composes ONE excitation with ONE trajectory. A turbo spin echo
 * (an echo train after every excitation) and an MPRAGE (an inversion, then a
 * whole train of gradient echoes) do not fit that grid, so they live here as
 * complete protocols, edited in the Console view (js/console.js) the way a
 * scanner console edits a protocol card.
 *
 * Each protocol is a reference script turned into a parameterised template:
 *   t2_tse_tra    ← tse.txt          (Turbo Spin Echo, CPMG, centred ky ordering)
 *   t1_mprage_3d  ← MPRAGE_BELEN.m   (3D MPRAGE, adiabatic hypsec inversion)
 * With the default parameters the exported .m plays the same blocks, with the
 * same delay formulas, as the reference script.
 *
 * Contract of one entry of `window.mintProtocols.list`:
 *   id, title, subtitle, family   identity shown in the queue and card header
 *   fileBase                      MATLAB-safe base name of the .m / .py / .seq
 *   defaults                      the parameter object, in console units
 *   tabs                          { Routine: [card, ...], Contrast: [...], ... }
 *   derive(params)                → { rows, ranges, messages, ta, timing, diagram }
 *                                   a message may carry `key`: the console then
 *                                   shows it on that card only, not twice
 *
 * Card kinds:
 *   { kind: 'edit',  key, label, unit, step, integer?, even?, note? }
 *       editable; its range comes from derive().ranges[key] = { min, max, why }
 *   { kind: 'fixed', label, value(p, d), note }
 *       shown, not editable in this protocol
 *   { kind: 'na',    label }
 *       a usual console parameter this protocol does not implement (dashed)
 *
 * derive() mirrors the timing arithmetic of the exported scripts with the same
 * PyPulseq rules (trapezoid rise times on the gradient raster, RF delay =
 * max(dead time, slice-select rise), delays rounded to the block raster), so a
 * range shown on a card is the range the script will accept.
 */

(function () {
    'use strict';

    const GAMMA = 42.576e6;          // [Hz/T]
    const GRAD = 10e-6;              // [s] gradient raster
    const BLOCK = 10e-6;             // [s] block-duration raster
    const ADC_RASTER = 100e-9;       // [s]

    // ─── PyPulseq arithmetic, reduced to what the two protocols use ──────
    const ceilTo = (x, r) => Math.ceil(Math.round((x / r) * 1e6) / 1e6) * r;
    const roundTo = (x, r) => Math.round(x / r) * r;
    const isMultiple = (x, r) => Math.abs(x / r - Math.round(x / r)) < 1e-6;

    /** Hardware limits of a preset, in Hz/m and Hz/m/s. */
    function hardware(preset) {
        return {
            maxGrad: preset.maxGrad * 1e-3 * GAMMA,
            maxSlew: preset.maxSlew * GAMMA,
            maxB1: preset.maxB1 * 1e-6,
            rfDead: preset.rfDeadTime * 1e-6,
            ringdown: preset.rfRingdownTime * 1e-6,
            adcDead: preset.adcDeadTime * 1e-6
        };
    }

    /** make_trapezoid(flat_area, flat_time): amplitude fixed by the plateau. */
    function trapFlat(hw, flatArea, flatTime) {
        const amp = flatArea / flatTime;
        const rise = ceilTo(Math.abs(amp) / hw.maxSlew, GRAD) || GRAD;
        return { amp, rise, flat: flatTime, dur: 2 * rise + flatTime, area: amp * (rise + flatTime) };
    }

    /** Can make_trapezoid(area, duration) build this lobe within the limits? */
    function trapFits(hw, area, duration) {
        const a = Math.abs(area);
        if (a === 0) return true;
        const dC = 1 / hw.maxSlew;             // 1/(2 slew) + 1/(2 slew)
        if (duration * duration <= 4 * a * dC) return false;
        const amp = (duration - Math.sqrt(duration * duration - 4 * a * dC)) / (2 * dC);
        const rise = ceilTo(amp / hw.maxSlew, GRAD) || GRAD;
        const flat = duration - 2 * rise;
        if (flat < -1e-12) return false;
        return a / (rise + flat) <= hw.maxGrad * (1 + 1e-9);
    }

    /** Peak B1 [T] of an apodised sinc pulse (PyPulseq make_sinc_pulse shape). */
    function sincPeakB1(flipRad, duration, tbw, apodization) {
        const n = Math.round(duration / 1e-6);
        const bw = tbw / duration;
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < n; i++) {
            const t = (i + 0.5) * 1e-6 - duration / 2;
            const x = Math.PI * bw * t;
            const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x;
            const w = 1 - apodization + apodization * Math.cos((2 * Math.PI * t) / duration);
            const s = w * sinc;
            sum += s * 1e-6;
            peak = Math.max(peak, Math.abs(s));
        }
        const scale = flipRad / (2 * Math.PI) / sum;   // Hz
        return (peak * scale) / GAMMA;
    }

    /** Sinc pulse with its slice-selection lobe: duration and RF centre. */
    function sincWithGz(hw, duration, tbw, thickness) {
        const amp = tbw / duration / thickness;            // [Hz/m]
        const gz = trapFlat(hw, amp * duration, duration);
        const rfDelay = Math.max(hw.rfDead, gz.rise);
        const gzDelay = rfDelay > gz.rise ? ceilTo(rfDelay - gz.rise, GRAD) : 0;
        return {
            dur: Math.max(gzDelay + gz.dur, rfDelay + duration + hw.ringdown),
            center: rfDelay + duration / 2,
            gzAmp: amp,
            gzArea: gz.area
        };
    }

    /** Hard (block) pulse, no gradient. */
    function blockPulse(hw, duration) {
        const delay = hw.rfDead;
        return { dur: delay + duration + hw.ringdown, center: delay + duration / 2 };
    }

    /** Adiabatic hypsec inversion (sampled on `dwell`; its peak sits half a dwell late). */
    function adiabatic(hw, duration, dwell) {
        const delay = hw.rfDead;
        return { dur: delay + duration + hw.ringdown, center: delay + duration / 2 + dwell / 2 };
    }

    /** Readout lobe + ADC: block duration, echo position, dwell. */
    function readout(hw, n, fov, readoutTime) {
        const gx = trapFlat(hw, n / fov, readoutTime);
        const adcDelay = gx.rise;
        return {
            gx,
            dur: Math.max(gx.dur, adcDelay + readoutTime + hw.adcDead),
            center: adcDelay + readoutTime / 2,
            dwell: readoutTime / n
        };
    }


    /** make_trapezoid(area, duration): the lobe as drawn (amplitude, ramps). */
    function trapArea(hw, area, duration) {
        const a = Math.abs(area);
        if (a === 0) return { amp: 0, rise: GRAD, flat: duration - 2 * GRAD, fall: GRAD, dur: duration };
        const dC = 1 / hw.maxSlew;
        const disc = Math.max(0, duration * duration - 4 * a * dC);
        let amp = (duration - Math.sqrt(disc)) / (2 * dC);
        const rise = ceilTo(amp / hw.maxSlew, GRAD) || GRAD;
        const flat = Math.max(0, duration - 2 * rise);
        amp = area / (rise + flat);
        return { amp, rise, flat, fall: rise, dur: duration };
    }

    /** A drawable gradient lobe starting at t0. */
    const lobe = (t0, tr) => ({ t0, rise: tr.rise, flat: tr.flat, fall: tr.fall !== undefined ? tr.fall : tr.rise, amp: tr.amp });

    /** The TSE ky table of the reference script: ky_order[shot][echo] (1-based line numbers). */
    function tseKyOrder(ny, etl) {
        const shots = ny / etl;
        const centerEcho = etl / 2;
        const echoIdx = Array.from({ length: etl }, (_, i) => i + 1);
        const echoOrder = echoIdx.map((e, i) => ({ e, d: Math.abs(e - centerEcho), i }))
            .sort((a, b) => a.d - b.d || a.i - b.i).map((o) => o.e);
        const ky = Array.from({ length: ny }, (_, i) => i + 1)
            .map((k, i) => ({ k, d: Math.abs(k - 1 - ny / 2), i }))
            .sort((a, b) => a.d - b.d || a.i - b.i).map((o) => o.k);
        const table = Array.from({ length: shots }, () => new Array(etl).fill(0));
        for (let g = 1; g <= etl; g++) {
            const echo = echoOrder[g - 1];
            for (let s = 0; s < shots; s++) table[s][echo - 1] = ky[(g - 1) * shots + s];
        }
        return table;
    }

    const ms = (s) => s * 1e3;
    /** Up to `d` decimals, trailing zeros dropped: 40 → "40", 28.72 → "28.72". */
    function fmt(x, d) {
        const t = Number(x).toFixed(d === undefined ? 2 : d);
        return t.indexOf('.') >= 0 ? t.replace(/\.?0+$/, '') : t;
    }

    /** m:ss for the TA badge. */
    function mmss(seconds) {
        const s = Math.round(seconds);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function common(hw, messages, readoutInfo) {
        if (Math.abs(readoutInfo.gx.amp) > hw.maxGrad) {
            messages.push({ level: 'ERROR', text: `Readout gradient ${fmt(readoutInfo.gx.amp / GAMMA * 1e3)} mT/m exceeds max grad. Lengthen the readout time or lower the matrix.` });
        }
        if (!isMultiple(readoutInfo.dwell, ADC_RASTER)) {
            messages.push({ level: 'WARNING', text: `ADC dwell ${fmt(readoutInfo.dwell * 1e9, 1)} ns is not a multiple of the 100 ns ADC raster; the scanner cannot sample at that rate.` });
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    //  t2_tse_tra — Turbo Spin Echo, 2D, CPMG
    // ═════════════════════════════════════════════════════════════════════
    const TSE = {
        id: 't2_tse_tra',
        fileBase: 'mint_tse_t2_tra',
        title: 't2_tse_tra',
        prefabLabel: 'T2 TSE',
        subtitle: 'Turbo Spin Echo · 2D · CPMG',
        family: 'Turbo Spin Echo · 2D',
        source: 'tse.txt (TSE_centered4)',
        diagramTitle: 'One echo train',
        defaults: {
            etl: 4,
            fovRead: 256,          // [mm]
            fovPhase: 100,         // [%] of FoV read
            resX: 2,               // [mm]
            resY: 2,               // [mm]
            sliceThickness: 4,     // [mm]
            te: 80,                // [ms] effective TE
            tr: 5000,              // [ms]
            readoutTime: 1.28,     // [ms]
            preTime: 2,            // [ms] prephaser / rewinder / slice rephaser
            spoilerTime: 1,        // [ms] crusher duration
            spoilerCycles: 16,     // crusher area = cycles / FoV read
            spoilerDelay: 1,       // [ms] gap between crusher and 180
            rfDuration: 3,         // [ms] 90 and 180
            tbw: 4
        },
        tabs: {
            Routine: [
                { kind: 'edit', key: 'sliceThickness', label: 'Slice thickness', unit: 'mm', step: 0.1 },
                { kind: 'edit', key: 'fovRead', label: 'FoV read', unit: 'mm', step: 1 },
                { kind: 'edit', key: 'fovPhase', label: 'FoV phase', unit: '%', step: 1 },
                { kind: 'edit', key: 'tr', label: 'TR', unit: 'ms', step: 10 },
                { kind: 'edit', key: 'te', label: 'TE (effective)', unit: 'ms', step: 0.02 },
                { kind: 'fixed', label: 'Slices', value: () => '1', note: 'Single slice in this protocol.' },
                { kind: 'na', label: 'Averages' },
                { kind: 'na', label: 'Concatenations' }
            ],
            Contrast: [
                { kind: 'fixed', label: 'Excitation', value: () => '90°', note: 'Sinc, CPMG phase 0.' },
                { kind: 'fixed', label: 'Refocusing', value: () => '180°', note: 'Sinc, CPMG phase 90° to the excitation.' },
                { kind: 'edit', key: 'etl', label: 'Echo train length', unit: 'echoes', step: 2, integer: true, even: true },
                { kind: 'fixed', label: 'Effective echo', value: (p) => `echo ${p.etl / 2}`, note: 'ETL / 2: the centre of k-space lands on the middle echo.' },
                { kind: 'na', label: 'Fat suppression' },
                { kind: 'na', label: 'Restore magn.' }
            ],
            Resolution: [
                { kind: 'edit', key: 'resX', label: 'Resolution read', unit: 'mm', step: 0.1 },
                { kind: 'edit', key: 'resY', label: 'Resolution phase', unit: 'mm', step: 0.1 },
                { kind: 'fixed', label: 'Base matrix', value: (p, d) => `${d.timing.nx} × ${d.timing.ny}`, note: 'FoV / resolution.' },
                { kind: 'edit', key: 'readoutTime', label: 'Readout time', unit: 'ms', step: 0.01 },
                { kind: 'na', label: 'Phase partial Fourier' },
                { kind: 'na', label: 'Interpolation' }
            ],
            Geometry: [
                { kind: 'fixed', label: 'Orientation', value: () => 'tra', note: 'Slice on z, readout on x, phase on y.' },
                { kind: 'fixed', label: 'Slice position', value: () => '0 mm', note: 'Isocentre.' },
                { kind: 'na', label: 'Phase enc. dir.' },
                { kind: 'na', label: 'Phase oversampling' }
            ],
            System: 'system',
            Sequence: [
                { kind: 'fixed', label: 'ky ordering', value: () => 'centred, interleaved', note: 'Lines nearest ky = 0 go to the effective echo.' },
                { kind: 'edit', key: 'spoilerCycles', label: 'Crusher area', unit: 'cycles / FoV', step: 1 },
                { kind: 'edit', key: 'spoilerTime', label: 'Crusher duration', unit: 'ms', step: 0.1 },
                { kind: 'edit', key: 'spoilerDelay', label: 'Crusher gap', unit: 'ms', step: 0.1 },
                { kind: 'edit', key: 'preTime', label: 'Prephaser / rewinder', unit: 'ms', step: 0.1 },
                { kind: 'edit', key: 'rfDuration', label: 'RF duration', unit: 'ms', step: 0.1 }
            ]
        },


        /** One echo train (the first shot) as drawable events, and the k-space fill. */
        preview(p, preset) {
            const hw = hardware(preset);
            const fovX = p.fovRead / 1000;
            const fovY = fovX * p.fovPhase / 100;
            const nx = Math.round(1000 * fovX / p.resX);
            const ny = Math.round(1000 * fovY / p.resY);
            const etl = p.etl;
            if (!(etl >= 2 && etl % 2 === 0 && ny % etl === 0 && nx > 0)) return null;
            const centerEcho = etl / 2;
            const rfDur = p.rfDuration / 1000, preTime = p.preTime / 1000;
            const spT = p.spoilerTime / 1000, spD = p.spoilerDelay / 1000, roT = p.readoutTime / 1000;
            const exc = sincWithGz(hw, rfDur, p.tbw, p.sliceThickness / 1000);
            const gzSel = trapFlat(hw, exc.gzAmp * rfDur, rfDur);
            const rfDelay = Math.max(hw.rfDead, gzSel.rise);
            const gzDelay = rfDelay > gzSel.rise ? ceilTo(rfDelay - gzSel.rise, GRAD) : 0;
            const ro = readout(hw, nx, fovX, roT);
            const crush = trapArea(hw, p.spoilerCycles / fovX, spT);
            const pre = trapArea(hw, -0.5 * ro.gx.area, preTime);
            const reph = trapArea(hw, -0.5 * gzSel.area, preTime);
            const fixed1 = (exc.dur - exc.center) + preTime + spT + spD + exc.center;
            const fixed2 = (exc.dur - exc.center) + spD + spT + preTime + ro.center;
            const fixed3 = (ro.dur - ro.center) + preTime + spT + spD + exc.center;
            const esp = (p.te / 1000) / centerEcho;
            const d1 = Math.max(0, roundTo(esp / 2 - fixed1, BLOCK));
            const d2 = Math.max(0, roundTo(esp / 2 - fixed2, BLOCK));
            const d3 = Math.max(0, roundTo(esp / 2 - fixed3, BLOCK));
            const order = tseKyOrder(ny, etl);
            const dky = 1 / fovY;
            const ev = { rf: [], gx: [], gy: [], gz: [], adc: [] };
            let t = 0;
            ev.rf.push({ t0: rfDelay, dur: rfDur, amp: 0.5, shape: 'sinc', label: '90°' });
            ev.gz.push(lobe(gzDelay, gzSel));
            t += exc.dur;
            ev.gz.push(lobe(t, reph)); t += preTime + d1;
            for (let e = 1; e <= etl; e++) {
                ev.gx.push(lobe(t, crush)); ev.gz.push(lobe(t, crush)); t += spT + spD;
                ev.rf.push({ t0: t + rfDelay, dur: rfDur, amp: 1, shape: 'sinc', label: '180°' });
                ev.gz.push(lobe(t + gzDelay, gzSel)); t += exc.dur + spD;
                ev.gx.push(lobe(t, crush)); ev.gz.push(lobe(t, crush)); t += spT;
                const kyArea = (order[0][e - 1] - 1 - ny / 2) * dky;
                ev.gx.push(lobe(t, pre));
                if (Math.abs(kyArea) > 1e-9) ev.gy.push(lobe(t, trapArea(hw, kyArea, preTime)));
                t += preTime + d2;
                ev.gx.push(lobe(t, ro.gx));
                ev.adc.push({ t0: t + ro.gx.rise, dur: roT, center: e === centerEcho });
                t += ro.dur;
                ev.gx.push(lobe(t, pre));
                if (Math.abs(kyArea) > 1e-9) ev.gy.push(lobe(t, trapArea(hw, -kyArea, preTime)));
                t += preTime + d3;
            }
            // k-space: which echo acquires each ky line (1 = first echo).
            const echoOfLine = new Array(ny).fill(0);
            order.forEach((row) => row.forEach((k, e) => { echoOfLine[k - 1] = e + 1; }));
            return {
                psd: { title: 'One echo train (shot 1)', duration: t, events: ev },
                kspace: { type: 'lines', ny, nx, groups: etl, groupOfLine: echoOfLine, centerLine: ny / 2 + 1,
                          legend: 'Colour = echo that fills the line; ky = 0 comes from echo ' + centerEcho + '.' }
            };
        },
        derive(p, preset) {
            const hw = hardware(preset);
            const messages = [];
            const ranges = {};
            const fovX = p.fovRead / 1000;
            const fovY = fovX * p.fovPhase / 100;
            const nx = Math.round(1000 * fovX / p.resX);
            const ny = Math.round(1000 * fovY / p.resY);
            const etl = p.etl;
            const centerEcho = etl / 2;
            const thk = p.sliceThickness / 1000;
            const te = p.te / 1000;
            const tr = p.tr / 1000;
            const readoutTime = p.readoutTime / 1000;
            const preTime = p.preTime / 1000;
            const spoilerTime = p.spoilerTime / 1000;
            const spoilerDelay = p.spoilerDelay / 1000;
            const rfDur = p.rfDuration / 1000;

            ranges.etl = { min: 2, max: Math.max(2, ny), why: 'even, and must divide the phase matrix' };
            if (etl % 2 !== 0) messages.push({ level: 'ERROR', text: 'ETL must be even: the effective echo is ETL / 2.' });
            if (ny % etl !== 0) messages.push({ level: 'ERROR', text: `Phase matrix ${ny} is not divisible by ETL ${etl}: every shot must carry the same number of echoes.` });

            const exc = sincWithGz(hw, rfDur, p.tbw, thk);
            const ref = exc;   // the 180 has the same shape and slice lobe
            if (exc.gzAmp > hw.maxGrad) {
                messages.push({ level: 'ERROR', key: 'sliceThickness', text: `Slice ${p.sliceThickness} mm needs ${fmt(exc.gzAmp / GAMMA * 1e3)} mT/m of slice selection, above max grad. Thicken the slice or lengthen the RF.` });
            }
            ranges.sliceThickness = {
                min: Math.ceil((p.tbw / rfDur / hw.maxGrad) * 1e5) / 100,
                max: null,
                why: 'slice-select gradient ≤ max grad'
            };
            const b1_90 = sincPeakB1(Math.PI / 2, rfDur, p.tbw, 0.5);
            const b1_180 = sincPeakB1(Math.PI, rfDur, p.tbw, 0.5);
            if (b1_180 > hw.maxB1) messages.push({ level: 'ERROR', text: `180° peak B1 ${fmt(b1_180 * 1e6)} µT exceeds ${preset.maxB1} µT. Lengthen the RF.` });

            const ro = readout(hw, nx, fovX, readoutTime);
            common(hw, messages, ro);

            const dkx = 1 / fovX;
            const dky = 1 / fovY;
            if (!trapFits(hw, 0.5 * ro.gx.area, preTime)) messages.push({ level: 'ERROR', text: 'Readout prephaser does not fit in the prephaser time.' });
            if (!trapFits(hw, (ny / 2) * dky, preTime)) messages.push({ level: 'ERROR', text: 'The outermost phase-encoding lobe does not fit in the prephaser time.' });
            if (!trapFits(hw, 0.5 * exc.gzArea, preTime)) messages.push({ level: 'ERROR', text: 'Slice rephaser does not fit in the prephaser time.' });
            if (!trapFits(hw, p.spoilerCycles / fovX, spoilerTime)) messages.push({ level: 'ERROR', text: 'Crusher area does not fit in the crusher duration.' });

            // The three delays of the reference script, each from ESP/2.
            const fixed1 = (exc.dur - exc.center) + preTime + spoilerTime + spoilerDelay + ref.center;
            const fixed2 = (ref.dur - ref.center) + spoilerDelay + spoilerTime + preTime + ro.center;
            const fixed3 = (ro.dur - ro.center) + preTime + spoilerTime + spoilerDelay + ref.center;
            const espMin = ceilTo(2 * Math.max(fixed1, fixed2, fixed3), 2 * BLOCK);
            const teMin = espMin * centerEcho;
            ranges.te = { min: ms(teMin), max: null, why: 'shortest echo spacing × ' + centerEcho };

            const esp = te / centerEcho;
            const d1 = roundTo(esp / 2 - fixed1, BLOCK);
            const d2 = roundTo(esp / 2 - fixed2, BLOCK);
            const d3 = roundTo(esp / 2 - fixed3, BLOCK);
            const tEcho = 2 * spoilerTime + 2 * spoilerDelay + ref.dur + 2 * preTime + Math.max(d2, 0) + ro.dur + Math.max(d3, 0);
            const tTrain = exc.dur + preTime + Math.max(d1, 0) + etl * tEcho;
            ranges.tr = { min: ms(ceilTo(tTrain, BLOCK)), max: null, why: 'echo train' };
            if (te < teMin - 1e-9) messages.push({ level: 'ERROR', key: 'te', text: `TE ${p.te} ms is below the minimum ${fmt(ms(teMin))} ms for ETL ${etl}.` });
            if (tr < tTrain - 1e-9) messages.push({ level: 'ERROR', key: 'tr', text: `TR ${p.tr} ms is shorter than the echo train (${fmt(ms(tTrain))} ms).` });
            if (!isMultiple(esp, 2 * GRAD)) messages.push({ level: 'WARNING', text: `Echo spacing ${fmt(ms(esp), 3)} ms is not a multiple of 0.02 ms; the delays are rounded and the echoes drift slightly off centre.` });

            ranges.readoutTime = { min: 0.1, max: null, why: 'dwell on the 100 ns ADC raster' };
            ranges.fovPhase = { min: 10, max: 200, why: '' };
            ['fovRead', 'resX', 'resY', 'spoilerTime', 'spoilerDelay', 'preTime', 'rfDuration'].forEach((k) => { ranges[k] = { min: 0.01, max: null, why: '' }; });
            ranges.spoilerCycles = { min: 0, max: null, why: '' };

            const shots = ny / etl;
            messages.push({ level: 'NOTE', text: `Every echo is phase-rewound and crushed symmetrically around each 180°, so the CPMG condition holds along the whole train.` });

            return {
                timing: { nx, ny, shots, esp, tTrain, d1, d2, d3, b1_90, b1_180, centerEcho },
                ta: Number.isInteger(shots) ? shots * tr : NaN,
                ranges,
                messages,
                rows: [
                    ['Voxel', `${Number(p.resX).toFixed(1)} × ${Number(p.resY).toFixed(1)} × ${Number(p.sliceThickness).toFixed(1)} mm`],
                    ['Matrix', `${nx} × ${ny}`],
                    ['Shots', Number.isInteger(shots) ? `${shots}` : '—'],
                    ['Echo spacing', `${fmt(ms(esp))} ms`],
                    ['Echo at ky = 0', `echo ${centerEcho} of ${etl}`],
                    ['Echo train', `${Math.round(ms(tTrain))} ms`],
                    ['Bandwidth', `${Math.round(1 / readoutTime)} Hz/Px`],
                    ['Peak B1 180°', `${fmt(b1_180 * 1e6)} µT`]
                ],
                diagram: { type: 'tse', etl, centerEcho },
                caption: '90° then a train of 180°s; the highlighted echo fills ky = 0 and sets the effective TE.'
            };
        }
    };

    // ═════════════════════════════════════════════════════════════════════
    //  t1_mprage_3d — MPRAGE, 3D, adiabatic inversion
    // ═════════════════════════════════════════════════════════════════════
    const INV_DURATION = 10.24e-3;   // [s] hypsec, as in the reference script
    const INV_DWELL = 10e-6;
    const INV_PEAK_B1 = 13.24e-6;    // [T] hypsec 10.24 ms, beta 800, mu 4.9 (measured in PyPulseq)

    const MPRAGE = {
        id: 't1_mprage_3d',
        fileBase: 'mint_mprage_t1_3d',
        title: 't1_mprage_3d',
        prefabLabel: 'MPRAGE',
        subtitle: 'MPRAGE · 3D · adiabatic IR',
        family: 'MPRAGE · 3D · adiabatic IR',
        source: 'MPRAGE_BELEN.m (MPRAGE_16_adiabatic)',
        diagramTitle: 'One inversion',
        defaults: {
            fov: 256,              // [mm] isotropic
            nx: 16,
            ny: 16,
            nz: 16,
            flipAngle: 8,          // [deg]
            te: 10,                // [ms]
            trGre: 200,            // [ms]
            ti: 2000,              // [ms] inversion centre → RF of the ky = 0 line
            trMp: 5000,            // [ms]
            readoutTime: 1.28,     // [ms]
            preTime: 2,            // [ms]
            spoilTime: 3,          // [ms]
            rfSpoilInc: 84,        // [deg]
            rfDuration: 1          // [ms] hard excitation pulse
        },
        tabs: {
            Routine: [
                { kind: 'edit', key: 'fov', label: 'FoV (isotropic)', unit: 'mm', step: 1 },
                { kind: 'edit', key: 'trMp', label: 'TR (inversion)', unit: 'ms', step: 10 },
                { kind: 'edit', key: 'ti', label: 'TI', unit: 'ms', step: 10 },
                { kind: 'edit', key: 'te', label: 'TE', unit: 'ms', step: 0.02 },
                { kind: 'fixed', label: 'Slabs', value: () => '1', note: 'One 3D slab, non-selective.' },
                { kind: 'na', label: 'Averages' }
            ],
            Contrast: [
                { kind: 'edit', key: 'flipAngle', label: 'Flip angle', unit: '°', step: 1 },
                { kind: 'fixed', label: 'Inversion', value: () => 'adiabatic hypsec', note: '10.24 ms, non-selective, ≈13.2 µT peak.' },
                { kind: 'edit', key: 'trGre', label: 'TR (GRE)', unit: 'ms', step: 1 },
                { kind: 'na', label: 'Fat suppression' }
            ],
            Resolution: [
                { kind: 'edit', key: 'nx', label: 'Matrix read (Nx)', unit: '', step: 2, integer: true, even: true },
                { kind: 'edit', key: 'ny', label: 'Matrix phase (Ny)', unit: '', step: 2, integer: true, even: true },
                { kind: 'edit', key: 'nz', label: 'Partitions (Nz)', unit: '', step: 2, integer: true, even: true },
                { kind: 'edit', key: 'readoutTime', label: 'Readout time', unit: 'ms', step: 0.01 },
                { kind: 'na', label: 'Partial Fourier' },
                { kind: 'na', label: 'Interpolation' }
            ],
            Geometry: [
                { kind: 'fixed', label: 'Orientation', value: () => '3D, read x', note: 'ky in the inner loop, kz in the outer loop.' },
                { kind: 'fixed', label: 'Slab thickness', value: (p) => `${p.fov} mm`, note: 'Isotropic FoV: the kz step is 1 / FoV.' },
                { kind: 'na', label: 'Slice oversampling' },
                { kind: 'na', label: 'Phase enc. dir.' }
            ],
            System: 'system',
            Sequence: [
                { kind: 'fixed', label: 'ky / kz order', value: () => 'linear', note: 'ky = 0 is GRE Ny/2 + 1 after each inversion.' },
                { kind: 'edit', key: 'rfSpoilInc', label: 'RF spoil increment', unit: '°', step: 1 },
                { kind: 'edit', key: 'spoilTime', label: 'Spoiler duration', unit: 'ms', step: 0.1 },
                { kind: 'edit', key: 'preTime', label: 'Encoding lobes', unit: 'ms', step: 0.1 },
                { kind: 'edit', key: 'rfDuration', label: 'Excitation duration', unit: 'ms', step: 0.1 },
                { kind: 'fixed', label: 'Phase rewinders', value: () => 'none', note: 'Original encoding: the residual phase is left to gradient + RF spoiling.' }
            ]
        },


        /** The first GRE after the inversion (ky and kz at their edge), and the ky-kz fill. */
        preview(p, preset) {
            const hw = hardware(preset);
            const fov = p.fov / 1000, dk = 1 / fov;
            const { nx, ny, nz } = p;
            if (!(nx > 0 && ny > 0 && nz > 0 && ny % 2 === 0 && nz % 2 === 0)) return null;
            const rfDur = p.rfDuration / 1000, preTime = p.preTime / 1000;
            const roT = p.readoutTime / 1000, spoilT = p.spoilTime / 1000;
            const exc = blockPulse(hw, rfDur);
            const ro = readout(hw, nx, fov, roT);
            const teMin = (exc.dur - exc.center) + preTime + ro.center;
            const dTE = Math.max(0, roundTo(p.te / 1000 - teMin, BLOCK));
            const ev = { rf: [], gx: [], gy: [], gz: [], adc: [] };
            let t = 0;
            ev.rf.push({ t0: hw.rfDead, dur: rfDur, amp: 1, shape: 'block', label: `${p.flipAngle}°` });
            t += exc.dur;
            ev.gx.push(lobe(t, trapArea(hw, -0.5 * ro.gx.area, preTime)));
            ev.gy.push(lobe(t, trapArea(hw, (1 - 1 - ny / 2) * dk, preTime)));
            ev.gz.push(lobe(t, trapArea(hw, (1 - 1 - nz / 2) * dk, preTime)));
            t += preTime + dTE;
            ev.gx.push(lobe(t, ro.gx));
            ev.adc.push({ t0: t + ro.gx.rise, dur: roT, center: false });   // this GRE is ky = -Ny/2, not ky = 0
            t += ro.dur;
            ev.gx.push(lobe(t, trapArea(hw, 2 * nx * dk, spoilT)));
            t += spoilT;
            return {
                psd: { title: 'One GRE readout (first after the inversion; TR GRE continues)', duration: t + 1e-3, events: ev },
                kspace: { type: 'grid', ny, nz, centerLine: ny / 2 + 1,
                          legend: 'Each dot is one readout along kx. ky steps inside one inversion (left to right); kz steps once per inversion (bottom to top). Highlighted: ky = 0, acquired at TI.' }
            };
        },
        derive(p, preset) {
            const hw = hardware(preset);
            const messages = [];
            const ranges = {};
            const fov = p.fov / 1000;
            const dk = 1 / fov;
            const { nx, ny, nz } = p;
            const te = p.te / 1000;
            const trGre = p.trGre / 1000;
            const ti = p.ti / 1000;
            const trMp = p.trMp / 1000;
            const readoutTime = p.readoutTime / 1000;
            const preTime = p.preTime / 1000;
            const spoilTime = p.spoilTime / 1000;
            const rfDur = p.rfDuration / 1000;

            ['nx', 'ny', 'nz'].forEach((k) => {
                ranges[k] = { min: 2, max: 512, why: 'even' };
                if (p[k] % 2 !== 0) messages.push({ level: 'ERROR', text: `${k.toUpperCase()} must be even: ky = 0 is line N/2 + 1.` });
            });

            const inv = adiabatic(hw, INV_DURATION, INV_DWELL);
            const exc = blockPulse(hw, rfDur);
            const ro = readout(hw, nx, fov, readoutTime);
            common(hw, messages, ro);
            const b1Gre = (p.flipAngle * Math.PI / 180) / (2 * Math.PI) / rfDur / GAMMA;
            if (b1Gre > hw.maxB1) messages.push({ level: 'ERROR', text: `Excitation peak B1 ${fmt(b1Gre * 1e6)} µT exceeds ${preset.maxB1} µT.` });
            if (INV_PEAK_B1 > hw.maxB1) messages.push({ level: 'ERROR', text: 'The adiabatic inversion exceeds the B1 limit of this scanner.' });

            if (!trapFits(hw, 0.5 * ro.gx.area, preTime)) messages.push({ level: 'ERROR', text: 'Readout prephaser does not fit in the encoding time.' });
            if (!trapFits(hw, (ny / 2) * dk, preTime)) messages.push({ level: 'ERROR', text: 'The outermost ky lobe does not fit in the encoding time.' });
            if (!trapFits(hw, (nz / 2) * dk, preTime)) messages.push({ level: 'ERROR', text: 'The outermost kz lobe does not fit in the encoding time.' });
            if (!trapFits(hw, 2 * nx * dk, spoilTime)) messages.push({ level: 'ERROR', text: 'Spoiler area does not fit in the spoiler duration.' });

            const teMin = (exc.dur - exc.center) + preTime + ro.center;
            ranges.te = { min: ms(ceilTo(teMin, BLOCK)), max: null, why: 'RF end + encoding + half the readout' };
            const dTE = roundTo(te - teMin, BLOCK);
            const tGreBody = exc.dur + preTime + Math.max(dTE, 0) + ro.dur + spoilTime;
            ranges.trGre = { min: ms(ceilTo(tGreBody, BLOCK)), max: null, why: 'one GRE block' };
            const dGRE = roundTo(trGre - tGreBody, BLOCK);
            const trGreActual = tGreBody + Math.max(dGRE, 0);

            const centerLine = ny / 2 + 1;
            const tiFixed = (inv.dur - inv.center) + exc.center + (centerLine - 1) * trGreActual;
            ranges.ti = { min: ms(ceilTo(tiFixed, BLOCK)), max: null, why: `inversion + ${centerLine - 1} GREs before ky = 0` };
            const dTI = roundTo(ti - tiFixed, BLOCK);
            const tMp = inv.dur + Math.max(dTI, 0) + ny * trGreActual;
            ranges.trMp = { min: ms(ceilTo(tMp, BLOCK)), max: null, why: 'inversion + TI + GRE train' };

            if (te < teMin - 1e-9) messages.push({ level: 'ERROR', key: 'te', text: `TE ${p.te} ms is below the minimum ${fmt(ms(teMin))} ms.` });
            if (trGre < tGreBody - 1e-9) messages.push({ level: 'ERROR', key: 'trGre', text: `TR (GRE) ${p.trGre} ms is shorter than one GRE block (${fmt(ms(tGreBody))} ms).` });
            if (ti < tiFixed - 1e-9) messages.push({ level: 'ERROR', key: 'ti', text: `TI ${p.ti} ms is too short: ${centerLine - 1} GREs play before ky = 0, so TI ≥ ${fmt(ms(tiFixed))} ms. Lower TR (GRE) or Ny.` });
            if (trMp < tMp - 1e-9) messages.push({ level: 'ERROR', key: 'trMp', text: `TR (inversion) ${p.trMp} ms is shorter than inversion + TI + GRE train (${fmt(ms(tMp))} ms).` });

            ranges.flipAngle = { min: 1, max: 90, why: '' };
            ranges.rfSpoilInc = { min: 0, max: 180, why: '117° and 84° are the usual values' };
            ranges.readoutTime = { min: 0.1, max: null, why: 'dwell on the 100 ns ADC raster' };
            ['fov', 'preTime', 'spoilTime', 'rfDuration'].forEach((k) => { ranges[k] = { min: 0.01, max: null, why: '' }; });

            messages.push({ level: 'NOTE', text: 'Phase encoding is not rewound (original encoding). The residual relies on the x spoiler and RF spoiling; MINT does not flag it as an error.' });

            return {
                timing: { centerLine, trGreActual, dTE, dGRE, dTI, b1Gre },
                ta: nz * trMp,
                ranges,
                messages,
                rows: [
                    ['Voxel', `${(p.fov / nx).toFixed(1)} × ${(p.fov / ny).toFixed(1)} × ${(p.fov / nz).toFixed(1)} mm`],
                    ['Matrix', `${nx} × ${ny} × ${nz}`],
                    ['GREs / inversion', `${ny}`],
                    ['TR (GRE)', `${fmt(ms(trGreActual))} ms`],
                    ['ky = 0 at', `GRE ${centerLine} of ${ny}`],
                    ['GRE block', `${fmt(ms(tGreBody))} ms`],
                    ['Bandwidth', `${Math.round(1 / readoutTime)} Hz/Px`],
                    ['ADC samples', `${nx * ny * nz}`]
                ],
                diagram: { type: 'mprage', ny, centerLine },
                caption: 'Adiabatic 180°, the TI gap, then a train of small-angle GREs; the highlighted one fills ky = 0.'
            };
        }
    };


    // ═════════════════════════════════════════════════════════════════════
    //  custom — the blank "New sequence": the Free builder's engine on a card
    // ═════════════════════════════════════════════════════════════════════
    // One excitation × one trajectory × one dimension, exactly the Free
    // builder's choices, filled in on the console card. Everything starts
    // empty; until every visible field is filled the console lists what is
    // missing and exports nothing. Then the script comes from the Free
    // builder's own composer (compose / composeMatlab), the checks from
    // mintValidation.validate, the drawings from simulator.js.
    const ON_OFF = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }];
    const isIR = (p) => p.excitation === 'inversionRecovery';

    const CUSTOM = {
        id: 'custom',
        blank: true,
        fileBase: 'new_sequence',
        title: 'new_sequence',
        prefabLabel: 'New sequence',
        subtitle: 'Blank sequence · fill in the card',
        family: 'Blank · Free builder engine',
        source: 'the Free builder templates',
        diagramTitle: '',
        defaults: {
            name: '',
            dimension: '', nSlices: NaN, trajectory: '', excitation: '',
            nShots: NaN, nInterleaves: NaN,
            fovX: NaN, fovY: NaN, fovZ: NaN, resX: NaN, resY: NaN,
            tr: NaN, te: NaN, ti: NaN, flipAngle: NaN,
            spoiler: '', phaseContrast: '', venc: NaN
        },
        tabs: {
            Routine: [
                { kind: 'text', key: 'name', label: 'Name', placeholder: 'new_sequence_1', note: 'File name of the .m / .py / .seq. Letters, digits and _ only.' },
                { kind: 'choice', key: 'dimension', label: 'Dimension', options: [
                    { value: '2D', label: '2D' }, { value: '3D', label: '3D' }, { value: 'multislice', label: 'Multislice' }] },
                { kind: 'edit', key: 'nSlices', label: 'Slices / partitions', unit: '', step: 1, integer: true, placeholder: 'e.g. 8',
                  show: (p) => p.dimension === '3D' || p.dimension === 'multislice' },
                { kind: 'edit', key: 'fovX', label: 'FoV x', unit: 'cm', step: 0.1, placeholder: 'e.g. 25.6' },
                { kind: 'edit', key: 'fovY', label: 'FoV y', unit: 'cm', step: 0.1, placeholder: 'e.g. 25.6' },
                { kind: 'edit', key: 'tr', label: 'TR', unit: 'ms', step: 1, placeholder: 'e.g. 500' },
                { kind: 'edit', key: 'te', label: 'TE', unit: 'ms', step: 0.02, placeholder: 'e.g. 10' }
            ],
            Contrast: [
                { kind: 'choice', key: 'excitation', label: 'Excitation', options: [
                    { value: 'spinEcho', label: 'Spin Echo' }, { value: 'gradientEcho', label: 'Gradient Echo' },
                    { value: 'inversionRecovery', label: 'Inversion Recovery' }] },
                { kind: 'edit', key: 'flipAngle', label: 'Flip angle', unit: '°', step: 1, placeholder: 'e.g. 15' },
                { kind: 'edit', key: 'ti', label: 'TI', unit: 'ms', step: 1, placeholder: 'e.g. 150', show: isIR,
                  note: 'TI that nulls a tissue ≈ 0.693 × T1.' },
                { kind: 'choice', key: 'spoiler', label: 'Spoiler', options: ON_OFF }
            ],
            Resolution: [
                { kind: 'edit', key: 'resX', label: 'Resolution x', unit: 'mm', step: 0.1, placeholder: 'e.g. 1' },
                { kind: 'edit', key: 'resY', label: 'Resolution y', unit: 'mm', step: 0.1, placeholder: 'e.g. 1' },
                { kind: 'fixed', label: 'Base matrix', value: (p) => (p.fovX > 0 && p.resX > 0 && p.fovY > 0 && p.resY > 0)
                    ? `${Math.round(p.fovX * 10 / p.resX)} × ${Math.round(p.fovY * 10 / p.resY)}` : '—', note: 'FoV / resolution.' }
            ],
            Geometry: [
                { kind: 'choice', key: 'trajectory', label: 'Trajectory', options: [
                    { value: 'cartesian', label: 'Cartesian' }, { value: 'epi', label: 'EPI' },
                    { value: 'radial', label: 'Radial' }, { value: 'spiral', label: 'Spiral' }] },
                { kind: 'edit', key: 'nShots', label: 'Shots / spokes', unit: '', step: 1, integer: true, placeholder: 'e.g. 1',
                  show: (p) => p.trajectory === 'epi' || p.trajectory === 'radial',
                  note: 'EPI: shots. Radial: number of spokes.' },
                { kind: 'edit', key: 'nInterleaves', label: 'Interleaves', unit: '', step: 1, integer: true, placeholder: 'e.g. 4',
                  show: (p) => p.trajectory === 'spiral', note: 'One spiral arm per shot.' },
                { kind: 'edit', key: 'fovZ', label: 'FoV z (slab)', unit: 'cm', step: 0.1, placeholder: 'e.g. 5',
                  show: (p) => p.dimension === '3D' }
            ],
            System: 'system',
            Sequence: [
                { kind: 'choice', key: 'phaseContrast', label: 'Phase contrast', options: ON_OFF },
                { kind: 'edit', key: 'venc', label: 'Venc', unit: 'cm/s', step: 1, placeholder: 'e.g. 100',
                  show: (p) => p.phaseContrast === 'on' }
            ]
        },

        /** Card subtitle: what the filled-in choices make, e.g. "Gradient Echo · Cartesian · 2D". */
        describe(p) {
            const label = (tab, key) => {
                const c = this.tabs[tab].find((x) => x.key === key);
                const o = c && c.options.find((x) => x.value === p[key]);
                return o ? o.label : null;
            };
            const parts = [label('Contrast', 'excitation'), label('Geometry', 'trajectory'), label('Routine', 'dimension')].filter(Boolean);
            return parts.length ? parts.join(' · ') : this.subtitle;
        },

        /** Labels of the visible fields still empty, in card order. */
        missing(p) {
            const out = [];
            Object.values(this.tabs).forEach((cards) => {
                if (!Array.isArray(cards)) return;
                cards.forEach((c) => {
                    if (c.show && !c.show(p)) return;
                    if (c.kind === 'choice' && !p[c.key]) out.push(c.label);
                    if (c.kind === 'edit' && !Number.isFinite(p[c.key])) out.push(c.label);
                });
            });
            return out;
        },

        /** The console card → the Free builder's params object (the composer's input). */
        builderParams(p, scanner) {
            const sys = {};
            window.pulseqTemplates.system.keys.forEach((k) => { sys[k] = scanner[k]; });
            const spiral = p.trajectory === 'spiral';
            return {
                dimension: p.dimension,
                nSlices: p.dimension === '2D' ? 1 : Math.max(1, Math.round(p.nSlices || 1)),
                trajectory: p.trajectory,
                excitation: p.excitation,
                nShots: spiral ? (p.nInterleaves || 1) : (Number.isFinite(p.nShots) ? p.nShots : 1),
                nInterleaves: Number.isFinite(p.nInterleaves) ? p.nInterleaves : 1,
                fov: { x: p.fovX, y: p.fovY, z: Number.isFinite(p.fovZ) ? p.fovZ : 5 },
                resolution: { x: p.resX, y: p.resY },
                tr: p.tr,
                te: p.te,
                ti: Number.isFinite(p.ti) ? p.ti : 150,
                flipAngle: p.flipAngle,
                inversionRecovery: isIR(p),
                spoiler: p.spoiler === 'on',
                phaseContrast: p.phaseContrast === 'on',
                venc: Number.isFinite(p.venc) ? p.venc : 100,
                system: sys
            };
        },

        derive(p, preset) {
            const missing = this.missing(p);
            const ranges = {
                nSlices: { min: 1, max: 256, why: '' },
                fovX: { min: 0.1, max: null, why: '' }, fovY: { min: 0.1, max: null, why: '' }, fovZ: { min: 0.1, max: null, why: '' },
                resX: { min: 0.05, max: null, why: '' }, resY: { min: 0.05, max: null, why: '' },
                tr: { min: 0.02, max: null, why: '' }, te: { min: 0.02, max: null, why: '' },
                ti: { min: 0.02, max: null, why: '' }, flipAngle: { min: 1, max: 180, why: '' },
                nShots: { min: 1, max: null, why: '' }, nInterleaves: { min: 1, max: null, why: '' },
                venc: { min: 1, max: null, why: '' }
            };
            if (missing.length) {
                return {
                    incomplete: true, missing, ranges, rows: [], ta: NaN, diagram: null, caption: '',
                    messages: [{ level: 'NOTE', text: `Fill in: ${missing.join(', ')}.` }]
                };
            }
            const bp = this.builderParams(p, preset);
            let r;
            try {
                r = window.mintValidation.validate(bp);
            } catch (err) {
                return { ranges, rows: [], ta: NaN, diagram: null, caption: '', messages: [{ level: 'ERROR', text: err.message }] };
            }
            const t = r.timing || {};
            if (Number.isFinite(t.teMinMs)) ranges.te = { min: Math.ceil(t.teMinMs * 100) / 100, max: null, why: 'shortest TE for these events' };
            if (isIR(p) && Number.isFinite(t.tiMinMs)) ranges.ti = { min: Math.ceil(t.tiMinMs * 100) / 100, max: null, why: 'shortest TI' };
            const TAG = { error: 'ERROR', warning: 'WARNING', info: 'NOTE' };
            const messages = r.messages.filter((m) => m.level !== 'ok')
                .map((m) => ({
                    level: TAG[m.level] || 'NOTE',
                    // A TE / TI finding is also shown on its card; the key lets the console say it once.
                    key: /\bTE\b/.test(m.title) ? 'te' : /\bTI\b/.test(m.title) ? 'ti' : undefined,
                    text: m.detail ? `${m.title}. ${m.detail}` : m.title
                }));
            const passed = r.messages.filter((m) => m.level === 'ok').length;
            if (passed) messages.push({ level: 'NOTE', text: `${passed} MINT check${passed > 1 ? 's' : ''} passed (rasters, timing, limits).` });
            const nx = Math.round(p.fovX * 10 / p.resX);
            const ny = Math.round(p.fovY * 10 / p.resY);
            const exc = { cartesian: ny, epi: bp.nShots, radial: bp.nShots, spiral: bp.nInterleaves }[p.trajectory] || ny;
            const ta = exc * (p.tr / 1000) * (p.dimension === '3D' ? bp.nSlices : 1);
            const f = (x) => (Number.isFinite(x) ? `${fmt(x)} ms` : '—');
            return {
                ranges, messages, ta,
                rows: [
                    ['Matrix', `${nx} × ${ny}${p.dimension === '2D' ? '' : ` × ${bp.nSlices}`}`],
                    ['Voxel', `${Number(p.resX).toFixed(1)} × ${Number(p.resY).toFixed(1)} mm`],
                    ['Excitations', `${exc}${p.dimension === '3D' ? ` × ${bp.nSlices}` : ''}`],
                    ['TE minimum', f(t.teMinMs)],
                    ['TE played', f(t.teActualMs)],
                    ['TR budget', f(t.trBudgetMs)]
                ].concat(isIR(p) && Number.isFinite(t.tiMinMs) ? [['TI minimum', f(t.tiMinMs)]] : [])
                 .concat([['MINT checks', `${r.counts.error} error · ${r.counts.warning} warning · ${r.counts.ok} ok`]]),
                diagram: null,
                caption: '',
                builder: bp
            };
        }
    };

    // ─── The scanner the console protocols are built for ─────────────────
    // The console's System tab lets the user pick a preset or type the six
    // limits (plus B0). Every protocol, its derive() and its scripts read the
    // limits from here, so the ranges on the cards and the scripts agree.
    const DEFAULT_PRESET = 'disc';   // both reference scripts were written for the Disc Scanner
    const DEFAULT_B0 = 0.55;         // [T]

    /** A fresh system object: the six limits of a preset plus b0. */
    function systemFromPreset(id) {
        const sys = window.pulseqTemplates.system;
        const p = sys.preset(id) || sys.preset(DEFAULT_PRESET);
        const out = {};
        sys.keys.forEach((k) => { out[k] = p[k]; });
        out.b0 = p.b0 !== undefined ? p.b0 : DEFAULT_B0;
        return out;
    }

    /** Resolve any (possibly partial) system into limits + b0 + a label. */
    function scanner(system) {
        const sys = window.pulseqTemplates.system;
        const base = systemFromPreset(DEFAULT_PRESET);
        const s = Object.assign(base, system || {});
        const id = sys.matchPreset(s);
        s.presetId = id;
        s.label = id ? sys.preset(id).label : 'Custom limits';
        return s;
    }

    window.mintProtocols = {
        list: [TSE, MPRAGE],            // the prefabricated sequences
        get: (id) => [TSE, MPRAGE, CUSTOM].find((p) => p.id === id),
        custom: CUSTOM,
        mmss,
        fmt,
        presetId: DEFAULT_PRESET,
        systemFromPreset,
        scanner
    };
})();
