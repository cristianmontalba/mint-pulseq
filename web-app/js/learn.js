/**
 * LEARN — the "Learn Pulseq" section.
 *
 * Renders a six-page guide (why Pulseq, the .seq file, blocks, the raster
 * clock, simulation, the round trip) from `window.learnData`, with three
 * interactive widgets that a slide deck cannot do:
 *
 *   seq-anatomy    — hover a [BLOCKS] row, the events it points at light up
 *   block-anatomy  — pick a block of a TR, see what plays inside it
 *   raster-clock   — drag a duration, watch it land on or off the tick grid
 *
 * External coupling:
 *   - window.learnData       → content (js/data/learn.js)
 *   - window.initLearn(id)   → exposed for app.js
 *
 * Content lives in the data file. Keep this file to rendering and behaviour.
 */

(function () {
    'use strict';

    // ─── Palette (same values as the rest of the app) ───────────────
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
        ok:     '#22c55e',
        bad:    '#ef4444'
    };

    var currentPage = null;

    // ═══════════════════════════════════════════════════════════════
    //  PROGRESS
    //  Kept in localStorage so a returning reader sees where they got to.
    //  Every access is guarded: a private window, cleared site data or a
    //  browser blocking storage must not take the section down with it.
    // ═══════════════════════════════════════════════════════════════

    var PROGRESS_KEY = 'mint.learn.progress';

    function readProgress() {
        try {
            var raw = window.localStorage.getItem(PROGRESS_KEY);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function markDone(pageId) {
        try {
            var list = readProgress();
            if (list.indexOf(pageId) === -1) {
                list.push(pageId);
                window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(list));
            }
        } catch (e) {
            /* storage unavailable — progress simply isn't remembered */
        }
    }

    function isDone(pageId) {
        return readProgress().indexOf(pageId) !== -1;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SMALL HELPERS
    // ═══════════════════════════════════════════════════════════════

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function pageById(id) {
        var pages = window.learnData.pages;
        for (var i = 0; i < pages.length; i++) {
            if (pages[i].id === id) return pages[i];
        }
        return pages[0];
    }

    function pageIndex(id) {
        var pages = window.learnData.pages;
        for (var i = 0; i < pages.length; i++) {
            if (pages[i].id === id) return i;
        }
        return 0;
    }

    /** Draw a trapezoid on `ctx` between two x positions */
    function trapezoid(ctx, x0, x1, base, amp, color, ramp) {
        ramp = Math.min(ramp === undefined ? 14 : ramp, (x1 - x0) / 2);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x0, base);
        ctx.lineTo(x0 + ramp, base - amp);
        ctx.lineTo(x1 - ramp, base - amp);
        ctx.lineTo(x1, base);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    function text(ctx, str, x, y, color, size, align, weight) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = (weight ? weight + ' ' : '') + size + 'px Inter, sans-serif';
        ctx.textAlign = align || 'left';
        ctx.fillText(str, x, y);
        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════
    //  WIDGET 1 — .seq anatomy
    // ═══════════════════════════════════════════════════════════════

    function seqAnatomyHTML(d) {
        var html = '<div class="lp-widget lp-seq" data-widget="seq-anatomy">';
        html += '<p class="lp-widget-caption">' + d.caption + '</p>';

        html += '<div class="lp-seq-grid">';

        // [BLOCKS] — the driving table
        html += '<div class="lp-seq-panel lp-seq-blocks">';
        html += '<div class="lp-seq-head"><span class="lp-seq-name">[BLOCKS]</span>'
              + '<span class="lp-seq-hint">the to-do list</span></div>';
        html += '<table class="lp-seq-table"><thead><tr>';
        d.blocks.head.forEach(function (h) { html += '<th>' + h + '</th>'; });
        html += '</tr></thead><tbody>';
        d.blocks.rows.forEach(function (row, i) {
            html += '<tr class="lp-seq-row is-block" tabindex="0" data-refs="'
                  + row.refs.join(' ') + '" data-block="' + i + '">';
            row.cells.forEach(function (c, ci) {
                var zero = ci > 1 && c === '0';
                html += '<td class="' + (zero ? 'is-zero' : '') + '">' + c + '</td>';
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        html += '<p class="lp-seq-label" data-role="block-label">'
              + 'Every row is one block. A zero means nothing plays on that channel.</p>';
        html += '</div>';

        // The event sections it points at
        html += '<div class="lp-seq-events">';
        d.sections.forEach(function (sec) {
            html += '<div class="lp-seq-panel">';
            html += '<div class="lp-seq-head"><span class="lp-seq-name">' + sec.name + '</span>'
                  + '<span class="lp-seq-hint">' + sec.hint + '</span></div>';
            html += '<table class="lp-seq-table"><thead><tr>';
            sec.head.forEach(function (h) { html += '<th>' + h + '</th>'; });
            html += '</tr></thead><tbody>';
            sec.rows.forEach(function (row) {
                html += '<tr class="lp-seq-row is-event" data-key="' + row.key + '" title="'
                      + escapeHtml(row.label) + '">';
                row.cells.forEach(function (c) { html += '<td>' + c + '</td>'; });
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        });
        html += '</div>';

        html += '</div></div>';
        return html;
    }

    function wireSeqAnatomy(root, d) {
        var widget = root.querySelector('[data-widget="seq-anatomy"]');
        if (!widget) return;
        var labelEl = widget.querySelector('[data-role="block-label"]');
        var defaultLabel = labelEl.textContent;

        function clear() {
            Array.prototype.forEach.call(
                widget.querySelectorAll('.is-referenced'),
                function (el) { el.classList.remove('is-referenced'); }
            );
            Array.prototype.forEach.call(
                widget.querySelectorAll('.is-source'),
                function (el) { el.classList.remove('is-source'); }
            );
            labelEl.textContent = defaultLabel;
            labelEl.classList.remove('is-active');
        }

        function light(row) {
            clear();
            row.classList.add('is-source');
            row.dataset.refs.split(' ').forEach(function (key) {
                var target = widget.querySelector('.is-event[data-key="' + key + '"]');
                if (target) target.classList.add('is-referenced');
            });
            labelEl.textContent = d.blocks.rows[Number(row.dataset.block)].label;
            labelEl.classList.add('is-active');
        }

        Array.prototype.forEach.call(widget.querySelectorAll('.is-block'), function (row) {
            row.addEventListener('mouseenter', function () { light(row); });
            row.addEventListener('focus', function () { light(row); });
        });
        widget.querySelector('.lp-seq-blocks').addEventListener('mouseleave', clear);
    }

    // ═══════════════════════════════════════════════════════════════
    //  WIDGET 2 — block anatomy (PSD with selectable blocks)
    // ═══════════════════════════════════════════════════════════════

    var PSD_W = 820;
    var PSD_H = 300;
    // Relative widths of the five blocks of one TR
    var BLOCK_SPAN = [0.24, 0.16, 0.10, 0.28, 0.22];

    function blockBounds() {
        var left = 54, right = PSD_W - 12;
        var span = right - left;
        var out = [], x = left;
        BLOCK_SPAN.forEach(function (f) {
            out.push({ x0: x, x1: x + span * f });
            x += span * f;
        });
        return out;
    }

    function drawPSD(canvas, selected) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, PSD_W, PSD_H);
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, PSD_W, PSD_H);

        var b = blockBounds();
        var channels = [
            { name: 'RF', y: 56, color: C.rf },
            { name: 'Gz', y: 104, color: C.gz },
            { name: 'Gy', y: 152, color: C.gy },
            { name: 'Gx', y: 200, color: C.gx },
            { name: 'ADC', y: 248, color: C.adc }
        ];

        // Block columns: highlight the selected one
        b.forEach(function (bl, i) {
            ctx.save();
            ctx.fillStyle = i === selected ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.02)';
            ctx.fillRect(bl.x0, 26, bl.x1 - bl.x0, PSD_H - 52);
            ctx.strokeStyle = i === selected ? 'rgba(56,189,248,0.6)' : C.grid;
            ctx.lineWidth = i === selected ? 1.5 : 1;
            ctx.setLineDash(i === selected ? [] : [4, 4]);
            ctx.strokeRect(bl.x0, 26, bl.x1 - bl.x0, PSD_H - 52);
            ctx.restore();
            text(ctx, String(i + 1), (bl.x0 + bl.x1) / 2, 18,
                 i === selected ? C.accent : C.muted, 12, 'center', '700');
        });

        // Channel baselines and labels
        channels.forEach(function (ch) {
            ctx.save();
            ctx.strokeStyle = C.axis;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(48, ch.y);
            ctx.lineTo(PSD_W - 12, ch.y);
            ctx.stroke();
            ctx.restore();
            text(ctx, ch.name, 42, ch.y + 4, ch.color, 11, 'right', '600');
        });

        var dim = function (i) { return selected === null || selected === i ? 1 : 0.28; };

        // Block 1 — sinc on RF + slice-select Gz
        ctx.save();
        ctx.globalAlpha = dim(0);
        var c1 = (b[0].x0 + b[0].x1) / 2;
        ctx.strokeStyle = C.rf;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var i = 0; i <= 100; i++) {
            var u = -1 + (2 * i) / 100;
            var t = u * Math.PI * 2;
            var s = t === 0 ? 1 : Math.sin(t) / t;
            s *= 0.54 + 0.46 * Math.cos(Math.PI * u);
            var px = c1 + u * ((b[0].x1 - b[0].x0) / 2 - 14);
            var py = 56 - s * 26;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        trapezoid(ctx, b[0].x0 + 8, b[0].x1 - 8, 104, 26, C.gz);
        ctx.restore();

        // Block 2 — slice rephaser, phase encode, readout prephaser
        ctx.save();
        ctx.globalAlpha = dim(1);
        trapezoid(ctx, b[1].x0 + 6, b[1].x1 - 6, 104, -16, C.gz, 8);
        trapezoid(ctx, b[1].x0 + 6, b[1].x1 - 6, 152, 22, C.gy, 8);
        trapezoid(ctx, b[1].x0 + 6, b[1].x1 - 6, 152, 12, C.gy, 8);
        trapezoid(ctx, b[1].x0 + 6, b[1].x1 - 6, 152, -18, C.gy, 8);
        trapezoid(ctx, b[1].x0 + 6, b[1].x1 - 6, 200, -18, C.gx, 8);
        ctx.restore();

        // Block 3 — pure delay
        ctx.save();
        ctx.globalAlpha = dim(2);
        text(ctx, 'TE', (b[2].x0 + b[2].x1) / 2, 160, C.muted, 11, 'center', '600');
        ctx.restore();

        // Block 4 — readout + ADC
        ctx.save();
        ctx.globalAlpha = dim(3);
        trapezoid(ctx, b[3].x0 + 8, b[3].x1 - 8, 200, 32, C.gx);
        ctx.fillStyle = C.adc;
        ctx.globalAlpha = dim(3) * 0.25;
        ctx.fillRect(b[3].x0 + 22, 232, (b[3].x1 - b[3].x0) - 44, 16);
        ctx.globalAlpha = dim(3);
        ctx.strokeStyle = C.adc;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b[3].x0 + 22, 232, (b[3].x1 - b[3].x0) - 44, 16);
        text(ctx, 'ADC', (b[3].x0 + b[3].x1) / 2, 244, C.adc, 10, 'center', '600');
        ctx.restore();

        // Block 5 — spoiler + TR delay
        ctx.save();
        ctx.globalAlpha = dim(4);
        trapezoid(ctx, b[4].x0 + 8, b[4].x0 + 58, 104, 22, C.gz, 8);
        text(ctx, 'TR', b[4].x1 - 26, 160, C.muted, 11, 'center', '600');
        ctx.restore();

        text(ctx, 'blocks in series  ·  events in parallel', PSD_W / 2, PSD_H - 8,
             C.muted, 10, 'center');
    }

    function blockAnatomyHTML(d) {
        var html = '<div class="lp-widget lp-blocks" data-widget="block-anatomy">';
        html += '<p class="lp-widget-caption">' + d.caption + '</p>';
        html += '<div class="lp-canvas-frame">'
              + '<canvas id="lp-psd" width="' + PSD_W + '" height="' + PSD_H + '"'
              + ' role="img" aria-label="Pulse sequence diagram of one TR, five blocks"></canvas>'
              + '</div>';

        html += '<div class="lp-block-tabs" role="group" aria-label="Blocks of one TR">';
        d.blocks.forEach(function (bl, i) {
            html += '<button type="button" class="lp-block-tab" data-block="' + i + '"'
                  + ' aria-pressed="false"><span class="lp-block-n">' + (i + 1) + '</span>'
                  + bl.name + '</button>';
        });
        html += '</div>';

        html += '<div class="lp-block-detail" data-role="detail"></div>';
        html += '</div>';
        return html;
    }

    function wireBlockAnatomy(root, d) {
        var widget = root.querySelector('[data-widget="block-anatomy"]');
        if (!widget) return;
        var canvas = widget.querySelector('#lp-psd');
        var detail = widget.querySelector('[data-role="detail"]');
        var tabs = widget.querySelectorAll('.lp-block-tab');

        function select(index) {
            drawPSD(canvas, index);
            Array.prototype.forEach.call(tabs, function (t) {
                var on = Number(t.dataset.block) === index;
                t.classList.toggle('is-active', on);
                t.setAttribute('aria-pressed', on ? 'true' : 'false');
            });

            var bl = d.blocks[index];
            var html = '<div class="lp-block-detail-head">'
                     + '<h4>Block ' + (index + 1) + ' — ' + bl.name + '</h4>'
                     + '<span class="lp-block-dur">' + bl.duration + '</span></div>';
            html += '<ul class="lp-event-list">';
            bl.events.forEach(function (ev) {
                html += '<li><span class="lp-event-ch lp-ch-' + ev.ch.toLowerCase().replace('—', 'none')
                      + '">' + ev.ch + '</span>' + ev.text + '</li>';
            });
            html += '</ul>';
            html += '<p class="lp-block-note">' + bl.note + '</p>';
            detail.innerHTML = html;
        }

        Array.prototype.forEach.call(tabs, function (t) {
            t.addEventListener('click', function () { select(Number(t.dataset.block)); });
        });

        // Clicking the diagram itself selects the block under the pointer
        canvas.addEventListener('click', function (ev) {
            var rect = canvas.getBoundingClientRect();
            var x = ((ev.clientX - rect.left) / rect.width) * PSD_W;
            var bounds = blockBounds();
            for (var i = 0; i < bounds.length; i++) {
                if (x >= bounds[i].x0 && x <= bounds[i].x1) { select(i); return; }
            }
        });

        select(0);
    }

    // ═══════════════════════════════════════════════════════════════
    //  WIDGET 3 — the raster clock
    // ═══════════════════════════════════════════════════════════════

    var CLK_W = 820;
    var CLK_H = 230;

    function drawRaster(canvas, durationUs, raster) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, CLK_W, CLK_H);
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, CLK_W, CLK_H);

        var left = 40, right = CLK_W - 40, base = 168;
        var axisMax = 160;                       // µs shown across the plot
        var pxPerUs = (right - left) / axisMax;
        var ticks = Math.floor(durationUs / raster.us + 1e-9);
        var onGrid = Math.abs(durationUs / raster.us - Math.round(durationUs / raster.us)) < 1e-9;
        var color = onGrid ? C.ok : C.bad;

        // Tick grid. Draw every tick when it is legible, else every tenth.
        var spacing = raster.us * pxPerUs;
        var every = spacing >= 4 ? 1 : 10;
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        for (var k = 0; k * raster.us <= axisMax; k += every) {
            var gx = left + k * raster.us * pxPerUs;
            // The grid is the whole point of this widget, so keep it legible.
            ctx.strokeStyle = (k % (10 * every) === 0)
                ? 'rgba(255,255,255,0.34)'
                : 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.moveTo(gx, 42);
            ctx.lineTo(gx, base + 8);
            ctx.stroke();
        }
        ctx.restore();

        // Time axis
        ctx.save();
        ctx.strokeStyle = C.axis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left, base);
        ctx.lineTo(right, base);
        ctx.stroke();
        ctx.restore();
        for (var lbl = 0; lbl <= axisMax; lbl += 20) {
            text(ctx, String(lbl), left + lbl * pxPerUs, base + 24, C.text, 10, 'center');
        }
        text(ctx, 'time (µs)', (left + right) / 2, base + 44, C.text, 10, 'center');

        // The block itself
        var x1 = left + durationUs * pxPerUs;
        trapezoid(ctx, left, x1, base, 92, color, Math.min(16, (x1 - left) / 3));

        // Verdict
        var headline = onGrid
            ? durationUs.toFixed(1) + ' µs  =  ' + ticks + ' whole ticks'
            : durationUs.toFixed(1) + ' µs  =  ' + (durationUs / raster.us).toFixed(1) + ' ticks';
        text(ctx, onGrid ? '✓  starts on a tick, ends on a tick'
                         : '✗  ends between two ticks',
             left, 30, color, 13, 'left', '700');
        text(ctx, headline, left, base - 100, color, 12, 'left', '600');

        // Mark where the edge falls relative to the grid
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, 42);
        ctx.lineTo(x1, base + 8);
        ctx.stroke();
        ctx.restore();

        text(ctx, 'one tick = ' + raster.us + ' µs  (' + raster.label.toLowerCase() + ')',
             right, 30, C.text, 10, 'right');
    }

    function rasterClockHTML(d) {
        var html = '<div class="lp-widget lp-raster" data-widget="raster-clock">';
        html += '<p class="lp-widget-caption">' + d.caption + '</p>';

        html += '<div class="lp-raster-controls">';
        html += '<div class="lp-raster-pick" role="group" aria-label="Raster">';
        d.rasters.forEach(function (r, i) {
            html += '<button type="button" class="lp-raster-btn' + (i === 0 ? ' is-active' : '') + '"'
                  + ' data-raster="' + r.id + '" aria-pressed="' + (i === 0) + '">'
                  + r.label + ' <span>' + r.us + ' µs</span></button>';
        });
        html += '</div>';
        html += '<label class="lp-raster-slider">Block duration'
              + '<input type="range" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '"'
              + ' value="' + d.start + '" data-role="duration">'
              + '<output data-role="readout">' + d.start.toFixed(1) + ' µs</output></label>';
        html += '</div>';

        html += '<div class="lp-canvas-frame">'
              + '<canvas id="lp-raster-canvas" width="' + CLK_W + '" height="' + CLK_H + '"'
              + ' role="img" aria-label="A block drawn against the raster grid"></canvas>'
              + '</div>';

        html += '<div class="lp-raster-verdict" data-role="verdict"></div>';
        html += '</div>';
        return html;
    }

    function wireRasterClock(root, d) {
        var widget = root.querySelector('[data-widget="raster-clock"]');
        if (!widget) return;
        var canvas = widget.querySelector('#lp-raster-canvas');
        var slider = widget.querySelector('[data-role="duration"]');
        var readout = widget.querySelector('[data-role="readout"]');
        var verdict = widget.querySelector('[data-role="verdict"]');
        var buttons = widget.querySelectorAll('.lp-raster-btn');
        var raster = d.rasters[0];

        function update() {
            var duration = parseFloat(slider.value);
            readout.textContent = duration.toFixed(1) + ' µs';
            drawRaster(canvas, duration, raster);

            var quotient = duration / raster.us;
            var onGrid = Math.abs(quotient - Math.round(quotient)) < 1e-9;
            var fixed = Math.ceil(quotient) * raster.us;

            if (onGrid) {
                verdict.className = 'lp-raster-verdict is-ok';
                verdict.innerHTML = '<strong>check_timing() passes.</strong> '
                    + duration.toFixed(1) + ' µs is exactly ' + Math.round(quotient)
                    + ' ticks of ' + raster.us + ' µs, so the block can be played as written.';
            } else {
                verdict.className = 'lp-raster-verdict is-bad';
                verdict.innerHTML = '<strong>check_timing() fails — RASTER error.</strong> '
                    + duration.toFixed(1) + ' µs is ' + quotient.toFixed(2) + ' ticks of '
                    + raster.us + ' µs. The fix is one line: '
                    + '<code>np.ceil(duration / ' + raster.api + ') * ' + raster.api + '</code>'
                    + ' rounds it up to <strong>' + fixed.toFixed(1) + ' µs</strong>.';
            }
        }

        slider.addEventListener('input', update);
        Array.prototype.forEach.call(buttons, function (btn) {
            btn.addEventListener('click', function () {
                d.rasters.forEach(function (r) { if (r.id === btn.dataset.raster) raster = r; });
                Array.prototype.forEach.call(buttons, function (b) {
                    var on = b === btn;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                update();
            });
        });

        update();
    }

    // ═══════════════════════════════════════════════════════════════
    //  CONTENT BLOCK RENDERERS
    // ═══════════════════════════════════════════════════════════════

    function renderBlock(block) {
        var w = window.learnData.widgets;

        switch (block.type) {
            case 'prose':
                return '<div class="lp-prose">' + block.html + '</div>';

            case 'note':
                return '<div class="lp-note">' + block.html + '</div>';

            case 'cards': {
                var html = '<div class="lp-section">';
                if (block.title) html += '<h3 class="lp-section-title">' + block.title + '</h3>';
                html += '<div class="lp-cards" style="--lp-cols:' + (block.columns || 3) + '">';
                block.items.forEach(function (item) {
                    html += '<div class="lp-card">';
                    if (item.tag) html += '<span class="lp-card-tag">' + item.tag + '</span>';
                    html += '<h4>' + item.title + '</h4>';
                    if (item.sub) html += '<p class="lp-card-sub">' + item.sub + '</p>';
                    html += '<p>' + item.body + '</p></div>';
                });
                return html + '</div></div>';
            }

            case 'flow': {
                var html = '<div class="lp-section">';
                if (block.title) html += '<h3 class="lp-section-title">' + block.title + '</h3>';
                html += '<div class="lp-flow">';
                html += '<div class="lp-flow-col"><div class="lp-flow-label">'
                      + block.left.label + '</div>';
                block.left.items.forEach(function (i) {
                    html += '<div class="lp-flow-item">' + i + '</div>';
                });
                html += '</div>';
                html += '<div class="lp-flow-arrow" aria-hidden="true">&rarr;</div>';
                html += '<div class="lp-flow-hub"><strong>' + block.hub.label + '</strong>'
                      + '<span>' + block.hub.sub + '</span></div>';
                html += '<div class="lp-flow-arrow" aria-hidden="true">&rarr;</div>';
                html += '<div class="lp-flow-col"><div class="lp-flow-label">'
                      + block.right.label + '</div>';
                block.right.items.forEach(function (i) {
                    html += '<div class="lp-flow-item">' + i + '</div>';
                });
                html += '</div></div></div>';
                return html;
            }

            case 'steps': {
                var html = '<div class="lp-section">';
                if (block.title) html += '<h3 class="lp-section-title">' + block.title + '</h3>';
                html += '<ol class="lp-steps">';
                block.items.forEach(function (item, i) {
                    html += '<li><span class="lp-step-n">' + (i + 1) + '</span>'
                          + '<h4>' + item.title + '</h4><p>' + item.body + '</p></li>';
                });
                return html + '</ol></div>';
            }

            case 'table': {
                var html = '<div class="lp-section">';
                if (block.title) html += '<h3 class="lp-section-title">' + block.title + '</h3>';
                html += '<div class="lp-table-scroll"><table class="lp-table"><thead><tr>';
                block.head.forEach(function (h) { html += '<th scope="col">' + h + '</th>'; });
                html += '</tr></thead><tbody>';
                block.rows.forEach(function (row) {
                    html += '<tr>';
                    row.forEach(function (cell) { html += '<td>' + cell + '</td>'; });
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
                if (block.note) html += '<p class="lp-table-note">' + block.note + '</p>';
                return html + '</div>';
            }

            case 'widget':
                if (block.widget === 'seq-anatomy')   return seqAnatomyHTML(w.seqAnatomy);
                if (block.widget === 'block-anatomy') return blockAnatomyHTML(w.blockAnatomy);
                if (block.widget === 'raster-clock')  return rasterClockHTML(w.rasterClock);
                return '';

            default:
                return '';
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  PAGE MARKUP
    // ═══════════════════════════════════════════════════════════════

    /** The self-check question at the foot of a lesson */
    function checkHTML(check) {
        var html = '<div class="lp-check" data-role="check">';
        html += '<div class="lp-check-head">Check yourself</div>';
        html += '<p class="lp-check-q">' + check.question + '</p>';
        html += '<div class="lp-check-options">';
        check.options.forEach(function (opt, i) {
            html += '<button type="button" class="lp-check-opt" data-option="' + i + '">'
                  + '<span class="lp-check-letter">' + 'ABCDE'.charAt(i) + '</span>'
                  + '<span>' + opt + '</span></button>';
        });
        html += '</div>';
        html += '<div class="lp-check-explain" data-role="check-explain" hidden>'
              + check.explain + '</div>';
        html += '</div>';
        return html;
    }

    /** The "try it in the Builder" hand-off */
    function taskHTML(task) {
        return '<div class="lp-task">'
             + '<div class="lp-task-head">Try it</div>'
             + '<p>' + task.text + '</p>'
             + '<button type="button" class="lp-task-btn" data-role="task">'
             + task.label + ' &rarr;</button>'
             + '</div>';
    }

    /** A short clip anchored to this page, when videos.js carries one */
    function videoHTML(pageId) {
        if (!window.videoData) return '';
        var hit = null;
        window.videoData.forEach(function (v) {
            if (v.anchor && v.anchor.module === 'learn' && v.anchor.page === pageId) hit = v;
        });
        if (!hit) return '';
        return '<div class="lp-video">'
             + '<div class="lp-video-head">' + hit.title + '</div>'
             + '<div class="lp-video-frame">'
             + '<iframe src="' + hit.embedUrl + '" title="' + escapeHtml(hit.title) + '"'
             + ' allowfullscreen loading="lazy"></iframe></div>'
             + (hit.description ? '<p class="lp-video-desc">' + hit.description + '</p>' : '')
             + '</div>';
    }

    function buildHTML(page) {
        var pages = window.learnData.pages;
        var idx = pageIndex(page.id);
        var done = readProgress();
        var pct = Math.round((done.length / pages.length) * 100);

        var html = '<div class="learn-section">';

        html += '<div class="sequence-header">'
              + '<h2 class="sequence-title">' + page.title + '</h2>'
              + '<p class="sequence-subtitle">' + page.lead + '</p></div>';

        // Progress strip
        html += '<div class="lp-progress">'
              + '<div class="lp-progress-bar"><span style="width:' + pct + '%"></span></div>'
              + '<span class="lp-progress-text">' + done.length + ' of ' + pages.length
              + ' lessons completed</span>'
              + (done.length ? '<button type="button" class="lp-progress-reset"'
                             + ' data-role="reset-progress">Reset</button>' : '')
              + '</div>';

        // Tab strip
        html += '<nav class="lp-tabs" aria-label="Learn Pulseq pages">';
        pages.forEach(function (p, i) {
            var cls = 'lp-tab' + (p.id === page.id ? ' is-active' : '')
                    + (isDone(p.id) ? ' is-done' : '');
            html += '<button type="button" class="' + cls + '"'
                  + ' data-page="' + p.id + '" aria-current="' + (p.id === page.id) + '">'
                  + '<span class="lp-tab-n">' + (isDone(p.id) ? '✓' : (i + 1)) + '</span>'
                  + p.nav + '</button>';
        });
        html += '</nav>';

        html += '<div class="lp-body">';
        page.blocks.forEach(function (b) { html += renderBlock(b); });
        html += videoHTML(page.id);
        if (page.task) html += taskHTML(page.task);
        if (page.check) html += checkHTML(page.check);
        html += '</div>';

        // Prev / next
        html += '<div class="lp-pager">';
        html += idx > 0
            ? '<button type="button" class="lp-pager-btn" data-page="' + pages[idx - 1].id + '">'
              + '&larr; <span>' + pages[idx - 1].nav + '</span></button>'
            : '<span></span>';
        html += '<span class="lp-pager-count">' + (idx + 1) + ' / ' + pages.length + '</span>';
        html += idx < pages.length - 1
            ? '<button type="button" class="lp-pager-btn is-next" data-page="' + pages[idx + 1].id + '">'
              + '<span>' + pages[idx + 1].nav + '</span> &rarr;</button>'
            : '<span></span>';
        html += '</div>';

        // On the last page, hand the reader on to the next module
        if (idx === pages.length - 1) {
            html += nextStepHTML();
        }

        html += '</div>';
        return html;
    }

    /** The hand-off at the end of the section */
    function nextStepHTML() {
        return '<div class="next-step">'
             + '<div class="next-step-label">Next in the path</div>'
             + '<h3>Sequence Walkthrough</h3>'
             + '<p>You have the model. Now watch one real sequence — a 2D-DFT Cartesian spin '
             + 'echo — taken apart instant by instant, with the physics, the hardware and the '
             + 'Pulseq code side by side.</p>'
             + '<button type="button" class="next-step-btn" data-tool="walkthrough">'
             + 'Open the Walkthrough &rarr;</button>'
             + '</div>';
    }

    // ═══════════════════════════════════════════════════════════════
    //  MOUNT
    // ═══════════════════════════════════════════════════════════════

    function render(container, pageId) {
        var page = pageById(pageId);
        currentPage = page.id;
        container.innerHTML = buildHTML(page);

        var root = container.querySelector('.learn-section');
        var w = window.learnData.widgets;
        wireSeqAnatomy(root, w.seqAnatomy);
        wireBlockAnatomy(root, w.blockAnatomy);
        wireRasterClock(root, w.rasterClock);

        wireCheck(root, page);
        wireTask(root, page);

        root.addEventListener('click', function (ev) {
            // Page navigation — tabs and pager share one handler
            var pageBtn = ev.target.closest('[data-page]');
            if (pageBtn) {
                render(container, pageBtn.dataset.page);
                container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }

            // Hand-off to another module
            var toolBtn = ev.target.closest('[data-tool]');
            if (toolBtn && window.openTool) {
                window.openTool(toolBtn.dataset.tool);
                return;
            }

            // Clear the saved progress
            if (ev.target.closest('[data-role="reset-progress"]')) {
                try {
                    window.localStorage.removeItem(PROGRESS_KEY);
                } catch (e) { /* nothing to clear */ }
                render(container, currentPage);
            }
        });
    }

    /** Self-check: reveal the verdict, and bank the lesson when it is right */
    function wireCheck(root, page) {
        var wrap = root.querySelector('[data-role="check"]');
        if (!wrap || !page.check) return;
        var explain = wrap.querySelector('[data-role="check-explain"]');
        var options = wrap.querySelectorAll('.lp-check-opt');

        Array.prototype.forEach.call(options, function (btn) {
            btn.addEventListener('click', function () {
                var picked = Number(btn.dataset.option);
                var right = picked === page.check.answer;

                Array.prototype.forEach.call(options, function (o) {
                    var i = Number(o.dataset.option);
                    o.classList.toggle('is-right', i === page.check.answer);
                    o.classList.toggle('is-wrong', i === picked && !right);
                    o.disabled = true;
                });

                explain.removeAttribute('hidden');
                wrap.classList.add(right ? 'is-correct' : 'is-incorrect');

                // A lesson counts as done once its question has been answered
                // correctly. A wrong answer reveals the explanation but banks
                // nothing, so the tab keeps its number until the reader retries.
                if (right) {
                    markDone(page.id);
                    var tab = root.querySelector('.lp-tab[data-page="' + page.id + '"]');
                    if (tab) {
                        tab.classList.add('is-done');
                        tab.querySelector('.lp-tab-n').textContent = '✓';
                    }
                }
            });
        });
    }

    /** "Try it": open the Builder already configured for this lesson */
    function wireTask(root, page) {
        var btn = root.querySelector('[data-role="task"]');
        if (!btn || !page.task) return;
        btn.addEventListener('click', function () {
            if (window.openTool) window.openTool('builder', page.task.preset);
        });
    }

    function initLearn(pageId) {
        var container = document.getElementById('content-container');
        if (!container) return;

        if (!window.learnData) {
            container.innerHTML = '<p>The learn.js data module is not loaded.</p>';
            return;
        }

        container.classList.add('fade-out');
        setTimeout(function () {
            render(container, pageId || currentPage || window.learnData.pages[0].id);
            container.classList.remove('fade-out');
        }, 300);
    }

    window.initLearn = initLearn;
})();
