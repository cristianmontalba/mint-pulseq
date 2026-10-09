/**
 * NAMES — the single source of truth for gradient event names.
 *
 * Every gradient event the app emits or draws is named here, once, following
 * the full descriptive convention of Bernstein, King & Zhou, "Handbook of MRI
 * Pulse Sequences": the axis, then what the lobe is FOR, then what it IS.
 *
 *     g<axis>_<family>_<function>_<lobe | blip | crusher | spoiler | waveform>
 *
 * Two families exist and must never be confused:
 *
 *   imaging     lobes that encode the image itself
 *   phasecorr   lobes that acquire reference data to correct the image
 *               (three-echo navigators, EPI / TSE phase correction)
 *
 * The same identifier is used in the generated Python, in the generated
 * MATLAB, in the Builder's pulse diagram and in the glossary under it. To
 * rename an event, change `name` here and nothing else.
 *
 * Entry schema:
 *   key     short handle used by the template code (`N.gxPre`)
 *   name    the identifier written into the generated scripts
 *   was     the pre-standardization names it replaces
 *   axis    'x' | 'y' | 'z'
 *   family  'imaging' | 'slice' | 'phasecorr'
 *   label   human label for UI chips and diagram annotations
 *   short   one or two words for tight spaces (the PSD)
 *   about   one sentence saying what the event does
 *   status  'live'      emitted by at least one Builder template
 *           'reserved'  named by the convention, not emitted yet — use this
 *                       exact name when a template first needs it
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    const EVENTS = [
        // ── Slice selection (z) ─────────────────────────────────────
        {
            key: 'gz', name: 'gz_imaging_slice_selection_lobe', was: ['gz', 'gz_slice'],
            axis: 'z', family: 'imaging', status: 'live',
            label: 'Imaging slice-selection lobe', short: 'slice selection',
            about: 'Plays under the excitation pulse; the RF sits on its flat plateau and picks the slice.'
        },
        {
            key: 'gzReph', name: 'gz_slice_selection_rephasing_lobe', was: ['gz_reph'],
            axis: 'z', family: 'slice', status: 'live',
            label: 'Slice-selection rephasing lobe', short: 'slice rephasing',
            about: 'Minus half the slice-selection area: undoes the phase the selection lobe left across the slice.'
        },
        {
            key: 'gzRefoc', name: 'gz_refocusing_slice_selection_lobe', was: ['gz2'],
            axis: 'z', family: 'slice', status: 'live',
            label: 'Refocusing slice-selection lobe', short: 'refocus selection',
            about: 'Slice selection for the 180° refocusing pulse.'
        },
        {
            key: 'gzRefocReph', name: 'gz_refocusing_slice_selection_rephasing_lobe', was: ['gz2_reph'],
            axis: 'z', family: 'slice', status: 'live',
            label: 'Refocusing slice-selection rephasing lobe', short: 'refocus rephasing',
            about: 'The lobe played on z straight after the refocusing pulse.'
        },
        {
            key: 'gzInv', name: 'gz_inversion_slice_selection_lobe', was: ['gz_inv'],
            axis: 'z', family: 'slice', status: 'live',
            label: 'Inversion slice-selection lobe', short: 'inversion selection',
            about: 'Slice selection for the 180° inversion pulse.'
        },
        {
            key: 'gzInvReph', name: 'gz_inversion_slice_selection_rephasing_lobe', was: ['gz_inv_reph'],
            axis: 'z', family: 'slice', status: 'live',
            label: 'Inversion slice-selection rephasing lobe', short: 'inversion rephasing',
            about: 'The lobe played on z straight after the inversion pulse.'
        },
        {
            key: 'gzEnc', name: 'gz_imaging_slice_encoding_lobe', was: ['gz_encode', 'gz_phase'],
            axis: 'z', family: 'imaging', status: 'live',
            label: 'Imaging slice-encoding lobe', short: 'slice encoding',
            about: '3D only: the kz phase encode that picks one partition of the slab.'
        },
        {
            key: 'gzRew', name: 'gz_imaging_slice_rewinding_lobe', was: ['gz_rewind'],
            axis: 'z', family: 'imaging', status: 'reserved',
            label: 'Imaging slice-rewinding lobe', short: 'slice rewinding',
            about: 'Returns kz to zero after the readout, the mirror of the slice-encoding lobe.'
        },
        {
            key: 'gzSpoil', name: 'gz_imaging_spoiler', was: ['gz_spoil'],
            axis: 'z', family: 'imaging', status: 'live',
            label: 'Imaging spoiler', short: 'spoiler',
            about: 'Dephases what is left of the transverse magnetization at the end of a TR.'
        },

        // ── Phase encoding (y) ──────────────────────────────────────
        {
            key: 'gyPe', name: 'gy_imaging_phase_encoding_lobe', was: ['gy_phase', 'gy_pre'],
            axis: 'y', family: 'imaging', status: 'live',
            label: 'Imaging phase-encoding lobe', short: 'phase encoding',
            about: 'Picks the ky line; its area steps by 1/FOV from one excitation to the next.'
        },
        {
            key: 'gyRew', name: 'gy_imaging_phase_rewinding_lobe', was: ['gy_rewind'],
            axis: 'y', family: 'imaging', status: 'reserved',
            label: 'Imaging phase-rewinding lobe', short: 'phase rewinding',
            about: 'Returns ky to zero after the readout, the mirror of the phase-encoding lobe.'
        },
        {
            key: 'gyBlip', name: 'gy_imaging_phase_encoding_blip', was: ['gy_blip'],
            axis: 'y', family: 'imaging', status: 'live',
            label: 'Imaging phase-encoding blip', short: 'phase blip',
            about: 'EPI: the short lobe between two readout lines that steps ky by one line.'
        },

        // ── Readout (x) ─────────────────────────────────────────────
        {
            key: 'gx', name: 'gx_imaging_readout_lobe', was: ['gx', 'gx_readout'],
            axis: 'x', family: 'imaging', status: 'live',
            label: 'Imaging readout lobe', short: 'readout',
            about: 'Frequency encoding: the ADC samples one kx line on its flat plateau.'
        },
        {
            key: 'gxPre', name: 'gx_imaging_readout_prephasing_lobe', was: ['gx_prephase', 'gx_pre'],
            axis: 'x', family: 'imaging', status: 'live',
            label: 'Imaging readout prephasing lobe', short: 'readout prephasing',
            about: 'Moves kx to the edge of the line so the readout crosses the centre of k-space half way through.'
        },
        {
            key: 'gxCrush', name: 'gx_imaging_crusher', was: ['gx_crusher'],
            axis: 'x', family: 'imaging', status: 'reserved',
            label: 'Imaging crusher', short: 'crusher',
            about: 'A matched pair around a refocusing pulse that keeps the echo and destroys the FID.'
        },
        {
            key: 'gxRew', name: 'gx_imaging_readout_rewinding_lobe', was: ['gx_rew'],
            axis: 'x', family: 'imaging', status: 'live',
            label: 'Imaging readout rewinding lobe (x)', short: 'readout rewinding',
            about: 'Spiral gradient echo: brings kx back to the centre after the arm.'
        },
        {
            key: 'gyRoRew', name: 'gy_imaging_readout_rewinding_lobe', was: ['gy_rew'],
            axis: 'y', family: 'imaging', status: 'live',
            label: 'Imaging readout rewinding lobe (y)', short: 'readout rewinding',
            about: 'Spiral gradient echo: brings ky back to the centre after the arm.'
        },
        {
            key: 'gxSpiral', name: 'gx_imaging_spiral_readout_waveform', was: ['gx_spiral'],
            axis: 'x', family: 'imaging', status: 'live',
            label: 'Imaging spiral readout waveform (x)', short: 'spiral readout',
            about: 'The x half of the spiral arm. A sampled waveform, not a trapezoidal lobe.'
        },
        {
            key: 'gySpiral', name: 'gy_imaging_spiral_readout_waveform', was: ['gy_spiral'],
            axis: 'y', family: 'imaging', status: 'live',
            label: 'Imaging spiral readout waveform (y)', short: 'spiral readout',
            about: 'The y half of the spiral arm. A sampled waveform, not a trapezoidal lobe.'
        },

        // ── Phase correction (never to be confused with imaging) ────
        {
            key: 'gxExtPc', name: 'gx_external_phasecorr_readout_lobe', was: [],
            axis: 'x', family: 'phasecorr', status: 'reserved',
            label: 'External phase-correction readout lobe', short: 'external phasecorr',
            about: 'Readout of a separate reference acquisition (e.g. a three-echo navigator played before the imaging train).'
        },
        {
            key: 'gxIntPc', name: 'gx_internal_phasecorr_readout_lobe', was: [],
            axis: 'x', family: 'phasecorr', status: 'reserved',
            label: 'Internal phase-correction readout lobe', short: 'internal phasecorr',
            about: 'Readout of reference lines acquired inside the imaging train itself (EPI / TSE phase correction).'
        }
    ];

    // key → identifier, the form the templates consume: `${N.gxPre}`.
    const v = {};
    const byName = {};
    EVENTS.forEach((e) => { v[e.key] = e.name; byName[e.name] = e; });

    window.pulseqTemplates.names = {
        events: EVENTS,
        v,
        /** Registry entry for an identifier, or undefined. */
        lookup: (name) => byName[name],
        /** Human label for an identifier; falls back to the identifier itself. */
        label: (name) => (byName[name] ? byName[name].label : name)
    };
})();
