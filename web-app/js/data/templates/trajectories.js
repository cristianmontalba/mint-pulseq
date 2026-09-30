/**
 * TRAJECTORIES — readout gradient definitions + acquisition loops (PyPulseq).
 *
 * Each function generates (as column-0-relative Python — the composer applies
 * the final 4-space indent to fit inside `def main():`):
 *   1. Readout gradient and ADC event definitions
 *   2. Pre-phasing gradient definitions
 *   3. The acquisition loop (which references RF events from excitations.js)
 *
 * The loop structure adapts to the excitation type via params.excitation.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    // Re-indent a multi-line snippet by N spaces (used to drop RF block code
    // into a `for` loop body written elsewhere in the same template).
    function indent(text, spaces) {
        const pad = ' '.repeat(spaces);
        return text.split('\n').map(line => (line.length ? pad + line : line)).join('\n');
    }

    // Helper: wrap one TR's worth of blocks in a slice / partition loop.
    //
    //   2D          → nothing to wrap, a single slice.
    //   multislice  → excite each slice in turn by offsetting the RF centre
    //                 frequency. The slices SHARE one TR, which is what makes
    //                 multislice worth doing: the recovery time of one slice is
    //                 spent exciting the others.
    //   3D          → one kz phase encode (partition) per excitation, so every
    //                 partition costs a full TR.
    //
    // `bodyLines` are the block-assembly lines at the encode loop's indent; they
    // come back indented one level deeper when a loop is added.
    // True when a slice / partition loop is actually emitted.
    function hasSliceLoop(params) {
        return params.dimension !== '2D' && (params.nSlices || 1) > 1;
    }

    // The too-short-TR warning must print once, not once per slice.
    function guardFor(params, encodeVar) {
        return hasSliceLoop(params)
            ? `${encodeVar} == 0 and i_slice == 0`
            : `${encodeVar} == 0`;
    }

    function sliceWrap(params, exc, bodyLines) {
        const dim = params.dimension;
        if (!hasSliceLoop(params)) return bodyLines;

        const head = [];
        if (dim === 'multislice') {
            head.push('    # Excite each slice in turn: gz.amplitude * z is the frequency offset');
            head.push('    # that moves the excited slab to that position.');
            head.push('    for i_slice in range(n_slices):');
            head.push('        rf.freq_offset = gz.amplitude * z_positions[i_slice]');
            if (exc === 'spinEcho' || exc === 'inversionRecovery') {
                head.push('        rf2.freq_offset = gz2.amplitude * z_positions[i_slice]');
            }
            if (exc === 'inversionRecovery') {
                head.push('        rf_inv.freq_offset = gz_inv.amplitude * z_positions[i_slice]');
            }
        } else {
            head.push('    # One kz partition per excitation.');
            head.push('    for i_slice in range(n_slices):');
            head.push("        gz_phase = pp.make_trapezoid(channel='z', area=kz_areas[i_slice],");
            head.push('                                     duration=pre_time_z, system=system)');
        }
        // Entries may themselves be multi-line strings (trDelayCode, rfBlock), so
        // flatten before indenting — indenting only the first line of each entry
        // silently produces broken Python.
        return head.concat(
            bodyLines.join('\n').split('\n').map(l => (l.length ? '    ' + l : l))
        );
    }

    // Helper: emit the TR recovery delay for one loop iteration.
    //
    // TR is the PERIOD of an iteration, so the delay is TR minus everything else
    // that plays in it — never a further full TR appended at the end. Getting this
    // wrong is silent: the sequence still builds and still passes check_timing(),
    // it just scans at a different TR than the one that was asked for.
    //
    // `terms` are Python expressions for the durations of that trajectory's own
    // blocks; `excitation_duration` comes from excitations.js. `guard` is the
    // condition under which the too-short warning may print (once per script).
    function trDelayCode(terms, guard, params) {
        const all = ['excitation_duration'].concat(terms || []);
        // Multislice shares one TR between all slices, so the budget per
        // excitation is TR / n_slices. 3D gives every partition its own TR.
        const share = (params && params.dimension === 'multislice' && (params.nSlices || 1) > 1)
            ? ' / n_slices' : '';
        const budget = `tr${share}`;
        const note = share
            ? ['    # The slices share one TR, so each excitation gets TR / n_slices of it.']
            : [];
        return [
            '',
            '    # TR is the period of one iteration: subtract everything else that plays.',
            ...note,
            '    iteration_duration = (',
            ...all.map((t, i) => `        ${i === 0 ? '' : '+ '}${t}`),
            '    )',
            `    tr_delay = ${budget} - iteration_duration`,
            '    # A TR that does not fit gets clamped, so say so instead of silently',
            '    # scanning at a different TR than the one that was asked for.',
            `    if tr_delay < 0 and ${guard}:`,
            `        print(f'WARNING: TR={${budget} * 1e3:.1f} ms per excitation is shorter than this '`,
            "              f'sequence allows; the shortest possible is {iteration_duration * 1e3:.1f} ms.')",
            '    tr_delay = max(np.round(tr_delay / system.block_duration_raster) * system.block_duration_raster, 0.0)',
        ].join('\n');
    }

    // Helper: generate the RF block sequence for one repetition, based on
    // excitation type (GRE, SE, IR). Column-0-relative (caller re-indents).
    function rfBlockCode(exc) {
        if (exc === 'inversionRecovery') {
            return `# Inversion pulse
seq.add_block(rf_inv, gz_inv)
seq.add_block(gz_inv_reph)
seq.add_block(pp.make_delay(delay_ti))
# 90-degree excitation
seq.add_block(rf, gz)
seq.add_block(gz_reph)
seq.add_block(pp.make_delay(delay1))
# 180-degree refocusing
seq.add_block(rf2, gz2)
seq.add_block(gz2_reph)
seq.add_block(pp.make_delay(delay2))`;
        }
        if (exc === 'spinEcho') {
            return `# 90-degree excitation
seq.add_block(rf, gz)
seq.add_block(gz_reph)
seq.add_block(pp.make_delay(delay1))
# 180-degree refocusing
seq.add_block(rf2, gz2)
seq.add_block(gz2_reph)
seq.add_block(pp.make_delay(delay2))`;
        }
        // gradientEcho (default) — gz_reph is combined with prephasing
        // gradients in the trajectory block for simultaneous play
        return `seq.add_block(rf, gz)`;
    }

    // ═════════════════════════════════════════════════════════════════
    //  CARTESIAN
    // ═════════════════════════════════════════════════════════════════
    function cartesian(params) {
        const exc = params.excitation;
        const is3D = params.dimension === '3D' && (params.nSlices || 1) > 1;
        const hasSpoiler = params.spoiler;
        const isGRE = exc === 'gradientEcho';
        const rfBlock = indent(rfBlockCode(exc), 4);

        const lines = [];
        lines.push('# Trajectory: Cartesian (line-by-line)');
        lines.push('k_width = n_x * delta_kx');
        lines.push('readout_time = 2.56e-3');
        lines.push('');
        lines.push('# Pick the ADC DWELL first and derive the flat top from it. Setting');
        lines.push('# duration=gx.flat_time instead leaves the dwell as flat_time / n_x, which');
        lines.push('# falls off the 100 ns ADC raster for many matrix sizes (n_x=96 gives');
        lines.push('# 13333.3 ns). make_adc accepts it and seq.write() still writes the file,');
        lines.push('# but check_timing() then fails with a RASTER error.');
        lines.push('adc_dwell = np.floor(readout_time / n_x / system.adc_raster_time) * system.adc_raster_time');
        lines.push('adc_duration = n_x * adc_dwell');
        lines.push('gx_flat_time = np.ceil(adc_duration / system.grad_raster_time) * system.grad_raster_time');
        lines.push('');
        lines.push("gx = pp.make_trapezoid(channel='x', amplitude=k_width / adc_duration, flat_time=gx_flat_time, system=system)");
        lines.push('# Centre the ADC window inside the flat top.');
        lines.push('adc = pp.make_adc(num_samples=n_x, dwell=adc_dwell,');
        lines.push('                  delay=gx.rise_time + (gx_flat_time - adc_duration) / 2, system=system)');
        lines.push('');
        lines.push('pre_time = 1.28e-3');
        lines.push("gx_pre = pp.make_trapezoid(channel='x', area=-gx.area / 2 - delta_kx / 2, duration=pre_time, system=system)");
        lines.push('');
        lines.push('for i_phase in range(n_y):');
        lines.push('    gy_pre = pp.make_trapezoid(');
        lines.push("        channel='y',");
        lines.push('        area=-n_y / 2 * delta_ky + i_phase * delta_ky,');
        lines.push('        duration=pre_time,');
        lines.push('        system=system,');
        lines.push('    )');
        lines.push('');
        const preTerm = `pp.calc_duration(gx_pre, gy_pre${isGRE ? ', gz_reph' : ''})`;
        const terms = [preTerm];

        const body = [];
        if (isGRE) {
            // TE runs from the middle of the excitation to the middle of the readout,
            // so the prephasers and half of each are already spent before the delay.
            body.push(`    te_delay = te - pp.calc_duration(gz, rf) / 2 - ${preTerm} - pp.calc_duration(gx) / 2`);
            body.push('    te_delay = max(np.round(te_delay / system.block_duration_raster) * system.block_duration_raster, 0.0)');
            terms.push('te_delay');
        }
        terms.push('pp.calc_duration(gx, adc)');
        if (hasSpoiler && isGRE) terms.push('pp.calc_duration(gz_spoil)');
        if (is3D) terms.push('pp.calc_duration(gz_phase)');
        body.push(trDelayCode(terms, guardFor(params, 'i_phase'), params));
        body.push('');
        body.push(rfBlock);
        if (is3D) body.push('    seq.add_block(gz_phase)');
        body.push(`    seq.add_block(gx_pre, gy_pre${isGRE ? ', gz_reph' : ''})`);
        if (isGRE) body.push('    seq.add_block(pp.make_delay(te_delay))');
        body.push('    seq.add_block(gx, adc)');
        if (hasSpoiler && isGRE) body.push('    seq.add_block(gz_spoil)');
        body.push('    if tr_delay > 0:');
        body.push('        seq.add_block(pp.make_delay(tr_delay))');
        lines.push(...sliceWrap(params, exc, body));

        return lines.join('\n');
    }

    // ═════════════════════════════════════════════════════════════════
    //  EPI
    // ═════════════════════════════════════════════════════════════════
    function epi(params) {
        const exc = params.excitation;
        const is3D = params.dimension === '3D' && (params.nSlices || 1) > 1;
        const nShots = params.nShots || 1;
        const hasSpoiler = params.spoiler;
        const isGRE = exc === 'gradientEcho';
        const rfBlock = indent(rfBlockCode(exc), 4);

        const lines = [];
        lines.push('# Trajectory: EPI (zigzag)');
        lines.push(`n_shots = ${nShots}`);
        lines.push('k_width = n_x * delta_kx');
        lines.push('readout_time = 12.8e-4');
        lines.push('');
        lines.push('# Pick the ADC DWELL first and derive the flat top from it. Setting');
        lines.push('# duration=gx.flat_time instead leaves the dwell as flat_time / n_x, which');
        lines.push('# falls off the 100 ns ADC raster for many matrix sizes (n_x=96 gives');
        lines.push('# 13333.3 ns). make_adc accepts it and seq.write() still writes the file,');
        lines.push('# but check_timing() then fails with a RASTER error.');
        lines.push('adc_dwell = np.floor(readout_time / n_x / system.adc_raster_time) * system.adc_raster_time');
        lines.push('adc_duration = n_x * adc_dwell');
        lines.push('gx_flat_time = np.ceil(adc_duration / system.grad_raster_time) * system.grad_raster_time');
        lines.push('');
        lines.push("gx = pp.make_trapezoid(channel='x', amplitude=k_width / adc_duration, flat_time=gx_flat_time, system=system)");
        lines.push('# Centre the ADC window inside the flat top.');
        lines.push('adc = pp.make_adc(num_samples=n_x, dwell=adc_dwell,');
        lines.push('                  delay=gx.rise_time + (gx_flat_time - adc_duration) / 2, system=system)');
        lines.push('');
        lines.push('pre_time = 1.28e-3');
        lines.push("gx_pre = pp.make_trapezoid(channel='x', area=-gx.area / 2 - delta_kx / 2, duration=pre_time, system=system)");
        if (isGRE) {
            lines.push("gz_reph_epi = pp.make_trapezoid(channel='z', area=-gz.area / 2, duration=pre_time, system=system)");
        }
        lines.push('');
        lines.push('# Phase blip between readout lines');
        lines.push("gy_blip = pp.make_trapezoid(channel='y', area=n_shots * delta_ky, system=system)");
        lines.push('');
        lines.push('amplitude = gx.amplitude');
        lines.push('n_echoes = round(n_y / n_shots)');
        lines.push('');
        lines.push('for i_shot in range(n_shots):');
        lines.push('    gy_pre = pp.make_trapezoid(');
        lines.push("        channel='y',");
        lines.push('        area=-n_y / 2 * delta_ky + i_shot * delta_ky,');
        lines.push('        duration=pre_time,');
        lines.push('        system=system,');
        lines.push('    )');
        lines.push('');
        const preTerm = `pp.calc_duration(gx_pre, gy_pre${isGRE ? ', gz_reph_epi' : ''})`;
        const terms = [preTerm];

        const body = [];
        body.push('    # The whole echo train plays inside one iteration.');
        body.push('    train_duration = (n_echoes * pp.calc_duration(gx, adc)');
        body.push('                      + (n_echoes - 1) * pp.calc_duration(gy_blip))');

        if (isGRE) {
            // TE lands on the centre of the echo train, not on its first line.
            body.push('');
            body.push(`    te_delay = te - pp.calc_duration(gz, rf) / 2 - ${preTerm} - train_duration / 2`);
            body.push('    te_delay = max(np.round(te_delay / system.block_duration_raster) * system.block_duration_raster, 0.0)');
            terms.push('te_delay');
        }
        terms.push('train_duration');
        if (hasSpoiler && isGRE) terms.push('pp.calc_duration(gz_spoil)');
        if (is3D) terms.push('pp.calc_duration(gz_phase)');
        body.push(trDelayCode(terms, guardFor(params, 'i_shot'), params));
        body.push('');
        body.push(rfBlock);
        if (is3D) body.push('    seq.add_block(gz_phase)');
        body.push(`    seq.add_block(gx_pre, gy_pre${isGRE ? ', gz_reph_epi' : ''})`);
        if (isGRE) body.push('    seq.add_block(pp.make_delay(te_delay))');
        body.push('');
        body.push('    for i_echo in range(n_echoes):');
        body.push('        gx.amplitude = (-1) ** i_echo * amplitude  # reverse polarity of read gradient');
        body.push('        seq.add_block(gx, adc)');
        body.push('        if i_echo != n_echoes - 1:');
        body.push('            seq.add_block(gy_blip)  # phase blip');
        body.push('');
        if (hasSpoiler && isGRE) body.push('    seq.add_block(gz_spoil)');
        body.push('    if tr_delay > 0:');
        body.push('        seq.add_block(pp.make_delay(tr_delay))');
        lines.push(...sliceWrap(params, exc, body));

        return lines.join('\n');
    }

    // ═════════════════════════════════════════════════════════════════
    //  RADIAL (diametral spokes)
    // ═════════════════════════════════════════════════════════════════
    function radial(params) {
        const exc = params.excitation;
        const is3D = params.dimension === '3D' && (params.nSlices || 1) > 1;
        const nSpokes = params.nShots || 400;
        const hasSpoiler = params.spoiler;
        const isGRE = exc === 'gradientEcho';
        const rfBlock = indent(rfBlockCode(exc), 4);

        const lines = [];
        lines.push('# Trajectory: Radial (diametral spokes)');
        lines.push(`n_spokes = ${nSpokes}`);
        lines.push('spoke_angle_increment = 2 * np.pi / n_spokes');
        lines.push('');
        lines.push('readout_time = 2.56e-3');
        lines.push('');
        lines.push('k_width = n_x * delta_kx');
        lines.push('# Pick the ADC DWELL first and derive the flat top from it. Setting');
        lines.push('# duration=gx.flat_time instead leaves the dwell as flat_time / n_x, which');
        lines.push('# falls off the 100 ns ADC raster for many matrix sizes (n_x=96 gives');
        lines.push('# 13333.3 ns). make_adc accepts it and seq.write() still writes the file,');
        lines.push('# but check_timing() then fails with a RASTER error.');
        lines.push('adc_dwell = np.floor(readout_time / n_x / system.adc_raster_time) * system.adc_raster_time');
        lines.push('adc_duration = n_x * adc_dwell');
        lines.push('gx_flat_time = np.ceil(adc_duration / system.grad_raster_time) * system.grad_raster_time');
        lines.push('');
        lines.push("gx = pp.make_trapezoid(channel='x', amplitude=k_width / adc_duration, flat_time=gx_flat_time, system=system)");
        lines.push('# Centre the ADC window inside the flat top.');
        lines.push('adc = pp.make_adc(num_samples=n_x, dwell=adc_dwell,');
        lines.push('                  delay=gx.rise_time + (gx_flat_time - adc_duration) / 2, system=system)');
        lines.push("gx_pre = pp.make_trapezoid(channel='x', area=-gx.area / 2 - delta_kx / 2, duration=1e-3, system=system)");
        lines.push('');
        lines.push('# Dummy scans to establish steady state. They must run at the same TR as');
        lines.push('# the real spokes, so their recovery delay is TR minus what they play.');
        lines.push('n_dummy = 4');
        lines.push('dummy_delay = tr - pp.calc_duration(gz, rf) - pp.calc_duration(gz_reph)');
        lines.push('dummy_delay = max(np.round(dummy_delay / system.block_duration_raster) * system.block_duration_raster, 0.0)');
        lines.push('for _ in range(n_dummy):');
        lines.push('    seq.add_block(rf, gz)');
        lines.push('    seq.add_block(gz_reph)');
        lines.push('    if dummy_delay > 0:');
        lines.push('        seq.add_block(pp.make_delay(dummy_delay))');
        lines.push('');
        lines.push('for i_spoke in range(n_spokes):');
        lines.push('    phi = spoke_angle_increment * i_spoke');
        lines.push('');
        const terms = [];
        const body = [];
        if (isGRE) {
            terms.push('pp.calc_duration(gz_reph)');
            // TE runs from the middle of the excitation to the middle of the spoke.
            body.push('    te_delay = (te - pp.calc_duration(gz, rf) / 2 - pp.calc_duration(gz_reph)');
            body.push('                - pp.calc_duration(gx_pre) - pp.calc_duration(gx) / 2)');
            body.push('    te_delay = max(np.round(te_delay / system.block_duration_raster) * system.block_duration_raster, 0.0)');
            terms.push('te_delay');
        }
        terms.push('pp.calc_duration(gx_pre)');
        terms.push('pp.calc_duration(gx, adc)');
        if (hasSpoiler && isGRE) terms.push('pp.calc_duration(gz_spoil)');
        if (is3D) terms.push('pp.calc_duration(gz_phase)');
        body.push(trDelayCode(terms, guardFor(params, 'i_spoke'), params));
        body.push('');
        body.push(rfBlock);
        if (is3D) body.push('    seq.add_block(gz_phase)');
        if (isGRE) {
            body.push('    seq.add_block(gz_reph)');
            body.push('    seq.add_block(pp.make_delay(te_delay))');
        }
        body.push("    seq.add_block(*pp.rotate(gx_pre, angle=phi, axis='z'))");
        body.push("    seq.add_block(*pp.rotate(gx, adc, angle=phi, axis='z'))");
        if (hasSpoiler && isGRE) body.push('    seq.add_block(gz_spoil)');
        body.push('    if tr_delay > 0:');
        body.push('        seq.add_block(pp.make_delay(tr_delay))');
        lines.push(...sliceWrap(params, exc, body));

        return lines.join('\n');
    }

    // ═════════════════════════════════════════════════════════════════
    //  SPIRAL (Archimedean)
    // ═════════════════════════════════════════════════════════════════
    function spiral(params) {
        const exc = params.excitation;
        const is3D = params.dimension === '3D' && (params.nSlices || 1) > 1;
        const nInterleaves = params.nInterleaves || 5;
        const isGRE = exc === 'gradientEcho';
        const rfBlock = indent(rfBlockCode(exc), 4);
        // The spiral waveform and its ADC share one delay so they stay aligned.
        // Using the slice rephaser's duration here (as an earlier version did)
        // double-counted it: the rephaser is already its own block.
        const rephDelayVar = 'system.adc_dead_time';

        const lines = [];
        lines.push('# Trajectory: Spiral (Archimedean)');
        lines.push(`n_interleaves = ${nInterleaves}`);
        lines.push('safety_margin = 0.90  # stay below hardware limits to absorb rounding error');
        lines.push('');
        lines.push('# Outer k-space radius the requested resolution demands.');
        lines.push('k_max = n_x / (2 * fov_x)');
        lines.push('');
        lines.push('# Turns per arm. Nyquist needs the arms together to cover k_max in steps of');
        lines.push('# delta_k = 1/FOV, i.e. n_turns * n_interleaves >= k_max / delta_k = n_x / 2.');
        lines.push('n_turns = int(np.ceil(n_x / (2 * n_interleaves)))');
        lines.push('');
        lines.push('# ONE continuous base arm, sampled finely. 1000 points is NOT enough: the');
        lines.push('# resampling onto the gradient raster then overshoots the slew limit by ~10%.');
        lines.push('# It converges by ~5000; 20000 is cheap because this runs once for all arms.');
        lines.push('n_base = 20000');
        lines.push('t_base = np.linspace(0, 1, n_base)');
        lines.push('r_base = k_max * t_base');
        lines.push('theta_base = 2 * np.pi * n_turns * t_base');
        lines.push('ka_base = np.stack([r_base * np.cos(theta_base), r_base * np.sin(theta_base)])');
        lines.push('');
        lines.push('# Time-optimal reparametrization, done ONCE — the timing depends only on |g|');
        lines.push('# and |slew|, both rotation-invariant, so every interleave shares it.');
        lines.push('ga, sa = pp.traj_to_grad(ka_base)');
        lines.push('dt_grad = np.abs(ga[0] + 1j * ga[1]) / (system.max_grad * safety_margin) * seq.grad_raster_time');
        lines.push('dt_slew = np.sqrt(np.abs(sa[0] + 1j * sa[1]) / (system.max_slew * safety_margin)) * seq.grad_raster_time');
        lines.push('dt_smooth = np.maximum(dt_grad, dt_slew)');
        lines.push('t_smooth = np.concatenate(([0.0], np.cumsum(dt_smooth)))');
        lines.push('t_opt = np.arange(0, np.floor(t_smooth[-1] / seq.grad_raster_time) + 1) * seq.grad_raster_time');
        lines.push('kx_opt = np.interp(t_opt, t_smooth, ka_base[0])');
        lines.push('ky_opt = np.interp(t_opt, t_smooth, ka_base[1])');
        if (isGRE) {
            lines.push('');
            lines.push("gz_reph_spiral = pp.make_trapezoid(channel='z', area=-gz.area / 2, duration=1.5e-3, system=system)");
            lines.push('gz_reph_spiral_duration = pp.calc_duration(gz_reph_spiral)');
            lines.push('');
            lines.push('# A spiral samples the centre of k-space FIRST, so TE runs from the middle');
            lines.push('# of the excitation to the START of the readout.');
            lines.push('te_delay_spiral = te - pp.calc_duration(gz, rf) / 2 - gz_reph_spiral_duration');
            lines.push('te_delay_spiral = max(np.round(te_delay_spiral / system.block_duration_raster) * system.block_duration_raster, 0.0)');
        }
        lines.push('');
        lines.push('# One excitation + spiral readout per interleave');
        lines.push('for i_interleave in range(n_interleaves):');
        lines.push('    # Rotate the shared base arm into place. An earlier version folded the');
        lines.push('    # rotation into the angle as `theta = a * round(8 / n_interleaves) + phi`;');
        lines.push('    # that factor becomes ZERO for n_interleaves >= 16, which freezes theta and');
        lines.push('    # degenerates every arm into a straight radial line — the classic "k-space');
        lines.push('    # collapses to a line" failure. A rotation matrix has no such cliff.');
        lines.push('    phi = i_interleave * (2 * np.pi / n_interleaves)');
        lines.push('    kx_rot = kx_opt * np.cos(phi) - ky_opt * np.sin(phi)');
        lines.push('    ky_rot = kx_opt * np.sin(phi) + ky_opt * np.cos(phi)');
        lines.push('');
        lines.push('    spiral_grad_shape, _ = pp.traj_to_grad(np.stack([kx_rot, ky_rot]))');
        lines.push('');
        lines.push('    # Slew is a VECTOR: ramping x and y together over max(|gx|, |gy|) would let the');
        lines.push('    # combined slew reach sqrt(2) times the limit, so size both ramps by np.hypot.');
        lines.push('');
        lines.push('    # RAMP IN — the hardware requires a waveform to start at zero, and pypulseq');
        lines.push('    # rejects a delayed gradient whose first sample is not zero. An Archimedean');
        lines.push('    # arm leaves the origin at finite speed, so it has to be ramped up to.');
        lines.push('    first_gx, first_gy = spiral_grad_shape[0, 0], spiral_grad_shape[1, 0]');
        lines.push('    ramp_in_time = np.hypot(first_gx, first_gy) / (system.max_slew * safety_margin)');
        lines.push('    n_in = max(int(np.ceil(ramp_in_time / seq.grad_raster_time)), 1)');
        lines.push('    in_x = np.linspace(0.0, first_gx, n_in + 1)[:-1]');
        lines.push('    in_y = np.linspace(0.0, first_gy, n_in + 1)[:-1]');
        lines.push('');
        lines.push('    # RAMP OUT — back to zero so the block connects cleanly to the delay after it.');
        lines.push('    last_gx, last_gy = spiral_grad_shape[0, -1], spiral_grad_shape[1, -1]');
        lines.push('    ramp_time = np.hypot(last_gx, last_gy) / (system.max_slew * safety_margin)');
        lines.push('    ramp_time = np.ceil(ramp_time / seq.grad_raster_time) * seq.grad_raster_time');
        lines.push('    n_ramp = max(int(round(ramp_time / seq.grad_raster_time)), 1)');
        lines.push('    ramp_x = np.linspace(last_gx, 0.0, n_ramp + 1)[1:]');
        lines.push('    ramp_y = np.linspace(last_gy, 0.0, n_ramp + 1)[1:]');
        lines.push('');
        lines.push('    spiral_grad_shape = np.concatenate([');
        lines.push('        np.stack([in_x, in_y]), spiral_grad_shape, np.stack([ramp_x, ramp_y]),');
        lines.push('    ], axis=1)');
        lines.push('');
        lines.push(`    gx_spiral = pp.make_arbitrary_grad(channel='x', waveform=spiral_grad_shape[0], delay=${rephDelayVar}, system=system)`);
        lines.push(`    gy_spiral = pp.make_arbitrary_grad(channel='y', waveform=spiral_grad_shape[1], delay=${rephDelayVar}, system=system)`);
        lines.push('');
        lines.push('    # One ADC sample per gradient raster point, covering the whole waveform. The');
        lines.push('    # ramps are part of the trajectory, so sampling through them costs nothing and');
        lines.push('    # keeps the samples in lock-step with the gradient the reconstruction reads.');
        lines.push(`    adc = pp.make_adc(num_samples=spiral_grad_shape.shape[1], dwell=seq.grad_raster_time,`);
        lines.push(`                      delay=${rephDelayVar}, system=system)`);
        lines.push('');
        if (isGRE) {
            // Only for gradient echo. A spin echo must NOT get a rewinder: its 180
            // already inverts k to (-kx, -ky), and adding gradient area on top of
            // that double-corrects, breaking the symmetry the reconstruction relies
            // on (the image collapses to a line/point at the centre).
            lines.push('    # REWINDER — a gradient echo has no refocusing pulse, so the spiral would end');
            lines.push('    # at the edge of k-space and the next shot would start from there. A spin echo');
            lines.push('    # needs NO rewinder: its 180 already inverts k to (-kx, -ky), and extra area on');
            lines.push('    # top of that collapses the reconstruction to a line through the centre.');
            lines.push('    k_end = np.sum(spiral_grad_shape, axis=1) * seq.grad_raster_time');
            lines.push('    # x and y play together, so each channel may only claim 1/sqrt(2) of the');
            lines.push('    # gradient and slew budget — otherwise the COMBINED vector exceeds the limit.');
            lines.push('    rew_system = pp.Opts(');
            lines.push('        max_grad=system.max_grad / np.sqrt(2),');
            lines.push('        max_slew=system.max_slew * safety_margin / np.sqrt(2),');
            lines.push('        grad_raster_time=system.grad_raster_time,');
            lines.push('    )');
            lines.push('    gx_rew = pp.make_trapezoid(channel=\'x\', area=-k_end[0], system=rew_system)');
            lines.push('    gy_rew = pp.make_trapezoid(channel=\'y\', area=-k_end[1], system=rew_system)');
            lines.push('    rewinder_duration = pp.calc_duration(gx_rew, gy_rew)');
            lines.push('');
        }
        lines.push('    readout_duration = pp.calc_duration(gx_spiral)');
        lines.push('');
        lines.push('    # Long spiral arms blur the image: off-resonance and T2* dephase across the');
        lines.push('    # readout. Keep each arm under ~6 ms by using more interleaves.');
        lines.push('    if readout_duration > 6e-3 and i_interleave == 0:');
        lines.push('        needed = int(np.ceil(n_interleaves * readout_duration / 6e-3))');
        lines.push('        print(f\'WARNING: spiral readout is {readout_duration * 1e3:.1f} ms per arm \'');
        lines.push('              f\'(target <= 6 ms). Use about {needed} interleaves instead of \'');
        lines.push('              f\'{n_interleaves} to stay under the blurring limit.\')');

        const spiralTerms = [];
        if (isGRE) spiralTerms.push('gz_reph_spiral_duration', 'te_delay_spiral');
        spiralTerms.push('readout_duration');
        if (isGRE) spiralTerms.push('rewinder_duration');
        if (is3D) spiralTerms.push('pp.calc_duration(gz_phase)');

        const body = [];
        body.push(trDelayCode(spiralTerms, guardFor(params, 'i_interleave'), params));
        body.push('');
        body.push(rfBlock);
        if (is3D) body.push('    seq.add_block(gz_phase)');
        if (isGRE) {
            body.push('    seq.add_block(gz_reph_spiral)');
            body.push('    seq.add_block(pp.make_delay(te_delay_spiral))');
        }
        body.push('    seq.add_block(gx_spiral, gy_spiral, adc)');
        if (isGRE) body.push('    seq.add_block(gx_rew, gy_rew)  # back to the centre of k-space');
        body.push('    if tr_delay > 0:');
        body.push('        seq.add_block(pp.make_delay(tr_delay))');
        lines.push(...sliceWrap(params, exc, body));
        lines.push('');
        // The ADC is no longer chunked into fixed-length segments, so there is no
        // MaxAdcSegmentLength to declare. Scanners that need a segmented ADC for
        // long spiral readouts would have to reinstate both together.

        return lines.join('\n');
    }

    window.pulseqTemplates.trajectories = {
        cartesian,
        epi,
        radial,
        spiral
    };
})();
