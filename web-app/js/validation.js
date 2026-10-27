/**
 * VALIDATION — the MINT validation pipeline, in the browser.
 *
 * The generated scripts carry their own validator (MintValidator in the .py,
 * the mint_* functions in the .m) and it has the last word, because it sees
 * the real event objects. This module answers the same questions BEFORE the
 * script is downloaded, so the Builder can show them live in the MINT console.
 *
 * It does that by rebuilding one TR of the sequence as plain event objects,
 * with the same arithmetic PyPulseq uses (make_trapezoid, make_sinc_pulse,
 * calc_duration are mirrored below, expression for expression), and then
 * running the pipeline over it:
 *
 *   1. build      events for the chosen excitation + trajectory. A lobe the
 *                 hardware cannot play under the current limits fails here.
 *   2. rasters    ADC dwell on adc_raster_time; every gradient lobe, TE, TR
 *                 and TI on 2 * grad_raster_time.
 *   3. timing     TE / TI reachable, TR long enough, spiral readout length.
 *   4. physical   every block checked for impossible RF / gradient / ADC
 *                 combinations: RF on the slice-selection plateau, in-plane
 *                 lobes not before the selection ramp-down, one event per axis.
 *   5. limits     peak B1 against max_b1.
 *
 * Public API:
 *   window.mintValidation.validate(params) → {
 *       messages: [{ level, group, title, detail }],   level: error | warning | ok | info
 *       counts:   { error, warning, ok, info },
 *       lobes:    [{ name, label, durationUs, rasters, onRaster }],
 *       lobeRasterUs: '20',
 *       timing:   { teMinMs, trMinMs, ... }
 *   }
 *
 * RULE: the three implementations (here, common.js, matlab/common.js) state
 * the same rules. Change one, change all three.
 */

