/**
 * DOWNLOADS — the one download bar and the one protocol summary, shared by
 * the Free builder (js/builder.js) and Console + Pulseq (js/console.js).
 *
 * Both views show the same three buttons, in the same order, with the same
 * look and the same status line under them:
 *
 *   [MATLAB (.m) | Python (.py)]  [Download script] [Download .txt]
 *   (the language switch belongs to the caller; Download script follows it)
 *   Saves as <base>.m / .py / _protocol.txt. ...      (before)
 *   SAVED <file> is in your Downloads folder. ...     (after)
 *   ERROR Export is off until every value is in range. (blocked)
 *
 * The buttons share one neutral colour and turn accent blue on hover or
 * keyboard focus; none stays lit after a click — the SAVED line confirms it.
 *
 * The .txt is a protocol printout in a fixed, plain format (ASCII only, CRLF,
 * names padded with dots so every value starts in column 35). Both views
 * build it through summaryText(), so it reads the same wherever it comes from.
 *
 *   window.mintDownloads = {
 *       barHTML({ txt })                  → the buttons (txt: false → only .py / .m)
 *       statusHTML()                      → the empty status line(s)
 *       update(root, { blocked, incomplete, base, saved, lang })
 *       save(fileName, text)
 *       summaryText({ title, meta, sections, messages, files })
 *       summaryName(base)                 → '<base>_protocol.txt'
 *   }
 * The caller listens for clicks on [data-dl="script" | "txt"] and maps
 * 'script' to the language its switch shows.
 */

(function () {
    'use strict';

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // One script button: it downloads the language the MATLAB / Python switch
    // next to it shows (the caller turns 'script' into 'm' or 'py').
    const BUTTONS = [
        { kind: 'script', label: 'Download script', title: 'The script in the language selected on the left' },
        { kind: 'txt', label: 'Download .txt', title: 'Protocol summary (parameters, summary, MINT verdict)' }
    ];

    /** `opts.txt === false` leaves the summary button out (the console has its own Export .txt). */
    function barHTML(opts) {
        const list = opts && opts.txt === false ? BUTTONS.filter((b) => b.kind !== 'txt') : BUTTONS;
        return `<div class="dl-bar" role="group" aria-label="Downloads">${list.map((b) =>
            `<button type="button" class="dl-btn" data-dl="${b.kind}" title="${esc(b.title)}">${esc(b.label)}</button>`).join('')}</div>`;
    }

    function statusHTML() {
        return '<p class="dl-status" data-dl-status aria-live="polite"></p>';
    }

    const summaryName = (base) => `${base}_protocol.txt`;

    function statusText({ blocked, incomplete, base, saved }) {
        if (incomplete) {
            return '<span class="dl-tag dl-tag-note">NOTE</span> Fill in every parameter to export.';
        }
        if (blocked) {
            return '<span class="dl-tag dl-tag-error">ERROR</span> Export is off until every value is in range.';
        }
        if (saved) {
            const what = /\.m$/.test(saved)
                ? 'MATLAB only runs it under that exact name: if your browser added " (1)", rename it.'
                : /\.py$/.test(saved)
                    ? 'Run it with Python (PyPulseq installed); it writes the .seq next to itself.'
                    : 'It is the protocol summary: open it with any text editor, it does not run.';
            return `<span class="dl-tag dl-tag-ok">SAVED</span> <code>${esc(saved)}</code> is in your Downloads folder. ${what}`;
        }
        return `Saves as <code>${esc(base)}.m</code> / <code>.py</code> / <code>${esc(summaryName(base).slice(base.length))}</code>. ` +
            'MATLAB only runs a script whose name has no spaces or symbols: if your browser saves <code>… (1).m</code>, rename it.';
    }

    /** Enable / disable every download control under `root` and refresh its status lines. */
    function update(root, opts) {
        if (!root) return;
        root.querySelectorAll('[data-dl]').forEach((b) => {
            b.disabled = !!opts.blocked;
            if (b.dataset.dl === 'script' && opts.lang) {
                b.title = `Download ${opts.base}.${opts.lang} (${opts.lang === 'm' ? 'MATLAB' : 'Python'})`;
            }
        });
        const html = statusText(opts);
        root.querySelectorAll('[data-dl-status]').forEach((p) => { p.innerHTML = html; });
    }

    function save(fileName, text) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoking at once can cancel the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    // ─── The protocol summary (.txt) ─────────────────────────────────────
    const WIDTH = 58;
    const VALUE_COL = 34;   // 0-based: values start in column 35

    /** Plain ASCII, so Notepad, MATLAB fileread and Python all read it the same. */
    function ascii(text) {
        return String(text)
            .replace(/µ/g, 'u')
            .replace(/[×]/g, 'x')
            .replace(/\s*°/g, ' deg')
            .replace(/[–—]/g, '-')
            .replace(/≤/g, '<=').replace(/≥/g, '>=')
            .replace(/\s*·\s*/g, ', ')
            .replace(/…/g, '...')
            .replace(/→/g, '->')
            .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^\x20-\x7E]/g, '?');
    }

    function row(label, value) {
        const l = ascii(label);
        const head = l.length + 2 > VALUE_COL - 1 ? `${l} ..` : `${l} `.padEnd(VALUE_COL - 1, '.');
        return `${head} ${ascii(value)}`;
    }

    function heading(title) {
        return ['-'.repeat(WIDTH), ` ${ascii(title).toUpperCase()}`, '-'.repeat(WIDTH)];
    }

    /**
     * sections: [{ title, items: [[label, value], ...] }]
     * messages: [{ level: 'OK' | 'WARNING' | 'ERROR' | 'NOTE', text }]
     */
    function summaryText({ title, meta, sections, messages, files }) {
        const out = ['='.repeat(WIDTH), ` ${ascii(title || 'MINT PROTOCOL SUMMARY')}`, '='.repeat(WIDTH)];
        (meta || []).forEach(([k, v]) => out.push(row(k, v)));
        (sections || []).forEach((s) => {
            if (!s.items || !s.items.length) return;
            out.push('', ...heading(s.title));
            s.items.forEach(([k, v]) => out.push(row(k, v)));
        });
        if (messages && messages.length) {
            out.push('', ...heading('MINT validation'));
            messages.forEach((m) => out.push(`${ascii(m.level).padEnd(8)}${ascii(m.text)}`));
        }
        if (files && files.length) {
            out.push('', ...heading('Files'));
            files.forEach(([k, v]) => out.push(row(k, v)));
        }
        out.push('='.repeat(WIDTH), '');
        return out.join('\r\n');
    }

    /** Local date and time as YYYY-MM-DD HH:MM. */
    function stamp(d) {
        const t = d || new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
    }

    window.mintDownloads = { barHTML, statusHTML, update, save, summaryText, summaryName, stamp, ascii };
})();
