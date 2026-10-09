/**
 * TRAJECTORIES — readout gradient definitions + acquisition loops (PyPulseq).
 *
 * Each trajectory is emitted in TWO parts (column-0-relative Python — the
 * composer applies the final 4-space indent to fit inside `def main():`):
 *
 *   <type>.events(params)   readout / prephasing events, the ADC, their MINT
 *                           raster checks, and `time_to_echo`.
 *   <type>.loop(params)     the acquisition loop. It uses the delays the
 *                           excitation's timing part derived from
 *                           `time_to_echo`, which is why it is emitted last.
 *
 * `time_to_echo` is the contract with excitations.js: the time, in seconds,
 * from the START of this trajectory's first block to the echo — excluding
 * `te_delay`. Whatever a trajectory plays before its echo MUST be counted in
 * it, or TE silently lengthens.
 *
 * Gradient identifiers come from names.js (`N.<key>`); never spell one here.
 * The loop structure adapts to the excitation type via params.excitation.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    const N = window.pulseqTemplates.names.v;
    const { lobeCheck } = window.pulseqTemplates.common;

    // Re-indent a multi-line snippet by N spaces (used to drop RF block code
    // into a `for` loop body written elsewhere in the same template).
    function indent(text, spaces) {
        const pad = ' '.repeat(spaces);
        return text.split('\n').map(line => (line.length ? pad + line : line)).join('\n');
    }

    const is3D = (params) => params.dimension === '3D' && (params.nSlices || 1) > 1;

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

    function sliceWrap(params, exc, bodyLines) {
        const dim = params.dimension;
        if (!hasSliceLoop(params)) return bodyLines;

        const head = [];
        if (dim === 'multislice') {
            head.push('    # Excite each slice in turn: the selection amplitude times z is the');
            head.push('    # frequency offset that moves the excited slice to that position.');
            head.push('    for i_slice in range(n_slices):');
            head.push(`        rf.freq_offset = ${N.gz}.amplitude * z_positions[i_slice]`);
            if (exc === 'spinEcho' || exc === 'inversionRecovery') {
                head.push(`        rf2.freq_offset = ${N.gzRefoc}.amplitude * z_positions[i_slice]`);
            }
            if (exc === 'inversionRecovery') {
                head.push(`        rf_inv.freq_offset = ${N.gzInv}.amplitude * z_positions[i_slice]`);
            }
        } else {
            head.push('    # One kz partition per excitation.');
            head.push('    for i_slice in range(n_slices):');
            head.push(`        ${N.gzEnc} = pp.make_trapezoid(`);
            head.push("            channel='z', area=kz_areas[i_slice], duration=pre_time_z, system=system,");
            head.push('        )');
            head.push(lobeCheck([N.gzEnc], 8));
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
    // blocks; `excitation_duration` comes from excitations.js. The too-short
    // warning goes through mint.warn(), which reports a repeated text once.
    function trDelayCode(terms, params) {
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
            '    if tr_delay < -1e-9:',
            '        mint.warn(',
            `            f'TR = {${budget} * 1e3:.2f} ms per excitation is shorter than this sequence '`,
            "            f'allows; the shortest possible is {iteration_duration * 1e3:.2f} ms.'",
            '        )',
            '    tr_delay = max(mint.round_to(tr_delay, system.block_duration_raster), 0.0)',
        ].join('\n');
    }

    const delayBlock = (name) => `if ${name} > 0:\n    seq.add_block(pp.make_delay(${name}))`;

    // Helper: generate the RF block sequence for one repetition, based on
    // excitation type (GRE, SE, IR). Column-0-relative (caller re-indents).
    function rfBlockCode(exc) {
        const spinEcho = `# 90-degree excitation
seq.add_block(rf, ${N.gz})
seq.add_block(${N.gzReph})
${delayBlock('delay1')}
# 180-degree refocusing
seq.add_block(rf2, ${N.gzRefoc})
seq.add_block(${N.gzRefocReph})
${delayBlock('delay2')}`;

        if (exc === 'inversionRecovery') {
            return `# Inversion pulse
seq.add_block(rf_inv, ${N.gzInv})
seq.add_block(${N.gzInvReph})
${delayBlock('delay_ti')}
${spinEcho}`;
        }
        if (exc === 'spinEcho') return spinEcho;
        // gradientEcho (default) — the slice rephaser is combined with the
        // prephasing gradients in the trajectory block for simultaneous play
        return `seq.add_block(rf, ${N.gz})`;
    }

    // The trapezoidal readout shared by Cartesian, EPI and Radial: the ADC
    // dwell is chosen first, checked against the ADC raster, and the flat top
    // is derived from it on the LOBE raster.
    function readoutLines(readoutTime) {
        return [
            'k_width = n_x * delta_kx',
            `readout_time = ${readoutTime}`,
            '',
            '# Pick the ADC DWELL first and derive the flat top from it. The dwell must be',
            '# an exact integer multiple of adc_raster_time (100 ns): readout_time / n_x is',
            '# not, for many matrix sizes (n_x = 96 gives 26666.7 ns). The request is',
            '# checked - a WARNING lands in the run log - and then snapped down to the',
            '# raster, which is the dwell the sequence really plays.',
            'adc_dwell_requested = readout_time / n_x',
            "mint.check_adc_dwell(adc_dwell_requested, 'Requested ADC dwell (readout_time / n_x)')",
            'adc_dwell = mint.floor_to(adc_dwell_requested, system.adc_raster_time)',
            'adc_duration = n_x * adc_dwell',
            '# The flat top is rounded up to the LOBE raster (2 * grad_raster_time), not',
            '# just the gradient raster, so the middle of the lobe - the echo - stays on',
            '# the gradient raster.',
            'gx_flat_time = mint.ceil_to(adc_duration, lobe_raster)',
            '',
            `${N.gx} = pp.make_trapezoid(`,
            "    channel='x', amplitude=k_width / adc_duration, flat_time=gx_flat_time, system=system,",
            ')',
            '# Centre the ADC window inside the flat top. An ADC may START only on the',
            '# RF raster, so the centring offset is snapped to it.',
            'adc_delay = (',
            `    ${N.gx}.rise_time`,
            '    + mint.floor_to((gx_flat_time - adc_duration) / 2, system.rf_raster_time)',
            ')',
            'adc = pp.make_adc(num_samples=n_x, dwell=adc_dwell, delay=adc_delay, system=system)',
            'mint.check_adc(adc)',
        ];
    }

    const prephaser = (duration) => [
        `${N.gxPre} = pp.make_trapezoid(`,
        `    channel='x', area=-${N.gx}.area / 2 - delta_kx / 2, duration=${duration}, system=system,`,
        ')',
    ];

    // ═════════════════════════════════════════════════════════════════
    //  CARTESIAN
    // ═════════════════════════════════════════════════════════════════
    const cartesian = {
        events(params) {
            const isGRE = params.excitation === 'gradientEcho';
            const lines = [];
            lines.push('# Trajectory: Cartesian (line-by-line)');
            lines.push(...readoutLines('2.56e-3'));
            lines.push('');
            lines.push('pre_time = 1.28e-3');
            lines.push(...prephaser('pre_time'));
            lines.push(lobeCheck([N.gx, N.gxPre]));
            lines.push('');
            lines.push('# The phase-encoding lobe is built per line in the loop below with the same');
            lines.push('# duration (pre_time), so the prephasing block lasts as long as its longest lobe.');
            lines.push(`prephasing_duration = pp.calc_duration(${N.gxPre}${isGRE ? `, ${N.gzReph}` : ''})`);
            lines.push('');
            lines.push('# The echo is the MIDDLE of the readout lobe.');
            lines.push('time_to_echo = (');
            if (is3D(params)) lines.push('    pre_time_z');
            lines.push(`    ${is3D(params) ? '+ ' : ''}prephasing_duration`);
            lines.push(`    + pp.calc_duration(${N.gx}) / 2`);
            lines.push(')');
            return lines.join('\n');
        },

        loop(params) {
            const exc = params.excitation;
            const hasSpoiler = params.spoiler;
            const isGRE = exc === 'gradientEcho';
            const rfBlock = indent(rfBlockCode(exc), 4);

            const lines = [];
            lines.push('for i_phase in range(n_y):');
            lines.push(`    ${N.gyPe} = pp.make_trapezoid(`);
            lines.push("        channel='y',");
            lines.push('        area=-n_y / 2 * delta_ky + i_phase * delta_ky,');
            lines.push('        duration=pre_time,');
            lines.push('        system=system,');
            lines.push('    )');
            lines.push(lobeCheck([N.gyPe], 4));

            const terms = [];
            if (is3D(params)) terms.push('pre_time_z');
            terms.push('prephasing_duration');
            if (isGRE) terms.push('te_delay');
            terms.push(`pp.calc_duration(${N.gx}, adc)`);
            if (hasSpoiler && isGRE) terms.push(`pp.calc_duration(${N.gzSpoil})`);

            const body = [];
            body.push(trDelayCode(terms, params));
            body.push('');
            body.push(rfBlock);
            if (is3D(params)) body.push(`    seq.add_block(${N.gzEnc})`);
            body.push(`    seq.add_block(${N.gxPre}, ${N.gyPe}${isGRE ? `, ${N.gzReph}` : ''})`);
            if (isGRE) body.push(indent(delayBlock('te_delay'), 4));
            body.push(`    seq.add_block(${N.gx}, adc)`);
            if (hasSpoiler && isGRE) body.push(`    seq.add_block(${N.gzSpoil})`);
            body.push(indent(delayBlock('tr_delay'), 4));
            lines.push(...sliceWrap(params, exc, body));

            return lines.join('\n');
        }
    };

    // ═════════════════════════════════════════════════════════════════
    //  EPI
    // ═════════════════════════════════════════════════════════════════
    const epi = {
        events(params) {
            const nShots = params.nShots || 1;
            const isGRE = params.excitation === 'gradientEcho';

            const lines = [];
            lines.push('# Trajectory: EPI (zigzag)');
            lines.push(`n_shots = ${nShots}`);
            lines.push(...readoutLines('12.8e-4'));
            lines.push('');
            lines.push('pre_time = 1.28e-3');
            lines.push(...prephaser('pre_time'));
            const lobes = [N.gx, N.gxPre];
            if (isGRE) {
                lines.push('# Re-time the slice rephaser to the prephasers it plays alongside.');
                lines.push(`${N.gzReph} = pp.make_trapezoid(`);
                lines.push(`    channel='z', area=-${N.gz}.area / 2, duration=pre_time, system=system,`);
                lines.push(')');
                lobes.push(N.gzReph);
            }
            lines.push('');
            lines.push('# Phase blip between readout lines');
            lines.push(`${N.gyBlip} = make_lobe_on_raster('y', n_shots * delta_ky, system, lobe_raster)`);
            lobes.push(N.gyBlip);
            lines.push(lobeCheck(lobes));
            lines.push('');
            lines.push(`amplitude = ${N.gx}.amplitude`);
            lines.push('n_echoes = round(n_y / n_shots)');
            lines.push('');
            lines.push('# The whole echo train plays inside one iteration.');
            lines.push(`line_duration = pp.calc_duration(${N.gx}, adc)`);
            lines.push(`blip_duration = pp.calc_duration(${N.gyBlip})`);
            lines.push('train_duration = n_echoes * line_duration + (n_echoes - 1) * blip_duration');
            lines.push(`prephasing_duration = pp.calc_duration(${N.gxPre}${isGRE ? `, ${N.gzReph}` : ''})`);
            lines.push('');
            lines.push('# The echo is the middle of the line that crosses ky = 0: line');
            lines.push('# n_echoes // 2 of the train, not the middle of the train itself.');
            lines.push('time_to_echo = (');
            if (is3D(params)) lines.push('    pre_time_z');
            lines.push(`    ${is3D(params) ? '+ ' : ''}prephasing_duration`);
            lines.push('    + (n_echoes // 2) * (line_duration + blip_duration)');
            lines.push(`    + pp.calc_duration(${N.gx}) / 2`);
            lines.push(')');
            return lines.join('\n');
        },

        loop(params) {
            const exc = params.excitation;
            const hasSpoiler = params.spoiler;
            const isGRE = exc === 'gradientEcho';
            const rfBlock = indent(rfBlockCode(exc), 4);

            const lines = [];
            lines.push('for i_shot in range(n_shots):');
            lines.push(`    ${N.gyPe} = pp.make_trapezoid(`);
            lines.push("        channel='y',");
            lines.push('        area=-n_y / 2 * delta_ky + i_shot * delta_ky,');
            lines.push('        duration=pre_time,');
            lines.push('        system=system,');
            lines.push('    )');
            lines.push(lobeCheck([N.gyPe], 4));

            const terms = [];
            if (is3D(params)) terms.push('pre_time_z');
            terms.push('prephasing_duration');
            if (isGRE) terms.push('te_delay');
            terms.push('train_duration');
            if (hasSpoiler && isGRE) terms.push(`pp.calc_duration(${N.gzSpoil})`);

            const body = [];
            body.push(trDelayCode(terms, params));
            body.push('');
            body.push(rfBlock);
            if (is3D(params)) body.push(`    seq.add_block(${N.gzEnc})`);
            body.push(`    seq.add_block(${N.gxPre}, ${N.gyPe}${isGRE ? `, ${N.gzReph}` : ''})`);
            if (isGRE) body.push(indent(delayBlock('te_delay'), 4));
            body.push('');
            body.push('    for i_echo in range(n_echoes):');
            body.push(`        ${N.gx}.amplitude = (-1) ** i_echo * amplitude  # reverse polarity of read gradient`);
            body.push(`        seq.add_block(${N.gx}, adc)`);
            body.push('        if i_echo != n_echoes - 1:');
            body.push(`            seq.add_block(${N.gyBlip})  # phase blip`);
            body.push('');
            if (hasSpoiler && isGRE) body.push(`    seq.add_block(${N.gzSpoil})`);
            body.push(indent(delayBlock('tr_delay'), 4));
            lines.push(...sliceWrap(params, exc, body));

            return lines.join('\n');
        }
    };

    // ═════════════════════════════════════════════════════════════════
    //  RADIAL (diametral spokes)
    // ═════════════════════════════════════════════════════════════════
    const radial = {
        events(params) {
            const nSpokes = params.nShots || 400;
            const isGRE = params.excitation === 'gradientEcho';

            const lines = [];
            lines.push('# Trajectory: Radial (diametral spokes)');
            lines.push(`n_spokes = ${nSpokes}`);
            lines.push('spoke_angle_increment = 2 * np.pi / n_spokes');
            lines.push('');
            lines.push(...readoutLines('2.56e-3'));
            lines.push(...prephaser('1e-3'));
            lines.push(lobeCheck([N.gx, N.gxPre]));
            lines.push('');
            lines.push('# The echo is the MIDDLE of the spoke.');
            lines.push('time_to_echo = (');
            const parts = [];
            if (is3D(params)) parts.push('pre_time_z');
            if (isGRE) parts.push(`pp.calc_duration(${N.gzReph})`);
            parts.push(`pp.calc_duration(${N.gxPre})`);
            parts.push(`pp.calc_duration(${N.gx}) / 2`);
            parts.forEach((p, i) => lines.push(`    ${i === 0 ? '' : '+ '}${p}`));
            lines.push(')');
            return lines.join('\n');
        },

        loop(params) {
            const exc = params.excitation;
            const hasSpoiler = params.spoiler;
            const isGRE = exc === 'gradientEcho';
            const rfBlock = indent(rfBlockCode(exc), 4);

            const lines = [];
            lines.push('# Dummy scans to establish steady state. They must run at the same TR as');
            lines.push('# the real spokes, so their recovery delay is TR minus what they play.');
            lines.push('n_dummy = 4');
            lines.push(`dummy_delay = tr - pp.calc_duration(rf, ${N.gz}) - pp.calc_duration(${N.gzReph})`);
            lines.push('dummy_delay = max(mint.round_to(dummy_delay, system.block_duration_raster), 0.0)');
            lines.push('for _ in range(n_dummy):');
            lines.push(`    seq.add_block(rf, ${N.gz})`);
            lines.push(`    seq.add_block(${N.gzReph})`);
            lines.push(indent(delayBlock('dummy_delay'), 4));
            lines.push('');
            lines.push('for i_spoke in range(n_spokes):');
            lines.push('    phi = spoke_angle_increment * i_spoke');

            const terms = [];
            if (is3D(params)) terms.push('pre_time_z');
            if (isGRE) terms.push(`pp.calc_duration(${N.gzReph})`, 'te_delay');
            terms.push(`pp.calc_duration(${N.gxPre})`);
            terms.push(`pp.calc_duration(${N.gx}, adc)`);
            if (hasSpoiler && isGRE) terms.push(`pp.calc_duration(${N.gzSpoil})`);

            const body = [];
            body.push(trDelayCode(terms, params));
            body.push('');
            body.push(rfBlock);
            if (is3D(params)) body.push(`    seq.add_block(${N.gzEnc})`);
            if (isGRE) {
                body.push(`    seq.add_block(${N.gzReph})`);
                body.push(indent(delayBlock('te_delay'), 4));
            }
            body.push('    # pp.rotate splits the lobe into its x and y components for this spoke.');
            body.push(`    seq.add_block(*pp.rotate(${N.gxPre}, angle=phi, axis='z'))`);
            body.push(`    seq.add_block(*pp.rotate(${N.gx}, adc, angle=phi, axis='z'))`);
            if (hasSpoiler && isGRE) body.push(`    seq.add_block(${N.gzSpoil})`);
            body.push(indent(delayBlock('tr_delay'), 4));
            lines.push(...sliceWrap(params, exc, body));

            return lines.join('\n');
        }
    };

    // ═════════════════════════════════════════════════════════════════
    //  SPIRAL (Archimedean)
    // ═════════════════════════════════════════════════════════════════
    // The spiral waveform and its ADC share one delay so they stay aligned.
    // Using the slice rephaser's duration here (as an earlier version did)
    // double-counted it: the rephaser is already its own block.
    const SPIRAL_DELAY = 'system.adc_dead_time';

    const spiral = {
        events(params) {
            const nInterleaves = params.nInterleaves || 5;
            const isGRE = params.excitation === 'gradientEcho';

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
            lines.push('dt_grad = np.abs(ga[0] + 1j * ga[1]) / (system.max_grad * safety_margin) * system.grad_raster_time');
            lines.push('dt_slew = np.sqrt(np.abs(sa[0] + 1j * sa[1]) / (system.max_slew * safety_margin)) * system.grad_raster_time');
            lines.push('dt_smooth = np.maximum(dt_grad, dt_slew)');
            lines.push('t_smooth = np.concatenate(([0.0], np.cumsum(dt_smooth)))');
            lines.push('t_opt = np.arange(0, np.floor(t_smooth[-1] / system.grad_raster_time) + 1) * system.grad_raster_time');
            lines.push('kx_opt = np.interp(t_opt, t_smooth, ka_base[0])');
            lines.push('ky_opt = np.interp(t_opt, t_smooth, ka_base[1])');
            if (isGRE) {
                lines.push('');
                lines.push('# Re-time the slice rephaser: it plays alone, right before the spiral.');
                lines.push(`${N.gzReph} = pp.make_trapezoid(`);
                lines.push(`    channel='z', area=-${N.gz}.area / 2, duration=1.5e-3, system=system,`);
                lines.push(')');
                lines.push(lobeCheck([N.gzReph]));
            }
            lines.push('');
            lines.push('# A spiral samples the centre of k-space FIRST, so the echo is the START of');
            lines.push('# the readout waveform.');
            lines.push('time_to_echo = (');
            const parts = [];
            if (is3D(params)) parts.push('pre_time_z');
            if (isGRE) parts.push(`pp.calc_duration(${N.gzReph})`);
            parts.push(SPIRAL_DELAY);
            parts.forEach((p, i) => lines.push(`    ${i === 0 ? '' : '+ '}${p}`));
            lines.push(')');
            return lines.join('\n');
        },

        loop(params) {
            const exc = params.excitation;
            const isGRE = exc === 'gradientEcho';
            const rfBlock = indent(rfBlockCode(exc), 4);

            const lines = [];
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
            lines.push('    n_in = max(int(np.ceil(ramp_in_time / system.grad_raster_time)), 1)');
            lines.push('    in_x = np.linspace(0.0, first_gx, n_in + 1)[:-1]');
            lines.push('    in_y = np.linspace(0.0, first_gy, n_in + 1)[:-1]');
            lines.push('');
            lines.push('    # RAMP OUT — back to zero so the block connects cleanly to the delay after it.');
            lines.push('    last_gx, last_gy = spiral_grad_shape[0, -1], spiral_grad_shape[1, -1]');
            lines.push('    ramp_time = np.hypot(last_gx, last_gy) / (system.max_slew * safety_margin)');
            lines.push('    ramp_time = np.ceil(ramp_time / system.grad_raster_time) * system.grad_raster_time');
            lines.push('    n_ramp = max(int(round(ramp_time / system.grad_raster_time)), 1)');
            lines.push('    ramp_x = np.linspace(last_gx, 0.0, n_ramp + 1)[1:]');
            lines.push('    ramp_y = np.linspace(last_gy, 0.0, n_ramp + 1)[1:]');
            lines.push('');
            lines.push('    spiral_grad_shape = np.concatenate([');
            lines.push('        np.stack([in_x, in_y]), spiral_grad_shape, np.stack([ramp_x, ramp_y]),');
            lines.push('    ], axis=1)');
            lines.push('');
            lines.push('    # Pad with zeros to a multiple of 4 samples. An even count keeps the waveform');
            lines.push('    # on the lobe raster (2 * grad_raster_time); a multiple of 4 also satisfies');
            lines.push('    # adc_samples_divisor, since the ADC takes one sample per gradient point.');
            lines.push('    n_pad = -spiral_grad_shape.shape[1] % 4');
            lines.push('    spiral_grad_shape = np.concatenate([spiral_grad_shape, np.zeros((2, n_pad))], axis=1)');
            lines.push('');
            lines.push(`    ${N.gxSpiral} = pp.make_arbitrary_grad(`);
            lines.push(`        channel='x', waveform=spiral_grad_shape[0], first=0.0, last=0.0,`);
            lines.push(`        delay=${SPIRAL_DELAY}, system=system,`);
            lines.push('    )');
            lines.push(`    ${N.gySpiral} = pp.make_arbitrary_grad(`);
            lines.push(`        channel='y', waveform=spiral_grad_shape[1], first=0.0, last=0.0,`);
            lines.push(`        delay=${SPIRAL_DELAY}, system=system,`);
            lines.push('    )');
            lines.push('');
            lines.push('    # One ADC sample per gradient raster point, covering the whole waveform. The');
            lines.push('    # ramps are part of the trajectory, so sampling through them costs nothing and');
            lines.push('    # keeps the samples in lock-step with the gradient the reconstruction reads.');
            lines.push('    # The dwell IS the gradient raster, a whole multiple of adc_raster_time - the');
            lines.push('    # check below is what catches it if either raster is ever changed.');
            lines.push('    adc = pp.make_adc(num_samples=spiral_grad_shape.shape[1], dwell=system.grad_raster_time,');
            lines.push(`                      delay=${SPIRAL_DELAY}, system=system)`);
            lines.push('    mint.check_adc(adc)');
            lines.push('');
            const lobes = [N.gxSpiral, N.gySpiral];
            if (isGRE) {
                // Only for gradient echo. A spin echo must NOT get a rewinder: its 180
                // already inverts k to (-kx, -ky), and adding gradient area on top of
                // that double-corrects, breaking the symmetry the reconstruction relies
                // on (the image collapses to a line/point at the centre).
                lines.push('    # REWINDER — a gradient echo has no refocusing pulse, so the spiral would end');
                lines.push('    # at the edge of k-space and the next shot would start from there. A spin echo');
                lines.push('    # needs NO rewinder: its 180 already inverts k to (-kx, -ky), and extra area on');
                lines.push('    # top of that collapses the reconstruction to a line through the centre.');
                lines.push('    k_end = np.sum(spiral_grad_shape, axis=1) * system.grad_raster_time');
                lines.push('    # x and y play together, so each channel may only claim 1/sqrt(2) of the');
                lines.push('    # gradient and slew budget — otherwise the COMBINED vector exceeds the limit.');
                lines.push('    rew_system = pp.Opts(');
                lines.push('        max_grad=system.max_grad / np.sqrt(2),');
                lines.push('        max_slew=system.max_slew * safety_margin / np.sqrt(2),');
                lines.push('        grad_raster_time=system.grad_raster_time,');
                lines.push('    )');
                lines.push(`    ${N.gxRew} = make_lobe_on_raster('x', -k_end[0], rew_system, lobe_raster)`);
                lines.push(`    ${N.gyRoRew} = make_lobe_on_raster('y', -k_end[1], rew_system, lobe_raster)`);
                lines.push(`    rewinder_duration = pp.calc_duration(${N.gxRew}, ${N.gyRoRew})`);
                lines.push('');
                lobes.push(N.gxRew, N.gyRoRew);
            }
            lines.push(lobeCheck(lobes, 4));
            lines.push(`    readout_duration = pp.calc_duration(${N.gxSpiral}, adc)`);
            lines.push('');
            lines.push('    # Long spiral arms blur the image: off-resonance and T2* dephase across the');
            lines.push('    # readout. Keep each arm under ~6 ms by using more interleaves.');
            lines.push('    if readout_duration > 6e-3:');
            lines.push('        needed = int(np.ceil(n_interleaves * readout_duration / 6e-3))');
            lines.push('        mint.warn(');
            lines.push("            f'Spiral readout is {readout_duration * 1e3:.1f} ms per arm (target <= 6 ms). '");
            lines.push("            f'Use about {needed} interleaves instead of {n_interleaves} to stay under '");
            lines.push("            f'the blurring limit.'");
            lines.push('        )');

            const terms = [];
            if (is3D(params)) terms.push('pre_time_z');
            if (isGRE) terms.push(`pp.calc_duration(${N.gzReph})`, 'te_delay');
            terms.push('readout_duration');
            if (isGRE) terms.push('rewinder_duration');

            const body = [];
            body.push(trDelayCode(terms, params));
            body.push('');
            body.push(rfBlock);
            if (is3D(params)) body.push(`    seq.add_block(${N.gzEnc})`);
            if (isGRE) {
                body.push(`    seq.add_block(${N.gzReph})`);
                body.push(indent(delayBlock('te_delay'), 4));
            }
            body.push(`    seq.add_block(${N.gxSpiral}, ${N.gySpiral}, adc)`);
            if (isGRE) body.push(`    seq.add_block(${N.gxRew}, ${N.gyRoRew})  # back to the centre of k-space`);
            body.push(indent(delayBlock('tr_delay'), 4));
            lines.push(...sliceWrap(params, exc, body));
            lines.push('');
            // The ADC is no longer chunked into fixed-length segments, so there is no
            // MaxAdcSegmentLength to declare. Scanners that need a segmented ADC for
            // long spiral readouts would have to reinstate both together.

            return lines.join('\n');
        }
    };

    window.pulseqTemplates.trajectories = {
        cartesian,
        epi,
        radial,
        spiral
    };
})();
