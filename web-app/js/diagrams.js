/**
 * diagrams.js — Static educational diagrams for MRI sequence sections.
 *
 * Public function: window.drawDiagram(canvasId, type)
 *
 * Supported types:
 *   't1-curves'           — T1 recovery curves for different tissues
 *   't2-curves'           — T2 and T2* decay curves
 *   'nutation-recovery'   — Vector diagram: RF nutation + T1 recovery
 *   'spin-refocus'        — 180° pulse refocusing mechanism
 *   'coherent-incoherent' — Spoiled (incoherent) vs balanced (coherent) comparison
 *   'ir-recovery'         — IR recovery: Mz from −M₀ toward +M₀ with null points
 */

(function () {
    'use strict';

    // ─── Color palette (consistent with app theme) ──────────────────
    var C = {
        bg:     '#0f172a',
        grid:   'rgba(255,255,255,0.06)',
        axis:   'rgba(255,255,255,0.25)',
        text:   '#94a3b8',
        label:  '#e2e8f0',
        fat:    '#f59e0b',
        wm:     '#3b82f6',
        gm:     '#10b981',
        csf:    '#06b6d4',
        accent: '#38bdf8',
        rf:     '#ef4444',
        t2s:    '#a855f7',
        white:  '#f8fafc'
    };

    // ─── Helpers ────────────────────────────────────────────────────

    /** Draw an arrow with triangular head */
    function drawArrow(ctx, x1, y1, x2, y2, color, lw, head) {
        head = head || 8;
        lw = lw || 2;
        var dx = x2 - x1, dy = y2 - y1;
        var a = Math.atan2(dy, dx);
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

    /** Draw Cartesian axes with grid, ticks and labels */
    function plotAxes(ctx, ml, mt, pw, ph, xLabel, yLabel, xTicks, yTicks) {
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        yTicks.forEach(function (v) {
            var y = mt + ph * (1 - v.frac);
            ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
        });
        xTicks.forEach(function (v) {
            var x = ml + v.frac * pw;
            ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph); ctx.stroke();
        });
        ctx.strokeStyle = C.axis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ml, mt);
        ctx.lineTo(ml, mt + ph);
        ctx.lineTo(ml + pw, mt + ph);
        ctx.stroke();
        ctx.fillStyle = C.text;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        xTicks.forEach(function (v) { ctx.fillText(v.label, ml + v.frac * pw, mt + ph + 14); });
        ctx.fillText(xLabel, ml + pw / 2, mt + ph + 30);
        ctx.textAlign = 'right';
        yTicks.forEach(function (v) {
            ctx.fillText(v.label, ml - 6, mt + ph * (1 - v.frac) + 4);
        });
        ctx.save();
        ctx.translate(13, mt + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
    }

    /** Draw a trapezoidal gradient lobe */
    function drawTrap(ctx, ox, baseY, start, end, ramp, amp, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.moveTo(ox + start, baseY);
        ctx.lineTo(ox + start + ramp, baseY - amp);
        ctx.lineTo(ox + end - ramp, baseY - amp);
        ctx.lineTo(ox + end, baseY);
        ctx.stroke();
    }

    // ═══════════════════════════════════════════════════════════════
    //  DIAGRAM: T1 Recovery Curves
    // ═══════════════════════════════════════════════════════════════

    function drawT1Curves(ctx, w, h) {
        var ml = 55, mr = 135, mt = 28, mb = 38;
        var pw = w - ml - mr, ph = h - mt - mb;
        var maxT = 5000;

        var xTicks = [], yTicks = [];
        for (var t = 0; t <= maxT; t += 1000) xTicks.push({ frac: t / maxT, label: '' + t });
        for (var v = 0; v <= 1; v += 0.25) yTicks.push({ frac: v, label: v.toFixed(2) });
        plotAxes(ctx, ml, mt, pw, ph, 'Time (ms)', 'Mz / M₀', xTicks, yTicks);

        var tissues = [
            { name: 'Fat',          t1: 270,  color: C.fat },
            { name: 'White Matter', t1: 780,  color: C.wm },
            { name: 'Gray Matter',  t1: 920,  color: C.gm },
            { name: 'CSF',          t1: 4000, color: C.csf }
        ];

        // Curves
        tissues.forEach(function (tis) {
            ctx.beginPath();
            ctx.strokeStyle = tis.color;
            ctx.lineWidth = 2.5;
            for (var i = 0; i <= pw; i++) {
                var tt = (i / pw) * maxT;
                var mz = 1 - Math.exp(-tt / tis.t1);
                var x = ml + i, y = mt + ph * (1 - mz);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });

        // TR markers
        var markers = [{ tr: 500, label: 'Short TR' }, { tr: 3000, label: 'Long TR' }];
        markers.forEach(function (m) {
            var x = ml + (m.tr / maxT) * pw;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1;
            ctx.moveTo(x, mt);
            ctx.lineTo(x, mt + ph);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = C.label;
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(m.label, x, mt - 6);
            ctx.font = '9px Inter, sans-serif';
            ctx.fillStyle = C.text;
            ctx.fillText(m.tr + ' ms', x, mt + 6);
        });

        // Dots at short TR
        var trShort = 500;
        var dotX = ml + (trShort / maxT) * pw;
        tissues.forEach(function (tis) {
            var mz = 1 - Math.exp(-trShort / tis.t1);
            var y = mt + ph * (1 - mz);
            ctx.beginPath();
            ctx.fillStyle = tis.color;
            ctx.arc(dotX, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        // Annotation
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = C.accent;
        ctx.textAlign = 'left';
        ctx.fillText('← Large separation', dotX + 8, mt + ph * 0.18);
        ctx.fillText('   = T1 contrast', dotX + 8, mt + ph * 0.27);

        // Legend
        var lx = ml + pw + 12, ly = mt + 15;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        tissues.forEach(function (tis) {
            ctx.fillStyle = tis.color;
            ctx.fillRect(lx, ly - 4, 14, 3);
            ctx.fillStyle = C.text;
            ctx.fillText(tis.name, lx + 20, ly);
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.font = '8px Inter, sans-serif';
            ctx.fillText('T1=' + tis.t1 + ' ms', lx + 20, ly + 11);
            ctx.restore();
            ctx.font = '10px Inter, sans-serif';
            ly += 28;
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  DIAGRAM: T2 / T2* Decay Curves
    // ═══════════════════════════════════════════════════════════════

    function drawT2Curves(ctx, w, h) {
        var ml = 55, mr = 135, mt = 28, mb = 38;
        var pw = w - ml - mr, ph = h - mt - mb;
        var maxT = 300;

        var xTicks = [], yTicks = [];
        for (var t = 0; t <= maxT; t += 50) xTicks.push({ frac: t / maxT, label: '' + t });
        for (var v = 0; v <= 1; v += 0.25) yTicks.push({ frac: v, label: v.toFixed(2) });
        plotAxes(ctx, ml, mt, pw, ph, 'Time (ms)', 'Mxy / M₀', xTicks, yTicks);

        var tissues = [
            { name: 'Fat',          t2: 85,   t2s: 10,  color: C.fat },
            { name: 'White Matter', t2: 90,   t2s: 50,  color: C.wm },
            { name: 'Gray Matter',  t2: 100,  t2s: 45,  color: C.gm },
            { name: 'CSF',          t2: 2000, t2s: 300, color: C.csf }
        ];

        // T2 curves (solid)
        tissues.forEach(function (tis) {
            ctx.beginPath();
            ctx.strokeStyle = tis.color;
            ctx.lineWidth = 2.5;
            for (var i = 0; i <= pw; i++) {
                var tt = (i / pw) * maxT;
                var mxy = Math.exp(-tt / tis.t2);
                var x = ml + i, y = mt + ph * (1 - mxy);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });

        // T2* curves (dashed, faint)
        tissues.forEach(function (tis) {
            ctx.beginPath();
            ctx.strokeStyle = tis.color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.globalAlpha = 0.5;
            for (var i = 0; i <= pw; i++) {
                var tt = (i / pw) * maxT;
                var mxy = Math.exp(-tt / tis.t2s);
                var x = ml + i, y = mt + ph * (1 - mxy);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1.0;
        });

        // TE markers
        var markers = [{ te: 15, label: 'Short TE' }, { te: 100, label: 'Long TE' }];
        markers.forEach(function (m) {
            var x = ml + (m.te / maxT) * pw;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1;
            ctx.moveTo(x, mt);
            ctx.lineTo(x, mt + ph);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = C.label;
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(m.label, x, mt - 6);
            ctx.font = '9px Inter, sans-serif';
            ctx.fillStyle = C.text;
            ctx.fillText(m.te + ' ms', x, mt + 6);
        });

        // Legend
        var lx = ml + pw + 12, ly = mt + 8;
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = C.label;
        ctx.fillText('─ T2 (solid)', lx, ly);
        ctx.fillStyle = C.text;
        ctx.fillText('┄ T2* (dashed)', lx, ly + 12);
        ly += 28;

        ctx.font = '10px Inter, sans-serif';
        tissues.forEach(function (tis) {
            ctx.fillStyle = tis.color;
            ctx.fillRect(lx, ly - 4, 14, 3);
            ctx.fillStyle = C.text;
            ctx.fillText(tis.name, lx + 20, ly);
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.font = '8px Inter, sans-serif';
            ctx.fillText('T2=' + tis.t2 + '  T2*=' + tis.t2s, lx + 20, ly + 11);
            ctx.restore();
            ctx.font = '10px Inter, sans-serif';
            ly += 25;
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  DIAGRAM: Nutation + T1 Recovery
    // ═══════════════════════════════════════════════════════════════

    function drawNutationRecovery(ctx, w, h) {
        var panels = [
            { title: '1. Equilibrium',      sub: 'M₀ along z-axis' },
            { title: '2. RF Pulse (α°)',    sub: 'Nutation toward xy' },
            { title: '3. Post-RF',          sub: 'Mxy in transverse plane' },
            { title: '4. Recovery',         sub: 'Mz grows (T1), Mxy decays (T2)' }
        ];

        var pw = w / 4;
        var padTop = 38, padBot = 15;
        var axLen = Math.min(pw * 0.35, (h - padTop - padBot) * 0.38);

        panels.forEach(function (p, i) {
            var cx = pw * i + pw / 2;
            var cy = padTop + (h - padTop - padBot) / 2 + 8;

            // Title
            ctx.fillStyle = C.label;
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.title, cx, 14);
            ctx.fillStyle = C.text;
            ctx.font = '9px Inter, sans-serif';
            ctx.fillText(p.sub, cx, 26);

            // Axes: z vertical, xy horizontal
            ctx.strokeStyle = C.axis;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy + axLen * 0.35);
            ctx.lineTo(cx, cy - axLen * 1.1);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - axLen * 0.25, cy);
            ctx.lineTo(cx + axLen * 1.1, cy);
            ctx.stroke();

            ctx.fillStyle = C.text;
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('z', cx - 10, cy - axLen * 1.05);
            ctx.fillText('xy', cx + axLen * 1.1, cy - 8);

            if (i === 0) {
                // Equilibrium: M along z-axis
                drawArrow(ctx, cx, cy, cx, cy - axLen * 0.9, C.accent, 3, 10);
                ctx.fillStyle = C.accent;
                ctx.font = '12px Inter, sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('M₀', cx + 8, cy - axLen * 0.65);
            }
            else if (i === 1) {
                // Nutation: vector rotating from z toward xy
                ctx.save();
                ctx.globalAlpha = 0.2;
                drawArrow(ctx, cx, cy, cx, cy - axLen * 0.9, C.text, 2, 8);
                ctx.restore();
                // Vector at ~50° from z toward xy
                var flipAngle = Math.PI * 0.28;
                var vx = cx + axLen * 0.9 * Math.sin(flipAngle);
                var vy = cy - axLen * 0.9 * Math.cos(flipAngle);
                drawArrow(ctx, cx, cy, vx, vy, C.rf, 3, 10);
                // Rotation arc
                ctx.beginPath();
                ctx.strokeStyle = C.rf;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 2]);
                ctx.arc(cx, cy, axLen * 0.55, -Math.PI / 2, -Math.PI / 2 + flipAngle);
                ctx.stroke();
                ctx.setLineDash([]);
                // RF label
                ctx.fillStyle = C.rf;
                ctx.font = 'bold 10px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText('RF', cx - 8, cy - axLen * 0.35);
            }
            else if (i === 2) {
                // Post-RF: M in xy plane
                drawArrow(ctx, cx, cy, cx + axLen * 0.9, cy, C.accent, 3, 10);
                ctx.fillStyle = C.accent;
                ctx.font = '12px Inter, sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('Mxy', cx + axLen * 0.45, cy - 10);
                // Precession indicator
                ctx.beginPath();
                ctx.strokeStyle = C.text;
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.4;
                ctx.arc(cx + axLen * 0.35, cy, 8, 0, Math.PI * 1.5);
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }
            else if (i === 3) {
                // Recovery: Mz grows, Mxy decays
                var recFrac = 0.6;
                drawArrow(ctx, cx, cy, cx, cy - axLen * recFrac, C.accent, 3, 10);
                ctx.save();
                ctx.globalAlpha = 0.35;
                drawArrow(ctx, cx, cy, cx + axLen * 0.3, cy, C.accent, 2, 6);
                ctx.restore();
                // T1 and T2 labels
                ctx.fillStyle = C.gm;
                ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('T1 ↑', cx + 10, cy - axLen * 0.35);
                ctx.fillStyle = C.rf;
                ctx.fillText('T2 →', cx + axLen * 0.12, cy + 14);
                ctx.fillStyle = C.text;
                ctx.font = '8px Inter, sans-serif';
                ctx.fillText('(decays)', cx + axLen * 0.12, cy + 23);
            }
        });

        // Panel separators
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        for (var i = 1; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(pw * i, padTop - 2);
            ctx.lineTo(pw * i, h - padBot);
            ctx.stroke();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  DIAGRAM: Spin Echo Refocusing (180°)
    // ═══════════════════════════════════════════════════════════════

    function drawSpinRefocus(ctx, w, h) {
        var panels = [
            { title: 'Post 90°',    sub: 't = 0' },
            { title: 'Dephasing',         sub: 't = TE/2' },
            { title: 'Post 180°',    sub: 'Phases inverted' },
            { title: 'Spin Echo',    sub: 't = TE' }
        ];

        var pw = w / 4;
        var padTop = 38, padBot = 30;
        var radius = Math.min(pw * 0.3, (h - padTop - padBot) * 0.32);
        var arrowLen = radius * 0.85;

        // Angles of the 5 spins per panel
        var panelAngles = [
            [0, 0, 0, 0, 0],                         // En fase
            [-0.55, -0.28, 0, 0.28, 0.55],            // Desfasados
            [0.55, 0.28, 0, -0.28, -0.55],             // Invertidos (espejo)
            [0, 0, 0, 0, 0]                            // Refocalizados
        ];
        var spinHues = [200, 225, 0, 130, 50];

        panels.forEach(function (panel, pi) {
            var cx = pw * pi + pw / 2;
            var cy = padTop + (h - padTop - padBot) / 2 - 5;

            // Title
            ctx.fillStyle = C.label;
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(panel.title, cx, 14);
            ctx.fillStyle = C.text;
            ctx.font = '9px Inter, sans-serif';
            ctx.fillText(panel.sub, cx, 26);

            // Circle (xy plane seen from above)
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.moveTo(cx - radius, cy);
            ctx.lineTo(cx + radius, cy);
            ctx.moveTo(cx, cy - radius);
            ctx.lineTo(cx, cy + radius);
            ctx.stroke();

            // Spin arrows
            var angles = panelAngles[pi];
            angles.forEach(function (a, si) {
                var dx = arrowLen * Math.cos(a);
                var dy = -arrowLen * Math.sin(a);
                var clr = spinHues[si] === 0
                    ? 'rgba(255,255,255,0.8)'
                    : 'hsl(' + spinHues[si] + ',70%,60%)';
                drawArrow(ctx, cx, cy, cx + dx, cy + dy, clr, 2, 7);
            });

            // Specific labels
            if (pi === 1) {
                ctx.font = '8px Inter, sans-serif';
                ctx.fillStyle = 'hsl(200,70%,60%)';
                ctx.textAlign = 'right';
                ctx.fillText('fast', cx + arrowLen * Math.cos(-0.55) - 2, cy + arrowLen * Math.sin(0.55) + 12);
                ctx.fillStyle = 'hsl(50,70%,60%)';
                ctx.textAlign = 'left';
                ctx.fillText('slow', cx + arrowLen * Math.cos(0.55) + 2, cy - arrowLen * Math.sin(0.55) + 12);
            }
            if (pi === 3) {
                ctx.fillStyle = C.gm;
                ctx.font = 'bold 10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('✔ ECHO', cx, cy + radius + 16);
            }
        });

        // 180° arrow between panel 2 and 3
        var midX = pw * 2;
        ctx.fillStyle = C.rf;
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('180° RF', midX, h - 10);
        drawArrow(ctx, midX - 25, h - 15, midX - 8, h - 15, C.rf, 1.5, 6);
        drawArrow(ctx, midX + 25, h - 15, midX + 8, h - 15, C.rf, 1.5, 6);

        // Separators
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        for (var i = 1; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(pw * i, padTop - 2);
            ctx.lineTo(pw * i, h - padBot);
            ctx.stroke();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  DIAGRAM: Coherent vs Incoherent Sequences
    // ═══════════════════════════════════════════════════════════════

    function drawCoherentIncoherent(ctx, w, h) {
        var halfW = w / 2;
        var padX = 35, padTop = 48;
        var plotW = halfW - padX * 2;
        var lineH = 30;
        var spacing = 68;

        var titles = ['Spoiled / Incoherent', 'Balanced / Coherent'];
        var subtitles = ['FLASH, SPGR, T1-FFE', 'TrueFISP, FIESTA, b-SSFP'];
        var accentColors = [C.rf, C.accent];

        for (var side = 0; side < 2; side++) {
            var ox = side * halfW + padX;

            // Title
            ctx.fillStyle = accentColors[side];
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(titles[side], side * halfW + halfW / 2, 15);
            ctx.fillStyle = C.text;
            ctx.font = '9px Inter, sans-serif';
            ctx.fillText(subtitles[side], side * halfW + halfW / 2, 28);
            ctx.font = '8px Inter, sans-serif';
            ctx.fillText(side === 0 ? 'Spoiler destroys residual Mxy' : 'Refocused gradients → Mxy preserved',
                side * halfW + halfW / 2, 39);

            var channels = ['RF', 'Gx', 'Gy'];
            var chColors = [C.rf, C.fat, C.gm];

            channels.forEach(function (ch, ci) {
                var baseY = padTop + ci * spacing;

                // Baseline
                ctx.strokeStyle = C.axis;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(ox, baseY);
                ctx.lineTo(ox + plotW, baseY);
                ctx.stroke();

                // Label
                ctx.fillStyle = C.text;
                ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(ch, ox - 5, baseY + 4);

                // Waveform
                if (ch === 'RF') {
                    var ps = plotW * 0.1, pe = plotW * 0.3;
                    var pm = (ps + pe) / 2, phw = (pe - ps) / 2;
                    ctx.beginPath();
                    ctx.strokeStyle = chColors[ci];
                    ctx.lineWidth = 2;
                    for (var x = ps; x <= pe; x++) {
                        var xn = (x - pm) / (phw / 3);
                        var amp = xn === 0 ? 1 : Math.sin(Math.PI * xn) / (Math.PI * xn);
                        var py = baseY - amp * lineH * 0.75;
                        if (x === ps) ctx.moveTo(ox + x, py); else ctx.lineTo(ox + x, py);
                    }
                    ctx.stroke();
                }
                else if (ch === 'Gx') {
                    if (side === 0) {
                        // Spoiled: dephase + readout + spoiler
                        drawTrap(ctx, ox, baseY, plotW * 0.3, plotW * 0.42, plotW * 0.03, lineH * 0.4, chColors[ci]);
                        drawTrap(ctx, ox, baseY, plotW * 0.42, plotW * 0.72, plotW * 0.03, -lineH * 0.6, chColors[ci]);
                        drawTrap(ctx, ox, baseY, plotW * 0.76, plotW * 0.92, plotW * 0.03, lineH * 0.65, C.rf);
                        ctx.fillStyle = C.rf;
                        ctx.font = '8px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('spoiler', ox + plotW * 0.84, baseY + lineH * 0.65 + 12);
                    } else {
                        // Balanced: dephase + readout + rephase (symmetric)
                        drawTrap(ctx, ox, baseY, plotW * 0.25, plotW * 0.38, plotW * 0.03, lineH * 0.45, chColors[ci]);
                        drawTrap(ctx, ox, baseY, plotW * 0.38, plotW * 0.68, plotW * 0.03, -lineH * 0.6, chColors[ci]);
                        drawTrap(ctx, ox, baseY, plotW * 0.68, plotW * 0.81, plotW * 0.03, lineH * 0.45, chColors[ci]);
                        ctx.fillStyle = C.accent;
                        ctx.font = '8px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('symmetric', ox + plotW * 0.53, baseY - lineH * 0.6 - 6);
                    }
                }
                else if (ch === 'Gy') {
                    if (side === 0) {
                        // Spoiled: phase encode without refocusing
                        drawTrap(ctx, ox, baseY, plotW * 0.3, plotW * 0.45, plotW * 0.03, -lineH * 0.45, chColors[ci]);
                    } else {
                        // Balanced: phase encode + rephase (refocused)
                        drawTrap(ctx, ox, baseY, plotW * 0.25, plotW * 0.38, plotW * 0.03, -lineH * 0.45, chColors[ci]);
                        drawTrap(ctx, ox, baseY, plotW * 0.68, plotW * 0.81, plotW * 0.03, lineH * 0.45, chColors[ci]);
                        ctx.fillStyle = C.accent;
                        ctx.font = '8px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('refocused', ox + plotW * 0.745, baseY + lineH * 0.45 + 12);
                    }
                }
            });

            // Bracket TR
            var bracketY = padTop + 2 * spacing + lineH + 8;
            ctx.strokeStyle = C.text;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(ox, bracketY);
            ctx.lineTo(ox, bracketY + 6);
            ctx.lineTo(ox + plotW, bracketY + 6);
            ctx.lineTo(ox + plotW, bracketY);
            ctx.stroke();
            ctx.fillStyle = C.text;
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('1 TR', ox + plotW / 2, bracketY + 18);
        }

        // Center separator
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(halfW, 5);
        ctx.lineTo(halfW, h - 5);
        ctx.stroke();
    }

    // ═══════════════════════════════════════════════════════════════
    //  DIAGRAM: IR Recovery (Mz from −M₀ toward +M₀)
    // ═══════════════════════════════════════════════════════════════

    function drawIRRecovery(ctx, w, h) {
        var ml = 55, mr = 135, mt = 28, mb = 38;
        var pw = w - ml - mr, ph = h - mt - mb;
        var maxT = 5000;

        // Y axis from -1 to +1
        var yTicks = [];
        for (var v = -1; v <= 1; v += 0.5) {
            yTicks.push({ frac: (v + 1) / 2, label: v.toFixed(1) });
        }
        var xTicks = [];
        for (var t = 0; t <= maxT; t += 1000) xTicks.push({ frac: t / maxT, label: '' + t });

        // Manual axes (because plotAxes assumes Y from 0 to 1)
        // Vertical grid
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        xTicks.forEach(function (v) {
            var x = ml + v.frac * pw;
            ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph); ctx.stroke();
        });
        // Horizontal grid
        yTicks.forEach(function (v) {
            var y = mt + ph * (1 - v.frac);
            ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
        });

        // Highlighted Mz = 0 line
        var zeroY = mt + ph * 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ml, zeroY); ctx.lineTo(ml + pw, zeroY); ctx.stroke();

        // Main axes
        ctx.strokeStyle = C.axis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ml, mt); ctx.lineTo(ml, mt + ph); ctx.lineTo(ml + pw, mt + ph);
        ctx.stroke();

        // Axis labels
        ctx.fillStyle = C.text;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        xTicks.forEach(function (v) { ctx.fillText(v.label, ml + v.frac * pw, mt + ph + 14); });
        ctx.fillText('Time after inversion (ms)', ml + pw / 2, mt + ph + 30);
        ctx.textAlign = 'right';
        yTicks.forEach(function (v) {
            ctx.fillText(v.label, ml - 6, mt + ph * (1 - v.frac) + 4);
        });
        ctx.save();
        ctx.translate(13, mt + ph / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('Mz / M₀', 0, 0);
        ctx.restore();

        var tissues = [
            { name: 'Fat',          t1: 270,  color: C.fat },
            { name: 'White Matter', t1: 780,  color: C.wm },
            { name: 'Gray Matter',  t1: 920,  color: C.gm },
            { name: 'CSF',          t1: 4000, color: C.csf }
        ];

        // Curves: Mz(t) = M0 * (1 - 2*exp(-t/T1))
        tissues.forEach(function (tis) {
            ctx.beginPath();
            ctx.strokeStyle = tis.color;
            ctx.lineWidth = 2.5;
            for (var i = 0; i <= pw; i++) {
                var tt = (i / pw) * maxT;
                var mz = 1 - 2 * Math.exp(-tt / tis.t1);
                // map mz (-1..+1) to pixel
                var yFrac = (mz + 1) / 2; // 0..1
                var x = ml + i;
                var y = mt + ph * (1 - yFrac);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });

        // Null points: TI_null = T1 * ln(2)
        var ln2 = Math.log(2);
        tissues.forEach(function (tis) {
            var tiNull = tis.t1 * ln2;
            if (tiNull < maxT) {
                var x = ml + (tiNull / maxT) * pw;
                // Point at Mz = 0
                ctx.beginPath();
                ctx.fillStyle = tis.color;
                ctx.arc(x, zeroY, 5, 0, Math.PI * 2);
                ctx.fill();
                // Subtle dashed vertical line
                ctx.beginPath();
                ctx.strokeStyle = tis.color;
                ctx.globalAlpha = 0.3;
                ctx.setLineDash([3, 3]);
                ctx.lineWidth = 1;
                ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = 1.0;
            }
        });

        // Clinical TI markers
        var markers = [
            { ti: 150,  label: 'STIR', note: '~150 ms' },
            { ti: 2770, label: 'FLAIR', note: '~2770 ms' }
        ];
        markers.forEach(function (m) {
            var x = ml + (m.ti / maxT) * pw;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.setLineDash([6, 3]);
            ctx.lineWidth = 1.2;
            ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = C.label;
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(m.label, x, mt - 6);
            ctx.font = '9px Inter, sans-serif';
            ctx.fillStyle = C.text;
            ctx.fillText(m.note, x, mt + 6);
        });

        // "Null point (Mz = 0)" label
        ctx.fillStyle = C.accent;
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Mz = 0 (null point)', ml + pw * 0.42, zeroY - 8);

        // Legend
        var lx = ml + pw + 12, ly = mt + 8;
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = C.label;
        ctx.fillText('TIₙᵤₗₗ = T1·ln2', lx, ly);
        ly += 18;

        ctx.font = '10px Inter, sans-serif';
        tissues.forEach(function (tis) {
            var tiNull = Math.round(tis.t1 * ln2);
            ctx.fillStyle = tis.color;
            ctx.fillRect(lx, ly - 4, 14, 3);
            ctx.fillStyle = C.text;
            ctx.fillText(tis.name, lx + 20, ly);
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.font = '8px Inter, sans-serif';
            ctx.fillText('TIₙ=' + tiNull + ' ms', lx + 20, ly + 11);
            ctx.restore();
            ctx.font = '10px Inter, sans-serif';
            ly += 25;
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════════════════════════

    window.drawDiagram = function (canvasId, type) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        var handlers = {
            't1-curves':           drawT1Curves,
            't2-curves':           drawT2Curves,
            'nutation-recovery':   drawNutationRecovery,
            'spin-refocus':        drawSpinRefocus,
            'coherent-incoherent': drawCoherentIncoherent,
            'ir-recovery':         drawIRRecovery
        };
        if (handlers[type]) handlers[type](ctx, canvas.width, canvas.height);
    };

})();
