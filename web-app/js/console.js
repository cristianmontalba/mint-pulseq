/**
 * CONSOLE — the Sequence Builder's Console view.
 *
 * Edits the console protocols of js/data/protocols.js the way a scanner
 * console edits a protocol card: a protocol queue on the left, the card with
 * its tabs in the middle, the derived values and one picture of the timing on
 * the right, and the live Pulseq script underneath.
 *
 * Layout (one screen):
 *   header   MINT · Sequence Builder · Console view · exam    [Free builder | Console + Pulseq] [TA]
 *   export   card footer: Export .txt (the protocol summary); the Pulseq script
 *            header: the shared bar Download .py / .m / .txt (js/downloads.js)
 *   left     PROTOCOL QUEUE: one entry per sequence of the exam (× removes one),
 *            the exam's total TA, and "+ New sequence", which opens the
 *            prefabricated sequences (T2 TSE, MPRAGE) and adds a copy with
 *            factory values (t2_tse_tra_2, …, with its own file names)
 *   System   tab: scanner preset buttons + the six limits and B0, editable;
 *            shared by both protocols, and every range follows them
 *   centre   protocol card: tabs, a two-column grid of parameter cards, export
 *   right    SUMMARY rows, ONE ECHO TRAIN / ONE INVERSION diagram, MINT verdict
 *
 * Inputs are never re-rendered while typing: an edit recomputes derive() and
 * repaints only the text around the inputs, so focus and caret stay put.
 *
 * External coupling:
 *   - window.mintProtocols                         → registry + derive()
 *   - window.pulseqTemplates.composeProtocol()     → .py / .m strings
 *   - window.pulseqTemplates.protocolFileName()    → MATLAB-safe file names
 *   - window.pulseqTemplates.system.preset('disc') → the scanner
 *   - window.initBuilder()                         → "Free builder" in the view switch
 *   - window.initConsole(protocolId?)              → exposed here
 */