(function () {
    'use strict';

    const EPS = 1e-9;          // pypulseq.eps
    const TOL = 1e-9;          // [s] timing tolerance of the block checks
    const SPIRAL_LIMIT = 6e-3; // [s] longest spiral arm before blurring sets in

    // ─── Raster arithmetic (mirrors MintValidator) ──────────────────
    const isMultiple = (value, raster) => {
        const ratio = value / raster;
        return Math.abs(ratio - Math.round(ratio)) < 1e-6;
    };
    // numpy rounds halves to even; Math.round rounds them up.
    function roundHalfEven(x) {
        const r = Math.round(x);
        return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
    }
    const round6 = (x) => roundHalfEven(x * 1e6) / 1e6;
    const roundTo = (value, raster) => roundHalfEven(value / raster) * raster;
    const ceilTo = (value, raster) => Math.ceil(round6(value / raster)) * raster;
    const floorTo = (value, raster) => Math.floor(round6(value / raster)) * raster;

    const us = (seconds) => seconds * 1e6;
    const ms = (seconds) => seconds * 1e3;
    const fmt = (x, digits) => Number(x).toFixed(digits === undefined ? 1 : digits);

    // A lobe the scanner cannot play. Stops the build; reported as an error.
    function Infeasible(title, detail) {
        this.title = title;
        this.detail = detail;
    }

    // ─── PyPulseq arithmetic, mirrored ──────────────────────────────

    // calculate_shortest_params_for_area
    function shortestParams(area, lim) {
        let rise = Math.ceil(Math.sqrt(Math.abs(area) / lim.slew) / lim.raster) * lim.raster;
        rise = Math.max(rise, lim.raster);
        let amplitude = area / rise;
        let effective = rise;
        if (Math.abs(amplitude) > lim.grad + EPS) {
            effective = Math.ceil(Math.abs(area) / lim.grad / lim.raster) * lim.raster;
            amplitude = area / effective;
            rise = Math.ceil(Math.abs(amplitude) / lim.slew / lim.raster) * lim.raster;
            rise = Math.max(rise, lim.raster);
        }
        return { amplitude, rise, flat: effective - rise, fall: rise };
    }

    function trap(channel, name, shape) {
        return {
            type: 'trap', channel, name, delay: 0,
            amplitude: shape.amplitude, rise: shape.rise, flat: shape.flat, fall: shape.fall,
            area: shape.amplitude * (shape.flat + shape.rise / 2 + shape.fall / 2)
        };
    }

    // make_trapezoid(area=...) — the shortest lobe for an area.
    function trapShortest(channel, name, area, lim) {
        return trap(channel, name, shortestParams(area, lim));
    }

    // make_trapezoid(area=..., duration=...)
    function trapAreaDuration(channel, name, area, duration, lim, ctx) {
        const s = shortestParams(area, lim);
        const minDuration = s.rise + s.flat + s.fall;
        if (duration < minDuration - 1e-12) {
            throw new Infeasible(
                `${name} does not fit its ${fmt(us(duration), 0)} µs`,
                `It has to deliver ${fmt(Math.abs(area), 1)} 1/m, which under ${ctx.limitsText} takes at least ` +
                `${fmt(us(minDuration), 0)} µs. The script stops here with "Requested area is too large for this ` +
                'gradient". Raise the gradient limits, lower the resolution, or lengthen the lobe.'
            );
        }
        const flat = duration - s.rise - s.fall;
        const amplitude = area / (s.rise / 2 + s.fall / 2 + flat);
        return trap(channel, name, { amplitude, rise: s.rise, flat, fall: s.fall });
    }

    // make_trapezoid(amplitude=..., flat_time=...)
    function trapAmplitudeFlat(channel, name, amplitude, flat, lim, ctx) {
        if (Math.abs(amplitude) > lim.grad + EPS) {
            throw new Infeasible(
                `${name} needs more gradient than the scanner has`,
                `Its plateau must reach ${fmt(Math.abs(amplitude) / ctx.gamma * 1e3, 2)} mT/m but max_grad is ` +
                `${ctx.system.maxGrad} mT/m. The script stops here with "Refined amplitude is larger than max".`
            );
        }
        let rise = Math.ceil(Math.max(Math.abs(amplitude) / lim.slew, lim.raster) / lim.raster) * lim.raster;
        if (rise === 0) rise = lim.raster;
        return trap(channel, name, { amplitude, rise, flat, fall: rise });
    }

    // make_lobe_on_raster — shortest lobe stretched to the lobe raster.
    function lobeOnRaster(channel, name, area, lim, lobeRaster, ctx) {
        const shortest = trapShortest(channel, name, area, lim);
        const d = shortest.rise + shortest.flat + shortest.fall;
        const duration = ceilTo(d, lobeRaster);
        if (duration - d > 1e-9) return trapAreaDuration(channel, name, area, duration, lim, ctx);
        return shortest;
    }

    const lobeDuration = (g) => (g.type === 'trap' ? g.rise + g.flat + g.fall : g.shapeDur);

    // calc_duration
    function eventDuration(e) {
        switch (e.type) {
            case 'delay': return e.delay;
            case 'rf': return e.delay + e.shapeDur + e.ringdown;
            case 'grad': return e.delay + e.shapeDur;
            case 'adc': return e.delay + e.numSamples * e.dwell + e.deadTime;
            case 'trap': return e.delay + e.rise + e.flat + e.fall;
            default: return 0;
        }
    }
    const calcDuration = (...events) => events.reduce((d, e) => Math.max(d, eventDuration(e)), 0);

    // Peak of a unit-flip apodized sinc, in Hz per radian of flip angle
    // (make_sinc_pulse: apodization 0.5, time-bandwidth 4, 1 us dwell).
    let sincPeakPerRadian = null;
    function sincPeak(duration, tbw, apodization, dwell) {
        if (sincPeakPerRadian !== null) return sincPeakPerRadian;
        const n = Math.round(duration / dwell);
        const bandwidth = tbw / duration;
        let sum = 0;
        let peak = 0;
        for (let i = 1; i <= n; i++) {
            const tt = (i - 0.5) * dwell - duration * 0.5;
            const window = 1 - apodization + apodization * Math.cos(2 * Math.PI * tt / duration);
            const x = Math.PI * bandwidth * tt;
            const v = window * (x === 0 ? 1 : Math.sin(x) / x);
            sum += v;
            peak = Math.max(peak, Math.abs(v));
        }
        sincPeakPerRadian = peak / (sum * dwell * 2 * Math.PI);
        return sincPeakPerRadian;
    }

    // make_sinc_pulse(..., return_gz=True, delay=system.rf_dead_time)
    function sincPulse(rfName, gzName, flip, ctx) {
        const duration = 3e-3;
        const tbw = 4;
        const amplitude = (tbw / duration) / ctx.sliceThickness;
        const gz = trapAmplitudeFlat('z', gzName, amplitude, duration, ctx.lim, ctx);
        const rf = {
            type: 'rf', name: rfName, delay: ctx.rfDeadTime, shapeDur: duration,
            ringdown: ctx.rfRingdown, center: duration * 0.5,
            peakB1: flip * sincPeak(duration, tbw, 0.5, ctx.rasters.rf) / ctx.gamma  // [T]
        };
        if (rf.delay > gz.rise) {
            gz.delay = Math.ceil((rf.delay - gz.rise) / ctx.lim.raster) * ctx.lim.raster;
        }
        if (rf.delay < gz.rise + gz.delay) rf.delay = gz.rise + gz.delay;
        return { rf, gz };
    }

    const delayEvent = (seconds) => ({ type: 'delay', delay: seconds });

    // ─── Stage 1: build one TR ──────────────────────────────────────

    function context(params) {
        const T = window.pulseqTemplates;
        const system = T.system.resolve(params.system);
        const rasters = T.system.rasters;
        const gamma = T.system.gamma;
        const { fov, resolution, dimension } = params;
        const fovX = Number((fov.x / 100).toFixed(4));
        const fovY = Number((fov.y / 100).toFixed(4));
        const nSlices = Math.max(1, Math.round(params.nSlices || 1));
        return {
            params, system, rasters, gamma,
            N: T.names.v,
            lim: { grad: system.maxGrad * 1e-3 * gamma, slew: system.maxSlew * gamma, raster: rasters.grad },
            limitsText: `max_grad ${system.maxGrad} mT/m and max_slew ${system.maxSlew} T/m/s`,
            lobeRaster: 2 * rasters.grad,
            maxB1: system.maxB1 * 1e-6,
            rfDeadTime: system.rfDeadTime * 1e-6,
            rfRingdown: system.rfRingdownTime * 1e-6,
            adcDeadTime: system.adcDeadTime * 1e-6,
            fovX, fovY,
            nX: Math.round((fov.x / 100) / (resolution.x / 1000)),
            nY: Math.round((fov.y / 100) / (resolution.y / 1000)),
            nSlices,
            sliceThickness: dimension === '3D' ? Number((fov.z / 100).toFixed(4)) : 10e-3,
            te: parseFloat(`${Number(params.te)}e-3`),
            tr: parseFloat(`${Number(params.tr)}e-3`),
            ti: parseFloat(`${Number(Number.isFinite(params.ti) ? params.ti : 150)}e-3`),
            is3D: dimension === '3D' && nSlices > 1,
            isMultislice: dimension === 'multislice' && nSlices > 1,
            isGRE: params.excitation === 'gradientEcho',
            isIR: params.excitation === 'inversionRecovery',
            preTimeZ: 1e-3
        };
    }

    // The trapezoidal readout shared by Cartesian, EPI and Radial.
    function buildReadout(ctx, readoutTime) {
        const N = ctx.N;
        const kWidth = ctx.nX * (1 / ctx.fovX);
        const dwellRequested = readoutTime / ctx.nX;
        const dwell = floorTo(dwellRequested, ctx.rasters.adc);
        if (!(dwell > 0)) {
            throw new Infeasible(
                'The ADC dwell rounds down to zero',
                `readout_time / n_x = ${fmt(dwellRequested * 1e9, 1)} ns is shorter than one adc_raster_time ` +
                `(${fmt(ctx.rasters.adc * 1e9, 0)} ns). Lower the matrix size.`
            );
        }
        const adcDuration = ctx.nX * dwell;
        const flat = ceilTo(adcDuration, ctx.lobeRaster);
        const gx = trapAmplitudeFlat('x', N.gx, kWidth / adcDuration, flat, ctx.lim, ctx);
        const adcDelay = gx.rise + floorTo((flat - adcDuration) / 2, ctx.rasters.rf);
        const adc = {
            type: 'adc', name: 'adc', numSamples: ctx.nX, dwell,
            delay: Math.max(adcDelay, ctx.adcDeadTime), deadTime: ctx.adcDeadTime
        };
        return { gx, adc, dwellRequested, dwell, adcDuration };
    }

    // The spiral arm, re-timed exactly as the template does it. Returns the
    // readout duration and the rewinder areas; no waveform leaves this function.
    function buildSpiral(ctx) {
        const nInterleaves = ctx.params.nInterleaves || 5;
        const raster = ctx.rasters.grad;
        const margin = 0.90;
        const kMax = ctx.nX / (2 * ctx.fovX);
        const nTurns = Math.ceil(ctx.nX / (2 * nInterleaves));
        const nBase = 20000;
        const kx = new Float64Array(nBase);
        const ky = new Float64Array(nBase);
        const step = 1 / (nBase - 1);
        for (let i = 0; i < nBase; i++) {
            const t = i === nBase - 1 ? 1 : i * step;
            const theta = 2 * Math.PI * nTurns * t;
            kx[i] = kMax * t * Math.cos(theta);
            ky[i] = kMax * t * Math.sin(theta);
        }
        // traj_to_grad: gradient between k points, slew averaged back onto them.
        const n = nBase - 1;
        const gxA = new Float64Array(n);
        const gyA = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            gxA[i] = (kx[i + 1] - kx[i]) / raster;
            gyA[i] = (ky[i + 1] - ky[i]) / raster;
        }
        const slewAt = (i) => Math.hypot((gxA[i + 1] - gxA[i]) / raster, (gyA[i + 1] - gyA[i]) / raster);
        const slewVec = (i) => [(gxA[i + 1] - gxA[i]) / raster, (gyA[i + 1] - gyA[i]) / raster];
        const tSmooth = new Float64Array(nBase);
        for (let i = 0; i < n; i++) {
            let s;
            if (i === 0) s = slewAt(0);
            else if (i === n - 1) s = slewAt(n - 2);
            else {
                const a = slewVec(i - 1);
                const b = slewVec(i);
                s = Math.hypot(0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]));
            }
            const dtGrad = Math.hypot(gxA[i], gyA[i]) / (ctx.lim.grad * margin) * raster;
            const dtSlew = Math.sqrt(s / (ctx.lim.slew * margin)) * raster;
            tSmooth[i + 1] = tSmooth[i] + Math.max(dtGrad, dtSlew);
        }
        // Resample k onto the gradient raster (np.interp).
        const nOpt = Math.floor(tSmooth[nBase - 1] / raster) + 1;
        const kxo = new Float64Array(nOpt);
        const kyo = new Float64Array(nOpt);
        let j = 0;
        for (let i = 0; i < nOpt; i++) {
            const t = i * raster;
            while (j < nBase - 2 && tSmooth[j + 1] < t) j++;
            const span = tSmooth[j + 1] - tSmooth[j];
            const f = span > 0 ? Math.min(Math.max((t - tSmooth[j]) / span, 0), 1) : 0;
            kxo[i] = kx[j] + f * (kx[j + 1] - kx[j]);
            kyo[i] = ky[j] + f * (ky[j + 1] - ky[j]);
        }
        const nCore = nOpt - 1;
        const first = [(kxo[1] - kxo[0]) / raster, (kyo[1] - kyo[0]) / raster];
        const last = [(kxo[nOpt - 1] - kxo[nOpt - 2]) / raster, (kyo[nOpt - 1] - kyo[nOpt - 2]) / raster];
        const slewLim = ctx.lim.slew * margin;
        const nIn = Math.max(Math.ceil(Math.hypot(first[0], first[1]) / slewLim / raster), 1);
        const rampTime = Math.ceil(Math.hypot(last[0], last[1]) / slewLim / raster) * raster;
        const nRamp = Math.max(Math.round(rampTime / raster), 1);
        let nSamples = nIn + nCore + nRamp;
        nSamples += (4 - (nSamples % 4)) % 4;

        // k at the end of the unrotated arm: the core ends at k(nOpt-1); the
        // linear ramps add the area of a triangle each.
        const rampInArea = (v) => v * raster * (nIn - 1) / 2;
        const rampOutArea = (v) => v * raster * (nRamp - 1) / 2;
        const kEnd = [
            kxo[nOpt - 1] + rampInArea(first[0]) + rampOutArea(last[0]),
            kyo[nOpt - 1] + rampInArea(first[1]) + rampOutArea(last[1])
        ];
        return { nInterleaves, nSamples, shapeDur: nSamples * raster, kEnd };
    }

    function buildSequence(ctx) {
        const N = ctx.N;
        const p = ctx.params;
        const lim = ctx.lim;
        const model = {
            lobes: [],        // every named gradient event, for the raster check
            pulses: [],       // every RF pulse, for the B1 check
            blocks: [],       // one TR, in play order
            notes: []
        };
        const lobe = (g) => { model.lobes.push(g); return g; };
        const block = (label, ...events) => model.blocks.push({ label, events });

        // ── Excitation events ───────────────────────────────────────
        const flip = ctx.isGRE ? p.flipAngle * Math.PI / 180 : Math.PI / 2;
        let inv = null;
        let gzInvReph = null;
        if (ctx.isIR) {
            inv = sincPulse('rf_inv', N.gzInv, Math.PI, ctx);
            model.pulses.push(inv.rf);
            lobe(inv.gz);
            gzInvReph = lobe(trapAreaDuration('z', N.gzInvReph, -inv.gz.area / 2, 2e-3, lim, ctx));
        }
        const exc = sincPulse('rf', N.gz, flip, ctx);
        model.pulses.push(exc.rf);
        lobe(exc.gz);
        let refoc = null;
        if (!ctx.isGRE) {
            refoc = sincPulse('rf2', N.gzRefoc, Math.PI, ctx);
            model.pulses.push(refoc.rf);
        }
        let gzReph = lobe(trapAreaDuration('z', N.gzReph, -exc.gz.area / 2, 2e-3, lim, ctx));
        let gzRefocReph = null;
        if (refoc) {
            lobe(refoc.gz);
            gzRefocReph = lobe(trapAreaDuration('z', N.gzRefocReph, -refoc.gz.area / 2, 2e-3, lim, ctx));
        }
        const hasSpoiler = ctx.isGRE && p.spoiler;
        const gzSpoil = hasSpoiler
            ? lobe(lobeOnRaster('z', N.gzSpoil, 4 / ctx.sliceThickness, lim, ctx.lobeRaster, ctx))
            : null;
        const gzEnc = ctx.is3D
            // The largest partition area is the one that has to fit.
            ? lobe(trapAreaDuration('z', N.gzEnc, -(ctx.nSlices / 2) / ctx.sliceThickness, ctx.preTimeZ, lim, ctx))
            : null;

        // ── Trajectory events ───────────────────────────────────────
        const traj = p.trajectory;
        const deltaKx = 1 / ctx.fovX;
        const deltaKy = 1 / ctx.fovY;
        let timeToEcho = ctx.is3D ? ctx.preTimeZ : 0;
        const play = [];      // blocks between the excitation prologue and the TR delay
        let ro = null;
        let teDelaySlot = -1; // index in `play` where te_delay goes (GRE only)

        if (traj === 'cartesian' || traj === 'epi') {
            // Both 1.28 ms: the cartesian readout of the GRE validated on the Disc Scanner.
            ro = buildReadout(ctx, traj === 'epi' ? 12.8e-4 : 1.28e-3);
            lobe(ro.gx);
            const preTime = 1.28e-3;
            const gxPre = lobe(trapAreaDuration('x', N.gxPre, -ro.gx.area / 2 - deltaKx / 2, preTime, lim, ctx));
            if (ctx.isGRE && traj === 'epi') {
                // Re-timed to the prephasers; replaces the 2 ms rephaser.
                model.lobes = model.lobes.filter((g) => g !== gzReph);
                gzReph = lobe(trapAreaDuration('z', N.gzReph, -exc.gz.area / 2, preTime, lim, ctx));
            }
            // The largest phase-encoding area is the one that has to fit.
            const gyPe = lobe(trapAreaDuration('y', N.gyPe, -ctx.nY / 2 * deltaKy, preTime, lim, ctx));
            const preEvents = ctx.isGRE ? [gxPre, gyPe, gzReph] : [gxPre, gyPe];
            const prephasing = ctx.isGRE ? calcDuration(gxPre, gzReph) : calcDuration(gxPre);

            if (gzEnc) play.push({ label: 'slice encoding', events: [gzEnc] });
            play.push({ label: 'prephasing', events: preEvents });
            teDelaySlot = play.length;

            if (traj === 'cartesian') {
                timeToEcho += prephasing + calcDuration(ro.gx) / 2;
                play.push({ label: 'readout', events: [ro.gx, ro.adc] });
            } else {
                const nShots = p.nShots || 1;
                const gyBlip = lobe(lobeOnRaster('y', N.gyBlip, nShots * deltaKy, lim, ctx.lobeRaster, ctx));
                const nEchoes = Math.round(ctx.nY / nShots);
                const line = calcDuration(ro.gx, ro.adc);
                const blip = calcDuration(gyBlip);
                timeToEcho += prephasing + Math.floor(nEchoes / 2) * (line + blip) + calcDuration(ro.gx) / 2;
                for (let i = 0; i < nEchoes; i++) {
                    play.push({ label: 'readout line', events: [ro.gx, ro.adc] });
                    if (i !== nEchoes - 1) play.push({ label: 'phase blip', events: [gyBlip] });
                }
                if (nEchoes < 1) {
                    throw new Infeasible(
                        'The EPI train has no echoes',
                        `n_y / n_shots = ${ctx.nY} / ${nShots} rounds to zero lines per shot. Use fewer shots.`
                    );
                }
                if (ctx.nY % nShots !== 0) {
                    model.notes.push({
                        level: 'warning', group: 'Timing & trajectory',
                        title: 'N shots does not divide the matrix',
                        detail: `n_y = ${ctx.nY} over ${nShots} shots gives ${fmt(ctx.nY / nShots, 2)} lines per shot; ` +
                            `the script rounds to ${nEchoes}, so ${nEchoes * nShots} lines are acquired instead of ${ctx.nY}.`
                    });
                }
            }
            if (gzSpoil) play.push({ label: 'spoiler', events: [gzSpoil] });
        } else if (traj === 'radial') {
            ro = buildReadout(ctx, 2.56e-3);
            lobe(ro.gx);
            const gxPre = lobe(trapAreaDuration('x', N.gxPre, -ro.gx.area / 2 - deltaKx / 2, 1e-3, lim, ctx));
            if (gzEnc) play.push({ label: 'slice encoding', events: [gzEnc] });
            if (ctx.isGRE) {
                play.push({ label: 'slice rephasing', events: [gzReph] });
                timeToEcho += calcDuration(gzReph);
                teDelaySlot = play.length;
            }
            timeToEcho += calcDuration(gxPre) + calcDuration(ro.gx) / 2;
            play.push({ label: 'spoke prephasing', events: [gxPre] });
            play.push({ label: 'spoke readout', events: [ro.gx, ro.adc] });
            if (gzSpoil) play.push({ label: 'spoiler', events: [gzSpoil] });
        } else {  // spiral
            const sp = buildSpiral(ctx);
            model.spiral = sp;
            const gxSpiral = lobe({ type: 'grad', channel: 'x', name: N.gxSpiral, delay: ctx.adcDeadTime, shapeDur: sp.shapeDur });
            const gySpiral = lobe({ type: 'grad', channel: 'y', name: N.gySpiral, delay: ctx.adcDeadTime, shapeDur: sp.shapeDur });
            const adc = {
                type: 'adc', name: 'adc', numSamples: sp.nSamples, dwell: ctx.rasters.grad,
                delay: ctx.adcDeadTime, deadTime: ctx.adcDeadTime
            };
            ro = { adc, dwell: adc.dwell, dwellRequested: adc.dwell, isSpiral: true };
            if (gzEnc) play.push({ label: 'slice encoding', events: [gzEnc] });
            if (ctx.isGRE) {
                model.lobes = model.lobes.filter((g) => g !== gzReph);
                gzReph = lobe(trapAreaDuration('z', N.gzReph, -exc.gz.area / 2, 1.5e-3, lim, ctx));
                play.push({ label: 'slice rephasing', events: [gzReph] });
                timeToEcho += calcDuration(gzReph);
                teDelaySlot = play.length;
            }
            timeToEcho += ctx.adcDeadTime;
            play.push({ label: 'spiral readout', events: [gxSpiral, gySpiral, adc] });
            model.spiral.readoutDuration = calcDuration(gxSpiral, adc);
            if (ctx.isGRE) {
                // Rewinders differ per interleave (k_end rotates); the longest sets the TR floor.
                const rewLim = { grad: lim.grad / Math.SQRT2, slew: lim.slew * 0.90 / Math.SQRT2, raster: lim.raster };
                let worst = null;
                for (let i = 0; i < sp.nInterleaves; i++) {
                    const phi = i * (2 * Math.PI / sp.nInterleaves);
                    const kx = sp.kEnd[0] * Math.cos(phi) - sp.kEnd[1] * Math.sin(phi);
                    const ky = sp.kEnd[0] * Math.sin(phi) + sp.kEnd[1] * Math.cos(phi);
                    const rx = lobeOnRaster('x', N.gxRew, -kx, rewLim, ctx.lobeRaster, ctx);
                    const ry = lobeOnRaster('y', N.gyRoRew, -ky, rewLim, ctx.lobeRaster, ctx);
                    if (!worst || calcDuration(rx, ry) > calcDuration(worst[0], worst[1])) worst = [rx, ry];
                }
                lobe(worst[0]);
                lobe(worst[1]);
                play.push({ label: 'rewinder', events: worst });
            }
        }

        // ── Excitation timing ───────────────────────────────────────
        const bd = ctx.rasters.block;
        const excDuration = calcDuration(exc.rf, exc.gz);
        const rfCenter = exc.rf.delay + exc.rf.center;
        const timing = { timeToEcho };

        if (ctx.isGRE) {
            timing.teMin = (excDuration - rfCenter) + timeToEcho;
            timing.teDelayRaw = ctx.te - timing.teMin;
            timing.teDelay = Math.max(roundTo(timing.teDelayRaw, bd), 0);
            timing.teActual = timing.teMin + timing.teDelay;
            block('excitation', exc.rf, exc.gz);
            play.forEach((b, i) => {
                if (i === teDelaySlot && timing.teDelay > 0) block('TE delay', delayEvent(timing.teDelay));
                block(b.label, ...b.events);
            });
        } else {
            const rf2Center = refoc.rf.delay + refoc.rf.center;
            timing.firstHalfMin = (excDuration - rfCenter) + calcDuration(gzReph) + rf2Center;
            timing.secondHalfMin = (calcDuration(refoc.rf, refoc.gz) - rf2Center) + calcDuration(gzRefocReph) + timeToEcho;
            timing.teMin = 2 * Math.max(timing.firstHalfMin, timing.secondHalfMin);
            timing.delay1Raw = ctx.te / 2 - timing.firstHalfMin;
            timing.delay2Raw = ctx.te / 2 - timing.secondHalfMin;
            timing.delay1 = Math.max(roundTo(timing.delay1Raw, bd), 0);
            timing.delay2 = Math.max(roundTo(timing.delay2Raw, bd), 0);
            timing.teActual = ctx.te;
            if (ctx.isIR) {
                const invCenter = inv.rf.delay + inv.rf.center;
                timing.tiMin = (calcDuration(inv.rf, inv.gz) - invCenter) + calcDuration(gzInvReph) + rfCenter;
                timing.delayTiRaw = ctx.ti - timing.tiMin;
                timing.delayTi = Math.max(roundTo(timing.delayTiRaw, bd), 0);
                block('inversion', inv.rf, inv.gz);
                block('inversion rephasing', gzInvReph);
                if (timing.delayTi > 0) block('TI delay', delayEvent(timing.delayTi));
            }
            block('excitation', exc.rf, exc.gz);
            block('slice rephasing', gzReph);
            if (timing.delay1 > 0) block('TE delay 1', delayEvent(timing.delay1));
            block('refocusing', refoc.rf, refoc.gz);
            block('refocusing rephasing', gzRefocReph);
            if (timing.delay2 > 0) block('TE delay 2', delayEvent(timing.delay2));
            play.forEach((b) => block(b.label, ...b.events));
        }

        // TR is the period of one iteration.
        timing.iteration = model.blocks.reduce((t, b) => t + calcDuration(...b.events), 0);
        timing.trBudget = ctx.isMultislice ? ctx.tr / ctx.nSlices : ctx.tr;
        timing.trDelayRaw = timing.trBudget - timing.iteration;
        model.timing = timing;
        model.readout = ro;
        return model;
    }

    // ─── Stage 4: the block checks (mirrors MintValidator.check_block) ──

    function checkBlocks(model) {
        const out = { errors: [], rf: [], inPlane: null };
        let clock = 0;
        let rampDownStart = null;

        model.blocks.forEach((b, index) => {
            const where = `Block ${index + 1} (${b.label}, t = ${fmt(ms(clock), 3)} ms)`;
            const rf = b.events.filter((e) => e.type === 'rf');
            const adc = b.events.filter((e) => e.type === 'adc');
            const grads = b.events.filter((e) => e.type === 'trap' || e.type === 'grad');

            if (rf.length > 1) out.errors.push(`${where}: ${rf.length} RF pulses in one block.`);
            if (adc.length > 1) out.errors.push(`${where}: ${adc.length} ADC events in one block.`);
            if (rf.length && adc.length) {
                out.errors.push(`${where}: RF and ADC in the same block. The scanner cannot transmit and receive at once.`);
            }
            ['x', 'y', 'z'].forEach((channel) => {
                const count = grads.filter((g) => g.channel === channel).length;
                if (count > 1) out.errors.push(`${where}: ${count} gradient events overlap on the ${channel} axis.`);
            });

            if (rf.length) {
                const pulse = rf[0];
                const rfStart = pulse.delay;
                const rfEnd = pulse.delay + pulse.shapeDur;
                const selection = grads.find((g) => g.channel === 'z' && g.type === 'trap');
                if (selection) {
                    const plateauStart = selection.delay + selection.rise;
                    const plateauEnd = plateauStart + selection.flat;
                    const onPlateau = rfStart >= plateauStart - TOL && rfEnd <= plateauEnd + TOL;
                    out.rf.push({ name: pulse.name, lobe: selection.name, rfStart, rfEnd, plateauStart, plateauEnd, onPlateau });
                    if (!onPlateau) {
                        out.errors.push(
                            `${where}: ${pulse.name} plays from ${fmt(us(rfStart))} to ${fmt(us(rfEnd))} µs but the ` +
                            `plateau of ${selection.name} spans ${fmt(us(plateauStart))} to ${fmt(us(plateauEnd))} µs.`
                        );
                    }
                    rampDownStart = clock + plateauEnd;
                } else {
                    rampDownStart = clock + rfEnd;
                }
            }

            if (rampDownStart !== null) {
                grads.filter((g) => g.channel !== 'z').forEach((g) => {
                    const start = clock + g.delay;
                    if (start < rampDownStart - TOL) {
                        out.errors.push(
                            `${where}: ${g.name} starts at ${fmt(us(start))} µs, before the slice-selection ` +
                            `ramp-down begins at ${fmt(us(rampDownStart))} µs.`
                        );
                    } else if (!out.inPlane || start - rampDownStart < out.inPlane.gap) {
                        // Remember the tightest case: the first in-plane lobe after an RF pulse.
                        out.inPlane = { name: g.name, start, rampDownStart, gap: start - rampDownStart };
                    }
                });
            }
            clock += calcDuration(...b.events);
        });
        return out;
    }

    // ─── The pipeline ───────────────────────────────────────────────

    function validate(params) {
        const messages = [];
        const say = (level, group, title, detail) => messages.push({ level, group, title, detail });
        const result = { messages, lobes: [], timing: {}, counts: { error: 0, warning: 0, ok: 0, info: 0 } };
        const finish = () => {
            messages.forEach((m) => { result.counts[m.level] += 1; });
            return result;
        };

        const T = window.pulseqTemplates;
        if (!T || !T.system || !T.names) {
            say('error', 'Setup', 'Templates not loaded', 'system.js and names.js must load before validation.js.');
            return finish();
        }

        const ctx = context(params);
        const names = T.names;
        const R = ctx.rasters;
        const lobeRasterUs = fmt(us(ctx.lobeRaster), 0);
        result.lobeRasterUs = lobeRasterUs;
        const G_RASTER = 'Raster times';
        const G_TIMING = 'Timing & trajectory';
        const G_PHYS = 'Physical constraints';
        const G_LIMITS = 'System limits';

        // Inputs that make everything downstream meaningless.
        const bad = [];
        if (!(params.fov.x > 0 && params.fov.y > 0)) bad.push('FOV X and Y must be positive');
        if (!(params.resolution.x > 0 && params.resolution.y > 0)) bad.push('the resolution must be positive');
        if (!(ctx.nX >= 2 && ctx.nY >= 2)) bad.push('the matrix must be at least 2 x 2');
        if (params.dimension === '3D' && !(params.fov.z > 0)) bad.push('FOV Z must be positive for 3D');
        if (!(ctx.te > 0 && ctx.tr > 0)) bad.push('TE and TR must be positive');
        if (ctx.isGRE && !(params.flipAngle > 0)) bad.push('the flip angle must be positive');
        if (!(ctx.system.maxGrad > 0 && ctx.system.maxSlew > 0)) bad.push('max_grad and max_slew must be positive');
        if (bad.length) {
            say('error', 'Setup', 'The form has values no sequence can be built from', bad.join('; ') + '.');
            return finish();
        }

        // ── 1. build ────────────────────────────────────────────────
        let model;
        try {
            model = buildSequence(ctx);
        } catch (err) {
            if (!(err instanceof Infeasible)) throw err;
            say('error', G_LIMITS, err.title, err.detail);
            say('info', G_LIMITS, 'The remaining checks were not run',
                'The sequence cannot be built with this combination, so there is nothing to time yet.');
            return finish();
        }
        const timing = model.timing;

        // ── 2. rasters ──────────────────────────────────────────────
        const ro = model.readout;
        const adcRasterNs = fmt(R.adc * 1e9, 0);
        if (ro.isSpiral) {
            say('ok', G_RASTER, 'ADC dwell is on the ADC raster',
                `Spiral samples once per gradient raster point: dwell ${fmt(ro.dwell * 1e9, 0)} ns = ` +
                `${Math.round(ro.dwell / R.adc)} × adc_raster_time (${adcRasterNs} ns).`);
        } else if (!isMultiple(ro.dwellRequested, R.adc)) {
            say('warning', G_RASTER, 'ADC dwell is NOT an integer multiple of adc_raster_time',
                `readout_time / n_x = ${fmt(ro.dwellRequested * 1e9, 2)} ns is not a multiple of ${adcRasterNs} ns, so the ` +
                `scanner cannot sample at that rate. The script snaps it down to ${fmt(ro.dwell * 1e9, 0)} ns ` +
                `(${Math.round(ro.dwell / R.adc)} rasters): the readout shortens from ` +
                `${fmt(us(ro.dwellRequested * ctx.nX), 1)} to ${fmt(us(ro.adcDuration), 1)} µs and the bandwidth rises to ` +
                `${fmt(1 / ro.dwell / ctx.nX, 1)} Hz/pixel. Pick a matrix size that divides the readout time to avoid it.`);
        } else {
            say('ok', G_RASTER, 'ADC dwell is on the ADC raster',
                `dwell ${fmt(ro.dwell * 1e9, 0)} ns = ${Math.round(ro.dwell / R.adc)} × adc_raster_time (${adcRasterNs} ns).`);
        }
        if (ro.adc.numSamples % 4 !== 0) {
            say('warning', G_RASTER, 'ADC sample count is not a multiple of 4',
                `${ro.adc.numSamples} samples per readout; adc_samples_divisor is 4 and some scanners reject other counts. ` +
                'Choose FOV and resolution so the matrix is a multiple of 4.');
        }

        result.lobes = model.lobes.map((g) => {
            const duration = lobeDuration(g);
            return {
                name: g.name,
                label: names.label(g.name),
                durationUs: us(duration),
                rasters: duration / ctx.lobeRaster,
                onRaster: isMultiple(duration, ctx.lobeRaster)
            };
        });
        const offRaster = result.lobes.filter((l) => !l.onRaster);
        if (offRaster.length) {
            offRaster.forEach((l) => say('warning', G_RASTER, `${l.name} is off the lobe raster`,
                `Its duration, ${fmt(l.durationUs, 1)} µs, is not a multiple of 2 × grad_raster_time (${lobeRasterUs} µs). ` +
                'Half of it falls off the gradient raster, so splitting it forces a ceil() that drifts the timing.'));
        } else {
            say('ok', G_RASTER, `All ${result.lobes.length} gradient lobes last a multiple of ${lobeRasterUs} µs`,
                `2 × grad_raster_time = ${lobeRasterUs} µs. A lobe on this raster can be split in half without leaving ` +
                'the gradient raster. Each duration is in the table at the foot of the console.');
        }

        const timingParam = (name, value) => {
            if (isMultiple(value, ctx.lobeRaster)) {
                say('ok', G_RASTER, `${name} is on the ${lobeRasterUs} µs raster`,
                    `${name} = ${fmt(ms(value), 3)} ms = ${Math.round(value / ctx.lobeRaster)} × 2 × grad_raster_time.`);
            } else {
                say('warning', G_RASTER, `${name} is NOT a multiple of 2 × grad_raster_time`,
                    `${name} = ${fmt(ms(value), 4)} ms is not a multiple of ${lobeRasterUs} µs. Its half falls off the ` +
                    `gradient raster, so the delays are rounded and the sequence plays at a slightly different ${name}. ` +
                    `Nearest valid value: ${fmt(ms(roundTo(value, ctx.lobeRaster)), 2)} ms.`);
            }
        };
        timingParam('TE', ctx.te);
        timingParam('TR', ctx.tr);
        if (ctx.isIR) timingParam('TI', ctx.ti);
        if (ctx.isMultislice && !isMultiple(ctx.tr / ctx.nSlices, ctx.lobeRaster)) {
            say('warning', G_RASTER, 'TR / n_slices is NOT a multiple of 2 × grad_raster_time',
                `The slices share one TR, so each excitation gets ${fmt(ms(ctx.tr / ctx.nSlices), 4)} ms, which is off the ` +
                `${lobeRasterUs} µs raster and gets rounded. Choose a TR that is a multiple of ` +
                `${fmt(ms(ctx.nSlices * ctx.lobeRaster), 2)} ms (n_slices × ${lobeRasterUs} µs).`);
        }

        // ── 3. timing ───────────────────────────────────────────────
        result.timing = {
            teMinMs: ms(timing.teMin),
            teActualMs: ms(timing.teActual),
            timeToEchoMs: ms(timing.timeToEcho),
            iterationMs: ms(timing.iteration),
            trBudgetMs: ms(timing.trBudget),
            tiMinMs: timing.tiMin !== undefined ? ms(timing.tiMin) : null,
            spiralReadoutMs: model.spiral ? ms(model.spiral.readoutDuration) : null
        };
        let teOk = true;
        if (ctx.isGRE) {
            if (timing.teDelayRaw < -TOL) {
                teOk = false;
                say('warning', G_TIMING, 'TE cannot be reached',
                    `TE = ${fmt(ms(ctx.te), 2)} ms, but these events need at least ${fmt(ms(timing.teMin), 3)} ms from the ` +
                    'centre of the RF pulse to the echo. The sequence plays at that longer TE instead.');
            }
        } else if (timing.delay1Raw < -TOL || timing.delay2Raw < -TOL) {
            teOk = false;
            say('error', G_TIMING, 'TE is too short for a spin echo',
                `The 180° must sit at TE/2 with the echo at TE. With these events the shortest usable TE is ` +
                `${fmt(ms(timing.teMin), 2)} ms; TE = ${fmt(ms(ctx.te), 2)} ms would leave the echo unrefocused, so the ` +
                'script stops with a ValueError.');
        }
        if (teOk) {
            say('ok', G_TIMING, 'TE is reachable and exact',
                `Measured from the centre of the RF pulse to the echo: shortest possible ${fmt(ms(timing.teMin), 3)} ms, ` +
                `requested ${fmt(ms(ctx.te), 3)} ms.`);
        }
        let tiOk = true;
        if (ctx.isIR) {
            if (timing.delayTiRaw < -TOL) {
                tiOk = false;
                say('error', G_TIMING, 'TI is too short',
                    `The inversion pulse, its rephaser and the first half of the excitation already take ` +
                    `${fmt(ms(timing.tiMin), 2)} ms; TI = ${fmt(ms(ctx.ti), 2)} ms cannot be played, so the script stops ` +
                    'with a ValueError.');
            } else {
                say('ok', G_TIMING, 'TI is reachable',
                    `Measured between pulse centres: shortest possible ${fmt(ms(timing.tiMin), 2)} ms, requested ` +
                    `${fmt(ms(ctx.ti), 2)} ms.`);
            }
        }
        // A gradient echo that misses TE still plays, so its TR is still worth checking;
        // a spin echo or a TI that does not fit never gets as far as the loop.
        if ((teOk || ctx.isGRE) && tiOk) {
            const label = ctx.isMultislice ? 'TR per excitation (TR / n_slices)' : 'TR';
            if (timing.trDelayRaw < -TOL) {
                say('warning', G_TIMING, 'TR is too short',
                    `${label} = ${fmt(ms(timing.trBudget), 2)} ms, but one iteration already plays for ` +
                    `${fmt(ms(timing.iteration), 2)} ms. The sequence runs at that longer TR instead.`);
            } else {
                say('ok', G_TIMING, 'TR fits the sequence',
                    `${label} = ${fmt(ms(timing.trBudget), 2)} ms; one iteration plays for ${fmt(ms(timing.iteration), 2)} ms.`);
            }
        }
        if (model.spiral && model.spiral.readoutDuration > SPIRAL_LIMIT) {
            const needed = Math.ceil(model.spiral.nInterleaves * model.spiral.readoutDuration / SPIRAL_LIMIT);
            say('warning', G_TIMING, 'Spiral readout is long',
                `About ${fmt(ms(model.spiral.readoutDuration), 1)} ms per arm (target ≤ 6 ms): off-resonance and T2* blur ` +
                `the image. Use about ${needed} interleaves instead of ${model.spiral.nInterleaves}.`);
        }
        model.notes.forEach((n) => say(n.level, n.group, n.title, n.detail));

        // ── 4. physical ─────────────────────────────────────────────
        const checks = checkBlocks(model);
        checks.errors.forEach((text) => say('error', G_PHYS, 'Impossible block', text));
        const onPlateau = checks.rf.filter((r) => r.onPlateau);
        if (checks.rf.length && onPlateau.length === checks.rf.length) {
            const r = checks.rf[checks.rf.length - 1];
            say('ok', G_PHYS, `RF plays on the slice-selection plateau (${checks.rf.length} of ${checks.rf.length} pulses)`,
                `e.g. ${r.name}: RF from ${fmt(us(r.rfStart), 0)} to ${fmt(us(r.rfEnd), 0)} µs; flat_time of ${r.lobe} from ` +
                `${fmt(us(r.plateauStart), 0)} to ${fmt(us(r.plateauEnd), 0)} µs. Nothing on the ramps.`);
        }
        if (checks.inPlane && !checks.errors.length) {
            const c = checks.inPlane;
            say('ok', G_PHYS, 'Phase-encoding and prephasing lobes start after the slice-selection ramp-down begins',
                `Tightest case: ${c.name} starts ${fmt(us(c.gap), 0)} µs after the ramp-down of the preceding ` +
                'slice-selection lobe begins. No in-plane lobe plays under an RF pulse.');
        }
        if (!checks.errors.length) {
            say('ok', G_PHYS, `No overlapping or impossible combinations in ${model.blocks.length} blocks of one TR`,
                'At most one RF, one ADC and one gradient event per axis in every block; RF and ADC never share a block.');
        }

        // ── 5. limits ───────────────────────────────────────────────
        const hot = model.pulses.filter((rf) => rf.peakB1 > ctx.maxB1 * (1 + 1e-9));
        if (hot.length) {
            hot.forEach((rf) => say('warning', G_LIMITS, `${rf.name} exceeds max_b1`,
                `Peak B1 ${fmt(rf.peakB1 * 1e6, 2)} µT against a limit of ${fmt(ctx.maxB1 * 1e6, 2)} µT. ` +
                'Lengthen the pulse or lower the flip angle.'));
        } else {
            const peak = Math.max(...model.pulses.map((rf) => rf.peakB1));
            say('ok', G_LIMITS, 'Peak B1 is within max_b1',
                `Highest pulse: ${fmt(peak * 1e6, 2)} µT of ${fmt(ctx.maxB1 * 1e6, 2)} µT allowed.`);
        }
        say('ok', G_LIMITS, 'Every lobe fits the gradient limits',
            `All lobes were built under ${ctx.limitsText}.`);

        // ── Options that change nothing ─────────────────────────────
        if (params.spoiler && !ctx.isGRE) {
            say('info', 'Options', 'Spoiler has no effect here',
                'The spoiler lobe is only played after a gradient-echo readout; it is ignored for Spin Echo and Inversion Recovery.');
        }
        if (params.phaseContrast) {
            say('info', 'Options', 'Phase contrast is not generated yet',
                'The Phase contrast and Venc controls do not change the script: no template emits velocity-encoding lobes.');
        }

        return finish();
    }

    window.mintValidation = { validate };
})();
