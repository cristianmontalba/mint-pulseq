/**
 * WALKTHROUGH — step-by-step sequence matrix.
 *
 * Renders one row per instant of a TR, with three synchronized columns:
 * spin drawings, hardware/pulse drawings and the Pulseq code that produces
 * the step. Hovering (or focusing) a row highlights all three columns; the
 * "?" button unfolds the didactic explanation of the timing calculation;
 * a toggle switches every snippet between PyPulseq and Pulseq (MATLAB).
 *
 * External coupling:
 *   - window.walkthroughData      → content (js/data/walkthrough.js)
 *   - window.initWalkthrough(id)  → exposed for app.js
 *
 * The cell pictograms are painted here, NOT in diagrams.js: they are small
 * component-specific icons, not the full-width educational diagrams that
 * window.drawDiagram serves. Painters are registered in `painters` below.
 */

(function () {
    'use strict';

    // ─── Palette (same values as diagrams.js) ───────────────────────
    var C = {
        bg:     '#0f172a',
        grid:   'rgba(255,255,255,0.06)',
        axis:   'rgba(255,255,255,0.25)',
        text:   '#94a3b8',
        label:  '#e2e8f0',
        accent: '#38bdf8',
        rf:     '#ef4444',
        gx:     '#f59e0b',
        gy:     '#10b981',
        gz:     '#3b82f6',
        adc:    '#06b6d4',
        muted:  '#64748b',
        purple: '#a855f7',
        white:  '#f8fafc'
    };

    var CELL_W = 300;
    var CELL_H = 160;

    // ─── Drawing helpers ────────────────────────────────────────────

    /** Arrow with a triangular head */
    function arrow(ctx, x1, y1, x2, y2, color, lw, head) {
        head = head || 7;
        lw = lw || 2;
        var a = Math.atan2(y2 - y1, x2 - x1);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
        ctx.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /** Small caption text */
    function text(ctx, str, x, y, color, size, align) {
        ctx.save();
        ctx.fillStyle = color || C.text;
        ctx.font = (size || 10) + 'px Inter, sans-serif';
        ctx.textAlign = align || 'left';
        ctx.fillText(str, x, y);
        ctx.restore();
    }

    /** Dashed line */
    function dashed(ctx, x1, y1, x2, y2, color, dash) {
        ctx.save();
        ctx.setLineDash(dash || [4, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
    }

    /** Trapezoid gradient lobe sitting on `base`, positive amp goes up */
    function trapezoid(ctx, x0, base, rise, flat, amp, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.moveTo(x0, base);
        ctx.lineTo(x0 + rise, base - amp);
        ctx.lineTo(x0 + rise + flat, base - amp);
        ctx.lineTo(x0 + rise + flat + rise, base);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
    }

    /** Baseline for a pulse channel, with its label on the left */
    function channel(ctx, x0, x1, y, label, color) {
        ctx.save();
        ctx.strokeStyle = C.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.restore();
        text(ctx, label, x0 - 4, y + 3, color, 9, 'right');
    }

    /** Apodized sinc centred on cx */
    function sinc(ctx, cx, base, halfWidth, amp, color, lobes) {
        lobes = lobes || 2;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (var i = 0; i <= 120; i++) {
            var u = -1 + (2 * i) / 120;
            var t = u * Math.PI * lobes;
            var s = t === 0 ? 1 : Math.sin(t) / t;
            s *= 0.54 + 0.46 * Math.cos(Math.PI * u); // apodization
            var x = cx + u * halfWidth;
            var y = base - s * amp;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    }

    /** Fan of isochromat vectors seen from above the transverse plane */
    function fan(ctx, cx, cy, r, centreAngle, spread, n, color) {
        for (var i = 0; i < n; i++) {
            var f = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
            var a = centreAngle + f * spread;
            ctx.save();
            ctx.globalAlpha = 0.45 + 0.55 * (1 - Math.abs(f));
            arrow(ctx, cx, cy, cx + r * Math.cos(a), cy + r * Math.sin(a), color, 1.8, 5);
            ctx.restore();
        }
    }

    /** Circle outline used as the transverse plane seen from +z */
    function planeCircle(ctx, cx, cy, r) {
        ctx.save();
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    /** k-space panel with grid, centre cross and optional sampled line */
    function kBox(ctx, x, y, w, h) {
        ctx.save();
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        var i;
        for (i = 1; i < 5; i++) {
            ctx.beginPath();
            ctx.moveTo(x + (w * i) / 5, y);
            ctx.lineTo(x + (w * i) / 5, y + h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y + (h * i) / 5);
            ctx.lineTo(x + w, y + (h * i) / 5);
            ctx.stroke();
        }
        ctx.strokeStyle = C.axis;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
        text(ctx, 'k-space', x + w / 2, y - 5, C.text, 9, 'center');
    }

    /** Stick figure. pose: 'stand' | 'sit' | 'write' */
    function stickFigure(ctx, x, y, s, pose, color) {
        color = color || C.label;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        // head
        ctx.beginPath();
        ctx.arc(x, y, 7 * s, 0, Math.PI * 2);
        ctx.stroke();

        // body
        ctx.beginPath();
        ctx.moveTo(x, y + 7 * s);
        ctx.lineTo(x, y + 30 * s);
        ctx.stroke();

        if (pose === 'sit') {
            // arms down, legs folded forward
            ctx.beginPath();
            ctx.moveTo(x - 11 * s, y + 24 * s);
            ctx.lineTo(x, y + 14 * s);
            ctx.lineTo(x + 11 * s, y + 24 * s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y + 30 * s);
            ctx.lineTo(x + 14 * s, y + 30 * s);
            ctx.lineTo(x + 14 * s, y + 42 * s);
            ctx.stroke();
        } else if (pose === 'write') {
            // one arm to a clipboard, the other across the body
            ctx.beginPath();
            ctx.moveTo(x - 13 * s, y + 20 * s);
            ctx.lineTo(x, y + 14 * s);
            ctx.lineTo(x + 13 * s, y + 21 * s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x - 9 * s, y + 30 * s);
            ctx.lineTo(x, y + 30 * s);
            ctx.lineTo(x + 9 * s, y + 44 * s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y + 30 * s);
            ctx.lineTo(x - 9 * s, y + 44 * s);
            ctx.stroke();
        } else {
            // standing, arms crossed-ish
            ctx.beginPath();
            ctx.moveTo(x - 12 * s, y + 22 * s);
            ctx.lineTo(x, y + 14 * s);
            ctx.lineTo(x + 12 * s, y + 22 * s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x - 9 * s, y + 44 * s);
            ctx.lineTo(x, y + 30 * s);
            ctx.lineTo(x + 9 * s, y + 44 * s);
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Clock face with hands */
    function clock(ctx, cx, cy, r, hourAngle, minuteAngle, color) {
        color = color || C.accent;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        for (var i = 0; i < 12; i++) {
            var a = (i / 12) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
            ctx.lineTo(cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1));
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(hourAngle) * r * 0.5, cy + Math.sin(hourAngle) * r * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(minuteAngle) * r * 0.78, cy + Math.sin(minuteAngle) * r * 0.78);
        ctx.stroke();
        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════
    //  SPIN COLUMN PAINTERS
    // ═══════════════════════════════════════════════════════════════

    function spinB0Align(ctx, w, h) {
        // B0 axis on the left
        arrow(ctx, 34, 132, 34, 28, C.accent, 2.5, 9);
        text(ctx, 'B\u2080', 34, 20, C.accent, 11, 'center');

        // individual spins, all roughly aligned with z
        var xs = [82, 118, 154, 190];
        var ys = [58, 110];
        ctx.save();
        for (var r = 0; r < ys.length; r++) {
            for (var i = 0; i < xs.length; i++) {
                var tilt = -Math.PI / 2 + (((i + r * 2) % 4) - 1.5) * 0.14;
                var x = xs[i], y = ys[r];
                ctx.globalAlpha = 0.85;
                arrow(ctx, x, y + 16, x + 30 * Math.cos(tilt), y + 16 + 30 * Math.sin(tilt), C.muted, 1.6, 5);
                // precession cone
                ctx.globalAlpha = 0.25;
                ctx.strokeStyle = C.accent;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.ellipse(x, y - 14, 8, 3, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();

        // net magnetization
        arrow(ctx, 254, 126, 254, 40, C.accent, 3, 10);
        text(ctx, 'M\u2080', 254, 32, C.label, 11, 'center');
        text(ctx, 'net magnetization', 254, 142, C.text, 9, 'center');
        text(ctx, 'equilibrium', 122, 146, C.text, 9, 'center');
    }

    function spinExcitation(ctx, w, h) {
        var cx = 140, cy = 108;

        // transverse plane
        ctx.save();
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 68, 20, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // z axis
        arrow(ctx, cx, cy, cx, 26, C.axis, 1.5, 7);
        text(ctx, 'z', cx - 8, 30, C.text, 10);
        text(ctx, 'xy', cx + 72, cy + 4, C.text, 10);

        // original M along z (dashed), tipped M in the plane
        dashed(ctx, cx, cy, cx, 42, C.muted);
        arrow(ctx, cx, cy, cx + 62, cy + 16, C.accent, 3, 9);
        text(ctx, 'M\u2093\u1d67', cx + 66, cy + 26, C.label, 10);

        // nutation arc
        ctx.save();
        ctx.strokeStyle = C.rf;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, 52, -Math.PI / 2, 0.22);
        ctx.stroke();
        ctx.restore();
        text(ctx, '90\u00b0', cx + 30, cy - 38, C.rf, 12);
        text(ctx, 'RF tips M\u2080 into the transverse plane', 150, 150, C.text, 9, 'center');
    }

    function spinDephase(ctx, w, h) {
        planeCircle(ctx, 150, 74, 52);
        fan(ctx, 150, 74, 50, 0, 0.55, 7, C.accent);
        ctx.save();
        ctx.strokeStyle = C.purple;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(150, 74, 60, -0.55, 0.55);
        ctx.stroke();
        ctx.restore();
        text(ctx, 'T2* fan-out', 150, 142, C.text, 10, 'center');
        text(ctx, 'reversible dephasing', 150, 154, C.muted, 9, 'center');
    }

    function spinDephaseWide(ctx, w, h) {
        planeCircle(ctx, 150, 74, 52);
        fan(ctx, 150, 74, 50, 0, 1.25, 9, C.accent);
        ctx.save();
        ctx.strokeStyle = C.purple;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(150, 74, 60, -1.25, 1.25);
        ctx.stroke();
        ctx.restore();
        text(ctx, 'phase keeps accumulating', 150, 142, C.text, 10, 'center');
        text(ctx, 'until the echo is formed', 150, 154, C.muted, 9, 'center');
    }

    function spinPrephase(ctx, w, h) {
        // position axis
        arrow(ctx, 28, 120, 276, 120, C.axis, 1.5, 7);
        text(ctx, 'x', 280, 124, C.text, 10);

        // one voxel per position, phase growing linearly with x
        for (var i = 0; i < 6; i++) {
            var x = 48 + i * 42;
            var a = -Math.PI / 2 + i * 0.9;
            ctx.save();
            ctx.strokeStyle = C.grid;
            ctx.lineWidth = 1;
            ctx.strokeRect(x - 13, 62, 26, 26);
            ctx.restore();
            arrow(ctx, x, 75, x + 16 * Math.cos(a), 75 + 16 * Math.sin(a), C.gy, 1.8, 5);
        }

        text(ctx, '\u03c6(x) = \u03b3 \u222b G\u2093 dt \u00b7 x', 150, 42, C.label, 11, 'center');
        text(ctx, 'position is written into the phase', 150, 148, C.text, 9, 'center');
    }

    function spinRefocus180(ctx, w, h) {
        planeCircle(ctx, 150, 76, 52);
        // mirror axis
        dashed(ctx, 88, 76, 212, 76, C.muted);

        // before: fan below the axis; after: mirrored above
        fan(ctx, 150, 76, 48, 0.75, 0.42, 5, C.muted);
        fan(ctx, 150, 76, 48, -0.75, 0.42, 5, C.accent);

        // flip arc
        ctx.save();
        ctx.strokeStyle = C.rf;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(150, 76, 60, 0.35, 1.15);
        ctx.stroke();
        ctx.restore();
        arrow(ctx, 176, 133, 168, 137, C.rf, 2, 7);
        text(ctx, '180\u00b0', 214, 118, C.rf, 12);
        text(ctx, '\u03c6 \u2192 \u2212\u03c6  (phase mirrored)', 150, 152, C.text, 9, 'center');
    }

    function spinRephase(ctx, w, h) {
        planeCircle(ctx, 150, 74, 52);
        fan(ctx, 150, 74, 50, 0, 0.3, 7, C.accent);

        // converging arrows
        ctx.save();
        ctx.strokeStyle = C.gy;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(150, 74, 62, -0.95, -0.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(150, 74, 62, 0.35, 0.95);
        ctx.stroke();
        ctx.restore();
        arrow(ctx, 196, 32, 202, 40, C.gy, 2, 6);
        arrow(ctx, 196, 116, 202, 108, C.gy, 2, 6);

        text(ctx, 'rephasing \u2192 echo', 150, 142, C.text, 10, 'center');
        text(ctx, 'k sweeps across the line', 150, 154, C.muted, 9, 'center');
    }

    function spinEchoPeak(ctx, w, h) {
        planeCircle(ctx, 88, 64, 42);
        ctx.save();
        ctx.shadowColor = C.accent;
        ctx.shadowBlur = 10;
        fan(ctx, 88, 64, 40, 0, 0.05, 5, C.accent);
        ctx.restore();
        text(ctx, 'in phase', 88, 122, C.text, 10, 'center');

        // echo envelope with ADC samples
        var base = 70, cx = 216, amp = 34;
        ctx.save();
        ctx.strokeStyle = C.rf;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (var i = 0; i <= 120; i++) {
            var u = -1 + (2 * i) / 120;
            var env = Math.exp(-6 * u * u);
            var y = base - env * Math.cos(u * Math.PI * 5) * amp;
            var x = cx + u * 62;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = C.adc;
        for (var s = 0; s <= 14; s++) {
            ctx.fillRect(cx - 62 + (s * 124) / 14 - 1, 108, 2, 8);
        }
        ctx.restore();
        text(ctx, 'ADC samples the echo', 216, 132, C.adc, 9, 'center');
    }

    function spinRelax(ctx, w, h) {
        var x0 = 44, y0 = 30, pw = 218, ph = 86;
        ctx.save();
        ctx.strokeStyle = C.axis;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0, y0 + ph);
        ctx.lineTo(x0 + pw, y0 + ph);
        ctx.stroke();
        ctx.restore();

        dashed(ctx, x0, y0, x0 + pw, y0, C.muted);
        text(ctx, 'M\u2080', x0 - 6, y0 + 4, C.text, 9, 'right');
        text(ctx, 'M\u1d22', x0 - 6, y0 + ph / 2, C.text, 9, 'right');
        text(ctx, 'TR', x0 + pw, y0 + ph + 14, C.text, 9, 'right');

        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (var i = 0; i <= 120; i++) {
            var t = i / 120;
            var mz = 1 - Math.exp(-3.1 * t);
            var x = x0 + t * pw;
            var y = y0 + ph - mz * ph;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        text(ctx, '1 \u2212 e\u207b\u1d40\u1d3f/\u1d40\u00b9', x0 + pw - 6, y0 + 22, C.label, 10, 'right');
        text(ctx, 'T1 recovery before the next excitation', 150, 150, C.text, 9, 'center');
    }

    // ═══════════════════════════════════════════════════════════════
    //  HARDWARE COLUMN PAINTERS
    // ═══════════════════════════════════════════════════════════════

    function hwMagnet(ctx, w, h) {
        // magnet housing
        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2;
        ctx.strokeRect(52, 28, 196, 86);
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = C.accent;
        ctx.fillRect(52, 28, 196, 86);
        ctx.restore();

        // bore tunnel
        ctx.save();
        ctx.fillStyle = C.bg;
        ctx.strokeStyle = C.axis;
        ctx.lineWidth = 1.2;
        ctx.fillRect(52, 58, 196, 30);
        ctx.strokeRect(52, 58, 196, 30);
        ctx.restore();

        // gradient + RF coil hints inside the housing
        ctx.save();
        ctx.strokeStyle = C.gz;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.4;
        for (var i = 0; i < 6; i++) {
            var x = 68 + i * 34;
            ctx.beginPath();
            ctx.moveTo(x, 34);
            ctx.lineTo(x, 54);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, 92);
            ctx.lineTo(x, 108);
            ctx.stroke();
        }
        ctx.restore();

        // B0 along the bore
        arrow(ctx, 74, 73, 236, 73, C.accent, 2.5, 9);
        text(ctx, 'B\u2080', 155, 66, C.accent, 11, 'center');

        // patient table
        ctx.save();
        ctx.strokeStyle = C.muted;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(20, 88);
        ctx.lineTo(120, 88);
        ctx.stroke();
        ctx.restore();

        text(ctx, 'gradient + RF coils', 150, 126, C.text, 9, 'center');
        text(ctx, 'mr.opts defines what they can do', 150, 140, C.muted, 9, 'center');
    }

    function rfCoil(ctx, cx, cy, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 16, 22, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, 9, 14, 0, 0, Math.PI * 2);
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy + 22);
        ctx.lineTo(cx - 4, cy + 32);
        ctx.moveTo(cx + 4, cy + 22);
        ctx.lineTo(cx + 4, cy + 32);
        ctx.stroke();
        ctx.restore();

        // radiated field
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.2;
        for (var i = 1; i <= 3; i++) {
            ctx.beginPath();
            ctx.arc(cx + 16, cy, 8 * i, -0.8, 0.8);
            ctx.stroke();
        }
        ctx.restore();
    }

    function rfRow(ctx, flip, amp) {
        rfCoil(ctx, 40, 54, C.rf);
        text(ctx, 'Tx coil', 40, 104, C.text, 9, 'center');

        channel(ctx, 104, 284, 56, 'RF', C.rf);
        sinc(ctx, 176, 56, 46, amp, C.rf, 2);
        text(ctx, flip, 250, 40, C.rf, 12, 'center');

        channel(ctx, 104, 284, 122, 'Gz', C.gz);
        trapezoid(ctx, 128, 122, 10, 76, 26, C.gz);
        text(ctx, 'slice select', 260, 118, C.text, 9, 'center');
        text(ctx, 'played in one block', 194, 148, C.muted, 9, 'center');
    }

    function hwRfExcite(ctx, w, h) { rfRow(ctx, '90\u00b0', 30); }
    function hwRfRefocus(ctx, w, h) { rfRow(ctx, '180\u00b0', 44); }

    function hwWaiting(ctx, w, h) {
        stickFigure(ctx, 78, 46, 1, 'stand', C.label);
        text(ctx, 'idle', 78, 128, C.text, 10, 'center');

        clock(ctx, 206, 72, 30, -Math.PI / 2, -0.35, C.accent);
        // sweep arrow around the clock
        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(206, 72, 38, -1.9, 0.9);
        ctx.stroke();
        ctx.restore();
        arrow(ctx, 229, 100, 234, 92, C.accent, 2, 6);

        text(ctx, 'no RF, no gradient, no ADC', 150, 146, C.muted, 9, 'center');
    }

    function hwWaitingTr(ctx, w, h) {
        stickFigure(ctx, 74, 50, 1, 'sit', C.label);
        // sleeping z's
        text(ctx, 'z', 94, 34, C.accent, 10);
        text(ctx, 'z', 104, 24, C.accent, 12);
        text(ctx, 'z', 117, 12, C.accent, 14);

        clock(ctx, 210, 70, 34, -Math.PI / 2, 2.4, C.accent);
        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(210, 70, 43, -2.2, 1.6);
        ctx.stroke();
        ctx.restore();
        arrow(ctx, 209, 113, 200, 110, C.accent, 2, 6);

        text(ctx, 'the longest block of the TR', 150, 146, C.muted, 9, 'center');
    }

    function hwGradPrephase(ctx, w, h) {
        channel(ctx, 34, 158, 52, 'G\u2093', C.gx);
        trapezoid(ctx, 52, 52, 9, 48, 22, C.gx);

        channel(ctx, 34, 158, 112, 'G\u1d67', C.gy);
        trapezoid(ctx, 52, 112, 9, 48, -20, C.gy);
        // the phase-encode lobe steps line by line
        ctx.save();
        ctx.globalAlpha = 0.35;
        trapezoid(ctx, 52, 112, 9, 48, -9, C.gy);
        trapezoid(ctx, 52, 112, 9, 48, 12, C.gy);
        ctx.restore();
        text(ctx, 'one step per TR', 96, 140, C.muted, 9, 'center');

        kBox(ctx, 186, 30, 96, 90);
        // jump from the centre to the start of the line
        var cx = 186 + 48, cy = 30 + 45;
        ctx.save();
        ctx.fillStyle = C.muted;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        arrow(ctx, cx, cy, 186 + 86, 30 + 20, C.accent, 2, 7);
        text(ctx, 'jump to the line start', 234, 134, C.text, 9, 'center');
    }

    function hwGradReadout(ctx, w, h) {
        channel(ctx, 34, 158, 86, 'G\u2093', C.gx);
        trapezoid(ctx, 48, 86, 12, 86, 40, C.gx);
        text(ctx, 'flat top', 103, 54, C.gx, 9, 'center');
        dashed(ctx, 60, 44, 60, 88, C.muted);
        dashed(ctx, 146, 44, 146, 88, C.muted);
        text(ctx, 'n\u2093 \u00b7 \u0394k', 103, 118, C.text, 9, 'center');

        kBox(ctx, 186, 30, 96, 90);
        var y = 30 + 20;
        arrow(ctx, 186 + 86, y, 186 + 10, y, C.accent, 2, 7);
        ctx.save();
        ctx.globalAlpha = 0.35;
        for (var i = 1; i < 4; i++) {
            dashed(ctx, 190, y + i * 20, 278, y + i * 20, C.accent, [2, 5]);
        }
        ctx.restore();
        text(ctx, 'k sweeps one line', 234, 134, C.text, 9, 'center');
    }

    function hwAdcRecord(ctx, w, h) {
        stickFigure(ctx, 52, 44, 0.95, 'write', C.label);
        // clipboard
        ctx.save();
        ctx.strokeStyle = C.adc;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(66, 58, 24, 30);
        ctx.globalAlpha = 0.5;
        for (var i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(70, 66 + i * 7);
            ctx.lineTo(86, 66 + i * 7);
            ctx.stroke();
        }
        ctx.restore();
        text(ctx, 'recording', 62, 126, C.text, 9, 'center');

        // signal + sampling comb
        var base = 62, x0 = 122, wv = 158;
        channel(ctx, x0, x0 + wv, base, 'S', C.rf);
        ctx.save();
        ctx.strokeStyle = C.rf;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (var j = 0; j <= 140; j++) {
            var u = -1 + (2 * j) / 140;
            var env = Math.exp(-5 * u * u);
            var yy = base - env * Math.cos(u * Math.PI * 6) * 26;
            var xx = x0 + ((u + 1) / 2) * wv;
            if (j === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.restore();

        channel(ctx, x0, x0 + wv, 116, 'ADC', C.adc);
        ctx.save();
        ctx.fillStyle = C.adc;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(x0, 96, wv, 20);
        ctx.globalAlpha = 1;
        for (var s = 0; s <= 18; s++) {
            ctx.fillRect(x0 + (s * wv) / 18 - 1, 98, 2, 16);
        }
        ctx.restore();
        text(ctx, 'dwell = flat_time / n\u2093', 201, 140, C.muted, 9, 'center');
    }

    // ─── Painter registry ───────────────────────────────────────────
    var painters = {
        'spin-b0-align':     spinB0Align,
        'spin-excitation':   spinExcitation,
        'spin-dephase':      spinDephase,
        'spin-dephase-wide': spinDephaseWide,
        'spin-prephase':     spinPrephase,
        'spin-refocus-180':  spinRefocus180,
        'spin-rephase':      spinRephase,
        'spin-echo-peak':    spinEchoPeak,
        'spin-relax':        spinRelax,
        'hw-magnet':         hwMagnet,
        'hw-rf-excite':      hwRfExcite,
        'hw-rf-refocus':     hwRfRefocus,
        'hw-waiting':        hwWaiting,
        'hw-waiting-tr':     hwWaitingTr,
        'hw-grad-prephase':  hwGradPrephase,
        'hw-grad-readout':   hwGradReadout,
        'hw-adc-record':     hwAdcRecord
    };

    function paintCell(canvas, type) {
        if (!canvas || !painters[type]) return;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        painters[type](ctx, canvas.width, canvas.height);
    }

    // ═══════════════════════════════════════════════════════════════
    //  CODE RENDERING
    // ═══════════════════════════════════════════════════════════════

    var LANGS = {
        py:     { label: 'PyPulseq', sub: 'Python', comment: '#' },
        matlab: { label: 'Pulseq', sub: 'MATLAB', comment: '%' }
    };

    var currentLang = 'py';
    var currentId = null;

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * Minimal token colouring. Runs on already-escaped text, so the only
     * characters it can see are safe; comments and strings are matched first
     * so keywords inside them are left alone.
     */
    function highlight(code, lang) {
        var commentChar = LANGS[lang].comment;
        var re = new RegExp(
            '(' + commentChar + '[^\\n]*)' +
            '|(\'[^\'\\n]*\')' +
            '|\\b(assert|import|from|for|in|def|return|end|function|True|False|None)\\b' +
            '|\\b(pp|np|mr|seq)\\.([A-Za-z_]\\w*)' +
            '|\\b(\\d+\\.?\\d*(?:e-?\\d+)?)\\b',
            'g'
        );
        return escapeHtml(code).replace(re, function (m, cmt, str, kw, ns, fn, num) {
            if (cmt) return '<span class="tok-comment">' + cmt + '</span>';
            if (str) return '<span class="tok-string">' + str + '</span>';
            if (kw)  return '<span class="tok-kw">' + kw + '</span>';
            if (ns)  return '<span class="tok-ns">' + ns + '</span>.<span class="tok-fn">' + fn + '</span>';
            if (num) return '<span class="tok-num">' + num + '</span>';
            return m;
        });
    }

    /** Repaint every code block in the current language */
    function applyLanguage(data) {
        data.rows.forEach(function (row) {
            var el = document.getElementById('wt-code-' + row.n);
            if (el) el.innerHTML = highlight(row.code[currentLang], currentLang);
        });
        var meta = LANGS[currentLang];
        Array.prototype.forEach.call(
            document.querySelectorAll('.wt-code-lang'),
            function (el) { el.textContent = meta.label + ' \u00b7 ' + meta.sub; }
        );
        Array.prototype.forEach.call(
            document.querySelectorAll('.wt-lang-btn'),
            function (btn) {
                var on = btn.dataset.lang === currentLang;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            }
        );
    }

    // ═══════════════════════════════════════════════════════════════
    //  MARKUP
    // ═══════════════════════════════════════════════════════════════

    function cellHTML(cell, rowN, kind) {
        return '<div class="wt-cell">' +
                   '<div class="wt-cell-label">' + cell.label + '</div>' +
                   '<div class="wt-canvas-frame">' +
                       '<canvas id="wt-' + kind + '-' + rowN + '" width="' + CELL_W +
                       '" height="' + CELL_H + '" role="img" aria-label="' + cell.label + '"></canvas>' +
                   '</div>' +
                   '<p class="wt-cell-caption">' + cell.caption + '</p>' +
               '</div>';
    }

    function rowHTML(row, seqId) {
        var video = rowVideo(seqId, row.n);
        var html = '<tr class="wt-row" data-row="' + row.n + '" tabindex="0">';
        html += '<td class="wt-num"><span>' + row.n + '</span></td>';
        html += '<td class="wt-td wt-td-spin">' + cellHTML(row.spin, row.n, 'spin') + '</td>';
        html += '<td class="wt-td wt-td-hw">' + cellHTML(row.hardware, row.n, 'hw') + '</td>';
        html += '<td class="wt-td wt-td-code">' +
                    '<div class="wt-code-head">' +
                        '<span class="wt-code-lang"></span>' +
                        (video
                            ? '<button type="button" class="wt-video-btn" data-row="' + row.n + '"'
                              + ' aria-expanded="false" aria-controls="wt-video-' + row.n + '"'
                              + ' title="' + escapeHtml(video.title) + '">&#9654;</button>'
                            : '') +
                        '<button type="button" class="wt-help-btn" data-row="' + row.n + '"' +
                            ' aria-expanded="false" aria-controls="wt-explain-' + row.n + '"' +
                            ' title="Explain this step">?</button>' +
                    '</div>' +
                    (video
                        ? '<div class="wt-video" id="wt-video-' + row.n + '" hidden>'
                          + '<div class="wt-video-frame"><iframe src="' + video.embedUrl + '"'
                          + ' title="' + escapeHtml(video.title) + '" allowfullscreen'
                          + ' loading="lazy"></iframe></div>'
                          + '<p class="wt-video-title">' + video.title + '</p></div>'
                        : '') +
                    '<pre class="wt-pre"><code id="wt-code-' + row.n + '"></code></pre>' +
                    '<div class="wt-explain" id="wt-explain-' + row.n + '" hidden>' +
                        '<h4>' + row.explain.title + '</h4>' +
                        row.explain.body +
                        (row.explain.formula
                            ? '<div class="wt-formula">\\[ ' + row.explain.formula + ' \\]</div>'
                            : '') +
                    '</div>' +
                '</td>';
        html += '</tr>';
        return html;
    }

    function buildHTML(data) {
        var html = '<div class="sequence-walkthrough">';

        html += '<div class="sequence-header">' +
                    '<h2 class="sequence-title">' + data.title + '</h2>' +
                    '<p class="sequence-subtitle">' + data.subtitle + '</p>' +
                '</div>';

        html += '<div class="wt-toolbar">' +
                    '<p class="wt-intro">' + data.intro + '</p>' +
                    '<div class="wt-lang-switch" role="group" aria-label="Code dialect">' +
                        '<button type="button" class="wt-lang-btn" data-lang="py" aria-pressed="true">PyPulseq</button>' +
                        '<button type="button" class="wt-lang-btn" data-lang="matlab" aria-pressed="false">Pulseq (MATLAB)</button>' +
                    '</div>' +
                '</div>';

        html += '<div class="wt-table-scroll"><table class="wt-table">' +
                    '<thead><tr>' +
                        '<th class="wt-num-head" scope="col">#</th>' +
                        '<th scope="col">Spin drawings</th>' +
                        '<th scope="col">Hardware &amp; pulses</th>' +
                        '<th scope="col">Associated code</th>' +
                    '</tr></thead><tbody>';

        data.rows.forEach(function (row) { html += rowHTML(row, data.id); });

        html += '</tbody></table></div>';

        // Real add_block order, since the table groups the two halves of TE
        html += '<div class="wt-blockorder">' +
                    '<div class="wt-blockorder-title">Block order actually emitted in one TR</div>' +
                    '<div class="wt-chips">';
        data.blockOrder.forEach(function (b, i) {
            if (i > 0) html += '<span class="wt-chip-sep">\u2192</span>';
            html += '<button type="button" class="wt-chip" data-row="' + b.row + '">' +
                        '<span class="wt-chip-n">' + b.row + '</span>' + b.label +
                    '</button>';
        });
        html += '</div></div>';

        html += '<div class="next-step">'
              + '<div class="next-step-label">Next in the path</div>'
              + '<h3>Sequence Builder</h3>'
              + '<p>You have followed one sequence from the magnet to the ADC. Now choose your '
              + 'own excitation, trajectory and timing, and let the app write the PyPulseq '
              + 'script for it.</p>'
              + '<button type="button" class="next-step-btn" data-tool="builder">'
              + 'Open the Builder &rarr;</button>'
              + '</div>';

        html += '</div>';
        return html;
    }

    /**
     * A short clip anchored to one row, when videos.js carries one.
     * Anchor shape: { module: 'walkthrough', sequence: '<id>', row: <n> }
     */
    function rowVideo(sequenceId, rowN) {
        if (!window.videoData) return null;
        var hit = null;
        window.videoData.forEach(function (v) {
            if (!v.anchor || v.anchor.module !== 'walkthrough') return;
            if (v.anchor.sequence && v.anchor.sequence !== sequenceId) return;
            if (v.anchor.row === rowN) hit = v;
        });
        return hit;
    }

    // ═══════════════════════════════════════════════════════════════
    //  INTERACTION
    // ═══════════════════════════════════════════════════════════════

    function rowEl(n) {
        return document.querySelector('.wt-row[data-row="' + n + '"]');
    }

    function attachListeners(data) {
        var root = document.querySelector('.sequence-walkthrough');
        if (!root) return;

        // "?" buttons — unfold the explanation under the snippet
        root.addEventListener('click', function (ev) {
            var help = ev.target.closest('.wt-help-btn');
            if (help) {
                var panel = document.getElementById('wt-explain-' + help.dataset.row);
                if (!panel) return;
                var open = !panel.hasAttribute('hidden');
                if (open) {
                    panel.setAttribute('hidden', '');
                } else {
                    panel.removeAttribute('hidden');
                }
                help.setAttribute('aria-expanded', open ? 'false' : 'true');
                help.classList.toggle('is-open', !open);
                return;
            }

            // Video toggle — same fold-out pattern as the "?" button
            var vid = ev.target.closest('.wt-video-btn');
            if (vid) {
                var panel = document.getElementById('wt-video-' + vid.dataset.row);
                if (!panel) return;
                var wasOpen = !panel.hasAttribute('hidden');
                if (wasOpen) panel.setAttribute('hidden', '');
                else panel.removeAttribute('hidden');
                vid.setAttribute('aria-expanded', wasOpen ? 'false' : 'true');
                vid.classList.toggle('is-open', !wasOpen);
                return;
            }

            // Hand-off to another module
            var toolBtn = ev.target.closest('[data-tool]');
            if (toolBtn && window.openTool) {
                window.openTool(toolBtn.dataset.tool);
                return;
            }

            // Block-order chip — scroll to and flash the row it belongs to
            var chip = ev.target.closest('.wt-chip');
            if (chip) {
                var target = rowEl(chip.dataset.row);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.focus({ preventScroll: true });
                }
            }
        });

        // Hovering a chip highlights its row (the same highlight the row hover gives)
        root.addEventListener('mouseover', function (ev) {
            var chip = ev.target.closest('.wt-chip');
            if (!chip) return;
            var target = rowEl(chip.dataset.row);
            if (target) target.classList.add('is-linked');
        });
        root.addEventListener('mouseout', function (ev) {
            var chip = ev.target.closest('.wt-chip');
            if (!chip) return;
            var target = rowEl(chip.dataset.row);
            if (target) target.classList.remove('is-linked');
        });

        // Language toggle
        root.addEventListener('click', function (ev) {
            var btn = ev.target.closest('.wt-lang-btn');
            if (!btn || btn.dataset.lang === currentLang) return;
            currentLang = btn.dataset.lang;
            applyLanguage(data);
        });

        // Enter/Space on a focused row opens its explanation
        root.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            var row = ev.target.closest('.wt-row');
            if (!row || ev.target.closest('button')) return;
            ev.preventDefault();
            var btn = row.querySelector('.wt-help-btn');
            if (btn) btn.click();
        });
    }

    // ─── Public entry point ─────────────────────────────────────────
    function initWalkthrough(id) {
        var container = document.getElementById('content-container');
        if (!container) return;

        currentId = id || 'se-2ddft';
        var data = window.walkthroughData && window.walkthroughData[currentId];
        if (!data) {
            container.innerHTML = '<p>No walkthrough found for "' + currentId + '".</p>';
            return;
        }

        container.classList.add('fade-out');
        setTimeout(function () {
            container.innerHTML = buildHTML(data);

            data.rows.forEach(function (row) {
                paintCell(document.getElementById('wt-spin-' + row.n), row.spin.diagram);
                paintCell(document.getElementById('wt-hw-' + row.n), row.hardware.diagram);
            });

            applyLanguage(data);
            attachListeners(data);

            if (window.renderMathInElement) {
                window.renderMathInElement(container, {
                    delimiters: [
                        { left: '\\[', right: '\\]', display: true },
                        { left: '$', right: '$', display: false }
                    ],
                    throwOnError: false
                });
            }

            container.classList.remove('fade-out');
        }, 300);
    }

    window.initWalkthrough = initWalkthrough;
})();
