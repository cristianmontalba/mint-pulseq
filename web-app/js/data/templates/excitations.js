/**
 * EXCITATIONS — RF pulse blocks by excitation type (PyPulseq).
 *
 * Each excitation is emitted in TWO parts, because its timing depends on the
 * trajectory and the trajectory's events depend on its pulses:
 *
 *   <type>.events(params)   RF pulses, slice-selection lobes and their
 *                           rephasers, plus the MINT B1 and lobe-raster checks.
 *                           Emitted BEFORE the trajectory's events.
 *   <type>.timing(params)   the TE / TI delays and `excitation_duration`.
 *                           Emitted AFTER the trajectory's events, because it
 *                           consumes `time_to_echo`, which they define.
 *
 * Gradient identifiers come from names.js (`N.<key>`); never spell one here.
 *
 * Variable contract (names the trajectory templates expect):
 *   GRE:  rf, N.gz, N.gzReph, (N.gzSpoil if spoiler enabled), te_delay
 *   SE:   rf, N.gz, N.gzReph, rf2, N.gzRefoc, N.gzRefocReph, delay1, delay2
 *   IR:   rf_inv, N.gzInv, N.gzInvReph, ti, delay_ti, plus everything SE has
 *   all:  excitation_duration
 *
 * TE is exact: it runs from the CENTRE of the excitation pulse
 * (rf.delay + pp.calc_rf_center(rf)[0], never calc_duration / 2) to the echo
 * the trajectory declares through `time_to_echo`.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    const N = window.pulseqTemplates.names.v;
    const { lobeCheck, msLiteral } = window.pulseqTemplates.common;

    // One slice-selective sinc pulse. Every pulse the Builder emits is this
    // shape; only the flip angle, the names and the `use` differ.
    function sincPulse(rf, gz, flip, use) {
        return `${rf}, ${gz}, _ = pp.make_sinc_pulse(
    flip_angle=${flip},
    duration=3e-3,
    slice_thickness=slice_thickness,
    apodization=0.5,
    time_bw_product=4,
    system=system,
    return_gz=True,
    delay=system.rf_dead_time,
    use='${use}',
)
mint.check_b1('${rf}', ${rf}, max_b1)`;
    }

    function rephaser(name, of) {
        return `${name} = pp.make_trapezoid(
    channel='z', area=-${of}.area / 2, duration=2e-3, system=system,
)`;
    }

    // ─────────────────────────────────────────────────────────────────
    //  GRADIENT ECHO
    // ─────────────────────────────────────────────────────────────────
    const gradientEcho = {
        events(params) {
            const lobes = [N.gz, N.gzReph];
            let out = `# Excitation: Gradient Echo (flip_angle is set with the scan parameters)
${sincPulse('rf', N.gz, 'flip_angle', 'excitation')}

${rephaser(N.gzReph, N.gz)}`;

            if (params.spoiler) {
                lobes.push(N.gzSpoil);
                out += `

# Spoiler gradient (destroys residual transverse magnetization)
${N.gzSpoil} = make_lobe_on_raster('z', 4 / slice_thickness, system, lobe_raster)`;
            }

            out += `

${lobeCheck(lobes)}`;
            return out;
        },

        timing() {
            return `# TE runs from the CENTRE of the RF pulse to the echo. The trajectory above
# defined time_to_echo: everything it plays between the excitation block and
# the echo. What is left of TE is one delay.
rf_center = rf.delay + pp.calc_rf_center(rf)[0]
te_min = (pp.calc_duration(rf, ${N.gz}) - rf_center) + time_to_echo
te_delay = te - te_min
# A gradient echo that cannot reach TE still images, just at a longer TE, so
# this warns instead of stopping - but it must never pass silently.
if te_delay < -1e-9:
    mint.warn(
        f'TE = {te * 1e3:.3f} ms cannot be reached: the shortest TE these events allow is '
        f'{te_min * 1e3:.3f} ms, and the sequence plays at that TE instead.'
    )
te_delay = max(mint.round_to(te_delay, system.block_duration_raster), 0.0)

# How long this excitation prologue occupies in every loop iteration. The
# trajectory blocks subtract it from TR, so TR stays the period of one iteration
# instead of being tacked on top of it.
excitation_duration = pp.calc_duration(rf, ${N.gz})`;
        }
    };

    // ─────────────────────────────────────────────────────────────────
    //  SPIN ECHO  (shared by Inversion Recovery, which adds a prologue)
    // ─────────────────────────────────────────────────────────────────
    function spinEchoPulses() {
        return `${sincPulse('rf', N.gz, 'np.pi / 2', 'excitation')}

${sincPulse('rf2', N.gzRefoc, 'np.pi', 'refocusing')}

${rephaser(N.gzReph, N.gz)}
${rephaser(N.gzRefocReph, N.gzRefoc)}`;
    }

    // delay1 puts the 180 at TE/2; delay2 puts the echo at TE.
    function spinEchoDelays() {
        return `# TE delays. Both halves are measured between pulse CENTRES:
#   90 centre -> 180 centre = TE / 2
#   180 centre -> echo      = TE / 2   (time_to_echo comes from the trajectory)
rf_center = rf.delay + pp.calc_rf_center(rf)[0]
rf2_center = rf2.delay + pp.calc_rf_center(rf2)[0]
first_half_min = (
    (pp.calc_duration(rf, ${N.gz}) - rf_center)
    + pp.calc_duration(${N.gzReph})
    + rf2_center
)
second_half_min = (
    (pp.calc_duration(rf2, ${N.gzRefoc}) - rf2_center)
    + pp.calc_duration(${N.gzRefocReph})
    + time_to_echo
)
delay1 = te / 2 - first_half_min
delay2 = te / 2 - second_half_min

# A negative delay means TE is too short for these events. Clamping it to zero
# would build a sequence that looks fine and passes check_timing() while the 180
# no longer sits at TE/2 — the echo never refocuses. Fail loudly instead.
if delay1 < -1e-9 or delay2 < -1e-9:
    te_min = 2 * max(first_half_min, second_half_min)
    raise ValueError(
        f'TE = {te * 1e3:.2f} ms is too short for this sequence: the 180 cannot sit at '
        f'TE/2 with the echo at TE. The shortest usable TE here is {te_min * 1e3:.2f} ms.'
    )

# With TE on the 2 * grad_raster_time raster these are already whole block
# rasters; the rounding only removes floating-point dust.
bd_raster = system.block_duration_raster
delay1 = max(mint.round_to(delay1, bd_raster), 0.0)
delay2 = max(mint.round_to(delay2, bd_raster), 0.0)`;
    }

    const SPIN_ECHO_DURATION = `pp.calc_duration(rf, ${N.gz}) + pp.calc_duration(${N.gzReph}) + delay1
    + pp.calc_duration(rf2, ${N.gzRefoc}) + pp.calc_duration(${N.gzRefocReph}) + delay2`;

    const spinEcho = {
        events() {
            return `# Excitation: Spin Echo
${spinEchoPulses()}

${lobeCheck([N.gz, N.gzReph, N.gzRefoc, N.gzRefocReph])}`;
        },

        timing() {
            return `${spinEchoDelays()}

# How long this excitation prologue occupies in every loop iteration. The
# trajectory blocks subtract it from TR, so TR stays the period of one iteration
# instead of being tacked on top of it.
excitation_duration = (
    ${SPIN_ECHO_DURATION}
)`;
        }
    };

    // ─────────────────────────────────────────────────────────────────
    //  INVERSION RECOVERY
    // ─────────────────────────────────────────────────────────────────
    const inversionRecovery = {
        events(params) {
            // TI comes from the form (ms). The field is only enabled when the
            // Inversion Recovery option is selected, so fall back to 150 ms if
            // the params object was built without it.
            const ti = Number.isFinite(params.ti) ? params.ti : 150;

            return `# Excitation: Inversion Recovery
${sincPulse('rf_inv', N.gzInv, 'np.pi', 'inversion')}
${rephaser(N.gzInvReph, N.gzInv)}

# Inversion time — set from the Builder form (Inversion Time TI field)
# TI_null = T1 * ln(2)   e.g. fat@1.5T: 0.693*270ms ~ 187ms, CSF@1.5T: 0.693*4000ms ~ 2773ms
ti = ${msLiteral(ti)}  # [s]
mint.check_timing_parameter('TI', ti)

${spinEchoPulses()}

${lobeCheck([N.gzInv, N.gzInvReph, N.gz, N.gzReph, N.gzRefoc, N.gzRefocReph])}`;
        },

        timing() {
            return `${spinEchoDelays()}

# TI runs from the CENTRE of the inversion pulse to the CENTRE of the excitation.
rf_inv_center = rf_inv.delay + pp.calc_rf_center(rf_inv)[0]
ti_min = (
    (pp.calc_duration(rf_inv, ${N.gzInv}) - rf_inv_center)
    + pp.calc_duration(${N.gzInvReph})
    + rf_center
)
delay_ti = ti - ti_min
if delay_ti < -1e-9:
    raise ValueError(
        f'TI = {ti * 1e3:.2f} ms is too short: the inversion pulse, its rephaser and the '
        f'first half of the excitation already take {ti_min * 1e3:.2f} ms.'
    )
delay_ti = max(mint.round_to(delay_ti, bd_raster), 0.0)

# How long this excitation prologue occupies in every loop iteration, inversion
# included. The trajectory blocks subtract it from TR, so TR stays the period of
# one iteration instead of being tacked on top of it.
excitation_duration = (
    pp.calc_duration(rf_inv, ${N.gzInv}) + pp.calc_duration(${N.gzInvReph}) + delay_ti
    + ${SPIN_ECHO_DURATION}
)`;
        }
    };

    window.pulseqTemplates.excitations = {
        spinEcho,
        gradientEcho,
        inversionRecovery
    };
})();
