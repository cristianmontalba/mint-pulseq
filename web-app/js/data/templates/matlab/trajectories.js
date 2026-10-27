/**
 * MATLAB / TRAJECTORIES — readout definitions + acquisition loops (Pulseq for MATLAB).
 *
 * The MATLAB mirror of ../trajectories.js: the same two-part contract
 * (`events` defines the readout and `time_to_echo`, `loop` plays it), the same
 * variable names, the same block order. Read that file for the reasoning
 * behind each step; the comments here are the ones the generated script keeps.
 *
 * Two MATLAB-specific points:
 *   - loops are 1-based, so every `i_x` that the Python uses as an offset
 *     appears here as `(i_x - 1)`;
 *   - a block is added with `mint = mint_add_block(mint, seq, ...)`, which runs
 *     the MINT block checks and then calls `seq.addBlock(...)`.
 *
 * Gradient identifiers come from names.js (`N.<key>`); never spell one here.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};
    window.pulseqTemplates.matlab = window.pulseqTemplates.matlab || {};

    const N = window.pulseqTemplates.names.v;
    const { lobeCheck } = window.pulseqTemplates.matlab.common;

    function indent(text, spaces) {
        const pad = ' '.repeat(spaces);
        return text.split('\n').map(line => (line.length ? pad + line : line)).join('\n');
    }

    const is3D = (params) => params.dimension === '3D' && (params.nSlices || 1) > 1;

    function hasSliceLoop(params) {
        return params.dimension !== '2D' && (params.nSlices || 1) > 1;
    }

    const addBlock = (events) => `mint = mint_add_block(mint, seq, ${events});`;
    const delayBlock = (name) =>
        `if ${name} > 0\n    ${addBlock(`mr.makeDelay(${name})`)}\nend`;

    // Wrap one TR's worth of blocks in a slice / partition loop (see the
    // Python sliceWrap for the three cases). `bodyLines` arrive at the encode
    // loop's indent and come back one level deeper, closed by an `end`.
    function sliceWrap(params, exc, bodyLines) {
        const dim = params.dimension;
        if (!hasSliceLoop(params)) return bodyLines;

        const head = [];
        if (dim === 'multislice') {
            head.push('    % Excite each slice in turn: the selection amplitude times z is the');
            head.push('    % frequency offset that moves the excited slice to that position.');
            head.push('    for i_slice = 1:n_slices');
            head.push(`        rf.freqOffset = ${N.gz}.amplitude * z_positions(i_slice);`);
            if (exc === 'spinEcho' || exc === 'inversionRecovery') {
                head.push(`        rf2.freqOffset = ${N.gzRefoc}.amplitude * z_positions(i_slice);`);
            }
            if (exc === 'inversionRecovery') {
                head.push(`        rf_inv.freqOffset = ${N.gzInv}.amplitude * z_positions(i_slice);`);
            }
        } else {
            head.push('    % One kz partition per excitation.');
            head.push('    for i_slice = 1:n_slices');
            head.push(`        ${N.gzEnc} = mr.makeTrapezoid('z', sys, ...`);
            head.push("            'Area', kz_areas(i_slice), 'Duration', pre_time_z);");
            head.push(lobeCheck([N.gzEnc], 8));
        }
        return head.concat(
            bodyLines.join('\n').split('\n').map(l => (l.length ? '    ' + l : l)),
            ['    end']
        );
    }

    // The TR recovery delay for one loop iteration: TR is the PERIOD of an
    // iteration, so the delay is TR minus everything else that plays in it.
    function trDelayCode(terms, params) {
        const all = ['excitation_duration'].concat(terms || []);
        const share = (params && params.dimension === 'multislice' && (params.nSlices || 1) > 1)
            ? ' / n_slices' : '';
        const budget = `tr${share}`;
        const note = share
            ? ['    % The slices share one TR, so each excitation gets TR / n_slices of it.']
            : [];
        return [
            '',
            '    % TR is the period of one iteration: subtract everything else that plays.',
            ...note,
            ...all.map((t, i) => {
                const lead = i === 0 ? '    iteration_duration = ' : '        + ';
                const tail = i === all.length - 1 ? ';' : ' ...';
                return `${lead}${t}${tail}`;
            }),
            `    tr_delay = ${budget} - iteration_duration;`,
            '    % A TR that does not fit gets clamped, so say so instead of silently',
            '    % scanning at a different TR than the one that was asked for.',
            '    if tr_delay < -1e-9',
            '        mint = mint_warn(mint, sprintf([ ...',
            "            'TR = %.2f ms per excitation is shorter than this sequence allows; ' ...",
            `            'the shortest possible is %.2f ms.'], (${budget}) * 1e3, iteration_duration * 1e3));`,
            '    end',
            '    tr_delay = max(mint_round_to(tr_delay, sys.blockDurationRaster), 0);',
        ].join('\n');
    }

    // The RF block sequence for one repetition (column-0-relative).
    function rfBlockCode(exc) {
        const spinEcho = `% 90-degree excitation
${addBlock(`rf, ${N.gz}`)}
${addBlock(N.gzReph)}
${delayBlock('delay1')}
% 180-degree refocusing
${addBlock(`rf2, ${N.gzRefoc}`)}
${addBlock(N.gzRefocReph)}
${delayBlock('delay2')}`;

        if (exc === 'inversionRecovery') {
            return `% Inversion pulse
${addBlock(`rf_inv, ${N.gzInv}`)}
${addBlock(N.gzInvReph)}
${delayBlock('delay_ti')}
${spinEcho}`;
        }
        if (exc === 'spinEcho') return spinEcho;
        return addBlock(`rf, ${N.gz}`);
    }

    // The trapezoidal readout shared by Cartesian, EPI and Radial.
    function readoutLines(readoutTime) {
        return [
            'k_width = n_x * delta_kx;',
            `readout_time = ${readoutTime};`,
            '',
            '% Pick the ADC DWELL first and derive the flat top from it. The dwell must be',
            '% an exact integer multiple of adcRasterTime (100 ns): readout_time / n_x is',
            '% not, for many matrix sizes (n_x = 96 gives 26666.7 ns). The request is',
            '% checked - a WARNING is printed with the report - and then snapped down to',
            '% the raster, which is the dwell the sequence really plays.',
            'adc_dwell_requested = readout_time / n_x;',
            "mint = mint_check_adc_dwell(mint, adc_dwell_requested, 'Requested ADC dwell (readout_time / n_x)');",
            'adc_dwell = mint_floor_to(adc_dwell_requested, sys.adcRasterTime);',
            'adc_duration = n_x * adc_dwell;',
            '% The flat top is rounded up to the LOBE raster (2 * gradRasterTime), not just',
            '% the gradient raster, so the middle of the lobe - the echo - stays on the',
            '% gradient raster.',
            'gx_flat_time = mint_ceil_to(adc_duration, lobe_raster);',
            '',
            `${N.gx} = mr.makeTrapezoid('x', sys, ...`,
            "    'Amplitude', k_width / adc_duration, 'FlatTime', gx_flat_time);",
            '% Centre the ADC window inside the flat top. An ADC may START only on the',
            '% RF raster, so the centring offset is snapped to it.',
            `adc_delay = ${N.gx}.riseTime ...`,
            '    + mint_floor_to((gx_flat_time - adc_duration) / 2, sys.rfRasterTime);',
            "adc = mr.makeAdc(n_x, sys, 'Dwell', adc_dwell, 'Delay', adc_delay);",
            "mint = mint_check_adc(mint, adc, 'adc');",
        ];
    }

    const prephaser = (duration) => [
        `${N.gxPre} = mr.makeTrapezoid('x', sys, ...`,
        `    'Area', -${N.gx}.area / 2 - delta_kx / 2, 'Duration', ${duration});`,
    ];

    // `time_to_echo = a ... + b ... + c;`
    function sumLines(target, parts) {
        return parts.map((p, i) => {
            const lead = i === 0 ? `${target} = ` : '    + ';
            const tail = i === parts.length - 1 ? ';' : ' ...';
            return `${lead}${p}${tail}`;
        });
    }

    // `area` is the ky area expression of one line. Cartesian runs ky from the
    // top line down, (n_y/2 - 1) ... -n_y/2, as in the GRE validated on the Disc
    // Scanner (mint_GRE.m, 2026-10-26); EPI shots keep their bottom-up order.
    const phaseEncodeLobe = (area) => [
        `    ${N.gyPe} = mr.makeTrapezoid('y', sys, ...`,
        `        'Area', ${area}, 'Duration', pre_time);`,
        lobeCheck([N.gyPe], 4),
    ];

    // ═════════════════════════════════════════════════════════════════
    //  CARTESIAN
    // ═════════════════════════════════════════════════════════════════
    const cartesian = {
        events(params) {
            const isGRE = params.excitation === 'gradientEcho';
            const lines = [];
            lines.push('% --- Trajectory: Cartesian (line-by-line) -------------------------------');
            lines.push(...readoutLines('1.28e-3'));
            lines.push('');
            lines.push('pre_time = 1.28e-3;');
            lines.push(...prephaser('pre_time'));
            lines.push(lobeCheck([N.gx, N.gxPre]));
            lines.push('');
            lines.push('% The phase-encoding lobe is built per line in the loop below with the same');
            lines.push('% duration (pre_time), so the prephasing block lasts as long as its longest lobe.');
            lines.push(`prephasing_duration = mr.calcDuration(${N.gxPre}${isGRE ? `, ${N.gzReph}` : ''});`);
            lines.push('');
            lines.push('% The echo is the MIDDLE of the readout lobe.');
            const parts = [];
            if (is3D(params)) parts.push('pre_time_z');
            parts.push('prephasing_duration', `mr.calcDuration(${N.gx}) / 2`);
            lines.push(...sumLines('time_to_echo', parts));
            return lines.join('\n');
        },

        loop(params) {
            const exc = params.excitation;
            const hasSpoiler = params.spoiler;
            const isGRE = exc === 'gradientEcho';

            const lines = [];
            lines.push('% --- Acquisition loop --------------------------------------------------');
            lines.push('for i_phase = 1:n_y');
            lines.push(...phaseEncodeLobe('(n_y / 2 - i_phase) * delta_ky'));

            const terms = [];
            if (is3D(params)) terms.push('pre_time_z');
            terms.push('prephasing_duration');
            if (isGRE) terms.push('te_delay');
            terms.push(`mr.calcDuration(${N.gx}, adc)`);
            if (hasSpoiler && isGRE) terms.push(`mr.calcDuration(${N.gzSpoil})`);

            const body = [];
            body.push(trDelayCode(terms, params));
            body.push('');
            body.push(indent(rfBlockCode(exc), 4));
            if (is3D(params)) body.push(indent(addBlock(N.gzEnc), 4));
            body.push(indent(addBlock(`${N.gxPre}, ${N.gyPe}${isGRE ? `, ${N.gzReph}` : ''}`), 4));
            if (isGRE) body.push(indent(delayBlock('te_delay'), 4));
            body.push(indent(addBlock(`${N.gx}, adc`), 4));
            if (hasSpoiler && isGRE) body.push(indent(addBlock(N.gzSpoil), 4));
            body.push(indent(delayBlock('tr_delay'), 4));
            lines.push(...sliceWrap(params, exc, body));
            lines.push('end');

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
            lines.push('% --- Trajectory: EPI (zigzag) -------------------------------------------');
            lines.push(`n_shots = ${nShots};`);
            lines.push(...readoutLines('12.8e-4'));
            lines.push('');
            lines.push('pre_time = 1.28e-3;');
            lines.push(...prephaser('pre_time'));
            const lobes = [N.gx, N.gxPre];
            if (isGRE) {
                lines.push('% Re-time the slice rephaser to the prephasers it plays alongside.');
                lines.push(`${N.gzReph} = mr.makeTrapezoid('z', sys, ...`);
                lines.push(`    'Area', -${N.gz}.area / 2, 'Duration', pre_time);`);
                lobes.push(N.gzReph);
            }
            lines.push('');
            lines.push('% Phase blip between readout lines');
            lines.push(`${N.gyBlip} = mint_make_lobe('y', n_shots * delta_ky, sys, lobe_raster);`);
            lobes.push(N.gyBlip);
            lines.push(lobeCheck(lobes));
            lines.push('');
            lines.push(`amplitude = ${N.gx}.amplitude;`);
            lines.push('n_echoes = round(n_y / n_shots);');
            lines.push('');
            lines.push('% The whole echo train plays inside one iteration.');
            lines.push(`line_duration = mr.calcDuration(${N.gx}, adc);`);
            lines.push(`blip_duration = mr.calcDuration(${N.gyBlip});`);
            lines.push('train_duration = n_echoes * line_duration + (n_echoes - 1) * blip_duration;');
            lines.push(`prephasing_duration = mr.calcDuration(${N.gxPre}${isGRE ? `, ${N.gzReph}` : ''});`);
            lines.push('');
            lines.push('% The echo is the middle of the line that crosses ky = 0: line');
            lines.push('% floor(n_echoes / 2) of the train (counting from 0), not the middle of the');
            lines.push('% train itself.');
            const parts = [];
            if (is3D(params)) parts.push('pre_time_z');
            parts.push(
                'prephasing_duration',
                'floor(n_echoes / 2) * (line_duration + blip_duration)',
                `mr.calcDuration(${N.gx}) / 2`
            );
            lines.push(...sumLines('time_to_echo', parts));
            return lines.join('\n');
        },

        loop(params) {
            const exc = params.excitation;
            const hasSpoiler = params.spoiler;
            const isGRE = exc === 'gradientEcho';

            const lines = [];
            lines.push('% --- Acquisition loop --------------------------------------------------');
            lines.push('for i_shot = 1:n_shots');
            lines.push(...phaseEncodeLobe('(-n_y / 2 + (i_shot - 1)) * delta_ky'));

            const terms = [];
            if (is3D(params)) terms.push('pre_time_z');
            terms.push('prephasing_duration');
            if (isGRE) terms.push('te_delay');
            terms.push('train_duration');
            if (hasSpoiler && isGRE) terms.push(`mr.calcDuration(${N.gzSpoil})`);

            const body = [];
            body.push(trDelayCode(terms, params));
            body.push('');
            body.push(indent(rfBlockCode(exc), 4));
            if (is3D(params)) body.push(indent(addBlock(N.gzEnc), 4));
            body.push(indent(addBlock(`${N.gxPre}, ${N.gyPe}${isGRE ? `, ${N.gzReph}` : ''}`), 4));
            if (isGRE) body.push(indent(delayBlock('te_delay'), 4));
            body.push('');
            body.push('    for i_echo = 1:n_echoes');
            body.push(`        ${N.gx}.amplitude = (-1) ^ (i_echo - 1) * amplitude;   % reverse polarity of read gradient`);
            body.push(indent(addBlock(`${N.gx}, adc`), 8));
            body.push('        if i_echo ~= n_echoes');
            body.push(`            ${addBlock(N.gyBlip)}   % phase blip`);
            body.push('        end');
            body.push('    end');
            body.push('');
            if (hasSpoiler && isGRE) body.push(indent(addBlock(N.gzSpoil), 4));
            body.push(indent(delayBlock('tr_delay'), 4));
            lines.push(...sliceWrap(params, exc, body));
            lines.push('end');

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
            lines.push('% --- Trajectory: Radial (diametral spokes) ------------------------------');
            lines.push(`n_spokes = ${nSpokes};`);
            lines.push('spoke_angle_increment = 2 * pi / n_spokes;');
            lines.push('');
            lines.push(...readoutLines('2.56e-3'));
            lines.push(...prephaser('1e-3'));
            lines.push(lobeCheck([N.gx, N.gxPre]));
            lines.push('');
            lines.push('% The echo is the MIDDLE of the spoke.');
            const parts = [];
            if (is3D(params)) parts.push('pre_time_z');
            if (isGRE) parts.push(`mr.calcDuration(${N.gzReph})`);
            parts.push(`mr.calcDuration(${N.gxPre})`, `mr.calcDuration(${N.gx}) / 2`);
            lines.push(...sumLines('time_to_echo', parts));
            return lines.join('\n');
        },

        loop(params) {
            const exc = params.excitation;
            const hasSpoiler = params.spoiler;
            const isGRE = exc === 'gradientEcho';

            const lines = [];
            lines.push('% --- Acquisition loop --------------------------------------------------');
            lines.push('% Dummy scans to establish steady state. They must run at the same TR as');
            lines.push('% the real spokes, so their recovery delay is TR minus what they play.');
            lines.push('n_dummy = 4;');
            lines.push(`dummy_delay = tr - mr.calcDuration(rf, ${N.gz}) - mr.calcDuration(${N.gzReph});`);
            lines.push('dummy_delay = max(mint_round_to(dummy_delay, sys.blockDurationRaster), 0);');
            lines.push('for i_dummy = 1:n_dummy');
            lines.push(indent(addBlock(`rf, ${N.gz}`), 4));
            lines.push(indent(addBlock(N.gzReph), 4));
            lines.push(indent(delayBlock('dummy_delay'), 4));
            lines.push('end');
            lines.push('');
            lines.push('for i_spoke = 1:n_spokes');
            lines.push('    phi = spoke_angle_increment * (i_spoke - 1);');

            const terms = [];
            if (is3D(params)) terms.push('pre_time_z');
            if (isGRE) terms.push(`mr.calcDuration(${N.gzReph})`, 'te_delay');
            terms.push(`mr.calcDuration(${N.gxPre})`);
            terms.push(`mr.calcDuration(${N.gx}, adc)`);
            if (hasSpoiler && isGRE) terms.push(`mr.calcDuration(${N.gzSpoil})`);

            const body = [];
            body.push(trDelayCode(terms, params));
            body.push('');
            body.push(indent(rfBlockCode(exc), 4));
            if (is3D(params)) body.push(indent(addBlock(N.gzEnc), 4));
            if (isGRE) {
                body.push(indent(addBlock(N.gzReph), 4));
                body.push(indent(delayBlock('te_delay'), 4));
            }
            body.push('    % mr.rotate splits the lobe into its x and y components for this spoke.');
            body.push(indent(addBlock(`mr.rotate('z', phi, ${N.gxPre})`), 4));
            body.push(indent(addBlock(`mr.rotate('z', phi, ${N.gx}, adc)`), 4));
            if (hasSpoiler && isGRE) body.push(indent(addBlock(N.gzSpoil), 4));
            body.push(indent(delayBlock('tr_delay'), 4));
            lines.push(...sliceWrap(params, exc, body));
            lines.push('end');

            return lines.join('\n');
        }
    };

    // ═════════════════════════════════════════════════════════════════
    //  SPIRAL (Archimedean)
    // ═════════════════════════════════════════════════════════════════
    // The spiral waveform and its ADC share one delay so they stay aligned.
    const SPIRAL_DELAY = 'sys.adcDeadTime';

    const spiral = {
        events(params) {
            const nInterleaves = params.nInterleaves || 5;
            const isGRE = params.excitation === 'gradientEcho';

            const lines = [];
            lines.push('% --- Trajectory: Spiral (Archimedean) -----------------------------------');
            lines.push(`n_interleaves = ${nInterleaves};`);
            lines.push('safety_margin = 0.90;   % stay below hardware limits to absorb rounding error');
            lines.push('grad_raster = sys.gradRasterTime;');
            lines.push('');
            lines.push('% Outer k-space radius the requested resolution demands.');
            lines.push('k_max = n_x / (2 * fov_x);');
            lines.push('');
            lines.push('% Turns per arm. Nyquist needs the arms together to cover k_max in steps of');
            lines.push('% delta_k = 1/FOV, i.e. n_turns * n_interleaves >= k_max / delta_k = n_x / 2.');
            lines.push('n_turns = ceil(n_x / (2 * n_interleaves));');
            lines.push('');
            lines.push('% ONE continuous base arm, sampled finely. 1000 points is NOT enough: the');
            lines.push('% resampling onto the gradient raster then overshoots the slew limit by ~10%.');
            lines.push('% It converges by ~5000; 20000 is cheap because this runs once for all arms.');
            lines.push('n_base = 20000;');
            lines.push('t_base = linspace(0, 1, n_base);');
            lines.push('r_base = k_max * t_base;');
            lines.push('theta_base = 2 * pi * n_turns * t_base;');
            lines.push('ka_base = [r_base .* cos(theta_base); r_base .* sin(theta_base)];');
            lines.push('');
            lines.push('% Gradient and slew of the base arm by finite differences. The gradient sits');
            lines.push('% between k-space points; the slew is averaged back onto the gradient points.');
            lines.push('ga = diff(ka_base, 1, 2) / grad_raster;');
            lines.push('sa_mid = diff(ga, 1, 2) / grad_raster;');
            lines.push('sa = [sa_mid(:, 1), 0.5 * (sa_mid(:, 1:end - 1) + sa_mid(:, 2:end)), sa_mid(:, end)];');
            lines.push('');
            lines.push('% Time-optimal reparametrization, done ONCE - the timing depends only on |g|');
            lines.push('% and |slew|, both rotation-invariant, so every interleave shares it.');
            lines.push('dt_grad = abs(ga(1, :) + 1i * ga(2, :)) / (sys.maxGrad * safety_margin) * grad_raster;');
            lines.push('dt_slew = sqrt(abs(sa(1, :) + 1i * sa(2, :)) / (sys.maxSlew * safety_margin)) * grad_raster;');
            lines.push('dt_smooth = max(dt_grad, dt_slew);');
            lines.push('t_smooth = [0, cumsum(dt_smooth)];');
            lines.push('t_opt = (0:floor(t_smooth(end) / grad_raster)) * grad_raster;');
            lines.push('t_opt = min(t_opt, t_smooth(end));   % interp1 returns NaN past the last point');
            lines.push('kx_opt = interp1(t_smooth, ka_base(1, :), t_opt);');
            lines.push('ky_opt = interp1(t_smooth, ka_base(2, :), t_opt);');
            if (isGRE) {
                lines.push('');
                lines.push('% Re-time the slice rephaser: it plays alone, right before the spiral.');
                lines.push(`${N.gzReph} = mr.makeTrapezoid('z', sys, ...`);
                lines.push(`    'Area', -${N.gz}.area / 2, 'Duration', 1.5e-3);`);
                lines.push(lobeCheck([N.gzReph]));
            }
            lines.push('');
            lines.push('% A spiral samples the centre of k-space FIRST, so the echo is the START of');
            lines.push('% the readout waveform.');
            const parts = [];
            if (is3D(params)) parts.push('pre_time_z');
            if (isGRE) parts.push(`mr.calcDuration(${N.gzReph})`);
            parts.push(SPIRAL_DELAY);
            lines.push(...sumLines('time_to_echo', parts));
            return lines.join('\n');
        },

        loop(params) {
            const exc = params.excitation;
            const isGRE = exc === 'gradientEcho';

            const lines = [];
            lines.push('% --- Acquisition loop --------------------------------------------------');
            lines.push('% One excitation + spiral readout per interleave');
            lines.push('for i_interleave = 1:n_interleaves');
            lines.push('    % Rotate the shared base arm into place with a plain rotation matrix.');
            lines.push('    % Folding the rotation into the angle instead degenerates every arm into');
            lines.push('    % a straight radial line once n_interleaves reaches 16.');
            lines.push('    phi = (i_interleave - 1) * (2 * pi / n_interleaves);');
            lines.push('    kx_rot = kx_opt * cos(phi) - ky_opt * sin(phi);');
            lines.push('    ky_rot = kx_opt * sin(phi) + ky_opt * cos(phi);');
            lines.push('');
            lines.push('    spiral_grad_shape = diff([kx_rot; ky_rot], 1, 2) / grad_raster;');
            lines.push('');
            lines.push('    % Slew is a VECTOR: ramping x and y together over max(|gx|, |gy|) would let the');
            lines.push('    % combined slew reach sqrt(2) times the limit, so size both ramps by hypot.');
            lines.push('');
            lines.push('    % RAMP IN - the hardware requires a waveform to start at zero. An');
            lines.push('    % Archimedean arm leaves the origin at finite speed, so it is ramped up to.');
            lines.push('    first_gx = spiral_grad_shape(1, 1);');
            lines.push('    first_gy = spiral_grad_shape(2, 1);');
            lines.push('    ramp_in_time = hypot(first_gx, first_gy) / (sys.maxSlew * safety_margin);');
            lines.push('    n_in = max(ceil(ramp_in_time / grad_raster), 1);');
            lines.push('    in_x = linspace(0, first_gx, n_in + 1);');
            lines.push('    in_y = linspace(0, first_gy, n_in + 1);');
            lines.push('    in_x = in_x(1:end - 1);');
            lines.push('    in_y = in_y(1:end - 1);');
            lines.push('');
            lines.push('    % RAMP OUT - back to zero so the block connects cleanly to the delay after it.');
            lines.push('    last_gx = spiral_grad_shape(1, end);');
            lines.push('    last_gy = spiral_grad_shape(2, end);');
            lines.push('    ramp_time = hypot(last_gx, last_gy) / (sys.maxSlew * safety_margin);');
            lines.push('    ramp_time = ceil(ramp_time / grad_raster) * grad_raster;');
            lines.push('    n_ramp = max(round(ramp_time / grad_raster), 1);');
            lines.push('    ramp_x = linspace(last_gx, 0, n_ramp + 1);');
            lines.push('    ramp_y = linspace(last_gy, 0, n_ramp + 1);');
            lines.push('    ramp_x = ramp_x(2:end);');
            lines.push('    ramp_y = ramp_y(2:end);');
            lines.push('');
            lines.push('    spiral_grad_shape = [[in_x; in_y], spiral_grad_shape, [ramp_x; ramp_y]];');
            lines.push('');
            lines.push('    % Pad with zeros to a multiple of 4 samples. An even count keeps the waveform');
            lines.push('    % on the lobe raster (2 * gradRasterTime); a multiple of 4 also satisfies');
            lines.push('    % adcSamplesDivisor, since the ADC takes one sample per gradient point.');
            lines.push('    n_pad = mod(-size(spiral_grad_shape, 2), 4);');
            lines.push('    spiral_grad_shape = [spiral_grad_shape, zeros(2, n_pad)];');
            lines.push('');
            lines.push(`    ${N.gxSpiral} = mr.makeArbitraryGrad('x', spiral_grad_shape(1, :), sys, ...`);
            lines.push(`        'Delay', ${SPIRAL_DELAY}, 'first', 0, 'last', 0);`);
            lines.push(`    ${N.gySpiral} = mr.makeArbitraryGrad('y', spiral_grad_shape(2, :), sys, ...`);
            lines.push(`        'Delay', ${SPIRAL_DELAY}, 'first', 0, 'last', 0);`);
            lines.push('');
            lines.push('    % One ADC sample per gradient raster point, covering the whole waveform. The');
            lines.push('    % dwell IS the gradient raster, a whole multiple of adcRasterTime - the check');
            lines.push('    % below is what catches it if either raster is ever changed.');
            lines.push("    adc = mr.makeAdc(size(spiral_grad_shape, 2), sys, ...");
            lines.push(`        'Dwell', grad_raster, 'Delay', ${SPIRAL_DELAY});`);
            lines.push("    mint = mint_check_adc(mint, adc, 'adc');");
            lines.push('');
            const lobes = [N.gxSpiral, N.gySpiral];
            if (isGRE) {
                lines.push('    % REWINDER - a gradient echo has no refocusing pulse, so the spiral would end');
                lines.push('    % at the edge of k-space and the next shot would start from there. A spin echo');
                lines.push('    % needs NO rewinder: its 180 already inverts k to (-kx, -ky), and extra area on');
                lines.push('    % top of that collapses the reconstruction to a line through the centre.');
                lines.push('    k_end = sum(spiral_grad_shape, 2) * grad_raster;');
                lines.push('    % x and y play together, so each channel may only claim 1/sqrt(2) of the');
                lines.push('    % gradient and slew budget - otherwise the COMBINED vector exceeds the limit.');
                lines.push('    rew_sys = mr.opts( ...');
                lines.push("        'MaxGrad', sys.maxGrad / sqrt(2), ...");
                lines.push("        'MaxSlew', sys.maxSlew * safety_margin / sqrt(2), ...");
                lines.push("        'gradRasterTime', grad_raster);");
                lines.push(`    ${N.gxRew} = mint_make_lobe('x', -k_end(1), rew_sys, lobe_raster);`);
                lines.push(`    ${N.gyRoRew} = mint_make_lobe('y', -k_end(2), rew_sys, lobe_raster);`);
                lines.push(`    rewinder_duration = mr.calcDuration(${N.gxRew}, ${N.gyRoRew});`);
                lines.push('');
                lobes.push(N.gxRew, N.gyRoRew);
            }
            lines.push(lobeCheck(lobes, 4));
            lines.push(`    readout_duration = mr.calcDuration(${N.gxSpiral}, adc);`);
            lines.push('');
            lines.push('    % Long spiral arms blur the image: off-resonance and T2* dephase across the');
            lines.push('    % readout. Keep each arm under ~6 ms by using more interleaves.');
            lines.push('    if readout_duration > 6e-3');
            lines.push('        needed = ceil(n_interleaves * readout_duration / 6e-3);');
            lines.push('        mint = mint_warn(mint, sprintf([ ...');
            lines.push("            'Spiral readout is %.1f ms per arm (target <= 6 ms). Use about %d ' ...");
            lines.push("            'interleaves instead of %d to stay under the blurring limit.'], ...");
            lines.push('            readout_duration * 1e3, needed, n_interleaves));');
            lines.push('    end');

            const terms = [];
            if (is3D(params)) terms.push('pre_time_z');
            if (isGRE) terms.push(`mr.calcDuration(${N.gzReph})`, 'te_delay');
            terms.push('readout_duration');
            if (isGRE) terms.push('rewinder_duration');

            const body = [];
            body.push(trDelayCode(terms, params));
            body.push('');
            body.push(indent(rfBlockCode(exc), 4));
            if (is3D(params)) body.push(indent(addBlock(N.gzEnc), 4));
            if (isGRE) {
                body.push(indent(addBlock(N.gzReph), 4));
                body.push(indent(delayBlock('te_delay'), 4));
            }
            body.push(indent(addBlock(`${N.gxSpiral}, ${N.gySpiral}, adc`), 4));
            if (isGRE) body.push(`    ${addBlock(`${N.gxRew}, ${N.gyRoRew}`)}   % back to the centre of k-space`);
            body.push(indent(delayBlock('tr_delay'), 4));
            lines.push(...sliceWrap(params, exc, body));
            lines.push('end');

            return lines.join('\n');
        }
    };

    window.pulseqTemplates.matlab.trajectories = {
        cartesian,
        epi,
        radial,
        spiral
    };
})();
