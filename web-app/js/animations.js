window.initAnimation = function(type) {
    const psdCanvas = document.getElementById('psd-canvas');
    const kspaceCanvas = document.getElementById('kspace-canvas');
    const kspaceFullCanvas = document.getElementById('kspace-full-canvas');
    const playBtn = document.getElementById('play-btn');

    // Determine if this is an RF-only type (excitation)
    const isRFType = (type === 'gre-rf' || type === 'se-rf' || type === 'ir-rf');

    // For trajectories we need PSD + k-space; for RF only PSD
    if (!psdCanvas) return;
    if (!isRFType && !kspaceCanvas) return;

    const psdCtx = psdCanvas.getContext('2d');
    const kCtx = kspaceCanvas ? kspaceCanvas.getContext('2d') : null;

    let animationId;
    let isPlaying = false;
    let time = 0;
    const maxTime = 400;
    let speed = 1;
    let cycle = 0;

    const xScale = psdCanvas.width / maxTime;

    const kScaleMap = { gre: 3.0, spinecho: 3.0, epi: 6, radial: 2.0, spiral: 4.0 };
    const kScale = kScaleMap[type] || 1.5;

    var maxCyclesMap = { gre: 17, spinecho: 17, epi: 1, radial: 16, spiral: 8 };
    var maxCycles = maxCyclesMap[type] || 16;

    let prevKx = 0, prevKy = 0;

    const colors = {
        rf: '#ef4444',
        gz: '#3b82f6',
        gy: '#10b981',
        gx: '#f59e0b',
        kspace: '#a855f7',
        grid: 'rgba(255,255,255,0.1)',
        text: '#94a3b8'
    };

    var baselines = {
        rf:  Math.round(psdCanvas.height * 0.11),
        gz:  Math.round(psdCanvas.height * 0.33),
        gy:  Math.round(psdCanvas.height * 0.56),
        gx:  Math.round(psdCanvas.height * 0.78)
    };
    var ampScale = Math.round(psdCanvas.height * 0.09);

    // ─── Gradient helpers ──────────────────────────────────────────────
    function getTrapezoidValue(t, start, end, rampTime, amplitude) {
        if (t < start || t > end) return 0;
        if (t < start + rampTime) return amplitude * ((t - start) / rampTime);
        if (t > end - rampTime) return amplitude * ((end - t) / rampTime);
        return amplitude;
    }

    // Sinc pulse helper (normalized, windowed)
    function sincPulse(t, center, halfWidth) {
        if (t < center - halfWidth || t > center + halfWidth) return 0;
        var x = (t - center) / (halfWidth / 3);
        return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    }

    function getGradients(t, seqType, currentCycle) {
        var rf = 0, gz = 0, gy = 0, gx = 0;

        // ── RF-only types (excitations) ──────────────────────────────
        if (seqType === 'gre-rf') {
            // GRE: single RF pulse with flip angle α + Gz slice select
            rf = sincPulse(t, 50, 20);
            // Flip angle < 90° → scale the sinc
            rf *= 0.6;
            gz = getTrapezoidValue(t, 25, 75, 5, 1);
            gz += getTrapezoidValue(t, 75, 95, 5, -0.5); // refocus lobe
            // Readout gradient (to show the gradient echo)
            gx = getTrapezoidValue(t, 120, 160, 5, -0.6); // dephase
            gx += getTrapezoidValue(t, 170, 320, 10, 0.5); // readout
            // Signal (ADC) indicator: small bump where echo forms
            return { rf: rf, gz: gz, gy: 0, gx: gx };
        }

        if (seqType === 'se-rf') {
            // SE: 90° pulse + 180° refocusing pulse
            // 90° excitation
            rf = sincPulse(t, 50, 20);
            gz = getTrapezoidValue(t, 25, 75, 5, 1);
            gz += getTrapezoidValue(t, 75, 95, 5, -0.5);
            // 180° refocusing pulse at t~200
            rf += sincPulse(t, 200, 20) * 1.0;
            gz += getTrapezoidValue(t, 175, 225, 5, 1);
            // Readout around the echo at t~350
            gx = getTrapezoidValue(t, 100, 140, 5, -0.5); // dephase
            gx += getTrapezoidValue(t, 300, 380, 8, 0.5);  // readout
            return { rf: rf, gz: gz, gy: 0, gx: gx };
        }

        if (seqType === 'ir-rf') {
            // IR: 180° inversion + wait TI + 90° + 180° refocus
            // 180° inversion pulse (t~40)
            rf = sincPulse(t, 40, 15) * 1.0;
            gz = getTrapezoidValue(t, 22, 58, 4, 1);
            // 90° excitation (t~160, after TI)
            rf += sincPulse(t, 160, 15) * 0.7;
            gz += getTrapezoidValue(t, 142, 178, 4, 0.9);
            gz += getTrapezoidValue(t, 178, 195, 4, -0.4); // refocus lobe
            // 180° refocusing pulse (t~270)
            rf += sincPulse(t, 270, 15) * 1.0;
            gz += getTrapezoidValue(t, 252, 288, 4, 1);
            // Readout around echo (t~360)
            gx = getTrapezoidValue(t, 200, 230, 5, -0.5); // dephase
            gx += getTrapezoidValue(t, 340, 395, 8, 0.5);  // readout
            return { rf: rf, gz: gz, gy: 0, gx: gx };
        }

        // ── Trajectory types ─────────────────────────────────────────
        // Excitation pulse (common to all trajectory types)
        if (t >= 30 && t <= 70) {
            var x = (t - 50) / 5;
            rf = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        }

        gz = getTrapezoidValue(t, 25, 75, 5, 1);
        gz += getTrapezoidValue(t, 75, 95, 5, -0.5);

        if (seqType === 'gre' || seqType === 'spinecho') {
            var phaseAmp = Math.cos(currentCycle * Math.PI / 16);
            gy = getTrapezoidValue(t, 100, 140, 5, phaseAmp);
            gx = getTrapezoidValue(t, 100, 140, 5, -1);
            gx += getTrapezoidValue(t, 160, 300, 10, 0.5);
        }
        else if (seqType === 'epi') {
            if (t > 100 && t < 350) {
                var echoIdx = Math.floor((t - 100) / 25);
                var isOdd = echoIdx % 2 !== 0;
                gx = getTrapezoidValue(t % 25, 2, 23, 3, isOdd ? -0.8 : 0.8);
                if (t % 25 < 3 && echoIdx > 0) gy = 1.0;
            }
            gy += getTrapezoidValue(t, 80, 95, 3, -1);
            gx += getTrapezoidValue(t, 80, 95, 3, -0.8);
        }
        else if (seqType === 'radial') {
            var angle = currentCycle * Math.PI / 16;
            var neg = getTrapezoidValue(t, 100, 170, 8, -0.6);
            var pos = getTrapezoidValue(t, 175, 300, 8, 0.6);
            gx = (neg + pos) * Math.cos(angle);
            gy = (neg + pos) * Math.sin(angle);
        }
        else if (seqType === 'spiral') {
            if (t > 100 && t < 350) {
                var spiralT = (t - 100) / 15;
                gx = Math.cos(spiralT) * (spiralT / 15);
                gy = Math.sin(spiralT) * (spiralT / 15);
            }
        }

        return { rf: rf, gz: gz, gy: gy, gx: gx };
    }

    // ─── Drawing helpers ───────────────────────────────────────────────
    function drawGrid(ctx, w, h) {
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i < h; i += 50) { ctx.moveTo(0, i); ctx.lineTo(w, i); }
        for (var j = 0; j < w; j += 50) { ctx.moveTo(j, 0); ctx.lineTo(j, h); }
        ctx.stroke();
    }

    function drawKSpaceAxes(ctx, w, h) {
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
        ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
        ctx.stroke();
        ctx.fillStyle = colors.text;
        ctx.font = '11px Inter';
        ctx.fillText('kx', w - 20, h / 2 - 6);
        ctx.fillText('ky', w / 2 + 6, 14);
    }

    function drawWaveforms(ctx, bls, sc, seqType, currentCycle, fromT, toT, lw) {
        var drawChannel = function(channel, baseline, color) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lw || 2;
            var started = false;
            for (var t = fromT; t <= toT; t++) {
                var vals = getGradients(t, seqType, currentCycle);
                var px = t * xScale;
                var py = baseline - vals[channel] * sc;
                if (!started) { ctx.moveTo(px, py); started = true; }
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        };
        drawChannel('rf', bls.rf, colors.rf);
        drawChannel('gz', bls.gz, colors.gz);
        drawChannel('gy', bls.gy, colors.gy);
        drawChannel('gx', bls.gx, colors.gx);
    }

    function drawLabels(ctx, bls) {
        ctx.fillStyle = colors.text;
        ctx.font = '13px Inter';
        ctx.fillText('RF', 10, bls.rf - 14);
        ctx.fillText('Gz (Slice)', 10, bls.gz - 14);

        if (isRFType) {
            // For RF-only types, Gy is always 0 but Gx shows readout
            ctx.fillText('Gy', 10, bls.gy - 14);
            ctx.fillText('Gx (Read)', 10, bls.gx - 14);
        } else {
            ctx.fillText('Gy (Phase)', 10, bls.gy - 14);
            ctx.fillText('Gx (Freq)', 10, bls.gx - 14);
        }
    }

    // ─── Full k-space (static preview with all cycles) ─────────────────
    function drawFullKSpace() {
        if (!kspaceFullCanvas) return;
        var ctx = kspaceFullCanvas.getContext('2d');
        var w = kspaceFullCanvas.width;
        var h = kspaceFullCanvas.height;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        drawKSpaceAxes(ctx, w, h);

        var cycleConfig = { gre: 17, spinecho: 17, epi: 1, radial: 16, spiral: 8 };
        var totalCycles = cycleConfig[type] || 16;
        var centerX = w / 2;
        var centerY = h / 2;

        for (var c = 0; c < totalCycles; c++) {
            var kx = 0, ky = 0;
            ctx.beginPath();
            var hue = (c * 270 / totalCycles + 260) % 360;
            ctx.strokeStyle = 'hsla(' + hue + ', 70%, 60%, 0.7)';
            ctx.lineWidth = 1.5;

            for (var t = 0; t <= maxTime; t++) {
                var vals = getGradients(t, type, c);
                kx += vals.gx * kScale;
                ky += vals.gy * kScale;

                var drawKx = kx, drawKy = ky;
                if (type === 'spiral' && totalCycles > 1) {
                    var rotAngle = c * 2 * Math.PI / totalCycles;
                    drawKx = kx * Math.cos(rotAngle) - ky * Math.sin(rotAngle);
                    drawKy = kx * Math.sin(rotAngle) + ky * Math.cos(rotAngle);
                }

                var px = centerX + drawKx;
                var py = centerY - drawKy;
                if (t === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
    }

    // ─── Main render loop ──────────────────────────────────────────────
    function render() {
        if (!isPlaying) return;

        // PSD: clear and redraw each frame
        psdCtx.clearRect(0, 0, psdCanvas.width, psdCanvas.height);
        drawGrid(psdCtx, psdCanvas.width, psdCanvas.height);

        // Full waveform as dim guide
        psdCtx.globalAlpha = 0.2;
        drawWaveforms(psdCtx, baselines, ampScale, type, cycle, 0, maxTime, 1.5);
        psdCtx.globalAlpha = 1.0;

        // Highlighted waveform up to current time
        drawWaveforms(psdCtx, baselines, ampScale, type, cycle, 0, Math.floor(time), 2.5);

        drawLabels(psdCtx, baselines);

        // Time cursor
        var cursorX = Math.floor(time) * xScale;
        psdCtx.beginPath();
        psdCtx.strokeStyle = 'rgba(255,255,255,0.45)';
        psdCtx.lineWidth = 1;
        psdCtx.setLineDash([4, 4]);
        psdCtx.moveTo(cursorX, 0);
        psdCtx.lineTo(cursorX, psdCanvas.height);
        psdCtx.stroke();
        psdCtx.setLineDash([]);

        // K-space: integrate up to current time (only for trajectory types)
        if (kCtx) {
            var kx = 0, ky = 0;
            for (var t = 0; t <= Math.floor(time); t++) {
                var vals = getGradients(t, type, cycle);
                kx += vals.gx * kScale;
                ky += vals.gy * kScale;
            }

            var kCenterX = kspaceCanvas.width / 2;
            var kCenterY = kspaceCanvas.height / 2;

            // Draw line segment from prev position to current (accumulates)
            kCtx.beginPath();
            kCtx.strokeStyle = colors.kspace;
            kCtx.lineWidth = 2;
            kCtx.moveTo(kCenterX + prevKx, kCenterY - prevKy);
            kCtx.lineTo(kCenterX + kx, kCenterY - ky);
            kCtx.stroke();

            // Current position dot (bright)
            kCtx.beginPath();
            kCtx.fillStyle = '#ffffff';
            kCtx.shadowBlur = 10;
            kCtx.shadowColor = colors.kspace;
            kCtx.arc(kCenterX + kx, kCenterY - ky, 3, 0, Math.PI * 2);
            kCtx.fill();
            kCtx.shadowBlur = 0;

            prevKx = kx;
            prevKy = ky;
        }

        // Advance
        time += speed;
        if (time > maxTime) {
            time = 0;
            cycle++;
            prevKx = 0;
            prevKy = 0;

            if (cycle >= maxCycles) {
                isPlaying = false;
                cancelAnimationFrame(animationId);
                if (playBtn) {
                    playBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Play';
                }
                return;
            }
        }

        animationId = requestAnimationFrame(render);
    }

    // ─── Play / Pause (trajectories only) ───────────────────────────────
    if (playBtn) {
        playBtn.addEventListener('click', function() {
            isPlaying = !isPlaying;
            playBtn.innerHTML = isPlaying
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Play';

            if (isPlaying) {
                if (cycle >= maxCycles) {
                    time = 0;
                    cycle = 0;
                    prevKx = 0;
                    prevKy = 0;
                }
                if (time === 0 && cycle === 0 && kCtx) {
                    kCtx.fillStyle = '#0f172a';
                    kCtx.fillRect(0, 0, kspaceCanvas.width, kspaceCanvas.height);
                    drawKSpaceAxes(kCtx, kspaceCanvas.width, kspaceCanvas.height);
                }
                render();
            } else {
                cancelAnimationFrame(animationId);
            }
        });
    }

    // ─── Initial static draw ───────────────────────────────────────────
    psdCtx.clearRect(0, 0, psdCanvas.width, psdCanvas.height);
    drawGrid(psdCtx, psdCanvas.width, psdCanvas.height);
    psdCtx.globalAlpha = 0.5;
    drawWaveforms(psdCtx, baselines, ampScale, type, 0, 0, maxTime, 2);
    psdCtx.globalAlpha = 1.0;
    drawLabels(psdCtx, baselines);

    // K-space init (trajectories only)
    if (kCtx) {
        kCtx.fillStyle = '#0f172a';
        kCtx.fillRect(0, 0, kspaceCanvas.width, kspaceCanvas.height);
        drawKSpaceAxes(kCtx, kspaceCanvas.width, kspaceCanvas.height);
    }

    if (!isRFType) {
        drawFullKSpace();
    }
};
