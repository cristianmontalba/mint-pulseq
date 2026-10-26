/**
 * COMPOSER — assembles the final script from blocks.
 *
 *   window.pulseqTemplates.compose(params)        → the .py  (PyPulseq)
 *   window.pulseqTemplates.composeMatlab(params)  → the .m   (Pulseq for MATLAB)
 *
 * Both walk the same assembly order, so the two exports describe the same
 * sequence:
 *
 *   1. common.preamble(params)          → imports / header (+ validation helpers)
 *   2. common.body(params)              → scan params, system limits, seq object
 *   3. excitations.<type>.events(p)     → RF pulses and slice-selection lobes
 *   4. trajectories.<type>.events(p)    → readout events and `time_to_echo`
 *   5. excitations.<type>.timing(p)     → TE / TI delays, from `time_to_echo`
 *   6. trajectories.<type>.loop(p)      → the acquisition loop
 *   7. common.footer(params)            → validation report, timing check,
 *                                         definitions, write
 *
 * Steps 3-6 interleave on purpose: the delays (5) need the readout (4), and
 * the readout needs the slice-selection lobes (3).
 *
 * Python: steps 2-7 are written column-0-relative and get indented by 4 spaces
 * as a block so they land inside the `def main():` body; step 1 and the
 * closing `if __name__ == '__main__':` stay at column 0.
 * MATLAB: a flat script; the validation helpers are local functions appended
 * by the MATLAB footer.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    function indentBlock(text, spaces) {
        const pad = ' '.repeat(spaces);
        return text.split('\n').map(line => (line.length ? pad + line : line)).join('\n');
    }

    // Resolve the two block objects for `params` out of one template set
    // (`{ common, excitations, trajectories }`), failing with a clear message.
    function pick(set, params, what) {
        if (!set || !set.common || !set.excitations || !set.trajectories) {
            throw new Error(`Missing ${what} template blocks. Verify that the template scripts are loaded.`);
        }
        const excitation = set.excitations[params.excitation];
        const trajectory = set.trajectories[params.trajectory];
        if (!excitation) throw new Error('Unknown excitation: ' + params.excitation);
        if (!trajectory) throw new Error('Unknown trajectory: ' + params.trajectory);
        return { common: set.common, excitation, trajectory };
    }

    // Steps 2-7, in the order documented above.
    function bodyParts(blocks, params) {
        return [
            blocks.common.body(params),
            blocks.excitation.events(params),
            blocks.trajectory.events(params),
            blocks.excitation.timing(params),
            blocks.trajectory.loop(params),
            blocks.common.footer(params)
        ].join('\n\n');
    }

    function compose(params) {
        const t = window.pulseqTemplates;
        const blocks = pick(t, params, 'PyPulseq');

        return [
            blocks.common.preamble(params),
            indentBlock(bodyParts(blocks, params), 4),
            '',
            '',
            "if __name__ == '__main__':",
            // A multi-slice or 3D sequence must NOT force plots on here — that would
            // override the defaults chosen in the preamble and hand the user back the
            // freeze the guard exists to prevent.
            (params.dimension === '3D' || (params.nSlices || 1) > 1)
                ? '    main(write_seq=True, save_report=True)  # plots off: large sequence'
                : '    main(plot=True, write_seq=True, save_plots=True, save_report=True)',
            ''
        ].join('\n');
    }

    function composeMatlab(params) {
        const blocks = pick(window.pulseqTemplates.matlab, params, 'MATLAB');
        return [
            blocks.common.preamble(params),
            '',
            bodyParts(blocks, params),
            ''
        ].join('\n');
    }

    /**
     * Console protocols (js/data/protocols.js): a whole-script template per
     * protocol, not the seven-step assembly above.
     *   composeProtocol(id, params, 'py' | 'm') → the script string
     *   protocolFileName(id, 'py' | 'm')        → MATLAB-safe file name
     */
    const PROTOCOL_TEMPLATES = { t2_tse_tra: 'tse', t1_mprage_3d: 'mprage' };

    function composeProtocol(id, params, lang) {
        const t = window.pulseqTemplates;
        const key = PROTOCOL_TEMPLATES[id];
        if (!key) throw new Error('Unknown protocol: ' + id);
        const set = lang === 'm' ? (t.matlab && t.matlab.protocols) : t.protocols;
        if (!set || !set[key]) {
            throw new Error(`Missing ${lang === 'm' ? 'MATLAB' : 'PyPulseq'} protocol templates. Verify that the template scripts are loaded.`);
        }
        return set[key](params);
    }

    function protocolFileName(id, lang) {
        const proto = window.mintProtocols.get(id);
        return `${window.pulseqTemplates.common.safeMatlabName(proto.fileBase)}.${lang === 'm' ? 'm' : 'py'}`;
    }

    window.pulseqTemplates.composeProtocol = composeProtocol;
    window.pulseqTemplates.protocolFileName = protocolFileName;
    window.pulseqTemplates.compose = compose;
    window.pulseqTemplates.composeMatlab = composeMatlab;
})();