(function () {
    'use strict';

    const P = () => window.mintProtocols;
    const TABS = ['Routine', 'Contrast', 'Resolution', 'Geometry', 'System', 'Sequence'];

    // Module state: survives leaving and re-entering the view.
    const state = {
        // The protocol queue: one entry per sequence of the exam. `type` is a
        // protocol id of js/data/protocols.js; `name` is what the queue and the
        // card show; `suffix` ('' or '_2', '_3', …) goes into the file names.
        // The exam starts with one blank sequence; T2 TSE / MPRAGE are added
        // from the "load a prefabricated one" links.
        queue: [
            { uid: 'q1', type: 'custom', name: 'new_sequence_1', suffix: '' }
        ],
        nextUid: 2,
        current: 'q1',             // uid of the selected queue entry
        tab: 'Routine',
        lang: 'm',                 // language of the code preview
        saved: {},                 // uid → file name of the last download, for the hint
        system: null,              // scanner limits + b0, shared by both protocols (one exam, one scanner)
        loaded: null,              // uid just added with "New sequence" (one NOTE line)
        params: {},                // uid → params object
        fill: {}                   // uid → k-space fill step shown (0 = all)
    };

    const entry = (uid) => state.queue.find((e) => e.uid === uid) || state.queue[0];
    const protoOf = (uid) => P().get(entry(uid).type);

    function params(uid) {
        if (!state.params[uid]) state.params[uid] = JSON.parse(JSON.stringify(protoOf(uid).defaults));
        return state.params[uid];
    }

    const safeName = (t) => window.pulseqTemplates.common.safeMatlabName(t);
    const subtitle = (ev) => (ev.proto.describe ? ev.proto.describe(ev.p) : ev.proto.subtitle);
    const visible = (c, p) => !c.show || c.show(p);

    /** What the queue, the card and the files call an entry. A blank sequence uses the name typed on its card. */
    function displayName(uid) {
        const e = entry(uid);
        if (P().get(e.type).blank) {
            const typed = params(uid).name;
            return typed && String(typed).trim() ? safeName(typed) : e.name;
        }
        return e.name;
    }

    /** "+ New sequence": a blank sequence (new_sequence_1, _2, …) opened on Routine. */
    function addBlank() {
        const used = state.queue.filter((e) => e.type === 'custom').map((e) => Number(e.name.split('_').pop()) || 0);
        const n = used.length ? Math.max(...used) + 1 : 1;
        const uid = 'q' + (state.nextUid++);
        state.queue.push({ uid, type: 'custom', name: `new_sequence_${n}`, suffix: '' });
        state.params[uid] = JSON.parse(JSON.stringify(P().custom.defaults));
        state.current = uid;
        state.tab = 'Routine';
        state.loaded = uid;
    }

    /** Add a prefabricated sequence to the queue with its factory parameters. */
    function addToQueue(type) {
        const proto = P().get(type);
        const same = state.queue.filter((e) => e.type === type);
        const n = same.length ? Math.max(...same.map((e) => Number(e.suffix.slice(1)) || 1)) + 1 : 1;
        const suffix = n > 1 ? `_${n}` : '';
        const uid = 'q' + (state.nextUid++);
        state.queue.push({ uid, type, name: proto.title + suffix, suffix });
        state.params[uid] = JSON.parse(JSON.stringify(proto.defaults));
        state.current = uid;
        state.tab = 'Routine';
        state.loaded = uid;
    }

    function removeFromQueue(uid) {
        if (state.queue.length < 2) return;
        const i = state.queue.findIndex((e) => e.uid === uid);
        if (i < 0) return;
        state.queue.splice(i, 1);
        delete state.params[uid];
        delete state.saved[uid];
        if (state.current === uid) state.current = state.queue[Math.min(i, state.queue.length - 1)].uid;
    }

    /** The scanner of this exam: limits chosen on the System tab. */
    function preset() {
        if (!state.system) state.system = P().systemFromPreset(P().presetId);
        return P().scanner(state.system);
    }

    /** The parameters handed to the script templates: protocol values + scanner. */
    function scriptParams(ev) {
        return Object.assign({}, ev.p, { system: Object.assign({}, state.system), fileBase: fileBase() });
    }

    // Scanner limits on the System tab, in the Free builder's units.
    const SYS_CARDS = [
        { key: 'maxGrad', label: 'Max grad', unit: 'mT/m', step: 0.1 },
        { key: 'maxSlew', label: 'Max slew', unit: 'T/m/s', step: 1 },
        { key: 'maxB1', label: 'Max B1', unit: 'µT', step: 0.1 },
        { key: 'rfRingdownTime', label: 'RF ringdown', unit: 'µs', step: 1, zeroOk: true },
        { key: 'rfDeadTime', label: 'RF dead time', unit: 'µs', step: 1, zeroOk: true },
        { key: 'adcDeadTime', label: 'ADC dead time', unit: 'µs', step: 1, zeroOk: true },
        { key: 'b0', label: 'B0 (field strength)', unit: 'T', step: 0.01 }
    ];

    function sysProblem(c, v) {
        if (!Number.isFinite(v)) return 'Enter a number.';
        if (c.zeroOk ? v < 0 : v <= 0) return c.zeroOk ? 'Cannot be negative.' : 'Must be above zero.';
        return '';
    }

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // ─── Card-level validation ───────────────────────────────────────────
    function cardProblem(card, value, range) {
        if (value === '' || value === null || !Number.isFinite(value)) return 'Enter a number.';
        if (card.integer && !Number.isInteger(value)) return 'Must be a whole number.';
        if (card.even && value % 2 !== 0) return 'Must be even.';
        if (range && range.min !== null && range.min !== undefined && value < range.min - 1e-9) {
            return `Below the minimum ${P().fmt(range.min)}${card.unit ? ' ' + card.unit : ''}.`;
        }
        if (range && range.max !== null && range.max !== undefined && value > range.max + 1e-9) {
            return `Above the maximum ${P().fmt(range.max)}${card.unit ? ' ' + card.unit : ''}.`;
        }
        return '';
    }

    function rangeText(card, range) {
        if (!range) return '';
        const lo = range.min !== null && range.min !== undefined ? P().fmt(range.min) : '…';
        const hi = range.max !== null && range.max !== undefined ? P().fmt(range.max) : '…';
        const unit = card.unit ? ' ' + card.unit : '';
        return `Range ${lo} – ${hi}${unit}${range.why ? ` (${range.why})` : ''}`;
    }

    /** derive() plus the per-card problems; `blocked` stops the export. */
    function evaluate(uid) {
        const proto = protoOf(uid);
        const p = params(uid);
        let d;
        try {
            d = proto.derive(p, preset());
            if (!Number.isFinite(d.ta)) d.ta = NaN;
        } catch (err) {
            d = { rows: [], ranges: {}, messages: [{ level: 'ERROR', text: err.message }], ta: NaN, diagram: null, caption: '' };
        }
        const cardErrors = {};
        SYS_CARDS.forEach((c) => {
            const msg = sysProblem(c, state.system[c.key]);
            if (msg) cardErrors['sys-' + c.key] = { tab: 'System', label: c.label, msg };
        });
        TABS.forEach((tab) => {
            const cards = proto.tabs[tab];
            if (!Array.isArray(cards)) return;
            cards.forEach((c) => {
                if (c.kind !== 'edit' || !visible(c, p)) return;
                // A blank sequence's empty field is "still to fill", not an error.
                if (proto.blank && !Number.isFinite(p[c.key])) return;
                const msg = cardProblem(c, p[c.key], d.ranges[c.key]);
                if (msg) cardErrors[c.key] = { tab, label: c.label, msg };
            });
        });
        const incomplete = !!d.incomplete;
        const blocked = incomplete || Object.keys(cardErrors).length > 0 || d.messages.some((m) => m.level === 'ERROR');
        return { proto, p, d, cardErrors, blocked, incomplete, item: entry(uid), name: displayName(uid) };
    }

    // ─── HTML ────────────────────────────────────────────────────────────
    function queueHTML() {
        const items = state.queue.map((q) => {
            const ev = evaluate(q.uid);
            const ta = Number.isFinite(ev.d.ta) ? P().mmss(ev.d.ta) : '—';
            const name = displayName(q.uid);
            const status = ev.incomplete ? ' · <span class="mc-tag mc-tag-note">TO FILL</span>'
                : ev.blocked ? ' · <span class="mc-tag mc-tag-error">ERROR</span>' : '';
            const remove = state.queue.length > 1
                ? `<button type="button" class="mc-queue-remove" data-remove="${q.uid}" title="Remove ${esc(name)} from the queue" aria-label="Remove ${esc(name)}">&times;</button>`
                : '';
            return `
                <div class="mc-queue-row">
                    <button type="button" class="mc-queue-item${q.uid === state.current ? ' is-active' : ''}" data-protocol="${q.uid}">
                        <span class="mc-queue-name">${esc(name)}</span>
                        <span class="mc-queue-family">${esc(ev.proto.family)}</span>
                        <span class="mc-queue-ta">TA ${ta}${status}</span>
                    </button>${remove}
                </div>`;
        }).join('');
        const total = state.queue.reduce((sum, q) => { const ta = evaluate(q.uid).d.ta; return sum + (Number.isFinite(ta) ? ta : 0); }, 0);
        const prefab = P().list.map((proto) => `<button type="button" class="mc-link" data-prefab="${proto.id}"
                title="Add ${esc(proto.prefabLabel)} with its factory parameters">${esc(proto.prefabLabel)}</button>`).join(' · ');
        return `
            <div class="mc-panel-title">Protocol queue</div>${items}
            <p class="mc-queue-total">Exam total TA <strong class="mc-mono">${P().mmss(total)}</strong></p>
            <button type="button" class="mc-new-btn" data-new="blank" title="A blank sequence: choose the excitation, trajectory and parameters on the card">+ New sequence</button>
            <p class="mc-new-alt">or load a prefabricated one: ${prefab}</p>`;
    }

    function systemCards(ev) {
        const sys = window.pulseqTemplates.system;
        const s = preset();
        const buttons = sys.scannerPresets.map((p) => `
                    <button type="button" class="mc-preset-btn${s.presetId === p.id ? ' is-active' : ''}" data-sys-preset="${p.id}"
                            aria-pressed="${s.presetId === p.id}">${esc(p.label)}</button>`).join('');
        const presetCard = `
            <div class="mc-param mc-param-wide">
                <div class="mc-param-label">Scanner preset</div>
                <div class="mc-preset-row" role="group" aria-label="Scanner preset">${buttons}
                </div>
                <div class="mc-param-note" id="mc-sys-match">${esc(s.presetId ? `All limits match the ${s.label}.` : 'Custom limits: the values below do not match any preset.')}
                    Both protocols use these limits; the ranges on every tab follow them.</div>
            </div>`;
        const cards = SYS_CARDS.map((c) => {
            const err = ev.cardErrors['sys-' + c.key];
            return `
            <div class="mc-param is-edit${err ? ' has-error' : ''}" data-card="sys-${c.key}">
                <label class="mc-param-label" for="mc-sys-${c.key}">${esc(c.label)}</label>
                <div class="mc-param-input">
                    <input id="mc-sys-${c.key}" type="number" inputmode="decimal" data-sys-key="${c.key}"
                           step="${c.step}" value="${esc(state.system[c.key])}">
                    <span class="mc-unit">${esc(c.unit)}</span>
                </div>
                <div class="mc-param-error" data-error="sys-${c.key}">${err ? `<span class="mc-tag mc-tag-error">ERROR</span> ${esc(err.msg)}` : ''}</div>
            </div>`;
        }).join('');
        return presetCard + cards;
    }

    function cardsHTML(ev) {
        const cards = ev.proto.tabs[state.tab];
        if (cards === 'system') return systemCards(ev);
        return cards.filter((c) => visible(c, ev.p)).map((c) => {
            if (c.kind === 'choice') {
                const empty = !ev.p[c.key];
                return `
                <div class="mc-param is-edit${empty ? ' is-empty' : ''}" data-card="${c.key}">
                    <div class="mc-param-label">${esc(c.label)}</div>
                    <div class="mc-choice" role="group" aria-label="${esc(c.label)}">${c.options.map((o) => `
                        <button type="button" class="mc-choice-btn${ev.p[c.key] === o.value ? ' is-active' : ''}" data-choice="${c.key}" data-value="${o.value}"
                                aria-pressed="${ev.p[c.key] === o.value}">${esc(o.label)}</button>`).join('')}
                    </div>
                    ${empty ? '<div class="mc-param-note">Choose one.</div>' : (c.note ? `<div class="mc-param-note">${esc(c.note)}</div>` : '')}
                </div>`;
            }
            if (c.kind === 'text') {
                return `
                <div class="mc-param is-edit" data-card="${c.key}">
                    <label class="mc-param-label" for="mc-in-${c.key}">${esc(c.label)}</label>
                    <div class="mc-param-input">
                        <input id="mc-in-${c.key}" type="text" data-text="${c.key}" spellcheck="false" autocomplete="off"
                               placeholder="${esc(ev.item.name)}" value="${esc(ev.p[c.key] || '')}">
                    </div>
                    <div class="mc-param-note" data-name-note>${esc(c.note || '')}</div>
                </div>`;
            }
            if (c.kind === 'na') {
                return `
                <div class="mc-param is-na">
                    <div class="mc-param-label">${esc(c.label)}</div>
                    <div class="mc-param-value">—</div>
                    <div class="mc-param-note">Not in this protocol.</div>
                </div>`;
            }
            if (c.kind === 'fixed') {
                return `
                <div class="mc-param is-fixed">
                    <div class="mc-param-label">${esc(c.label)}</div>
                    <div class="mc-param-value" data-fixed="${esc(c.label)}">${esc(c.value(ev.p, ev.d))}</div>
                    ${c.note ? `<div class="mc-param-note">${esc(c.note)}</div>` : ''}
                </div>`;
            }
            const err = ev.cardErrors[c.key];
            const v = ev.p[c.key];
            const empty = ev.proto.blank && !Number.isFinite(v);
            return `
                <div class="mc-param is-edit${err ? ' has-error' : ''}${empty ? ' is-empty' : ''}" data-card="${c.key}">
                    <label class="mc-param-label" for="mc-in-${c.key}">${esc(c.label)}</label>
                    <div class="mc-param-input">
                        <input id="mc-in-${c.key}" type="number" inputmode="decimal" data-key="${c.key}"
                               step="${c.step || 'any'}" value="${Number.isFinite(v) ? esc(v) : ''}"${c.placeholder ? ` placeholder="${esc(c.placeholder)}"` : ''}>
                        <span class="mc-unit">${esc(c.unit || '')}</span>
                    </div>
                    <div class="mc-param-note" data-range="${c.key}">${esc(rangeText(c, ev.d.ranges[c.key]))}</div>
                    ${c.note ? `<div class="mc-param-note">${esc(c.note)}</div>` : ''}
                    <div class="mc-param-error" data-error="${c.key}">${err ? `<span class="mc-tag mc-tag-error">ERROR</span> ${esc(err.msg)}` : ''}</div>
                </div>`;
        }).join('');
    }

    function tabsHTML(ev) {
        return TABS.map((t) => {
            const bad = Object.values(ev.cardErrors).some((e) => e.tab === t);
            // Only an out-of-range value marks a tab; fields still to fill do not
            // (the MINT console and the dashed cards already say what is missing).
            const dot = bad ? ' <span class="mc-dot" title="A parameter on this tab is out of range">!</span>' : '';
            return `<button type="button" role="tab" class="mc-tab${t === state.tab ? ' is-active' : ''}" data-tab="${t}"
                        aria-selected="${t === state.tab}">${t}${dot}</button>`;
        }).join('');
    }

    function derivedHTML(ev) {
        if (!ev.d.rows.length) {
            return `<p class="mc-pv-legend">${ev.incomplete ? 'Fill in the card to see the matrix, timing and TA.' : 'Fix the ERROR lines to see the summary.'}</p>`;
        }
        return ev.d.rows.map(([k, v]) => `
            <div class="mc-derived-row"><span>${esc(k)}</span><span class="mc-mono">${esc(v)}</span></div>`).join('');
    }

    /** The MINT console lines: shown on screen and written into the .txt summary. */
    function messageLines(ev) {
        const lines = [];
        Object.values(ev.cardErrors).forEach((e) => {
            lines.push({ level: 'ERROR', text: `${e.label} (${e.tab}): ${e.msg}` });
        });
        // A range error already reported on its card is not repeated.
        ev.d.messages.forEach((m) => { if (!(m.key && ev.cardErrors[m.key])) lines.push(m); });
        if (state.loaded === state.current) {
            lines.push({ level: 'NOTE', text: ev.proto.blank
                ? `${ev.name} added: a blank sequence. Choose the excitation, trajectory and parameters on the card.`
                : `${ev.name} added to the queue with the ${ev.proto.prefabLabel} factory parameters.` });
        }
        if (ev.proto.blank && ev.p.name && String(ev.p.name).trim() && safeName(ev.p.name) !== String(ev.p.name).trim()) {
            lines.push({ level: 'NOTE', text: `Name saved as ${safeName(ev.p.name)}: MATLAB only runs files named with letters, digits and _.` });
        }
        if (!ev.incomplete && !lines.some((m) => m.level === 'ERROR' || m.level === 'WARNING')) {
            lines.unshift({ level: 'OK', text: 'Timing, gradient and B1 limits pass. The script will build with these values.' });
        }
        return lines;
    }

    function messagesHTML(ev) {
        return messageLines(ev).map((m) => `
            <div class="mc-msg mc-msg-${m.level.toLowerCase()}"><span class="mc-tag mc-tag-${m.level.toLowerCase()}">${m.level}</span><span>${esc(m.text)}</span></div>`).join('');
    }

    // ─── Diagram (SVG) ───────────────────────────────────────────────────
    function diagramSVG(dg) {
        if (!dg) return '';
        const W = 280, H = 74, base = 40, adcY = 50;
        const pulse = (x, h, cls) => `<path class="${cls}" d="M${x - 5} ${base} Q ${x} ${base - h} ${x + 5} ${base}" />`;
        let out = `<line class="mc-dg-axis" x1="4" y1="${base}" x2="${W - 4}" y2="${base}" />`;

        if (dg.type === 'tse') {
            const n = dg.etl;
            const x0 = 14;
            const step = (W - 28) / (n + 0.5);
            out += pulse(x0, 12, 'mc-dg-rf');
            out += `<text class="mc-dg-label" x="${x0}" y="${H - 2}" text-anchor="middle">90°</text>`;
            for (let i = 1; i <= n; i++) {
                const x = x0 + (i - 0.5) * step;
                out += pulse(x, 22, 'mc-dg-rf');
                const ax = x + step / 2;
                const w = Math.max(3, Math.min(14, step * 0.35));
                const cls = i === dg.centerEcho ? 'mc-dg-adc is-center' : 'mc-dg-adc';
                out += `<rect class="${cls}" x="${ax - w / 2}" y="${adcY}" width="${w}" height="7" rx="1" />`;
            }
            const cx = x0 + (dg.centerEcho - 0.5) * step + step / 2;
            out += `<text class="mc-dg-label is-center" x="${cx}" y="${H - 2}" text-anchor="middle">ky = 0</text>`;
        } else {
            const xInv = 14;
            out += pulse(xInv, 28, 'mc-dg-inv');
            out += `<text class="mc-dg-label" x="${xInv}" y="${H - 2}" text-anchor="middle">180°</text>`;
            const startX = 70, endX = W - 30;
            out += `<line class="mc-dg-gap" x1="${xInv + 8}" y1="${base - 18}" x2="${startX - 6}" y2="${base - 18}" />`;
            out += `<text class="mc-dg-label" x="${(xInv + startX) / 2}" y="${base - 22}" text-anchor="middle">TI</text>`;
            const n = dg.ny;
            const step = (endX - startX) / Math.max(1, n - 1);
            for (let i = 1; i <= n; i++) {
                const x = startX + (i - 1) * step;
                const center = i === dg.centerLine;
                out += `<line class="mc-dg-tick${center ? ' is-center' : ''}" x1="${x}" y1="${base}" x2="${x}" y2="${base - (center ? 14 : 8)}" />`;
                if (n <= 48 || center) {
                    out += `<rect class="mc-dg-adc${center ? ' is-center' : ''}" x="${x - 1.5}" y="${adcY}" width="3" height="7" />`;
                }
            }
            const cx = startX + (dg.centerLine - 1) * step;
            out += `<text class="mc-dg-label is-center" x="${cx}" y="${H - 2}" text-anchor="middle">ky = 0</text>`;
            out += `<text class="mc-dg-label" x="${W - 14}" y="${base - 4}" text-anchor="middle">…</text>`;
        }
        return `<svg class="mc-dg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Timing of ${dg.type === 'tse' ? 'one echo train' : 'one inversion'}">${out}</svg>`;
    }


    // ─── Sequence and trajectory preview (canvas, the Free builder's look) ─
    // The drawings come from simulator.js (window.mintPreview), so the console
    // and the Free builder share the navy canvas, grid, colours, ADC dots and
    // label bar. TSE / MPRAGE: data from proto.preview(); k-space fills echo by
    // echo (or inversion by inversion) with the stepper under the canvas. A
    // blank sequence: the Free builder's own drawings of its parameters.
    let fillTimer = null;

    function stopFill() {
        if (fillTimer) { clearInterval(fillTimer); fillTimer = null; }
    }

    function previewData(ev) {
        if (ev.blocked || !ev.proto.preview) return null;
        try { return ev.proto.preview(ev.p, preset()); } catch (err) { return null; }
    }

    /** Steps of the k-space fill: echoes (TSE) or inversions (MPRAGE). */
    function fillSteps(pv) {
        if (!pv) return 0;
        return pv.kspace.type === 'lines' ? pv.kspace.groups : pv.kspace.nz;
    }

    function stepperHTML(ev, pv) {
        if (ev.proto.blank || !pv) return '';
        const n = fillSteps(pv);
        const cur = state.fill[state.current] || 0;
        const unit = pv.kspace.type === 'lines' ? 'Echo' : 'Inversion';
        const shown = cur ? `${unit} ${cur} of ${n}` : `All ${n} ${unit === 'Echo' ? 'echoes' : 'inversions'}`;
        return `
            <div class="mc-fill" role="group" aria-label="k-space fill">
                <button type="button" class="mc-fill-btn" data-fill="prev" aria-label="Previous ${unit.toLowerCase()}">&#9664;</button>
                <span class="mc-fill-text mc-mono" id="mc-fill-text">${shown}</span>
                <button type="button" class="mc-fill-btn" data-fill="next" aria-label="Next ${unit.toLowerCase()}">&#9654;</button>
                <button type="button" class="mc-fill-play" data-fill="play">${fillTimer ? '&#9632; Stop' : '&#9654; Fill'}</button>
            </div>`;
    }

    function previewHTML(ev) {
        const pv = previewData(ev);
        const empty = ev.incomplete ? 'Fill in the parameters on the card to see the sequence.'
            : ev.blocked ? 'Fix the ERROR lines to see the sequence.' : '';
        return `
            <div class="mc-panel mc-preview">
                <div class="mc-panel-title">Sequence preview</div>
                <p class="mc-pv-sub" id="mc-psd-title">${esc(pv ? pv.psd.title : (ev.proto.blank && !ev.blocked ? 'One TR of the sequence you built' : ''))}</p>
                <div class="mc-canvas-wrap">
                    <canvas id="mc-psd-canvas" width="800" height="360" data-base-w="800" data-base-h="360" aria-label="Pulse sequence diagram"></canvas>
                    <p class="mc-canvas-empty" id="mc-psd-empty"${empty ? '' : ' hidden'}>${esc(empty)}</p>
                </div>
                <div class="mc-panel-title mc-pv-ktitle">Trajectory preview</div>
                <div class="mc-pv-krow">
                    <div class="mc-canvas-wrap mc-canvas-k">
                        <canvas id="mc-traj-canvas" width="400" height="400" data-base-w="400" data-base-h="400" aria-label="k-space trajectory"></canvas>
                        <p class="mc-canvas-empty" id="mc-traj-empty"${empty ? '' : ' hidden'}>${esc(empty)}</p>
                    </div>
                    <div class="mc-pv-side">
                        <div id="mc-stepper">${stepperHTML(ev, pv)}</div>
                        <p class="mc-pv-legend" id="mc-k-legend">${esc(pv ? pv.kspace.legend : '')}</p>
                    </div>
                </div>
            </div>`;
    }

    /** Size a canvas for the screen's pixel ratio (its drawing stays in base units). */
    function fitCanvas(canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Number(canvas.dataset.baseW), h = Number(canvas.dataset.baseH);
        if (canvas.width !== Math.round(w * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        canvas.dataset.dpr = String(dpr);
    }

    function blankCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawPreviews(ev) {
        const psd = document.getElementById('mc-psd-canvas');
        const traj = document.getElementById('mc-traj-canvas');
        if (!psd || !traj || !window.mintPreview) return;
        [psd, traj].forEach(fitCanvas);
        const empty = ev.incomplete ? 'Fill in the parameters on the card to see the sequence.'
            : ev.blocked ? 'Fix the ERROR lines to see the sequence.' : '';
        ['mc-psd-empty', 'mc-traj-empty'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) { el.hidden = !empty; el.textContent = empty; }
        });
        const legend = document.getElementById('mc-k-legend');
        const title = document.getElementById('mc-psd-title');
        if (empty) {
            blankCanvas(psd); blankCanvas(traj);
            if (legend) legend.textContent = '';
            if (title) title.textContent = '';
            set1('mc-stepper', '');
            return;
        }
        if (ev.proto.blank) {
            window.mintPreview.drawBuilder(psd, traj, ev.d.builder);
            if (title) title.textContent = 'One TR of the sequence you built (Free builder drawing)';
            if (legend) legend.textContent = 'The Free builder’s trajectory for this excitation and trajectory: lines or arms with the ADC samples in green.';
            set1('mc-stepper', '');
            return;
        }
        const pv = previewData(ev);
        if (!pv) { blankCanvas(psd); blankCanvas(traj); return; }
        const steps = fillSteps(pv);
        if ((state.fill[state.current] || 0) > steps) state.fill[state.current] = 0;
        window.mintPreview.drawPSD(psd, pv.psd, ev.proto.prefabLabel);
        window.mintPreview.drawKspace(traj, pv.kspace, state.fill[state.current] || 0);
        if (title) title.textContent = pv.psd.title;
        if (legend) legend.textContent = pv.kspace.legend;
        set1('mc-stepper', stepperHTML(ev, pv));
    }

    function set1(id, html) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    /** Step the k-space fill: 'prev' | 'next' | 'play'. */
    function fillAction(what) {
        const ev = evaluate(state.current);
        const pv = previewData(ev);
        if (!pv) return;
        const n = fillSteps(pv);
        const cur = state.fill[state.current] || 0;
        if (what === 'play') {
            if (fillTimer) { stopFill(); drawPreviews(ev); return; }
            const uid = state.current;
            state.fill[uid] = 1;
            drawPreviews(ev);
            fillTimer = setInterval(() => {
                if (state.current !== uid) { stopFill(); return; }
                const next = (state.fill[uid] || 0) + 1;
                if (next > n) { stopFill(); state.fill[uid] = 0; } else { state.fill[uid] = next; }
                drawPreviews(evaluate(uid));
            }, 400);
            return;
        }
        stopFill();
        let k = cur || (what === 'prev' ? n + 1 : 0);
        k += what === 'next' ? 1 : -1;
        state.fill[state.current] = k < 1 || k > n ? 0 : k;
        drawPreviews(ev);
    }

    function codeHTML() {
        return `
            <div class="mc-code">
                <div class="mc-code-head">
                    <div class="mc-panel-title">Pulseq script</div>
                    <div class="seg-switch" role="group" aria-label="Script language">
                        <button type="button" class="seg-btn${state.lang === 'm' ? ' is-active' : ''}" data-mc-lang="m" aria-pressed="${state.lang === 'm'}">MATLAB (.m)</button>
                        <button type="button" class="seg-btn${state.lang === 'py' ? ' is-active' : ''}" data-mc-lang="py" aria-pressed="${state.lang === 'py'}">Python (.py)</button>
                    </div>
                    ${window.mintDownloads.barHTML({ txt: false })}
                </div>
                ${window.mintDownloads.statusHTML()}
                <pre class="builder-preview mc-code-pre" id="mc-code-pre"></pre>
            </div>`;
    }

    function buildHTML() {
        const ev = evaluate(state.current);
        const s = preset();
        return `
        <div class="mc">
            <header class="mc-top">
                <div class="mc-brand">
                    <strong>MINT</strong>
                    <span>Sequence Builder · Console view</span>
                    <span class="mc-exam" id="mc-exam">Exam: ${esc(s.label)} · ${esc(s.b0)} T</span>
                </div>
                <div class="mc-top-right">
                    <div class="mc-switch" role="group" aria-label="View">
                        <button type="button" class="mc-switch-btn" data-view="builder" aria-pressed="false">Free builder</button>
                        <button type="button" class="mc-switch-btn is-active" aria-pressed="true">Console + Pulseq</button>
                    </div>
                    <div class="mc-ta" title="Acquisition time of the selected protocol"><span>TA</span> <strong id="mc-ta">${Number.isFinite(ev.d.ta) ? P().mmss(ev.d.ta) : '—'}</strong></div>
                </div>
            </header>

            <div class="mc-grid">
                <aside class="mc-panel mc-queue" id="mc-queue">${queueHTML()}</aside>

                <section class="mc-panel mc-card">
                    <div class="mc-card-head">
                        <span class="mc-card-title mc-mono" id="mc-card-title">${esc(ev.name)}</span>
                        <span class="mc-card-sub" id="mc-card-sub">${esc(subtitle(ev))}</span>
                    </div>
                    <div class="mc-tabs" role="tablist" id="mc-tabs">${tabsHTML(ev)}</div>
                    <div class="mc-params" id="mc-params">${cardsHTML(ev)}</div>
                    <div class="mc-card-foot">
                        <p>Dashed cards are console parameters this protocol does not implement.</p>
                        <button type="button" class="dl-btn" data-dl="txt" title="Protocol summary: every parameter, the summary and the MINT verdict">Export .txt</button>
                    </div>
                    <div class="mc-file-hint">${window.mintDownloads.statusHTML()}</div>
                </section>

                <aside class="mc-side">
                    <div class="mc-panel">
                        <div class="mc-panel-title">Summary</div>
                        <div id="mc-derived">${derivedHTML(ev)}</div>
                    </div>
                    ${ev.proto.blank ? '' : `<div class="mc-panel">
                        <div class="mc-panel-title" id="mc-dg-title">${esc(ev.proto.diagramTitle)}</div>
                        <div id="mc-diagram">${diagramSVG(ev.d.diagram)}</div>
                        <p class="mc-dg-caption" id="mc-dg-caption">${esc(ev.d.caption || '')}</p>
                    </div>`}
                    <div class="mc-panel">
                        <div class="mc-panel-title">MINT console</div>
                        <div id="mc-messages" aria-live="polite">${messagesHTML(ev)}</div>
                    </div>
                </aside>
            </div>
            <div class="mc-bottom">
                ${codeHTML()}
                ${previewHTML(ev)}
            </div>
        </div>`;
    }

    // ─── Partial repaint after an edit ───────────────────────────────────
    function refresh() {
        const ev = evaluate(state.current);
        const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        set('mc-queue', queueHTML());
        set('mc-derived', derivedHTML(ev));
        set('mc-diagram', diagramSVG(ev.d.diagram));
        set('mc-messages', messagesHTML(ev));
        const cardTitle = document.getElementById('mc-card-title');
        if (cardTitle) cardTitle.textContent = ev.name;
        const cardSub = document.getElementById('mc-card-sub');
        if (cardSub) cardSub.textContent = subtitle(ev);
        drawPreviews(ev);
        const ta = document.getElementById('mc-ta');
        if (ta) ta.textContent = Number.isFinite(ev.d.ta) ? P().mmss(ev.d.ta) : '—';

        // Tab error dots, without touching the active tab's inputs.
        set('mc-tabs', tabsHTML(ev));

        const exam = document.getElementById('mc-exam');
        if (exam) { const sc = preset(); exam.textContent = `Exam: ${sc.label} · ${sc.b0} T`; }
        if (ev.proto.tabs[state.tab] === 'system') {
            const sc = preset();
            document.querySelectorAll('.mc-preset-btn').forEach((b) => {
                const on = b.dataset.sysPreset === sc.presetId;
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-pressed', String(on));
            });
            const match = document.getElementById('mc-sys-match');
            if (match) {
                match.textContent = (sc.presetId ? `All limits match the ${sc.label}.` : 'Custom limits: the values below do not match any preset.') +
                    ' Both protocols use these limits; the ranges on every tab follow them.';
            }
            SYS_CARDS.forEach((c) => {
                const err = ev.cardErrors['sys-' + c.key];
                const card = document.querySelector(`.mc-param[data-card="sys-${c.key}"]`);
                if (card) card.classList.toggle('has-error', !!err);
                set2(`[data-error="sys-${c.key}"]`, err ? `<span class="mc-tag mc-tag-error">ERROR</span> ${esc(err.msg)}` : '');
            });
        }

        const cards = ev.proto.tabs[state.tab];
        if (Array.isArray(cards)) {
            cards.forEach((c) => {
                if (c.kind === 'edit') {
                    const card = document.querySelector(`.mc-param[data-card="${c.key}"]`);
                    const err = ev.cardErrors[c.key];
                    if (card) card.classList.toggle('has-error', !!err);
                    set2(`[data-range="${c.key}"]`, esc(rangeText(c, ev.d.ranges[c.key])));
                    set2(`[data-error="${c.key}"]`, err ? `<span class="mc-tag mc-tag-error">ERROR</span> ${esc(err.msg)}` : '');
                } else if (c.kind === 'fixed') {
                    const el = document.querySelector(`[data-fixed="${CSS.escape(c.label)}"]`);
                    if (el) el.textContent = c.value(ev.p, ev.d);
                }
            });
        }

        window.mintDownloads.update(document.querySelector('#content-container .mc'), {
            blocked: ev.blocked,
            incomplete: ev.incomplete,
            lang: state.lang,
            base: fileBase(),
            saved: state.saved[state.current]
        });
        updateCode(ev);
    }

    function set2(selector, html) {
        const el = document.querySelector(selector);
        if (el) el.innerHTML = html;
    }

    function updateCode(ev) {
        const pre = document.getElementById('mc-code-pre');
        if (!pre) return;
        const c = state.lang === 'm' ? '% ' : '# ';
        if (ev.incomplete) {
            pre.textContent = c + 'Fill in the parameters on the card to generate the script.';
            return;
        }
        if (ev.blocked) {
            pre.textContent = c + 'Fix the ERROR lines in the MINT console: with these values the script stops at an assert.';
            return;
        }
        try {
            pre.textContent = scriptText(ev, state.lang);
        } catch (err) {
            pre.textContent = (state.lang === 'm' ? '% ' : '# ') + 'Error generating code: ' + err.message;
        }
    }

    // ─── Downloads (shared bar: js/downloads.js) ─────────────────────────
    const fileBase = () => (protoOf(state.current).blank
        ? safeName(displayName(state.current))
        : safeName(protoOf(state.current).fileBase + entry(state.current).suffix));

    /** The script of the selected entry. A blank sequence goes through the Free builder's composer. */
    function scriptText(ev, lang) {
        if (ev.proto.blank) {
            const bp = Object.assign({}, ev.d.builder, { fileBase: fileBase() });
            return lang === 'm' ? window.pulseqTemplates.composeMatlab(bp) : window.pulseqTemplates.compose(bp);
        }
        return window.pulseqTemplates.composeProtocol(ev.proto.id, scriptParams(ev), lang);
    }

    /** Every tab of the card, the scanner, the summary and the verdict, as the .txt sections. */
    function summary(ev) {
        const s = preset();
        const sections = [];
        TABS.forEach((tab) => {
            const cards = ev.proto.tabs[tab];
            if (cards === 'system') {
                sections.push({
                    title: tab,
                    items: [['Scanner', s.presetId ? s.label : 'Custom limits']]
                        .concat(SYS_CARDS.map((c) => [c.label, `${state.system[c.key]} ${c.unit}`]))
                });
                return;
            }
            sections.push({
                title: tab,
                items: cards.filter((c) => visible(c, ev.p)).map((c) => {
                    if (c.kind === 'na') return [c.label, 'n/a'];
                    if (c.kind === 'fixed') return [c.label, c.value(ev.p, ev.d)];
                    if (c.kind === 'text') return [c.label, ev.name];
                    if (c.kind === 'choice') {
                        const o = c.options.find((x) => x.value === ev.p[c.key]);
                        return [c.label, o ? o.label : '-'];
                    }
                    return [c.label, `${ev.p[c.key]}${c.unit ? ' ' + c.unit : ''}`];
                })
            });
        });
        sections.push({
            title: 'Summary',
            items: ev.d.rows.concat([['TA', Number.isFinite(ev.d.ta) ? P().mmss(ev.d.ta) : '-']])
        });
        const base = fileBase();
        return window.mintDownloads.summaryText({
            title: 'MINT PROTOCOL SUMMARY',
            meta: [
                ['Protocol', ev.name],
                ['Sequence', subtitle(ev)],
                ['Scanner', `${s.label} (${s.b0} T)`],
                ['Generated', window.mintDownloads.stamp()],
                ['MINT view', 'Console + Pulseq']
            ],
            sections,
            messages: messageLines(ev),
            files: [
                ['MATLAB script', `${base}.m`],
                ['Python script', `${base}.py`],
                ['Scanner file', `${base}.seq`]
            ]
        });
    }

    function download(kind) {
        if (kind === 'script') kind = state.lang;   // the language the switch shows
        const ev = evaluate(state.current);
        if (ev.blocked) return;
        let text;
        let name;
        try {
            if (kind === 'txt') {
                text = summary(ev);
                name = window.mintDownloads.summaryName(fileBase());
            } else {
                text = scriptText(ev, kind);
                name = `${fileBase()}.${kind}`;
            }
        } catch (err) {
            alert('Could not generate the file: ' + err.message);
            return;
        }
        window.mintDownloads.save(name, text);
        state.saved[state.current] = name;
        refresh();
    }

    // ─── Listeners ───────────────────────────────────────────────────────
    function render() {
        stopFill();
        const container = document.getElementById('content-container');
        container.innerHTML = buildHTML();
        attach();
        refresh();
    }

    function attach() {
        const root = document.querySelector('#content-container .mc');
        if (!root) return;

        root.addEventListener('input', (ev) => {
            const sysInput = ev.target.closest('input[data-sys-key]');
            if (sysInput) {
                const raw = sysInput.value.trim();
                state.system[sysInput.dataset.sysKey] = raw === '' ? NaN : Number(raw);
                state.loaded = null;
                refresh();
                return;
            }
            const text = ev.target.closest('input[data-text]');
            if (text) {
                params(state.current)[text.dataset.text] = text.value;
                state.loaded = null;
                refresh();
                return;
            }
            const input = ev.target.closest('input[data-key]');
            if (!input) return;
            const raw = input.value.trim();
            params(state.current)[input.dataset.key] = raw === '' ? NaN : Number(raw);
            state.loaded = null;
            refresh();
        });

        root.addEventListener('click', (ev) => {
            const nw = ev.target.closest('[data-new]');
            if (nw) { stopFill(); addBlank(); render(); return; }
            const ch = ev.target.closest('[data-choice]');
            if (ch) {
                // A choice can show or hide other cards (TI, Venc, FoV z…): full repaint.
                params(state.current)[ch.dataset.choice] = ch.dataset.value;
                state.loaded = null;
                render();
                return;
            }
            const fl = ev.target.closest('[data-fill]');
            if (fl) { fillAction(fl.dataset.fill); return; }
            const pf = ev.target.closest('[data-prefab]');
            if (pf) { stopFill(); addToQueue(pf.dataset.prefab); render(); return; }
            const rm = ev.target.closest('[data-remove]');
            if (rm) { removeFromQueue(rm.dataset.remove); render(); return; }
            const sp = ev.target.closest('[data-sys-preset]');
            if (sp) {
                const b0 = state.system.b0;
                state.system = P().systemFromPreset(sp.dataset.sysPreset);
                // A preset without its own B0 keeps the field strength typed so far.
                if (!(window.pulseqTemplates.system.preset(sp.dataset.sysPreset).b0 > 0) && Number.isFinite(b0)) state.system.b0 = b0;
                render();
                return;
            }
            const q = ev.target.closest('[data-protocol]');
            if (q) { stopFill(); state.current = q.dataset.protocol; render(); return; }
            const t = ev.target.closest('[data-tab]');
            if (t) { state.tab = t.dataset.tab; render(); return; }
            // The same two-way switch as the Builder's: back to the free builder.
            if (ev.target.closest('[data-view="builder"]')) {
                if (window.initBuilder) window.initBuilder();
                return;
            }
            const l = ev.target.closest('[data-mc-lang]');
            if (l) { state.lang = l.dataset.mcLang; render(); return; }
            const x = ev.target.closest('[data-dl]');
            if (x) { download(x.dataset.dl); return; }
        });
    }

    // ─── Public entry point ──────────────────────────────────────────────
    function initConsole(protocolId) {
        const container = document.getElementById('content-container');
        if (!container || !window.mintProtocols) return;
        // A protocol type selects its first queue entry.
        const hit = protocolId && state.queue.find((e) => e.type === protocolId || e.uid === protocolId);
        if (hit) state.current = hit.uid;
        else if (protocolId && P().list.some((x) => x.id === protocolId)) addToQueue(protocolId);
        container.classList.add('fade-out');
        setTimeout(() => {
            render();
            container.classList.remove('fade-out');
        }, 300);
    }

    window.initConsole = initConsole;
})();
