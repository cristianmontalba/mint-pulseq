/**
 * INSPECTOR — read and explain a .seq file in the browser.
 *
 * Drop a Pulseq .seq on the page and it is parsed client-side (no upload,
 * no server) into its sections, then explained: the header definitions, the
 * block list with its pointers, a pulse-sequence diagram of the first TR,
 * and the k-space trajectory obtained by integrating gradient areas.
 *
 * External coupling:
 *   - window.initInspector()  → exposed for app.js
 *   - window.openTool(id)     → hand-off to another module (app.js)
 *
 * Nothing here writes a .seq; this module only reads.
 */

(function () {
    'use strict';

    var C = {
        bg:     '#0f172a',
        grid:   'rgba(255,255,255,0.07)',
        axis:   'rgba(255,255,255,0.25)',
        text:   '#94a3b8',
        label:  '#e2e8f0',
        accent: '#38bdf8',
        rf:     '#ef4444',
        gx:     '#f59e0b',
        gy:     '#10b981',
        gz:     '#3b82f6',
        adc:    '#06b6d4',
        muted:  '#64748b'
    };

    var EXAMPLE_URL = 'examples/spin_echo_example.seq';
    var PAGE_SIZE = 40;

    var parsed = null;      // the last successfully parsed file
    var blockPage = 0;      // paging offset into the block table

    // ═══════════════════════════════════════════════════════════════
    //  PARSER
    // ═══════════════════════════════════════════════════════════════

    /** Split the file into `[SECTION] → [lines]`, dropping comments. */
    function splitSections(textBody) {
        var sections = {};
        var current = null;
        textBody.split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();
            if (!line || line.charAt(0) === '#') return;
            var m = line.match(/^\[([A-Z_]+)\]$/);
            if (m) {
                current = m[1];
                sections[current] = [];
                return;
            }
            if (current) sections[current].push(line);
        });
        return sections;
    }

    function numbers(line) {
        return line.split(/\s+/).map(Number);
    }

    /**
     * Pulseq stores shapes as a run-length-encoded derivative: two equal
     * consecutive values are followed by a repeat count, and the running sum
     * reconstructs the samples. A shape that compression would not shrink is
     * stored raw, which is why the sample count is checked at the end.
     */
    function decompressShape(data, numSamples) {
        var out = [];
        var i = 0;
        while (i < data.length) {
            var v = data[i];
            out.push(v);
            i++;
            if (i < data.length && data[i] === v) {
                out.push(v);
                i++;
                if (i < data.length) {
                    var repeats = Math.round(data[i]);
                    i++;
                    for (var r = 0; r < repeats; r++) out.push(v);
                }
            }
        }
        var acc = 0;
        var summed = out.map(function (d) { acc += d; return acc; });
        if (summed.length === numSamples) return summed;
        if (data.length === numSamples) return data.slice();
        return summed;
    }

    function parseShapes(lines) {
        var shapes = {};
        var id = null;
        var n = 0;
        var data = [];
        function flush() {
            if (id !== null) shapes[id] = { numSamples: n, samples: decompressShape(data, n) };
        }
        lines.forEach(function (line) {
            var mId = line.match(/^shape_id\s+(\d+)$/);
            if (mId) { flush(); id = Number(mId[1]); n = 0; data = []; return; }
            var mN = line.match(/^num_samples\s+(\d+)$/);
            if (mN) { n = Number(mN[1]); return; }
            var v = Number(line);
            if (!isNaN(v)) data.push(v);
        });
        flush();
        return shapes;
    }

    function parseSeq(textBody) {
        var sections = splitSections(textBody);
        var warnings = [];

        if (!sections.BLOCKS) {
            throw new Error('No [BLOCKS] section found — this does not look like a .seq file.');
        }

        // --- version -------------------------------------------------
        var version = { major: 1, minor: 0, revision: 0 };
        (sections.VERSION || []).forEach(function (line) {
            var p = line.split(/\s+/);
            if (p[0] in version) version[p[0]] = Number(p[1]);
        });

        // --- definitions ---------------------------------------------
        var definitions = {};
        (sections.DEFINITIONS || []).forEach(function (line) {
            var parts = line.split(/\s+/);
            definitions[parts[0]] = parts.slice(1).join(' ');
        });
        var blockRaster = Number(definitions.BlockDurationRaster) || 1e-5;

        // --- blocks --------------------------------------------------
        // NUM DUR RF GX GY GZ ADC EXT
        var blocks = (sections.BLOCKS || []).map(function (line) {
            var v = numbers(line);
            return {
                id: v[0], dur: v[1],
                rf: v[2] || 0, gx: v[3] || 0, gy: v[4] || 0, gz: v[5] || 0,
                adc: v[6] || 0, ext: v[7] || 0
            };
        });

        // --- trapezoid gradients -------------------------------------
        // id amplitude rise flat fall delay   (Hz/m, µs)
        var trap = {};
        (sections.TRAP || []).forEach(function (line) {
            var v = numbers(line);
            trap[v[0]] = {
                id: v[0], amplitude: v[1],
                rise: v[2], flat: v[3], fall: v[4], delay: v[5] || 0
            };
        });

        // --- arbitrary gradients -------------------------------------
        // id amplitude shape_id [time_shape_id] delay
        var grad = {};
        (sections.GRADIENTS || []).forEach(function (line) {
            var v = numbers(line);
            grad[v[0]] = {
                id: v[0], amplitude: v[1], shapeId: v[2],
                timeShapeId: v.length > 4 ? v[3] : 0,
                delay: v[v.length - 1] || 0
            };
        });
        if (Object.keys(grad).length) {
            warnings.push('This sequence uses arbitrary gradient shapes. Their areas are '
                        + 'estimated from the shape samples, so the k-space plot is '
                        + 'approximate for those blocks.');
        }

        // --- RF ------------------------------------------------------
        // v1.4: id ampl mag phase time_shape delay freq phase use
        // v1.5: id ampl mag phase time_shape center delay ... use
        var rf = {};
        (sections.RF || []).forEach(function (line) {
            var parts = line.split(/\s+/);
            var v = parts.map(Number);
            var long = parts.length >= 12;              // 1.5 carries `center`
            rf[v[0]] = {
                id: v[0],
                amplitude: v[1],
                magId: v[2], phaseId: v[3], timeId: v[4],
                center: long ? v[5] : null,
                delay: long ? v[6] : v[5],
                use: parts[parts.length - 1]
            };
        });

        // --- ADC -----------------------------------------------------
        // id num dwell delay ...   (dwell ns, delay µs)
        var adc = {};
        (sections.ADC || []).forEach(function (line) {
            var v = numbers(line);
            adc[v[0]] = { id: v[0], num: v[1], dwell: v[2], delay: v[3] || 0 };
        });

        var shapes = parseShapes(sections.SHAPES || []);

        // --- signature -----------------------------------------------
        var signature = null;
        (sections.SIGNATURE || []).forEach(function (line) {
            var p = line.split(/\s+/);
            if (p[0] === 'Hash') signature = p[1];
        });

        var totalTicks = blocks.reduce(function (s, b) { return s + b.dur; }, 0);

        return {
            version: version,
            definitions: definitions,
            blockRaster: blockRaster,
            blocks: blocks,
            trap: trap,
            grad: grad,
            rf: rf,
            adc: adc,
            shapes: shapes,
            signature: signature,
            duration: totalTicks * blockRaster,
            warnings: warnings
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  DERIVED QUANTITIES
    // ═══════════════════════════════════════════════════════════════

    /** Area of a trapezoid, in 1/m (amplitude Hz/m × time s). */
    function trapArea(t) {
        return t.amplitude * (t.rise / 2 + t.flat + t.fall / 2) * 1e-6;
    }

    function gradArea(p, id, channelStore) {
        if (!id) return 0;
        if (p.trap[id]) return trapArea(p.trap[id]);
        var g = p.grad[id];
        if (!g) return 0;
        var shape = p.shapes[g.shapeId];
        if (!shape) return 0;
        // Arbitrary gradient: sum the samples over the gradient raster.
        var raster = Number(p.definitions.GradientRasterTime) || 1e-5;
        var sum = shape.samples.reduce(function (s, v) { return s + v; }, 0);
        return g.amplitude * sum * raster;
    }

    /**
     * Walk the blocks integrating gradient area into k.
     *
     * This is the ground-truth method: k is the running integral of the
     * gradient, an excitation resets it to the origin, and a refocusing pulse
     * mirrors it. Doing it this way avoids the known failure of
     * calculate_kspace() on multi-shot sequences, which does not restart k at
     * each excitation and so draws later shots displaced.
     */
    /** Area accumulated within a trapezoid up to the middle of its flat top. */
    function trapAreaToFlatCentre(t) {
        return t.amplitude * (t.rise / 2 + t.flat / 2) * 1e-6;
    }

    function computeKSpace(p) {
        var kx = 0, ky = 0;
        var path = [];
        var excitations = 0;
        var refocusings = 0;
        var adcBlocks = 0;
        var adcCentres = [];         // k at the centre of each ADC window
        var excitationTimes = [];    // block-time of every excitation, in seconds
        var clock = 0;
        var maxK = 0;

        p.blocks.forEach(function (b) {
            if (b.rf) {
                var use = (p.rf[b.rf] && p.rf[b.rf].use) || '';
                if (use === 'r') {
                    kx = -kx; ky = -ky;
                    refocusings++;
                } else {
                    kx = 0; ky = 0;
                    excitations++;
                    excitationTimes.push(clock);
                    path.push({ x: 0, y: 0, adc: false, jump: true });
                }
            }

            var dx = gradArea(p, b.gx);
            var dy = gradArea(p, b.gy);

            if (b.adc) {
                adcBlocks++;
                // Where k sits when the middle sample is taken. With the ADC
                // delayed by the rise time and lasting the flat top, that is the
                // centre of the flat part of the readout gradient.
                var tx = p.trap[b.gx];
                var ty = p.trap[b.gy];
                adcCentres.push({
                    x: kx + (tx ? trapAreaToFlatCentre(tx) : dx / 2),
                    y: ky + (ty ? trapAreaToFlatCentre(ty) : dy / 2)
                });
            }

            if (dx || dy || b.adc) {
                kx += dx;
                ky += dy;
                maxK = Math.max(maxK, Math.abs(kx), Math.abs(ky));
                path.push({ x: kx, y: ky, adc: !!b.adc, jump: false });
            }

            clock += b.dur * p.blockRaster;
        });

        return {
            path: path,
            excitations: excitations,
            refocusings: refocusings,
            adcBlocks: adcBlocks,
            adcCentres: adcCentres,
            excitationTimes: excitationTimes,
            maxK: maxK
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  SANITY CHECKS
    //  These are the checks that catch what check_timing() cannot: a
    //  sequence can be perfectly legal and still sample the wrong place.
    // ═══════════════════════════════════════════════════════════════

    function diagnostics(p, k) {
        var rows = [];

        // --- 1. Does k reach the edge the resolution implies? ---------
        var firstAdc = null;
        Object.keys(p.adc).forEach(function (id) { if (!firstAdc) firstAdc = p.adc[id]; });
        var fovParts = (p.definitions.FOV || '').split(/\s+/).map(Number);
        var fovX = fovParts[0];

        if (firstAdc && fovX) {
            var expected = firstAdc.num / (2 * fovX);
            var ratio = k.maxK / expected;
            var ok = Math.abs(ratio - 1) < 0.1;
            rows.push({
                label: '|k|max matches the resolution',
                status: ok ? 'ok' : 'warn',
                detail: 'Measured ' + k.maxK.toFixed(1) + ' 1/m against n_x / (2·FOV) = '
                      + expected.toFixed(1) + ' 1/m'
                      + (ok ? '.' : ' — a ratio of ' + ratio.toFixed(2)
                              + '. Cartesian and radial should match it exactly; other '
                              + 'trajectories may legitimately differ.')
            });
        }

        // --- 2. Does the echo land in the middle of the readout? ------
        if (k.adcCentres.length) {
            var worst = 0;
            k.adcCentres.forEach(function (c) {
                worst = Math.max(worst, Math.abs(c.x));
            });
            var tol = k.maxK * 0.05 || 1;
            var centred = worst <= tol;
            rows.push({
                label: 'k crosses the centre during the readout',
                status: centred ? 'ok' : 'fail',
                detail: centred
                    ? 'The largest offset at any ADC centre is ' + worst.toFixed(1) + ' 1/m.'
                    : 'kx is ' + worst.toFixed(1) + ' 1/m away from the origin at the centre '
                      + 'of the readout, so the centre of k-space is never sampled. This is '
                      + 'the readout prephaser having the wrong sign or the wrong area — the '
                      + 'classic spin-echo bug. The sequence is still perfectly legal, which '
                      + 'is exactly why check_timing() says nothing.'
            });
        }

        // --- 3. Is the repetition time constant? ----------------------
        if (k.excitationTimes.length > 2) {
            var gaps = [];
            for (var i = 1; i < k.excitationTimes.length; i++) {
                gaps.push(k.excitationTimes[i] - k.excitationTimes[i - 1]);
            }
            var minGap = Math.min.apply(null, gaps);
            var maxGap = Math.max.apply(null, gaps);
            var steady = (maxGap - minGap) < 1e-5;
            rows.push({
                label: 'TR is constant between excitations',
                status: steady ? 'ok' : 'warn',
                detail: steady
                    ? 'Every repetition is ' + (minGap * 1000).toFixed(2) + ' ms.'
                    : 'Repetitions range from ' + (minGap * 1000).toFixed(2) + ' to '
                      + (maxGap * 1000).toFixed(2) + ' ms. That is expected for a prepared '
                      + 'or multi-echo sequence, and a red flag for a plain one.'
            });
        }

        // --- 4. Are the block durations on the raster? ----------------
        var offRaster = 0;
        p.blocks.forEach(function (b) {
            if (Math.abs(b.dur - Math.round(b.dur)) > 1e-9) offRaster++;
        });
        rows.push({
            label: 'Block durations are whole raster ticks',
            status: offRaster ? 'fail' : 'ok',
            detail: offRaster
                ? offRaster + ' blocks are not a whole number of ticks.'
                : 'All ' + p.blocks.length + ' blocks land on the '
                  + (p.blockRaster * 1e6) + ' µs grid.'
        });

        return rows;
    }

    /** Blocks belonging to the first repetition, for the diagram. */
    function firstTR(p) {
        var out = [];
        var seenExcitation = false;
        for (var i = 0; i < p.blocks.length; i++) {
            var b = p.blocks[i];
            var isExc = b.rf && (!p.rf[b.rf] || p.rf[b.rf].use !== 'r');
            if (isExc) {
                if (seenExcitation) break;
                seenExcitation = true;
            }
            out.push(b);
            if (out.length > 60) break;
        }
        return out;
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAWING
    // ═══════════════════════════════════════════════════════════════

    var PSD_W = 860, PSD_H = 320;

    function text(ctx, str, x, y, color, size, align, weight) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = (weight ? weight + ' ' : '') + size + 'px Inter, sans-serif';
        ctx.textAlign = align || 'left';
        ctx.fillText(str, x, y);
        ctx.restore();
    }

    function drawPSD(canvas, p) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, PSD_W, PSD_H);
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, PSD_W, PSD_H);

        var all = firstTR(p);

        // The TR delay is usually an order of magnitude longer than everything
        // it follows — drawing it to scale squashes the whole sequence into the
        // first few pixels. Trim the trailing event-less blocks and say so.
        var last = all.length - 1;
        while (last > 0) {
            var b0 = all[last];
            if (b0.rf || b0.gx || b0.gy || b0.gz || b0.adc) break;
            last--;
        }
        var blocks = all.slice(0, last + 1);
        var trimmedUs = all.slice(last + 1)
            .reduce(function (s, b) { return s + b.dur; }, 0) * p.blockRaster * 1e6;

        var totalUs = blocks.reduce(function (s, b) { return s + b.dur; }, 0) * p.blockRaster * 1e6;
        if (totalUs <= 0) return;

        var left = 52, right = PSD_W - 14;
        var pxPerUs = (right - left) / totalUs;

        var rows = [
            { key: 'rf', name: 'RF', y: 54, color: C.rf },
            { key: 'gz', name: 'Gz', y: 108, color: C.gz },
            { key: 'gy', name: 'Gy', y: 158, color: C.gy },
            { key: 'gx', name: 'Gx', y: 208, color: C.gx },
            { key: 'adc', name: 'ADC', y: 258, color: C.adc }
        ];

        rows.forEach(function (r) {
            ctx.save();
            ctx.strokeStyle = C.axis;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(46, r.y);
            ctx.lineTo(right, r.y);
            ctx.stroke();
            ctx.restore();
            text(ctx, r.name, 40, r.y + 4, r.color, 11, 'right', '600');
        });

        // Peak gradient amplitude, for a common vertical scale
        var peak = 1;
        blocks.forEach(function (b) {
            ['gx', 'gy', 'gz'].forEach(function (ch) {
                var t = p.trap[b[ch]];
                if (t) peak = Math.max(peak, Math.abs(t.amplitude));
            });
        });

        var tUs = 0;
        blocks.forEach(function (b, i) {
            var x0 = left + tUs * pxPerUs;
            var durUs = b.dur * p.blockRaster * 1e6;

            // block separator
            ctx.save();
            ctx.strokeStyle = C.grid;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(x0, 30);
            ctx.lineTo(x0, PSD_H - 34);
            ctx.stroke();
            ctx.restore();
            if (blocks.length <= 20) {
                text(ctx, String(b.id), x0 + durUs * pxPerUs / 2, 24, C.muted, 9, 'center');
            }

            // gradients
            [['gz', 108, C.gz], ['gy', 158, C.gy], ['gx', 208, C.gx]].forEach(function (spec) {
                var t = p.trap[b[spec[0]]];
                if (!t) return;
                var base = spec[1];
                var amp = (t.amplitude / peak) * 34;
                var sx = x0 + t.delay * pxPerUs;
                var r1 = sx + t.rise * pxPerUs;
                var r2 = r1 + t.flat * pxPerUs;
                var r3 = r2 + t.fall * pxPerUs;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(sx, base);
                ctx.lineTo(r1, base - amp);
                ctx.lineTo(r2, base - amp);
                ctx.lineTo(r3, base);
                ctx.closePath();
                ctx.fillStyle = spec[2];
                ctx.globalAlpha = 0.3;
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.strokeStyle = spec[2];
                ctx.lineWidth = 1.6;
                ctx.stroke();
                ctx.restore();
            });

            // RF: draw the real envelope when the shape is available
            if (b.rf && p.rf[b.rf]) {
                var ev = p.rf[b.rf];
                var shape = p.shapes[ev.magId];
                var rfRaster = Number(p.definitions.RadiofrequencyRasterTime) || 1e-6;
                var sx2 = x0 + (ev.delay || 0) * pxPerUs;
                ctx.save();
                ctx.strokeStyle = C.rf;
                ctx.lineWidth = 1.7;
                ctx.beginPath();
                if (shape && shape.samples.length > 1) {
                    var widthUs = shape.samples.length * rfRaster * 1e6;
                    var maxV = 0;
                    shape.samples.forEach(function (v) { maxV = Math.max(maxV, Math.abs(v)); });
                    if (maxV === 0) maxV = 1;
                    var step = Math.max(1, Math.floor(shape.samples.length / 220));
                    for (var s = 0; s < shape.samples.length; s += step) {
                        var px = sx2 + (s / shape.samples.length) * widthUs * pxPerUs;
                        var py = 54 - (shape.samples[s] / maxV) * 26;
                        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                    }
                } else {
                    ctx.moveTo(sx2, 54);
                    ctx.lineTo(sx2, 54 - 26);
                    ctx.lineTo(sx2 + durUs * pxPerUs * 0.6, 54 - 26);
                    ctx.lineTo(sx2 + durUs * pxPerUs * 0.6, 54);
                }
                ctx.stroke();
                ctx.restore();
                text(ctx, ev.use === 'r' ? '180°' : (ev.use === 'i' ? 'inv' : '90°'),
                     sx2, 34, C.rf, 10, 'left', '600');
            }

            // ADC window
            if (b.adc && p.adc[b.adc]) {
                var a = p.adc[b.adc];
                var ax = x0 + (a.delay || 0) * pxPerUs;
                var awUs = (a.num * a.dwell) / 1000;     // ns → µs
                ctx.save();
                ctx.fillStyle = C.adc;
                ctx.globalAlpha = 0.22;
                ctx.fillRect(ax, 246, awUs * pxPerUs, 24);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = C.adc;
                ctx.lineWidth = 1.4;
                ctx.strokeRect(ax, 246, awUs * pxPerUs, 24);
                ctx.restore();
                text(ctx, a.num + ' samples', ax + 4, 262, C.adc, 9, 'left');
            }

            tUs += durUs;
        });

        // time axis
        ctx.save();
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(left, PSD_H - 30);
        ctx.lineTo(right, PSD_H - 30);
        ctx.stroke();
        ctx.restore();
        var totalMs = totalUs / 1000;
        for (var t2 = 0; t2 <= 4; t2++) {
            var frac = t2 / 4;
            text(ctx, (totalMs * frac).toFixed(1), left + frac * (right - left),
                 PSD_H - 16, C.text, 9, 'center');
        }
        var caption = 'time (ms) — first repetition, ' + blocks.length + ' blocks';
        if (trimmedUs > 0) {
            caption += '  ·  trailing delay of ' + (trimmedUs / 1000).toFixed(1)
                     + ' ms not drawn';
        }
        text(ctx, caption, (left + right) / 2, PSD_H - 4, C.muted, 9, 'center');
    }

    var K_W = 420, K_H = 420;

    function drawKSpace(canvas, k) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, K_W, K_H);
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, K_W, K_H);

        var pts = k.path.filter(function (p) { return !p.jump; });
        if (!pts.length) {
            text(ctx, 'No gradient events to integrate', K_W / 2, K_H / 2, C.muted, 11, 'center');
            return;
        }

        var maxK = 1e-9;
        pts.forEach(function (p) {
            maxK = Math.max(maxK, Math.abs(p.x), Math.abs(p.y));
        });
        var pad = 40;
        var scale = (Math.min(K_W, K_H) / 2 - pad) / maxK;
        var cx = K_W / 2, cy = K_H / 2;

        // axes
        ctx.save();
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(pad, cy); ctx.lineTo(K_W - pad, cy);
        ctx.moveTo(cx, pad); ctx.lineTo(cx, K_H - pad);
        ctx.stroke();
        ctx.restore();

        // the path, segment by segment: sampled stretches stand out
        var prev = null;
        k.path.forEach(function (p) {
            if (p.jump) { prev = { x: 0, y: 0 }; return; }
            if (prev) {
                ctx.save();
                ctx.strokeStyle = p.adc ? C.accent : C.muted;
                ctx.globalAlpha = p.adc ? 0.95 : 0.35;
                ctx.lineWidth = p.adc ? 1.6 : 1;
                ctx.beginPath();
                ctx.moveTo(cx + prev.x * scale, cy - prev.y * scale);
                ctx.lineTo(cx + p.x * scale, cy - p.y * scale);
                ctx.stroke();
                ctx.restore();
            }
            prev = p;
        });

        text(ctx, 'kx (1/m)', K_W - pad, cy - 8, C.text, 9, 'right');
        text(ctx, 'ky', cx + 8, pad + 4, C.text, 9, 'left');
        text(ctx, '|k|max = ' + maxK.toFixed(1) + ' 1/m', K_W / 2, K_H - 12, C.muted, 9, 'center');

        // legend
        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(14, 18); ctx.lineTo(34, 18); ctx.stroke();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = C.muted;
        ctx.beginPath(); ctx.moveTo(14, 32); ctx.lineTo(34, 32); ctx.stroke();
        ctx.restore();
        text(ctx, 'ADC open', 40, 22, C.text, 9);
        text(ctx, 'traverse', 40, 36, C.text, 9);
    }

    // ═══════════════════════════════════════════════════════════════
    //  MARKUP
    // ═══════════════════════════════════════════════════════════════

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function dropzoneHTML() {
        return '<div class="insp-drop" data-role="drop">'
             + '<div class="insp-drop-icon" aria-hidden="true">⤓</div>'
             + '<h3>Drop a .seq file here</h3>'
             + '<p>It is parsed in your browser. Nothing is uploaded anywhere.</p>'
             + '<div class="insp-drop-actions">'
             + '<label class="insp-btn">Choose a file'
             + '<input type="file" accept=".seq,text/plain" data-role="file" hidden></label>'
             + '<button type="button" class="insp-btn is-ghost" data-role="example">'
             + 'Load the bundled spin echo</button>'
             + '</div>'
             + '<p class="insp-drop-note">The bundled file is a real 256-line spin echo — and '
             + 'it carries a genuine defect the sanity checks below will find. It is kept as '
             + 'a specimen, not as a reference implementation.</p>'
             + '</div>';
    }

    function summaryHTML(p, k) {
        var def = p.definitions;
        var fov = def.FOV ? def.FOV.split(/\s+/).map(function (v) {
            return (Number(v) * 1000).toFixed(0);
        }).join(' × ') + ' mm' : '—';

        var cards = [
            ['Name', def.Name || '—'],
            ['Pulseq version', p.version.major + '.' + p.version.minor + '.' + p.version.revision],
            ['Blocks', p.blocks.length.toLocaleString()],
            ['Duration', p.duration.toFixed(2) + ' s'],
            ['Excitations', String(k.excitations)],
            ['Refocusing pulses', String(k.refocusings)],
            ['ADC events', String(k.adcBlocks)],
            ['FOV', fov]
        ];

        var html = '<div class="insp-summary">';
        cards.forEach(function (c) {
            html += '<div class="insp-stat"><span class="insp-stat-label">' + c[0] + '</span>'
                  + '<strong>' + escapeHtml(c[1]) + '</strong></div>';
        });
        html += '</div>';
        return html;
    }

    function diagnosticsHTML(p, k) {
        var rows = diagnostics(p, k);
        if (!rows.length) return '';

        var icons = { ok: '✓', warn: '!', fail: '✗' };
        var html = '<div class="insp-section"><h3 class="insp-h">Sanity checks</h3>'
                 + '<p class="insp-lead">Not a timing check — the scanner would accept this '
                 + 'file either way. These look at whether the sequence samples where it '
                 + 'means to, which is the class of bug that survives every automated check '
                 + 'and only shows up in the image.</p>'
                 + '<div class="insp-checks">';

        rows.forEach(function (r) {
            html += '<div class="insp-check is-' + r.status + '">'
                  + '<span class="insp-check-icon">' + icons[r.status] + '</span>'
                  + '<div><strong>' + r.label + '</strong>'
                  + '<p>' + r.detail + '</p></div></div>';
        });

        html += '</div></div>';
        return html;
    }

    function definitionsHTML(p) {
        var html = '<div class="insp-section"><h3 class="insp-h">Header definitions</h3>'
                 + '<p class="insp-lead">Everything the scanner needs to know before it plays '
                 + 'a single block — above all the raster times the sequence was designed '
                 + 'against.</p>'
                 + '<div class="lp-table-scroll"><table class="lp-table"><thead><tr>'
                 + '<th>Key</th><th>Value</th></tr></thead><tbody>';
        Object.keys(p.definitions).sort().forEach(function (key) {
            html += '<tr><td>' + escapeHtml(key) + '</td><td>'
                  + escapeHtml(p.definitions[key]) + '</td></tr>';
        });
        html += '</tbody></table></div>';
        if (p.signature) {
            html += '<p class="insp-note">This file is signed: <code>md5 '
                  + escapeHtml(p.signature) + '</code>. The hash covers everything above the '
                  + '[SIGNATURE] section, so any edit invalidates it.</p>';
        }
        html += '</div>';
        return html;
    }

    function blocksHTML(p) {
        var start = blockPage * PAGE_SIZE;
        var slice = p.blocks.slice(start, start + PAGE_SIZE);
        var lastPage = Math.max(0, Math.ceil(p.blocks.length / PAGE_SIZE) - 1);

        var html = '<div class="insp-section"><h3 class="insp-h">The block list</h3>'
                 + '<p class="insp-lead">One row per block. The columns are <em>pointers</em> '
                 + 'into the event sections, not values — a zero means that channel is idle. '
                 + 'Hover a row to see it spelled out.</p>';

        html += '<div class="insp-blocks"><div class="lp-table-scroll">'
              + '<table class="lp-table insp-block-table"><thead><tr>'
              + '<th>#</th><th>dur</th><th>rf</th><th>gx</th><th>gy</th><th>gz</th>'
              + '<th>adc</th><th>ms</th></tr></thead><tbody>';

        slice.forEach(function (b) {
            html += '<tr class="insp-block-row" tabindex="0" data-block="' + b.id + '">'
                  + '<td>' + b.id + '</td><td>' + b.dur + '</td>'
                  + '<td class="' + (b.rf ? '' : 'is-zero') + '">' + b.rf + '</td>'
                  + '<td class="' + (b.gx ? '' : 'is-zero') + '">' + b.gx + '</td>'
                  + '<td class="' + (b.gy ? '' : 'is-zero') + '">' + b.gy + '</td>'
                  + '<td class="' + (b.gz ? '' : 'is-zero') + '">' + b.gz + '</td>'
                  + '<td class="' + (b.adc ? '' : 'is-zero') + '">' + b.adc + '</td>'
                  + '<td>' + (b.dur * p.blockRaster * 1000).toFixed(2) + '</td></tr>';
        });

        html += '</tbody></table></div>';
        html += '<div class="insp-block-detail" data-role="block-detail">'
              + 'Hover or focus a row.</div>';
        html += '</div>';

        html += '<div class="insp-pager">'
              + '<button type="button" class="insp-btn is-ghost" data-role="blocks-prev"'
              + (blockPage === 0 ? ' disabled' : '') + '>&larr; Previous</button>'
              + '<span>blocks ' + (start + 1) + '–' + Math.min(start + PAGE_SIZE, p.blocks.length)
              + ' of ' + p.blocks.length + '</span>'
              + '<button type="button" class="insp-btn is-ghost" data-role="blocks-next"'
              + (blockPage >= lastPage ? ' disabled' : '') + '>Next &rarr;</button>'
              + '</div></div>';
        return html;
    }

    function describeBlock(p, id) {
        var b = null;
        p.blocks.forEach(function (x) { if (x.id === id) b = x; });
        if (!b) return '';

        var parts = [];
        if (b.rf && p.rf[b.rf]) {
            var ev = p.rf[b.rf];
            var useName = { e: 'excitation', r: 'refocusing', i: 'inversion',
                            s: 'saturation', p: 'preparation' }[ev.use] || 'pulse';
            parts.push('<li><span class="insp-ch insp-ch-rf">RF</span> event ' + ev.id
                     + ' — ' + useName + ', ' + ev.amplitude.toFixed(0) + ' Hz, delay '
                     + ev.delay + ' µs, envelope from shape ' + ev.magId + '</li>');
        }
        [['gz', 'Gz'], ['gy', 'Gy'], ['gx', 'Gx']].forEach(function (spec) {
            var t = p.trap[b[spec[0]]];
            if (!t) return;
            parts.push('<li><span class="insp-ch insp-ch-' + spec[0] + '">' + spec[1]
                     + '</span> trapezoid ' + t.id + ' — ' + (t.amplitude / 1000).toFixed(1)
                     + ' kHz/m, ' + t.rise + '/' + t.flat + '/' + t.fall
                     + ' µs rise/flat/fall, area ' + trapArea(t).toFixed(1) + ' 1/m</li>');
        });
        if (b.adc && p.adc[b.adc]) {
            var a = p.adc[b.adc];
            parts.push('<li><span class="insp-ch insp-ch-adc">ADC</span> event ' + a.id
                     + ' — ' + a.num + ' samples, dwell ' + a.dwell + ' ns ('
                     + ((a.num * a.dwell) / 1e6).toFixed(2) + ' ms window), delay '
                     + a.delay + ' µs</li>');
        }
        if (!parts.length) {
            parts.push('<li><span class="insp-ch">—</span> a pure delay: nothing plays, the '
                     + 'block only occupies time</li>');
        }

        return '<div class="insp-block-detail-head">Block ' + b.id + ' · '
             + (b.dur * p.blockRaster * 1000).toFixed(2) + ' ms · ' + b.dur
             + ' ticks</div><ul class="insp-event-list">' + parts.join('') + '</ul>';
    }

    function resultsHTML(p, k) {
        var html = '<div class="insp-results">';

        html += summaryHTML(p, k);

        if (p.warnings.length) {
            html += '<div class="insp-warn">' + p.warnings.map(escapeHtml).join(' ') + '</div>';
        }

        html += diagnosticsHTML(p, k);

        html += definitionsHTML(p);

        html += '<div class="insp-section"><h3 class="insp-h">First repetition</h3>'
              + '<p class="insp-lead">The diagram is drawn from the events themselves: '
              + 'trapezoids from their rise/flat/fall times, the RF envelope decompressed from '
              + 'its shape.</p>'
              + '<div class="lp-canvas-frame"><canvas id="insp-psd" width="' + PSD_W
              + '" height="' + PSD_H + '" role="img" aria-label="Pulse sequence diagram of the '
              + 'first repetition"></canvas></div></div>';

        html += blocksHTML(p);

        html += '<div class="insp-section"><h3 class="insp-h">k-space</h3>'
              + '<p class="insp-lead">Obtained by integrating gradient areas block by block: '
              + 'an excitation resets k to the origin and a refocusing pulse mirrors it. This '
              + 'is the ground-truth method, and it stays correct on multi-shot sequences '
              + 'where <code>calculate_kspace()</code> draws later shots displaced.</p>'
              + '<div class="insp-kwrap"><div class="lp-canvas-frame"><canvas id="insp-k" width="'
              + K_W + '" height="' + K_H + '" role="img" aria-label="k-space trajectory">'
              + '</canvas></div></div></div>';

        html += '<div class="next-step">'
              + '<div class="next-step-label">Next in the path</div>'
              + '<h3>Back to the Builder</h3>'
              + '<p>You have seen what a finished sequence looks like from the inside. '
              + 'Configure your own, download the script, run it, and drop the .seq it writes '
              + 'back here.</p>'
              + '<button type="button" class="next-step-btn" data-tool="builder">'
              + 'Open the Builder &rarr;</button></div>';

        html += '</div>';
        return html;
    }

    // ═══════════════════════════════════════════════════════════════
    //  MOUNT
    // ═══════════════════════════════════════════════════════════════

    function buildHTML() {
        return '<div class="inspector-section">'
             + '<div class="sequence-header">'
             + '<h2 class="sequence-title">Seq Inspector</h2>'
             + '<p class="sequence-subtitle">Open a .seq and see what it actually tells the '
             + 'scanner to do.</p></div>'
             + dropzoneHTML()
             + '<div data-role="output"></div>'
             + '</div>';
    }

    function showError(root, message) {
        root.querySelector('[data-role="output"]').innerHTML =
            '<div class="insp-error"><strong>Could not read that file.</strong> '
            + escapeHtml(message) + '</div>';
    }

    function loadText(root, textBody, label) {
        try {
            parsed = parseSeq(textBody);
        } catch (err) {
            parsed = null;
            showError(root, err.message);
            return;
        }
        blockPage = 0;
        renderResults(root, label);
    }

    function renderResults(root, label) {
        var k = computeKSpace(parsed);
        var out = root.querySelector('[data-role="output"]');
        out.innerHTML = (label ? '<p class="insp-filename">' + escapeHtml(label) + '</p>' : '')
                      + resultsHTML(parsed, k);

        drawPSD(document.getElementById('insp-psd'), parsed);
        drawKSpace(document.getElementById('insp-k'), k);
        wireResults(root, label);
    }

    function wireResults(root, label) {
        var detail = root.querySelector('[data-role="block-detail"]');
        Array.prototype.forEach.call(root.querySelectorAll('.insp-block-row'), function (row) {
            function show() {
                detail.innerHTML = describeBlock(parsed, Number(row.dataset.block));
                Array.prototype.forEach.call(root.querySelectorAll('.insp-block-row'),
                    function (r) { r.classList.remove('is-active'); });
                row.classList.add('is-active');
            }
            row.addEventListener('mouseenter', show);
            row.addEventListener('focus', show);
        });

        var prev = root.querySelector('[data-role="blocks-prev"]');
        var next = root.querySelector('[data-role="blocks-next"]');
        if (prev) prev.addEventListener('click', function () {
            if (blockPage > 0) { blockPage--; renderResults(root, label); }
        });
        if (next) next.addEventListener('click', function () {
            var last = Math.ceil(parsed.blocks.length / PAGE_SIZE) - 1;
            if (blockPage < last) { blockPage++; renderResults(root, label); }
        });
    }

    function wire(root) {
        var drop = root.querySelector('[data-role="drop"]');
        var fileInput = root.querySelector('[data-role="file"]');

        function readFile(file) {
            var reader = new FileReader();
            reader.onload = function () { loadText(root, String(reader.result), file.name); };
            reader.onerror = function () { showError(root, 'The file could not be read.'); };
            reader.readAsText(file);
        }

        ['dragenter', 'dragover'].forEach(function (evName) {
            drop.addEventListener(evName, function (ev) {
                ev.preventDefault();
                drop.classList.add('is-over');
            });
        });
        ['dragleave', 'drop'].forEach(function (evName) {
            drop.addEventListener(evName, function (ev) {
                ev.preventDefault();
                drop.classList.remove('is-over');
            });
        });
        drop.addEventListener('drop', function (ev) {
            var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
            if (file) readFile(file);
        });

        fileInput.addEventListener('change', function () {
            if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
        });

        root.querySelector('[data-role="example"]').addEventListener('click', function () {
            // Opening index.html straight off disk blocks this fetch, so say so
            // rather than failing silently.
            fetch(EXAMPLE_URL)
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.text();
                })
                .then(function (body) { loadText(root, body, 'spin_echo_example.seq'); })
                .catch(function () {
                    showError(root, 'The bundled example needs the page to be served over '
                                  + 'http (a local file:// page cannot fetch it). Drop your '
                                  + 'own .seq on the box above instead.');
                });
        });

        root.addEventListener('click', function (ev) {
            var toolBtn = ev.target.closest('[data-tool]');
            if (toolBtn && window.openTool) window.openTool(toolBtn.dataset.tool);
        });
    }

    function initInspector() {
        var container = document.getElementById('content-container');
        if (!container) return;

        container.classList.add('fade-out');
        setTimeout(function () {
            container.innerHTML = buildHTML();
            var root = container.querySelector('.inspector-section');
            wire(root);
            // Keep whatever was already loaded when coming back to the tab
            if (parsed) renderResults(root, null);
            container.classList.remove('fade-out');
        }, 300);
    }

    window.initInspector = initInspector;
})();
