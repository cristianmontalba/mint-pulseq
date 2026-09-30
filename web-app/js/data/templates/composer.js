/**
 * COMPOSER — assembles the final .py script from blocks.
 *
 * The builder calls `window.pulseqTemplates.compose(params)` and receives
 * back the content of the .py file ready for download.
 *
 * Assembly order:
 *   1. common.preamble(params)    → imports + `def main(...):` signature + docstring
 *   2. common.body(params)        → scan params, system limits, seq object
 *   3. excitations.<type>(params) → RF pulse definitions, TE delay calcs
 *   4. trajectories.<type>(params)→ readout definitions + acquisition loop
 *   5. common.footer(params)      → timing check, report, definitions, write, return
 *
 * Steps 2-5 are written column-0-relative and get indented by 4 spaces as a
 * block so they land correctly inside the `def main():` body; step 1 and the
 * closing `if __name__ == '__main__':` stay at column 0.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    function indentBlock(text, spaces) {
        const pad = ' '.repeat(spaces);
        return text.split('\n').map(line => (line.length ? pad + line : line)).join('\n');
    }

    function compose(params) {
        const t = window.pulseqTemplates;

        // Validate that all block modules are loaded
        if (!t.common || !t.excitations || !t.trajectories) {
            throw new Error('Missing template blocks. Verify that common.js, excitations.js and trajectories.js are loaded.');
        }

        // Map form ids to block functions
        const excitationFn = t.excitations[params.excitation];
        const trajectoryFn = t.trajectories[params.trajectory];

        if (!excitationFn) throw new Error('Unknown excitation: ' + params.excitation);
        if (!trajectoryFn) throw new Error('Unknown trajectory: ' + params.trajectory);

        // Assemble the function body (everything that lives inside `def main():`)
        const bodyParts = [
            t.common.body(params),
            excitationFn(params),
            trajectoryFn(params),
            t.common.footer(params)
        ].join('\n\n');

        const indentedBody = indentBlock(bodyParts, 4);

        return [
            t.common.preamble(params),
            indentedBody,
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

    window.pulseqTemplates.compose = compose;
})();
