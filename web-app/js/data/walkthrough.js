/**
 * walkthrough.js — Data for the step-by-step sequence walkthrough.
 *
 * Exposes the global variable `walkthroughData` (object, NOT an array):
 * one walkthrough per sequence, keyed by id.
 *
 * Each row of the matrix pairs three views of the same instant of the
 * sequence: what the magnetization does (spin), what the scanner plays
 * (hardware) and the Pulseq code that produces it (code).
 *
 * Row schema:
 * {
 *   n: 0,                                   // row number shown in the table
 *   spin:     { label, caption, diagram },  // diagram -> painter in walkthrough.js
 *   hardware: { label, caption, diagram },
 *   code:     { py: '...', matlab: '...' }, // same step in both dialects
 *   explain:  { title, body, formula }      // opened by the "?" button
 * }
 *
 * `body` is raw HTML. `formula` is optional LaTeX (rendered by KaTeX).
 * The reference implementation for every snippet is python/spin_echo.py.
 */

const walkthroughData = {
    'se-2ddft': {
        id: 'se-2ddft',
        title: '2D-DFT Cartesian SE',
        subtitle: 'Sequence name — spin echo with Cartesian readout, step by step',
        intro: 'Each row is one instant of a single TR. Hover a row to link the physics, '
             + 'the hardware and the code; use the "?" button to unfold how the timing is '
             + 'computed. The reference script is python/spin_echo.py.',

        // Real block order emitted inside the phase-encoding loop. The table is
        // ordered didactically (the two halves of TE side by side); this strip
        // shows the order seq.add_block() is actually called in.
        blockOrder: [
            { row: 1, label: 'rf, gz' },
            { row: 1, label: 'gz_reph' },
            { row: 2, label: 'delay TE1' },
            { row: 3, label: 'gx_pre, gy_pre' },
            { row: 5, label: 'rf2, gz2' },
            { row: 5, label: 'gz2_reph' },
            { row: 4, label: 'delay TE2' },
            { row: 6, label: 'gx' },
            { row: 7, label: '+ adc' },
            { row: 8, label: 'delay TR' }
        ],

        rows: [
            // --- 0 -------------------------------------------------
            {
                n: 0,
                spin: {
                    label: 'Alignment with B0',
                    caption: 'Spins precess around B0; their sum is the net magnetization M0 along +z.',
                    diagram: 'spin-b0-align'
                },
                hardware: {
                    label: 'Magnet / resonator',
                    caption: 'Superconducting bore holding B0, with the gradient and RF coils inside.',
                    diagram: 'hw-magnet'
                },
                code: {
                    py: [
                        "system = pp.Opts(",
                        "    max_grad=28, grad_unit='mT/m',",
                        "    max_slew=150, slew_unit='T/m/s',",
                        "    rf_ringdown_time=20e-6,",
                        "    rf_dead_time=100e-6,",
                        "    adc_dead_time=10e-6,",
                        ")",
                        "",
                        "seq = pp.Sequence(system)"
                    ].join('\n'),
                    matlab: [
                        "lims = mr.opts( ...",
                        "    'MaxGrad', 28, 'gradUnit', 'mT/m', ...",
                        "    'MaxSlew', 150, 'SlewUnit', 'T/m/s', ...",
                        "    'rfRingdownTime', 20e-6, ...",
                        "    'rfDeadTime', 100e-6, ...",
                        "    'adcDeadTime', 10e-6);",
                        "",
                        "seq = mr.Sequence(lims);"
                    ].join('\n')
                },
                explain: {
                    title: 'The hardware envelope',
                    body: [
                        '<p><code>Opts</code> is not a sequence event: it is the physical limit every later',
                        'event is checked against. Pulseq refuses to write a sequence that steps outside it.</p>',
                        '<ul>',
                        '  <li><strong>max_grad / max_slew</strong> — the gradient amplifiers. The slew rate',
                        '      bounds how fast a trapezoid can ramp, so it also sets the shortest possible readout.</li>',
                        '  <li><strong>rf_dead_time</strong> — the transmit chain needs this long before the RF',
                        '      can start; it is why every pulse carries <code>delay=system.rf_dead_time</code>.</li>',
                        '  <li><strong>rf_ringdown_time</strong> — the coil keeps ringing after the pulse; nothing',
                        '      may be played during it.</li>',
                        '  <li><strong>adc_dead_time</strong> — the receiver cannot sample immediately after',
                        '      transmit/receive switching.</li>',
                        '</ul>',
                        '<p>When two gradient channels play together each one only gets <code>1/sqrt(2)</code> of',
                        'the budget — the limit applies to the <em>vector</em>, not to each axis separately.</p>'
                    ].join('\n'),
                    formula: '|\\vec{G}| = \\sqrt{G_x^2 + G_y^2 + G_z^2} \\le G_{max}'
                }
            },

            // --- 1 -------------------------------------------------
            {
                n: 1,
                spin: {
                    label: 'Excitation',
                    caption: 'The 90 degree pulse nutates M0 into the transverse plane, creating Mxy.',
                    diagram: 'spin-excitation'
                },
                hardware: {
                    label: 'RF pulse + transmit coil',
                    caption: 'Apodized sinc on the RF channel, played together with the slice-select Gz.',
                    diagram: 'hw-rf-excite'
                },
                code: {
                    py: [
                        "rf, gz, _ = pp.make_sinc_pulse(",
                        "    flip_angle=np.deg2rad(90),",
                        "    duration=3e-3,",
                        "    slice_thickness=slice_thickness,",
                        "    apodization=0.42,",
                        "    time_bw_product=4,",
                        "    system=system,",
                        "    return_gz=True,",
                        "    use='excitation',",
                        ")",
                        "gz_reph = pp.make_trapezoid(",
                        "    channel='z', area=-gz.area / 2,",
                        "    duration=1.28e-3, system=system,",
                        ")",
                        "",
                        "seq.add_block(rf, gz)",
                        "seq.add_block(gz_reph)"
                    ].join('\n'),
                    matlab: [
                        "[rf, gz] = mr.makeSincPulse(pi/2, lims, ...",
                        "    'Duration', 3e-3, ...",
                        "    'SliceThickness', slice_thickness, ...",
                        "    'apodization', 0.5, ...",
                        "    'timeBwProduct', 4);",
                        "",
                        "gzReph = mr.makeTrapezoid('z', lims, ...",
                        "    'Area', -gz.area/2, ...",
                        "    'Duration', 1.28e-3);",
                        "",
                        "seq.addBlock(rf, gz);",
                        "seq.addBlock(gzReph);"
                    ].join('\n')
                },
                explain: {
                    title: 'Slice selection, and why Gz is rephased',
                    body: [
                        '<p>A sinc in time is a rectangle in frequency, so playing it while Gz is on excites one',
                        'slab of Larmor frequencies — one slice. The <em>time-bandwidth product</em> ties the two',
                        'together: for a 3 ms pulse with TBW = 4 the bandwidth is 1333 Hz, and the gradient',
                        'amplitude follows from the slice thickness you asked for.</p>',
                        '<p>Apodization tapers the sinc lobes so the slice profile does not ring.</p>',
                        '<p>The catch: spins at different z inside the slice accumulate different phase while Gz',
                        'is on. <code>gz_reph</code> plays <strong>minus half</strong> of the slice-select area and',
                        'undoes exactly that — without it the slice is dephased before the echo even starts.</p>'
                    ].join('\n'),
                    formula: 'G_z = \\frac{\\mathrm{TBW}}{\\gamma \\cdot \\Delta z \\cdot T_{rf}}'
                }
            },

            // --- 2 -------------------------------------------------
            {
                n: 2,
                spin: {
                    label: 'Delay — first half of TE',
                    caption: 'Free precession: isochromats fan out under T2* (reversible dephasing).',
                    diagram: 'spin-dephase'
                },
                hardware: {
                    label: 'Waiting',
                    caption: 'Nothing is played. The scanner simply lets the clock run.',
                    diagram: 'hw-waiting'
                },
                code: {
                    py: [
                        "raster = seq.grad_raster_time",
                        "rf_center  = rf.delay + pp.calc_rf_center(rf)[0]",
                        "rf2_center = rf2.delay + pp.calc_rf_center(rf2)[0]",
                        "",
                        "te_delay_1 = (",
                        "    te / 2",
                        "    - (pp.calc_duration(gz, rf) - rf_center)",
                        "    - pp.calc_duration(gz_reph)",
                        "    - pp.calc_duration(gx_pre)",
                        "    - rf2_center",
                        ")",
                        "te_delay_1 = np.ceil(te_delay_1 / raster) * raster",
                        "assert te_delay_1 >= 0, 'TE too short before the 180'",
                        "",
                        "seq.add_block(pp.make_delay(te_delay_1))"
                    ].join('\n'),
                    matlab: [
                        "raster = lims.gradRasterTime;",
                        "% centres of the two pulses",
                        "t90c  = rf.delay + mr.calcRfCenter(rf);",
                        "t180c = rf180.delay + mr.calcRfCenter(rf180);",
                        "",
                        "delay1 = TE/2 ...",
                        "       - (mr.calcDuration(rf) - t90c) ...",
                        "       - mr.calcDuration(gzReph) ...",
                        "       - mr.calcDuration(gxPre) ...",
                        "       - t180c;",
                        "delay1 = ceil(delay1/raster)*raster;",
                        "assert(delay1 >= 0, 'TE too short before the 180');",
                        "",
                        "seq.addBlock(mr.makeDelay(delay1));"
                    ].join('\n')
                },
                explain: {
                    title: 'A delay is TE/2 minus everything already played',
                    body: [
                        '<p>TE is measured <strong>peak to peak</strong>: from the centre of the 90 degree pulse',
                        'to the centre of the echo, with the 180 exactly half way. So the delay is not TE/2 — it is',
                        'TE/2 minus every block that already sits between those two centres:</p>',
                        '<ul>',
                        '  <li>the <em>tail</em> of the excitation block, from the RF peak to the end of the block;</li>',
                        '  <li>the slice rephaser;</li>',
                        '  <li>the prephasing block (row 3);</li>',
                        '  <li>the <em>head</em> of the refocusing block, from its start to its RF peak.</li>',
                        '</ul>',
                        '<p>Use <code>calc_rf_center(rf)[0] + rf.delay</code> for the peak, never',
                        '<code>calc_duration(rf)/2</code> — that ignores the dead time and the ringdown and drifts',
                        'by about a millisecond on a 2 ms pulse.</p>',
                        '<p>Two rules this snippet obeys: the delay is snapped to <code>grad_raster_time</code>',
                        '(an off-raster delay fails <code>check_timing()</code>), and a negative result',
                        '<strong>raises</strong> instead of being clamped to zero. Clamping would move the 180 off',
                        'TE/2, the echo would never refocus, and the sequence would still build and still pass the',
                        'timing check — a silently wrong scan.</p>'
                    ].join('\n'),
                    formula: '\\delta_1 = \\frac{TE}{2} - \\left(T_{90} - t_{90}^{c}\\right) - T_{reph} - T_{pre} - t_{180}^{c}'
                }
            },

            // --- 3 -------------------------------------------------
            {
                n: 3,
                spin: {
                    label: 'Pre-gradient',
                    caption: 'A linear phase ramp is written across x and y: spins are tagged by position.',
                    diagram: 'spin-prephase'
                },
                hardware: {
                    label: 'Gradients + k-space jump',
                    caption: 'Gx and Gy trapezoids move the sampling point to the start of one k-space line.',
                    diagram: 'hw-grad-prephase'
                },
                code: {
                    py: [
                        "delta_kx = 1 / fov_x",
                        "delta_ky = 1 / fov_y",
                        "",
                        "gx_pre = pp.make_trapezoid(",
                        "    channel='x', area=gx.area / 2,",
                        "    duration=1.28e-3, system=system,",
                        ")",
                        "gy_pre = pp.make_trapezoid(",
                        "    channel='y',",
                        "    area=0.5 * n_y * delta_ky - i_phase * delta_ky,",
                        "    duration=pp.calc_duration(gx_pre), system=system,",
                        ")",
                        "",
                        "seq.add_block(gx_pre, gy_pre)"
                    ].join('\n'),
                    matlab: [
                        "deltak = 1/fov;",
                        "",
                        "gxPre = mr.makeTrapezoid('x', lims, ...",
                        "    'Area', gx.area/2, ...",
                        "    'Duration', 1.28e-3);",
                        "",
                        "gyPre = mr.makeTrapezoid('y', lims, ...",
                        "    'Area', Ny/2*deltak - (shot-1)*deltak, ...",
                        "    'Duration', mr.calcDuration(gxPre));",
                        "",
                        "seq.addBlock(gxPre, gyPre);"
                    ].join('\n')
                },
                explain: {
                    title: 'Where k goes, and why the sign looks wrong',
                    body: [
                        '<p>A gradient does not move spins, it moves <strong>k</strong>: the position in k-space',
                        'is the running integral of the gradient area.</p>',
                        '<p><code>gy_pre</code> picks the line. Its area steps by <code>dk = 1/FOV</code> per',
                        'iteration, walking from <code>+n_y*dk/2</code> down through zero — one phase-encode line',
                        'per TR, the "DFT" half of 2D-DFT.</p>',
                        '<p><code>gx_pre</code> takes k to the edge of the line so the readout crosses the centre',
                        'of k-space half way through. Note the sign: it is <strong>+gx.area/2</strong>, not minus.',
                        'In a gradient echo this prephaser is negative, but here the 180 that follows inverts k to',
                        '<code>(-kx, -ky)</code>, so the prephaser must push the same way the readout will.',
                        'Getting this sign wrong is the classic spin-echo bug — the sequence builds, the timing',
                        'check passes, and the image is garbage.</p>'
                    ].join('\n'),
                    formula: '\\vec{k}(t) = \\frac{\\gamma}{2\\pi}\\int_0^{t} \\vec{G}(\\tau)\\,d\\tau'
                }
            },

            // --- 4 -------------------------------------------------
            {
                n: 4,
                spin: {
                    label: 'Delay — second half of TE',
                    caption: 'Free precession again, now running the fan back toward coherence.',
                    diagram: 'spin-dephase-wide'
                },
                hardware: {
                    label: 'Waiting',
                    caption: 'Idle time between the refocusing pulse and the readout.',
                    diagram: 'hw-waiting'
                },
                code: {
                    py: [
                        "raster = seq.grad_raster_time",
                        "adc_center = adc.delay + adc.num_samples * adc.dwell / 2",
                        "",
                        "te_delay_2 = (",
                        "    te / 2",
                        "    - (pp.calc_duration(gz2, rf2) - rf2_center)",
                        "    - pp.calc_duration(gz2_reph)",
                        "    - adc_center",
                        ")",
                        "te_delay_2 = np.ceil(te_delay_2 / raster) * raster",
                        "assert te_delay_2 >= 0, 'TE too short after the 180'",
                        "",
                        "# played right after the 180 block - see the note",
                        "seq.add_block(pp.make_delay(te_delay_2))"
                    ].join('\n'),
                    matlab: [
                        "raster = lims.gradRasterTime;",
                        "adcCenter = adc.delay + adc.numSamples*adc.dwell/2;",
                        "",
                        "delay2 = TE/2 ...",
                        "       - (mr.calcDuration(rf180) - t180c) ...",
                        "       - mr.calcDuration(gz180Reph) ...",
                        "       - adcCenter;",
                        "delay2 = ceil(delay2/raster)*raster;",
                        "assert(delay2 >= 0, 'TE too short after the 180');",
                        "",
                        "% played right after the 180 block - see the note",
                        "seq.addBlock(mr.makeDelay(delay2));"
                    ].join('\n')
                },
                explain: {
                    title: 'The second half of TE — and a note on the row order',
                    body: [
                        '<p>Same arithmetic as row 2, now on the other side of the refocusing pulse: from the',
                        'centre of the 180 to the centre of the ADC window. The ADC centre is not the middle of',
                        'the readout block — the ADC starts after <code>gx.rise_time</code>, so it is',
                        '<code>adc.delay + n_x*dwell/2</code>.</p>',
                        '<p><strong>Row order vs block order.</strong> The table lists the two halves of TE',
                        'together, which is how the timing is derived. In the emitted script this delay is played',
                        '<em>after</em> the 180, not before it. The real order is the strip under the table:',
                        '<code>rf,gz -> gz_reph -> d1 -> gx_pre,gy_pre -> rf2,gz2 -> gz2_reph -> d2 -> gx,adc -> d_TR</code>.</p>',
                        '<p>When both delays are satisfied the echo peak lands on the centre of the ADC window,',
                        'which is what TE means.</p>'
                    ].join('\n'),
                    formula: '\\delta_2 = \\frac{TE}{2} - \\left(T_{180} - t_{180}^{c}\\right) - T_{reph2} - t_{adc}^{c}'
                }
            },

            // --- 5 -------------------------------------------------
            {
                n: 5,
                spin: {
                    label: 'Refocusing',
                    caption: 'The 180 mirrors every accumulated phase; the fan starts closing again.',
                    diagram: 'spin-refocus-180'
                },
                hardware: {
                    label: 'RF pulse + transmit coil',
                    caption: 'A second sinc, twice the area, with its own slice-select gradient.',
                    diagram: 'hw-rf-refocus'
                },
                code: {
                    py: [
                        "rf2, gz2, _ = pp.make_sinc_pulse(",
                        "    flip_angle=np.deg2rad(180),",
                        "    duration=3e-3,",
                        "    slice_thickness=slice_thickness,",
                        "    apodization=0.42,",
                        "    time_bw_product=4,",
                        "    system=system,",
                        "    return_gz=True,",
                        "    use='refocusing',",
                        ")",
                        "gz2_reph = pp.make_trapezoid(",
                        "    channel='z', area=-gz2.area / 2,",
                        "    duration=1.28e-3, system=system,",
                        ")",
                        "",
                        "seq.add_block(rf2, gz2)",
                        "seq.add_block(gz2_reph)"
                    ].join('\n'),
                    matlab: [
                        "[rf180, gz180] = mr.makeSincPulse(pi, lims, ...",
                        "    'Duration', 3e-3, ...",
                        "    'SliceThickness', slice_thickness, ...",
                        "    'apodization', 0.5, ...",
                        "    'timeBwProduct', 4);",
                        "",
                        "gz180Reph = mr.makeTrapezoid('z', lims, ...",
                        "    'Area', -gz180.area/2, ...",
                        "    'Duration', 1.28e-3);",
                        "",
                        "seq.addBlock(rf180, gz180);",
                        "seq.addBlock(gz180Reph);"
                    ].join('\n')
                },
                explain: {
                    title: 'What the 180 actually buys you',
                    body: [
                        '<p>Static field inhomogeneity makes spins precess at slightly different rates: after the',
                        'first delay a spin has accumulated phase <code>phi = gamma * dB0 * d1</code>. The 180',
                        'flips the sign of that phase, so an equal wait afterwards brings every isochromat back to',
                        'zero — the echo.</p>',
                        '<p>This is what separates spin echo from gradient echo: the refocusing recovers the',
                        '<strong>T2*</strong> dephasing, leaving the contrast governed by true <strong>T2</strong>.',
                        'What it cannot recover is irreversible spin-spin relaxation.</p>',
                        '<p><code>use=\'refocusing\'</code> is not decoration — the scanner interpreter uses it to',
                        'route the pulse correctly. The flip angle is <code>pi</code>, so the pulse carries twice',
                        'the area of the 90 for the same duration and shape.</p>'
                    ].join('\n'),
                    formula: 'S(TE) = S_0\\, e^{-TE/T_2}'
                }
            },

            // --- 6 -------------------------------------------------
            {
                n: 6,
                spin: {
                    label: 'Readout gradient',
                    caption: 'Frequency encoding: k sweeps across the line while the echo forms.',
                    diagram: 'spin-rephase'
                },
                hardware: {
                    label: 'Gx flat top + k-space traverse',
                    caption: 'One trapezoid on x; k travels from one edge of the line to the other.',
                    diagram: 'hw-grad-readout'
                },
                code: {
                    py: [
                        "delta_kx = 1 / fov_x",
                        "",
                        "gx = pp.make_trapezoid(",
                        "    channel='x',",
                        "    flat_area=n_x * delta_kx,",
                        "    flat_time=2.56e-3,",
                        "    system=system,",
                        ")"
                    ].join('\n'),
                    matlab: [
                        "deltak = 1/fov;",
                        "",
                        "gx = mr.makeTrapezoid('x', lims, ...",
                        "    'FlatArea', Nx*deltak, ...",
                        "    'FlatTime', 2.56e-3);"
                    ].join('\n')
                },
                explain: {
                    title: 'The readout sets the resolution',
                    body: [
                        '<p>The flat top must sweep the full width of k-space, <code>n_x * dk</code> with',
                        '<code>dk = 1/FOV</code>. That is the whole specification: the FOV fixes the spacing of the',
                        'samples, the number of samples fixes how far out k goes, and how far out k goes fixes the',
                        'resolution.</p>',
                        '<p>Only the <strong>flat</strong> part is sampled, which is why the gradient is defined by',
                        '<code>flat_area</code> and <code>flat_time</code> and the ramps are left to the system',
                        'limits. A shorter flat time means a wider receive bandwidth: less chemical-shift',
                        'displacement and a shorter minimum TE, paid for in SNR.</p>'
                    ].join('\n'),
                    formula: '\\Delta x = \\frac{FOV_x}{n_x} = \\frac{1}{n_x \\Delta k_x}, \\qquad |k|_{max} = \\frac{n_x}{2\\,FOV_x}'
                }
            },

            // --- 7 -------------------------------------------------
            {
                n: 7,
                spin: {
                    label: 'ADC on during the readout',
                    caption: 'At the echo peak the isochromats are back in phase; the signal is sampled.',
                    diagram: 'spin-echo-peak'
                },
                hardware: {
                    label: 'Receiver sampling',
                    caption: 'n_x samples taken on the flat top: one k-space line per TR.',
                    diagram: 'hw-adc-record'
                },
                code: {
                    py: [
                        "adc = pp.make_adc(",
                        "    num_samples=n_x,",
                        "    duration=gx.flat_time,",
                        "    delay=gx.rise_time,",
                        "    system=system,",
                        ")",
                        "",
                        "# gradient and ADC are ONE block: sampling happens",
                        "# while the readout gradient is on its flat top",
                        "seq.add_block(gx, adc)"
                    ].join('\n'),
                    matlab: [
                        "adc = mr.makeAdc(Nx, lims, ...",
                        "    'Duration', gx.flatTime, ...",
                        "    'Delay', gx.riseTime);",
                        "",
                        "% gradient and ADC are ONE block: sampling happens",
                        "% while the readout gradient is on its flat top",
                        "seq.addBlock(gx, adc);"
                    ].join('\n')
                },
                explain: {
                    title: 'Why delay = rise_time',
                    body: [
                        '<p>The ADC and the readout gradient go into the <em>same</em> block — that is what makes',
                        'it frequency encoding. <code>delay=gx.rise_time</code> holds sampling off until the ramp',
                        'is over, so every sample is taken at constant gradient amplitude and the samples land on',
                        'an even k-space grid. Sample during the ramp and the grid is non-uniform; the FFT would',
                        'need regridding first.</p>',
                        '<p>The dwell time falls out of the other two numbers, and with it the receive bandwidth:</p>',
                        '<ul>',
                        '  <li><code>dwell = flat_time / n_x</code></li>',
                        '  <li><code>BW = 1/dwell</code> across the whole line</li>',
                        '</ul>',
                        '<p>Each TR fills one horizontal line of the matrix. After <code>n_y</code> repetitions the',
                        'grid is complete and a 2D inverse FFT gives the image — the "2D-DFT" in the name.</p>'
                    ].join('\n'),
                    formula: '\\Delta t = \\frac{T_{flat}}{n_x}, \\qquad BW_{px} = \\frac{1}{T_{flat}}'
                }
            },

            // --- 8 -------------------------------------------------
            {
                n: 8,
                spin: {
                    label: 'Repetition time',
                    caption: 'T1 relaxation: Mz regrows toward M0 before the next excitation.',
                    diagram: 'spin-relax'
                },
                hardware: {
                    label: 'Waiting out TR',
                    caption: 'The longest idle block; it sets the scan time, n_y * TR.',
                    diagram: 'hw-waiting-tr'
                },
                code: {
                    py: [
                        "raster = seq.grad_raster_time",
                        "",
                        "tr_delay = (",
                        "    tr",
                        "    - pp.calc_duration(gz, rf)",
                        "    - pp.calc_duration(gz_reph)",
                        "    - te_delay_1",
                        "    - pp.calc_duration(gx_pre)",
                        "    - pp.calc_duration(gz2, rf2)",
                        "    - pp.calc_duration(gz2_reph)",
                        "    - te_delay_2",
                        "    - pp.calc_duration(gx, adc)",
                        ")",
                        "tr_delay = np.floor(tr_delay / raster) * raster",
                        "assert tr_delay >= 0, 'TR is too short'",
                        "",
                        "seq.add_block(pp.make_delay(tr_delay))"
                    ].join('\n'),
                    matlab: [
                        "raster = lims.gradRasterTime;",
                        "",
                        "trDelay = TR ...",
                        "        - mr.calcDuration(rf, gz) ...",
                        "        - mr.calcDuration(gzReph) ...",
                        "        - delay1 ...",
                        "        - mr.calcDuration(gxPre) ...",
                        "        - mr.calcDuration(rf180, gz180) ...",
                        "        - mr.calcDuration(gz180Reph) ...",
                        "        - delay2 ...",
                        "        - mr.calcDuration(gx, adc);",
                        "trDelay = floor(trDelay/raster)*raster;",
                        "assert(trDelay >= 0, 'TR too short');",
                        "",
                        "seq.addBlock(mr.makeDelay(trDelay));"
                    ].join('\n')
                },
                explain: {
                    title: 'TR is a period, not a suffix',
                    body: [
                        '<p>The tempting one-liner <code>seq.add_block(pp.make_delay(tr))</code> at the end of the',
                        'loop is <strong>wrong</strong>. It appends a whole TR <em>on top of</em> everything the',
                        'iteration already played, so the real repetition time becomes TR + prologue + readout. The',
                        'failure is silent: the sequence builds, <code>check_timing()</code> passes, and the scan',
                        'simply runs at the wrong TR — with the wrong T1 weighting.</p>',
                        '<p>The delay has to be TR <em>minus</em> the duration of every block in the iteration,',
                        'which is what this snippet computes. Note it rounds <strong>down</strong> (the delays',
                        'inside TE round up), so the iteration never overruns the requested period.</p>',
                        '<p>TR also drives the two things the user feels: T1 contrast, and the total scan time.</p>'
                    ].join('\n'),
                    formula: 'S \\propto \\left(1 - e^{-TR/T_1}\\right) e^{-TE/T_2}, \\qquad T_{scan} = n_y \\cdot TR'
                }
            }
        ]
    }
};

window.walkthroughData = walkthroughData;
