/**
 * simulator.js — Pulse Sequence Diagram (PSD) and k-space trajectory
 *                preview for the Sequence Builder.
 *
 * Public function: window.drawBuilderPreview(params)
 *   Called by builder.js on every form change.
 *   Draws on: #builder-psd-canvas  and  #builder-traj-canvas
 */

(function () {
    'use strict';

    // ─── Colors (matching app theme) ────────────────────────────────
    var COL = {
        bg:   '#0f172a',
        grid: 'rgba(255,255,255,0.06)',
        axis: 'rgba(255,255,255,0.18)',
        text: '#94a3b8',
        rf:   '#ef4444',
        gz:   '#3b82f6',
        gy:   '#10b981',
        gx:   '#f59e0b',
        adc:  '#06b6d4'
    };

    // ═══════════════════════════════════════════════════════════════
    //  WAVEFORM HELPERS
    // ═══════════════════════════════════════════════════════════════

    /** Trapezoidal gradient: ramp up → flat → ramp down */
    function trap(t, start, rise, flat, fall, amp) {
        if (t < start || t > start + rise + flat + fall) return 0;
        var dt = t - start;
        if (dt < rise) return amp * dt / rise;
        if (dt < rise + flat) return amp;
        return amp * (1 - (dt - rise - flat) / fall);
    }

    /** Windowed sinc envelope for RF pulse */
    function sincPulse(t, center, halfW) {
        if (t < center - halfW || t > center + halfW) return 0;
        var x = (t - center) / (halfW / 3);
        var env = 0.54 + 0.46 * Math.cos(Math.PI * (t - center) / halfW); // Hamming
        return (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * env;
    }

    // ═══════════════════════════════════════════════════════════════
    //  WAVEFORM GENERATION  (returns 5 Float32Arrays + tMax in ms)
    // ═══════════════════════════════════════════════════════════════

    function generateWaveforms(params) {
        var exc  = params.excitation;
        var traj = params.trajectory;
        var TE   = params.te;            // ms
        var fa   = params.flipAngle;
        var Ny   = Math.round((params.fov.y / 100) / (params.resolution.y / 1000));
        if (Ny < 8) Ny = 64;
        var nShots = params.nShots || 1;

        // Determine total display time based on combination
        var tMax;
        if (traj === 'epi') {
            var nLines = Math.min(Math.round(Ny / nShots), 64);
            tMax = (exc === 'spinEcho' || exc === 'inversionRecovery')
                 ? Math.max(TE + nLines * 1.8 + 5, 40)
                 : nLines * 1.8 + 12;
        } else if (traj === 'spiral') {
            tMax = (exc === 'spinEcho') ? Math.max(TE + 25, 45) : 35;
        } else { // cartesian, radial
            if (exc === 'spinEcho') tMax = Math.max(TE + 5, 25);
            else if (exc === 'inversionRecovery') tMax = Math.max(TE + 20, 40);
            else tMax = 15;
        }

        var N = 1200;
        var rf  = new Float32Array(N);
        var gz  = new Float32Array(N);
        var gy  = new Float32Array(N);
        var gx  = new Float32Array(N);
        var adc = new Float32Array(N);

        // Helper: ms → sample index
        function idx(ms) { return Math.round(ms / tMax * (N - 1)); }

        // Fill arrays sample by sample
        for (var i = 0; i < N; i++) {
            var t = i / (N - 1) * tMax; // current time in ms

            // ── EXCITATION (RF + Gz) ────────────────────────────
            if (exc === 'gradientEcho') {
                rf[i] = sincPulse(t, 1.5, 1.2) * (fa / 90);
                gz[i] = trap(t, 0.1, 0.3, 2.4, 0.3, 1)
                      + trap(t, 3.1, 0.2, 1.0, 0.2, -0.5);
            }
            else if (exc === 'spinEcho') {
                // 90° at t=1.5
                rf[i] = sincPulse(t, 1.5, 1.2);
                gz[i] = trap(t, 0.1, 0.3, 2.4, 0.3, 1)
                      + trap(t, 3.1, 0.2, 1.0, 0.2, -0.5);
                // 180° at t = TE/2 + 1.5
                var t180 = TE / 2 + 1.5;
                rf[i] += sincPulse(t, t180, 1.2) * 1.3;
                gz[i] += trap(t, t180 - 1.5, 0.3, 2.4, 0.3, 1);
            }
            else if (exc === 'inversionRecovery') {
                var TI = 12; // compressed TI for display
                // 180° inversion at t=1.5
                rf[i] = sincPulse(t, 1.5, 1.2) * 1.3;
                gz[i] = trap(t, 0.1, 0.3, 2.4, 0.3, 1)
                      + trap(t, 3.1, 0.2, 1.0, 0.2, -0.5);
                // 90° excitation at t = TI + 1.5
                var t90 = TI + 1.5;
                rf[i] += sincPulse(t, t90, 1.2);
                gz[i] += trap(t, t90 - 1.4, 0.3, 2.4, 0.3, 0.9)
                       + trap(t, t90 + 1.5, 0.2, 1.0, 0.2, -0.45);
                // 180° refocus at t = TI + TE/2 + 1.5
                var t180ir = TI + TE / 2 + 1.5;
                rf[i] += sincPulse(t, t180ir, 1.2) * 1.3;
                gz[i] += trap(t, t180ir - 1.4, 0.3, 2.4, 0.3, 1);
            }

            // ── TRAJECTORY (Gy, Gx, ADC) ────────────────────────
            var readStart; // when the readout period begins
            if (exc === 'spinEcho') readStart = TE - 2;
            else if (exc === 'inversionRecovery') readStart = 12 + TE - 2; // TI + TE
            else readStart = 5; // GRE

            if (traj === 'cartesian') {
                // Prephase Gx (negative) + Gy encode
                gx[i] += trap(t, readStart - 2.5, 0.2, 1.8, 0.2, -0.6);
                gy[i] += trap(t, readStart - 2.5, 0.2, 1.8, 0.2, 0.5);
                // Readout Gx + ADC
                gx[i] += trap(t, readStart, 0.3, 3.0, 0.3, 0.7);
                if (t >= readStart + 0.3 && t <= readStart + 3.3) adc[i] = 1;
            }
            else if (traj === 'epi') {
                var epiStart = readStart - 0.5;
                var nLines = Math.min(Math.round(Ny / nShots), 64);
                var lineT = 1.6;    // time per readout line
                var blipT = 0.2;    // blip duration
                var totalEpiT = nLines * lineT;

                // Prephase: Gx negative + Gy negative (go to -ky max)
                gx[i] += trap(t, epiStart - 2.5, 0.2, 1.5, 0.2, -0.7);
                gy[i] += trap(t, epiStart - 2.5, 0.2, 1.5, 0.2, -0.8);

                // EPI echo train
                if (t >= epiStart && t < epiStart + totalEpiT) {
                    var tRel = t - epiStart;
                    var lineIdx = Math.floor(tRel / lineT);
                    var tInLine = tRel - lineIdx * lineT;

                    // Gx: alternating polarity readout
                    var pol = (lineIdx % 2 === 0) ? 1 : -1;
                    gx[i] += trap(tInLine, 0.05, 0.15, lineT - 0.55, 0.15, 0.8 * pol);

                    // ADC during flat portion
                    if (tInLine >= 0.2 && tInLine <= lineT - 0.25) adc[i] = 1;

                    // Gy blip between lines
                    if (lineIdx < nLines - 1) {
                        gy[i] += trap(tInLine, lineT - blipT - 0.05, 0.05, blipT, 0.05, 0.9);
                    }
                }
            }
            else if (traj === 'radial') {
                var angle = Math.PI / 6; // show one representative spoke (30°)
                var cosA = Math.cos(angle), sinA = Math.sin(angle);
                // Prephase (negative, rotated)
                gx[i] += trap(t, readStart - 2, 0.15, 1.2, 0.15, -0.5 * cosA);
                gy[i] += trap(t, readStart - 2, 0.15, 1.2, 0.15, -0.5 * sinA);
                // Readout (positive, rotated)
                gx[i] += trap(t, readStart, 0.15, 4.0, 0.15, 0.6 * cosA);
                gy[i] += trap(t, readStart, 0.15, 4.0, 0.15, 0.6 * sinA);
                if (t >= readStart + 0.15 && t <= readStart + 4.15) adc[i] = 1;
            }
            else if (traj === 'spiral') {
                var spiralStart = readStart;
                var spiralDur = 20; // ms
                if (t >= spiralStart && t < spiralStart + spiralDur) {
                    var tRel = (t - spiralStart) / spiralDur; // 0..1
                    var amp = tRel * 0.8; // increasing amplitude
                    var freq = tRel * 25;
                    gx[i] += amp * Math.cos(freq);
                    gy[i] += amp * Math.sin(freq);
                    adc[i] = 1;
                }
            }
        }

        return { rf: rf, gz: gz, gy: gy, gx: gx, adc: adc, tMax: tMax, N: N };
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW PULSE SEQUENCE DIAGRAM
    // ═══════════════════════════════════════════════════════════════

    function drawPSD(canvas, params) {
        var ctx = canvas.getContext('2d');
        var W = canvas.width, H = canvas.height;

        // Background
        ctx.fillStyle = COL.bg;
        ctx.fillRect(0, 0, W, H);

        var wf = generateWaveforms(params);
        var N = wf.N;

        // Layout
        var ml = 58;      // left margin (labels)
        var mr = 12;       // right margin
        var mt = 8;        // top margin
        var mb = 30;       // bottom margin (time axis)
        var plotW = W - ml - mr;
        var plotH = H - mt - mb;

        var channels = [
            { name: 'RF',  data: wf.rf,  color: COL.rf,  scale: 0 },
            { name: 'Gz',  data: wf.gz,  color: COL.gz,  scale: 0 },
            { name: 'Gy',  data: wf.gy,  color: COL.gy,  scale: 0 },
            { name: 'Gx',  data: wf.gx,  color: COL.gx,  scale: 0 },
            { name: 'ADC', data: wf.adc, color: COL.adc, scale: 0 }
        ];
        var nCh = channels.length;
        var chGap = 4;
        var chH = (plotH - (nCh - 1) * chGap) / nCh;

        // Compute per-channel amplitude scale
        for (var c = 0; c < nCh; c++) {
            var mx = 0;
            for (var i = 0; i < N; i++) {
                var v = Math.abs(channels[c].data[i]);
                if (v > mx) mx = v;
            }
            channels[c].scale = mx || 1;
        }

        // Draw each channel
        for (var c = 0; c < nCh; c++) {
            var ch = channels[c];
            var y0 = mt + c * (chH + chGap);           // top of strip
            var baseline = y0 + chH / 2;                // zero line
            var ampPx = chH * 0.42;                     // max amplitude in pixels

            // Strip background
            ctx.fillStyle = 'rgba(255,255,255,0.015)';
            ctx.fillRect(ml, y0, plotW, chH);

            // Baseline
            ctx.strokeStyle = COL.axis;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(ml, baseline);
            ctx.lineTo(ml + plotW, baseline);
            ctx.stroke();

            // Channel label
            ctx.fillStyle = ch.color;
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(ch.name, ml - 8, baseline + 4);

            // Waveform
            if (ch.name === 'ADC') {
                // ADC: draw as filled blocks
                ctx.fillStyle = ch.color;
                ctx.globalAlpha = 0.35;
                var inAdc = false;
                var adcStart = 0;
                for (var i = 0; i <= N; i++) {
                    var on = i < N && ch.data[i] > 0.5;
                    if (on && !inAdc) { adcStart = i; inAdc = true; }
                    if (!on && inAdc) {
                        var x1 = ml + (adcStart / (N - 1)) * plotW;
                        var x2 = ml + (i / (N - 1)) * plotW;
                        ctx.fillRect(x1, y0 + 4, x2 - x1, chH - 8);
                        inAdc = false;
                    }
                }
                ctx.globalAlpha = 1;
                // ADC ticks
                ctx.strokeStyle = ch.color;
                ctx.lineWidth = 0.5;
                ctx.globalAlpha = 0.6;
                for (var i = 0; i < N; i++) {
                    if (ch.data[i] > 0.5 && i % 8 === 0) {
                        var x = ml + (i / (N - 1)) * plotW;
                        ctx.beginPath();
                        ctx.moveTo(x, y0 + 6);
                        ctx.lineTo(x, y0 + chH - 6);
                        ctx.stroke();
                    }
                }
                ctx.globalAlpha = 1;
            } else {
                // Gradient / RF: filled area + line
                ctx.beginPath();
                ctx.moveTo(ml, baseline);
                for (var i = 0; i < N; i++) {
                    var x = ml + (i / (N - 1)) * plotW;
                    var y = baseline - (ch.data[i] / ch.scale) * ampPx;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(ml + plotW, baseline);
                ctx.closePath();
                ctx.fillStyle = ch.color;
                ctx.globalAlpha = 0.12;
                ctx.fill();
                ctx.globalAlpha = 1;

                // Stroke on top
                ctx.beginPath();
                ctx.strokeStyle = ch.color;
                ctx.lineWidth = 1.6;
                for (var i = 0; i < N; i++) {
                    var x = ml + (i / (N - 1)) * plotW;
                    var y = baseline - (ch.data[i] / ch.scale) * ampPx;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
        }

        // Time axis
        ctx.strokeStyle = COL.axis;
        ctx.lineWidth = 1;
        var axisY = H - mb;
        ctx.beginPath();
        ctx.moveTo(ml, axisY);
        ctx.lineTo(ml + plotW, axisY);
        ctx.stroke();

        ctx.fillStyle = COL.text;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        var nTicks = Math.min(Math.round(wf.tMax / 5), 10);
        if (nTicks < 3) nTicks = 5;
        var tickStep = wf.tMax / nTicks;
        // Round tickStep to nice number
        if (tickStep > 10) tickStep = Math.round(tickStep / 5) * 5;
        else if (tickStep > 2) tickStep = Math.round(tickStep);
        else tickStep = Math.round(tickStep * 2) / 2;
        if (tickStep < 1) tickStep = 1;

        for (var tt = 0; tt <= wf.tMax; tt += tickStep) {
            var x = ml + (tt / wf.tMax) * plotW;
            ctx.beginPath();
            ctx.moveTo(x, axisY);
            ctx.lineTo(x, axisY + 4);
            ctx.stroke();
            ctx.fillText(tt.toFixed(tt % 1 === 0 ? 0 : 1), x, axisY + 16);
        }
        ctx.fillText('t [ms]', ml + plotW / 2, H - 3);

        // Vertical grid lines (light)
        ctx.strokeStyle = COL.grid;
        ctx.lineWidth = 0.5;
        for (var tt = tickStep; tt < wf.tMax; tt += tickStep) {
            var x = ml + (tt / wf.tMax) * plotW;
            ctx.beginPath();
            ctx.moveTo(x, mt);
            ctx.lineTo(x, axisY);
            ctx.stroke();
        }

        // Sequence label
        var excNames = { gradientEcho: 'GRE', spinEcho: 'SE', inversionRecovery: 'IR' };
        var trajNames = { cartesian: 'Cartesian', epi: 'EPI', radial: 'Radial', spiral: 'Spiral' };
        var label = (excNames[params.excitation] || '') + ' + ' + (trajNames[params.trajectory] || '');
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(label, ml + plotW - 4, mt + 12);
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAW K-SPACE TRAJECTORY
    // ═══════════════════════════════════════════════════════════════

    function drawTrajectory(canvas, params) {
        var ctx = canvas.getContext('2d');
        var W = canvas.width, H = canvas.height;
        var cx = W / 2, cy = H / 2;

        ctx.fillStyle = COL.bg;
        ctx.fillRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = COL.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var g = 0; g < W; g += 40) { ctx.moveTo(g, 0); ctx.lineTo(g, H); }
        for (var g2 = 0; g2 < H; g2 += 40) { ctx.moveTo(0, g2); ctx.lineTo(W, g2); }
        ctx.stroke();

        // Axes
        ctx.strokeStyle = COL.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, cy); ctx.lineTo(W, cy);
        ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
        ctx.stroke();

        ctx.fillStyle = COL.text;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('kx', W - 20, cy - 6);
        ctx.fillText('ky', cx + 6, 14);

        var traj = params.trajectory;
        var scale = Math.min(cx, cy) * 0.82;

        if (traj === 'cartesian') drawCartesian(ctx, cx, cy, scale, params);
        else if (traj === 'epi')  drawEPI(ctx, cx, cy, scale, params);
        else if (traj === 'radial') drawRadial(ctx, cx, cy, scale, params);
        else if (traj === 'spiral') drawSpiral(ctx, cx, cy, scale, params);

        // Trajectory label
        var labels = { cartesian: 'Cartesian', epi: 'EPI', radial: 'Radial', spiral: 'Spiral' };
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, H - 26, W, 26);
        ctx.fillStyle = '#a855f7';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[traj] + ' Trajectory', W / 2, H - 9);
    }

    // ─── Cartesian ──────────────────────────────────────────────────
    function drawCartesian(ctx, cx, cy, scale, params) {
        var Ny = Math.min(Math.round((params.fov.y / 10) / (params.resolution.y / 10)), 64);
        if (Ny < 4) Ny = 32;
        for (var line = 0; line < Ny; line++) {
            var frac = line / (Ny - 1);
            var ky = (frac - 0.5) * 2 * scale;
            var hue = (line * 270 / Ny + 260) % 360;

            // Trajectory line (red like JEMRIS)
            ctx.strokeStyle = 'hsla(' + hue + ',70%,55%,0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx - scale, cy - ky);
            ctx.lineTo(cx + scale, cy - ky);
            ctx.stroke();

            // ADC sample dots (green like JEMRIS)
            ctx.fillStyle = 'rgba(74,222,128,0.7)';
            var nDots = Math.min(Ny, 32);
            for (var d = 0; d < nDots; d++) {
                var kx = (d / (nDots - 1) - 0.5) * 2 * scale;
                ctx.beginPath();
                ctx.arc(cx + kx, cy - ky, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ─── EPI ────────────────────────────────────────────────────────
    function drawEPI(ctx, cx, cy, scale, params) {
        var Ny = Math.min(Math.round((params.fov.y / 10) / (params.resolution.y / 10)), 48);
        if (Ny < 4) Ny = 32;

        // Trajectory path
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(239,68,68,0.7)';
        ctx.lineWidth = 1.5;
        var started = false;
        for (var line = 0; line < Ny; line++) {
            var frac = line / (Ny - 1);
            var ky = (frac - 0.5) * 2 * scale;
            var xS, xE;
            if (line % 2 === 0) { xS = cx - scale; xE = cx + scale; }
            else { xS = cx + scale; xE = cx - scale; }
            if (!started) { ctx.moveTo(xS, cy + ky); started = true; }
            else { ctx.lineTo(xS, cy + ky); }
            ctx.lineTo(xE, cy + ky);
        }
        ctx.stroke();

        // ADC sample dots
        ctx.fillStyle = 'rgba(74,222,128,0.6)';
        var nDots = Math.min(Ny, 32);
        for (var line = 0; line < Ny; line++) {
            var frac = line / (Ny - 1);
            var ky = (frac - 0.5) * 2 * scale;
            for (var d = 0; d < nDots; d++) {
                var kxFrac = d / (nDots - 1);
                var kx = (line % 2 === 0)
                    ? (kxFrac - 0.5) * 2 * scale
                    : (0.5 - kxFrac) * 2 * scale;
                ctx.beginPath();
                ctx.arc(cx + kx, cy + ky, 1.3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ─── Radial ─────────────────────────────────────────────────────
    function drawRadial(ctx, cx, cy, scale, params) {
        var Nr = Math.min(params.nShots || 32, 64);
        if (Nr < 4) Nr = 32;
        for (var s = 0; s < Nr; s++) {
            var theta = s * Math.PI / Nr;
            var hue = (s * 270 / Nr + 260) % 360;
            ctx.strokeStyle = 'hsla(' + hue + ',70%,55%,0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx - scale * Math.cos(theta), cy - scale * Math.sin(theta));
            ctx.lineTo(cx + scale * Math.cos(theta), cy + scale * Math.sin(theta));
            ctx.stroke();

            // ADC dots
            ctx.fillStyle = 'rgba(74,222,128,0.5)';
            for (var d = 0; d < 20; d++) {
                var r = (d / 19 - 0.5) * 2 * scale;
                ctx.beginPath();
                ctx.arc(cx + r * Math.cos(theta), cy + r * Math.sin(theta), 1.3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        // Center glow
        ctx.beginPath();
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 10; ctx.shadowColor = '#a855f7';
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // ─── Spiral ─────────────────────────────────────────────────────
    function drawSpiral(ctx, cx, cy, scale, params) {
        var nInt = params.nInterleaves || 5;
        if (nInt < 1) nInt = 5;
        var maxTurns = 8;
        var nPts = 600;
        for (var arm = 0; arm < nInt; arm++) {
            var phi0 = arm * 2 * Math.PI / nInt;
            var hue = (arm * 270 / nInt + 260) % 360;

            // Trajectory line
            ctx.strokeStyle = 'hsla(' + hue + ',70%,55%,0.65)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (var i = 0; i <= nPts; i++) {
                var frac = i / nPts;
                var r = frac * scale;
                var angle = frac * maxTurns * 2 * Math.PI + phi0;
                var px = cx + r * Math.cos(angle);
                var py = cy - r * Math.sin(angle);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // ADC dots (sparse)
            ctx.fillStyle = 'rgba(74,222,128,0.45)';
            for (var i = 0; i <= nPts; i += 12) {
                var frac = i / nPts;
                var r = frac * scale;
                var angle = frac * maxTurns * 2 * Math.PI + phi0;
                ctx.beginPath();
                ctx.arc(cx + r * Math.cos(angle), cy - r * Math.sin(angle), 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════════════════════════

    window.drawBuilderPreview = function (params) {
        var psdCanvas  = document.getElementById('builder-psd-canvas');
        var trajCanvas = document.getElementById('builder-traj-canvas');
        if (psdCanvas)  drawPSD(psdCanvas, params);
        if (trajCanvas) drawTrajectory(trajCanvas, params);
    };

})();
