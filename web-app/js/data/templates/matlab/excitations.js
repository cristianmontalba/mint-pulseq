/**
 * MATLAB / EXCITATIONS — RF pulse blocks by excitation type (Pulseq for MATLAB).
 *
 * The MATLAB mirror of ../excitations.js: the same two-part contract
 * (`events` before the trajectory's events, `timing` after them), the same
 * variable names, the same exact-TE arithmetic between pulse centres.
 *
 * Gradient identifiers come from names.js (`N.<key>`); never spell one here.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};
    window.pulseqTemplates.matlab = window.pulseqTemplates.matlab || {};

    const N = window.pulseqTemplates.names.v;
    const { lobeCheck, msLiteral } = window.pulseqTemplates.matlab.common;

    // One slice-selective sinc pulse. mr.makeSincPulse raises rf.delay to the
    // RF dead time and onto the plateau of the selection lobe by itself.
    function sincPulse(rf, gz, flip, use) {
        return `[${rf}, ${gz}] = mr.makeSincPulse(${flip}, sys, ...
    'Duration', 3e-3, 'SliceThickness', slice_thickness, ...
    'apodization', 0.5, 'timeBwProduct', 4, 'use', '${use}');
mint = mint_check_b1(mint, '${rf}', ${rf}, max_b1);`;
    }

    function rephaser(name, of) {
        return `${name} = mr.makeTrapezoid('z', sys, ...
    'Area', -${of}.area / 2, 'Duration', 2e-3);`;
    }

    // ─────────────────────────────────────────────────────────────────
    //  GRADIENT ECHO
    // ─────────────────────────────────────────────────────────────────
    const gradientEcho = {
        events(params) {
            const lobes = [N.gz, N.gzReph];
            let out = `% --- Excitation: Gradient Echo ------------------------------------------
% (flip_angle is set with the scan parameters)
${sincPulse('rf', N.gz, 'flip_angle', 'excitation')}

${rephaser(N.gzReph, N.gz)}`;

            if (params.spoiler) {
                lobes.push(N.gzSpoil);
                out += `

% Spoiler gradient (destroys residual transverse magnetization)
${N.gzSpoil} = mint_make_lobe('z', 4 / slice_thickness, sys, lobe_raster);`;
            }

            out += `

${lobeCheck(lobes)}`;
            return out;
        },

        timing() {
            return `% --- Timing ------------------------------------------------------------
% TE runs from the CENTRE of the RF pulse to the echo. The trajectory above
% defined time_to_echo: everything it plays between the excitation block and
% the echo. What is left of TE is one delay.
rf_center = rf.delay + mr.calcRfCenter(rf);
te_min = (mr.calcDuration(rf, ${N.gz}) - rf_center) + time_to_echo;
te_delay = te - te_min;
% A gradient echo that cannot reach TE still images, just at a longer TE, so
% this warns instead of stopping - but it must never pass silently.
if te_delay < -1e-9
    mint = mint_warn(mint, sprintf([ ...
        'TE = %.3f ms cannot be reached: the shortest TE these events allow is ' ...
        '%.3f ms, and the sequence plays at that TE instead.'], te * 1e3, te_min * 1e3));
end
te_delay = max(mint_round_to(te_delay, sys.blockDurationRaster), 0);

% How long this excitation prologue occupies in every loop iteration. The
% trajectory blocks subtract it from TR, so TR stays the period of one iteration
% instead of being tacked on top of it.
excitation_duration = mr.calcDuration(rf, ${N.gz});`;
        }
    };

    // ─────────────────────────────────────────────────────────────────
    //  SPIN ECHO  (shared by Inversion Recovery, which adds a prologue)
    // ─────────────────────────────────────────────────────────────────
    function spinEchoPulses() {
        return `${sincPulse('rf', N.gz, 'pi / 2', 'excitation')}

${sincPulse('rf2', N.gzRefoc, 'pi', 'refocusing')}

${rephaser(N.gzReph, N.gz)}
${rephaser(N.gzRefocReph, N.gzRefoc)}`;
    }

    function spinEchoDelays() {
        return `% --- Timing ------------------------------------------------------------
% TE delays. Both halves are measured between pulse CENTRES:
%   90 centre -> 180 centre = TE / 2
%   180 centre -> echo      = TE / 2   (time_to_echo comes from the trajectory)
rf_center = rf.delay + mr.calcRfCenter(rf);
rf2_center = rf2.delay + mr.calcRfCenter(rf2);
first_half_min = (mr.calcDuration(rf, ${N.gz}) - rf_center) ...
    + mr.calcDuration(${N.gzReph}) ...
    + rf2_center;
second_half_min = (mr.calcDuration(rf2, ${N.gzRefoc}) - rf2_center) ...
    + mr.calcDuration(${N.gzRefocReph}) ...
    + time_to_echo;
delay1 = te / 2 - first_half_min;
delay2 = te / 2 - second_half_min;

% A negative delay means TE is too short for these events. Clamping it to zero
% would build a sequence that looks fine and passes checkTiming while the 180
% no longer sits at TE/2 - the echo never refocuses. Fail loudly instead.
if delay1 < -1e-9 || delay2 < -1e-9
    te_min = 2 * max(first_half_min, second_half_min);
    error('MINT:te', ['TE = %.2f ms is too short for this sequence: the 180 cannot sit at ' ...
        'TE/2 with the echo at TE. The shortest usable TE here is %.2f ms.'], ...
        te * 1e3, te_min * 1e3);
end

% With TE on the 2 * gradRasterTime raster these are already whole block
% rasters; the rounding only removes floating-point dust.
bd_raster = sys.blockDurationRaster;
delay1 = max(mint_round_to(delay1, bd_raster), 0);
delay2 = max(mint_round_to(delay2, bd_raster), 0);`;
    }

    const SPIN_ECHO_DURATION = `mr.calcDuration(rf, ${N.gz}) + mr.calcDuration(${N.gzReph}) + delay1 ...
    + mr.calcDuration(rf2, ${N.gzRefoc}) + mr.calcDuration(${N.gzRefocReph}) + delay2`;

    const spinEcho = {
        events() {
            return `% --- Excitation: Spin Echo ----------------------------------------------
${spinEchoPulses()}

${lobeCheck([N.gz, N.gzReph, N.gzRefoc, N.gzRefocReph])}`;
        },

        timing() {
            return `${spinEchoDelays()}

% How long this excitation prologue occupies in every loop iteration. The
% trajectory blocks subtract it from TR, so TR stays the period of one iteration
% instead of being tacked on top of it.
excitation_duration = ${SPIN_ECHO_DURATION};`;
        }
    };

    // ─────────────────────────────────────────────────────────────────
    //  INVERSION RECOVERY
    // ─────────────────────────────────────────────────────────────────
    const inversionRecovery = {
        events(params) {
            const ti = Number.isFinite(params.ti) ? params.ti : 150;

            return `% --- Excitation: Inversion Recovery -------------------------------------
${sincPulse('rf_inv', N.gzInv, 'pi', 'inversion')}
${rephaser(N.gzInvReph, N.gzInv)}

% Inversion time - set from the Builder form (Inversion Time TI field)
% TI_null = T1 * ln(2)   e.g. fat@1.5T: 0.693*270ms ~ 187ms, CSF@1.5T: 0.693*4000ms ~ 2773ms
ti = ${msLiteral(ti)};   % [s]
mint = mint_check_timing_parameter(mint, 'TI', ti);

${spinEchoPulses()}

${lobeCheck([N.gzInv, N.gzInvReph, N.gz, N.gzReph, N.gzRefoc, N.gzRefocReph])}`;
        },

        timing() {
            return `${spinEchoDelays()}

% TI runs from the CENTRE of the inversion pulse to the CENTRE of the excitation.
rf_inv_center = rf_inv.delay + mr.calcRfCenter(rf_inv);
ti_min = (mr.calcDuration(rf_inv, ${N.gzInv}) - rf_inv_center) ...
    + mr.calcDuration(${N.gzInvReph}) ...
    + rf_center;
delay_ti = ti - ti_min;
if delay_ti < -1e-9
    error('MINT:ti', ['TI = %.2f ms is too short: the inversion pulse, its rephaser and the ' ...
        'first half of the excitation already take %.2f ms.'], ti * 1e3, ti_min * 1e3);
end
delay_ti = max(mint_round_to(delay_ti, bd_raster), 0);

% How long this excitation prologue occupies in every loop iteration, inversion
% included. The trajectory blocks subtract it from TR, so TR stays the period of
% one iteration instead of being tacked on top of it.
excitation_duration = mr.calcDuration(rf_inv, ${N.gzInv}) + mr.calcDuration(${N.gzInvReph}) + delay_ti ...
    + ${SPIN_ECHO_DURATION};`;
        }
    };

    window.pulseqTemplates.matlab.excitations = {
        spinEcho,
        gradientEcho,
        inversionRecovery
    };
})();
