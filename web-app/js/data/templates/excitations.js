/**
 * EXCITATIONS — RF pulse blocks by excitation type (PyPulseq).
 *
 * Each function defines the RF events, slice-select gradients, rephasing,
 * and TE-related delay calculations. The trajectory template references
 * these names inside its acquisition loop.
 *
 * Variable contract (names the trajectory templates expect):
 *   GRE:  rf, gz, gz_reph, (gz_spoil if spoiler enabled)
 *   SE:   rf, gz, gz_reph, rf2, gz2, gz2_reph, delay1, delay2
 *   IR:   rf_inv, gz_inv, gz_inv_reph, ti, delay_ti,
 *         rf, gz, gz_reph, rf2, gz2, gz2_reph, delay1, delay2
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    // ─────────────────────────────────────────────────────────────────
    //  GRADIENT ECHO
    // ─────────────────────────────────────────────────────────────────
    function gradientEcho(params) {
        const hasSpoiler = params.spoiler;

        let out = `# Excitation: Gradient Echo
flip_angle = np.deg2rad(${params.flipAngle})

rf, gz, _ = pp.make_sinc_pulse(
    flip_angle=flip_angle,
    duration=3e-3,
    slice_thickness=slice_thickness,
    apodization=0.5,
    time_bw_product=4,
    system=system,
    return_gz=True,
    delay=system.rf_dead_time,
    use='excitation',
)

gz_reph = pp.make_trapezoid(channel='z', area=-gz.area / 2, duration=2e-3, system=system)

# How long this excitation prologue occupies in every loop iteration. The
# trajectory blocks subtract it from TR, so TR stays the period of one iteration
# instead of being tacked on top of it.
excitation_duration = pp.calc_duration(gz, rf)`;

        if (hasSpoiler) {
            out += `

# Spoiler gradient (destroys residual transverse magnetization)
gz_spoil = pp.make_trapezoid(channel='z', area=4 / slice_thickness, system=system)`;
        }

        return out;
    }

    // ─────────────────────────────────────────────────────────────────
    //  SPIN ECHO
    // ─────────────────────────────────────────────────────────────────
    function spinEcho(params) {
        return `# Excitation: Spin Echo
rf, gz, _ = pp.make_sinc_pulse(
    flip_angle=np.pi / 2,
    duration=3e-3,
    slice_thickness=slice_thickness,
    apodization=0.5,
    time_bw_product=4,
    system=system,
    return_gz=True,
    delay=system.rf_dead_time,
    use='excitation',
)

rf2, gz2, _ = pp.make_sinc_pulse(
    flip_angle=np.pi,
    duration=3e-3,
    slice_thickness=slice_thickness,
    apodization=0.5,
    time_bw_product=4,
    system=system,
    return_gz=True,
    delay=system.rf_dead_time,
    use='refocusing',
)

gz_reph = pp.make_trapezoid(channel='z', area=-gz.area / 2, duration=2e-3, system=system)
gz2_reph = pp.make_trapezoid(channel='z', area=-gz2.area / 2, duration=2e-3, system=system)

# TE delays: center the 180 at TE/2 so the echo forms at TE (approximate, clipped at 0).
# Every delay is snapped to the block-duration raster; an off-raster delay makes
# seq.check_timing() fail with a RASTER error (it happens at plenty of TE values).
bd_raster = system.block_duration_raster
delay1 = te / 2 - pp.calc_duration(gz, rf) - pp.calc_duration(gz_reph)
delay2 = te / 2 - pp.calc_duration(gz2, rf2) - pp.calc_duration(gz2_reph)

# A negative delay means TE is too short for these pulses. Clamping it to zero
# would build a sequence that looks fine and passes check_timing() while the 180
# no longer sits at TE/2 — the echo never refocuses. Fail loudly instead.
if delay1 < 0 or delay2 < 0:
    te_min = 2 * max(
        pp.calc_duration(gz, rf) + pp.calc_duration(gz_reph),
        pp.calc_duration(gz2, rf2) + pp.calc_duration(gz2_reph),
    )
    raise ValueError(
        f'TE = {te * 1e3:.1f} ms is too short for these pulses: the 180 cannot sit at '
        f'TE/2, so the echo will not refocus. The shortest usable TE here is '
        f'{te_min * 1e3:.1f} ms.'
    )

delay1 = np.round(delay1 / bd_raster) * bd_raster
delay2 = np.round(delay2 / bd_raster) * bd_raster

# How long this excitation prologue occupies in every loop iteration. The
# trajectory blocks subtract it from TR, so TR stays the period of one iteration
# instead of being tacked on top of it.
excitation_duration = (
    pp.calc_duration(gz, rf) + pp.calc_duration(gz_reph) + delay1
    + pp.calc_duration(gz2, rf2) + pp.calc_duration(gz2_reph) + delay2
)`;
    }

    // ─────────────────────────────────────────────────────────────────
    //  INVERSION RECOVERY
    // ─────────────────────────────────────────────────────────────────
    function inversionRecovery(params) {
        // TI comes from the form (ms). The field is only enabled when the
        // Inversion Recovery option is selected, so fall back to 150 ms if the
        // params object was built without it.
        const tiSec = (Number.isFinite(params.ti) ? params.ti : 150) / 1000;

        return `# Excitation: Inversion Recovery
rf_inv, gz_inv, _ = pp.make_sinc_pulse(
    flip_angle=np.pi,
    duration=3e-3,
    slice_thickness=slice_thickness,
    apodization=0.5,
    time_bw_product=4,
    system=system,
    return_gz=True,
    delay=system.rf_dead_time,
    use='inversion',
)
gz_inv_reph = pp.make_trapezoid(channel='z', area=-gz_inv.area / 2, duration=2e-3, system=system)

# Inversion time — set from the Builder form (Inversion Time TI field)
# TI_null = T1 * ln(2)   e.g. fat@1.5T: 0.693*270ms ~ 187ms, CSF@1.5T: 0.693*4000ms ~ 2773ms
ti = ${tiSec.toFixed(5)}  # [s]

rf, gz, _ = pp.make_sinc_pulse(
    flip_angle=np.pi / 2,
    duration=3e-3,
    slice_thickness=slice_thickness,
    apodization=0.5,
    time_bw_product=4,
    system=system,
    return_gz=True,
    delay=system.rf_dead_time,
    use='excitation',
)

rf2, gz2, _ = pp.make_sinc_pulse(
    flip_angle=np.pi,
    duration=3e-3,
    slice_thickness=slice_thickness,
    apodization=0.5,
    time_bw_product=4,
    system=system,
    return_gz=True,
    delay=system.rf_dead_time,
    use='refocusing',
)

gz_reph = pp.make_trapezoid(channel='z', area=-gz.area / 2, duration=2e-3, system=system)
gz2_reph = pp.make_trapezoid(channel='z', area=-gz2.area / 2, duration=2e-3, system=system)

# Timing delays (approximate, clipped at 0). Every delay is snapped to the
# block-duration raster; an off-raster delay makes seq.check_timing() fail with
# a RASTER error (it happens at plenty of TE/TI values).
bd_raster = system.block_duration_raster
delay_ti = ti - pp.calc_duration(gz_inv, rf_inv) - pp.calc_duration(gz_inv_reph)
delay1 = te / 2 - pp.calc_duration(gz, rf) - pp.calc_duration(gz_reph)
delay2 = te / 2 - pp.calc_duration(gz2, rf2) - pp.calc_duration(gz2_reph)

# A negative delay means TE (or TI) is too short for these pulses. Clamping it to
# zero would build a sequence that looks fine and passes check_timing() while the
# 180 no longer sits at TE/2 — the echo never refocuses. Fail loudly instead.
if delay1 < 0 or delay2 < 0:
    te_min = 2 * max(
        pp.calc_duration(gz, rf) + pp.calc_duration(gz_reph),
        pp.calc_duration(gz2, rf2) + pp.calc_duration(gz2_reph),
    )
    raise ValueError(
        f'TE = {te * 1e3:.1f} ms is too short for these pulses: the 180 cannot sit at '
        f'TE/2, so the echo will not refocus. The shortest usable TE here is '
        f'{te_min * 1e3:.1f} ms.'
    )
if delay_ti < 0:
    ti_min = pp.calc_duration(gz_inv, rf_inv) + pp.calc_duration(gz_inv_reph)
    raise ValueError(
        f'TI = {ti * 1e3:.1f} ms is too short: the inversion pulse and its rephaser '
        f'already take {ti_min * 1e3:.1f} ms.'
    )

delay_ti = np.round(delay_ti / bd_raster) * bd_raster
delay1 = np.round(delay1 / bd_raster) * bd_raster
delay2 = np.round(delay2 / bd_raster) * bd_raster

# How long this excitation prologue occupies in every loop iteration, inversion
# included. The trajectory blocks subtract it from TR, so TR stays the period of
# one iteration instead of being tacked on top of it.
excitation_duration = (
    pp.calc_duration(gz_inv, rf_inv) + pp.calc_duration(gz_inv_reph) + delay_ti
    + pp.calc_duration(gz, rf) + pp.calc_duration(gz_reph) + delay1
    + pp.calc_duration(gz2, rf2) + pp.calc_duration(gz2_reph) + delay2
)`;
    }

    window.pulseqTemplates.excitations = {
        spinEcho,
        gradientEcho,
        inversionRecovery
    };
})();
