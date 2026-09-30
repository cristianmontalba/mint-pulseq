/**
 * learn.js — Content for the "Learn Pulseq" section.
 *
 * Exposes the global variable `learnData` (object with a `pages` array).
 * Source material: the SWiM / CAMERA deck "Open Pulse sequence programming
 * for MRI" (Swim_mint_2026.pdf) and the pulseq/pypulseq example repository.
 *
 * Page schema:
 * {
 *   id: 'why-pulseq',     // used in the tab strip and by initLearn(id)
 *   nav: 'Why Pulseq',    // short tab label
 *   title: '...',
 *   lead: '...',          // one paragraph under the title
 *   blocks: [ ... ]       // rendered in order by learn.js
 * }
 *
 * Block types understood by the renderer:
 *   { type: 'prose',  html }
 *   { type: 'cards',  title?, columns?, items: [{ title, sub?, body, tag? }] }
 *   { type: 'flow',   title?, left: {label, items}, hub: {label, sub}, right: {label, items} }
 *   { type: 'steps',  title?, items: [{ title, body }] }
 *   { type: 'table',  title?, head: [], rows: [[]], note? }
 *   { type: 'note',   html }
 *   { type: 'widget', widget: 'seq-anatomy' | 'block-anatomy' | 'raster-clock' }
 *
 * Widget payloads live in `learnData.widgets` so the component stays free of
 * content. Don't put rendering logic in this file.
 */

const learnData = {

    // ─── Data consumed by the interactive widgets ───────────────────
    widgets: {

        /**
         * seq-anatomy — an abridged but self-consistent .seq excerpt.
         * `refs` on each block lists the event rows that block points at,
         * as "<section>:<id>" keys matching the `key` of each event row.
         */
        seqAnatomy: {
            caption: 'An abridged .seq for one TR of a gradient echo. '
                   + 'Hover or focus a block to light up the events it points at.',
            blocks: {
                head: ['id', 'dur', 'rf', 'gx', 'gy', 'gz', 'adc'],
                rows: [
                    {
                        cells: ['1', '40', '1', '0', '0', '1', '0'],
                        label: 'slice-selective excitation',
                        refs: ['rf:1', 'trap:1', 'shape:1', 'shape:2']
                    },
                    {
                        cells: ['2', '20', '0', '2', '3', '4', '0'],
                        label: 'prephasing + phase encoding + slice rephaser',
                        refs: ['trap:2', 'trap:3', 'trap:4']
                    },
                    {
                        cells: ['3', '32', '0', '5', '0', '0', '1'],
                        label: 'readout with the ADC open',
                        refs: ['trap:5', 'adc:1']
                    }
                ]
            },
            sections: [
                {
                    name: '[RF]',
                    hint: 'the pulses',
                    head: ['id', 'mag', 'phase', 'delay', 'freq'],
                    rows: [
                        { key: 'rf:1', cells: ['1', '1', '2', '100', '0'], label: 'sinc, points at two shapes' }
                    ]
                },
                {
                    name: '[TRAP]',
                    hint: 'the gradients',
                    head: ['id', 'amplitude', 'rise', 'flat', 'fall'],
                    rows: [
                        { key: 'trap:1', cells: ['1', '-2.5e+05', '100', '3000', '100'], label: 'slice select' },
                        { key: 'trap:2', cells: ['2', '1.4e+05', '100', '600', '100'], label: 'readout prephaser' },
                        { key: 'trap:3', cells: ['3', '9.0e+04', '100', '600', '100'], label: 'phase encode' },
                        { key: 'trap:4', cells: ['4', '1.2e+05', '100', '600', '100'], label: 'slice rephaser' },
                        { key: 'trap:5', cells: ['5', '2.5e+05', '100', '3000', '100'], label: 'readout' }
                    ]
                },
                {
                    name: '[ADC]',
                    hint: 'the receiver',
                    head: ['id', 'num', 'dwell', 'delay', 'freq'],
                    rows: [
                        { key: 'adc:1', cells: ['1', '256', '3200', '120', '0'], label: '256 samples on the flat top' }
                    ]
                },
                {
                    name: '[SHAPES]',
                    hint: 'the envelopes',
                    head: ['shape_id', 'num_samples'],
                    rows: [
                        { key: 'shape:1', cells: ['1', '4000'], label: 'RF magnitude' },
                        { key: 'shape:2', cells: ['2', '4000'], label: 'RF phase' }
                    ]
                }
            ]
        },

        /**
         * block-anatomy — the five blocks of one gradient-echo TR.
         * `events` is what the detail panel lists when a block is selected.
         */
        blockAnatomy: {
            caption: 'One TR of a gradient echo, block by block. '
                   + 'Select a block to see what plays inside it.',
            blocks: [
                {
                    name: 'slice-selective excitation',
                    duration: '3.0 ms',
                    events: [
                        { ch: 'RF', text: 'apodized sinc, flip angle alpha' },
                        { ch: 'Gz', text: 'slice-select trapezoid' }
                    ],
                    note: 'Two events, one block: the pulse is played <em>while</em> Gz is on. '
                        + 'That simultaneity is what selects a slice — listing them as two '
                        + 'consecutive blocks would excite the whole volume.'
                },
                {
                    name: 'prephasing + phase encoding',
                    duration: '1.0 ms',
                    events: [
                        { ch: 'Gz', text: 'slice rephaser, minus half the slice-select area' },
                        { ch: 'Gy', text: 'phase-encode lobe, one step per TR' },
                        { ch: 'Gx', text: 'readout prephaser' }
                    ],
                    note: 'Three gradient channels at once — the maximum a block allows. '
                        + 'They are independent events that simply share a time slot.'
                },
                {
                    name: 'delay (TE)',
                    duration: 'TE-dependent',
                    events: [
                        { ch: '—', text: 'a pure delay: no RF, no gradient, no ADC' }
                    ],
                    note: 'A block with no events at all is still a block. Its only job is '
                        + 'to occupy time so the echo lands where TE says it should.'
                },
                {
                    name: 'readout + ADC',
                    duration: '3.2 ms',
                    events: [
                        { ch: 'Gx', text: 'readout trapezoid' },
                        { ch: 'ADC', text: 'n_x samples, delayed by the rise time' }
                    ],
                    note: 'The ADC and the gradient must share one block. Sampling while Gx '
                        + 'is at constant amplitude is exactly what frequency encoding means.'
                },
                {
                    name: 'spoiler + delay (TR)',
                    duration: 'TR-dependent',
                    events: [
                        { ch: 'Gz', text: 'spoiler, to dephase leftover transverse magnetization' },
                        { ch: '—', text: 'delay filling out the rest of TR' }
                    ],
                    note: 'The delay is TR <em>minus</em> everything already played in this '
                        + 'iteration — not a whole TR appended on top of it.'
                }
            ]
        },

        /**
         * raster-clock — the three raster times a .seq declares in its header.
         * `us` is the tick length in microseconds.
         */
        rasterClock: {
            caption: 'Drag the duration. A block may only begin and end on a tick of the '
                   + 'raster it is measured against.',
            rasters: [
                { id: 'grad', label: 'Gradients', us: 10, api: 'system.grad_raster_time' },
                { id: 'rf', label: 'RF pulses', us: 1, api: 'system.rf_raster_time' },
                { id: 'adc', label: 'ADC samples', us: 0.1, api: 'system.adc_raster_time' }
            ],
            min: 5,
            max: 150,
            step: 0.5,
            start: 105
        }
    },

    // ─── The pages ──────────────────────────────────────────────────
    pages: [

        // ═══ 1 ═══════════════════════════════════════════════════════
        {
            id: 'why-pulseq',
            nav: 'Why Pulseq',
            title: 'Why Pulseq',
            lead: 'Pulseq separates the description of a sequence from its execution on '
                + 'hardware. That single idea removes the vendor lock-in that has shaped '
                + 'MR sequence development for decades.',
            check: {
                question: 'What does a .seq file actually contain?',
                options: [
                    'Compiled code for one particular vendor',
                    'The explicit list of events, with their amplitudes and timings',
                    'A MATLAB script the scanner executes'
                ],
                answer: 1,
                explain: 'No executable code, and nothing vendor-specific — just numbers. '
                       + 'That is what lets one file run on a Siemens, a GE and a United '
                       + 'Imaging scanner, and what lets you read it in a text editor.'
            },
            blocks: [
                {
                    type: 'prose',
                    html: '<p>Writing a pulse sequence has always meant writing it <em>for one '
                        + 'scanner</em>. Every manufacturer imposes its own programming '
                        + 'environment, with its own language and its own execution model, '
                        + 'and none of them talk to each other. Access is gated by licences, '
                        + 'non-disclosure agreements and specific hardware.</p>'
                        + '<p>The real cost is not the compiler. It is researcher time, and the '
                        + 'fact that two labs cannot simply exchange a file.</p>'
                },
                {
                    type: 'cards',
                    title: 'One environment per vendor',
                    columns: 4,
                    items: [
                        { title: 'Philips', body: 'PARADISE' },
                        { title: 'Siemens', body: 'IDEA' },
                        { title: 'GE', body: 'EPIC' },
                        { title: 'Bruker', body: 'PARAVISION' }
                    ]
                },
                {
                    type: 'flow',
                    title: 'What Pulseq changes',
                    left: {
                        label: 'Written in',
                        items: ['MATLAB / Octave (pulseq)', 'Python (PyPulseq)', 'Graphical tools']
                    },
                    hub: { label: '.seq file', sub: 'plain text · versionable · citable' },
                    right: {
                        label: 'Played by an interpreter on',
                        items: ['Siemens', 'GE (via TOPPE / PulCeq)', 'United Imaging', 'OCRA / FLOCRA', 'Philips (ISMRM 2024)']
                    }
                },
                {
                    type: 'note',
                    html: '<strong>The .seq holds no executable code.</strong> It is the complete, '
                        + 'explicit list of events with their amplitudes and timings. Because it '
                        + 'is plain text, it can be versioned in Git, attached to a paper and '
                        + 'inspected line by line — so the physics in a paper stops being a claim '
                        + 'you have to take on trust. <em>(Layton et al., Magnetic Resonance in '
                        + 'Medicine, 2017.)</em>'
                }
            ]
        },

        // ═══ 2 ═══════════════════════════════════════════════════════
        {
            id: 'seq-file',
            nav: 'The .seq file',
            title: 'Anatomy of a .seq',
            lead: 'A .seq file is a to-do list for the scanner: one row per block, each row '
                + 'pointing at events that are described once and reused.',
            check: {
                question: 'In the [BLOCKS] table, what does a <code>0</code> in the '
                        + '<code>gy</code> column mean?',
                options: [
                    'Gy plays, but with zero amplitude',
                    'No gradient event plays on Gy during that block',
                    'Gy points at the event whose id is 0'
                ],
                answer: 1,
                explain: 'The columns are pointers, not values. A zero is the "nothing here" '
                       + 'pointer — the channel stays idle for the whole block. Event ids '
                       + 'start at 1 precisely so that 0 can mean "none".'
            },
            blocks: [
                { type: 'widget', widget: 'seq-anatomy' },
                {
                    type: 'cards',
                    columns: 3,
                    items: [
                        {
                            title: 'One row per block',
                            body: 'Each row says how long the block lasts and which event to play '
                                + 'on each channel. A zero means nothing happens there.'
                        },
                        {
                            title: 'Written once, reused many times',
                            body: 'The excitation pulse is described a single time. Every block '
                                + 'that needs it just points at it, which is what keeps the file small.'
                        },
                        {
                            title: 'Plain numbers, no vendor code',
                            body: 'Amplitudes in Hz/m, times in raster ticks. Nothing is compiled: '
                                + 'you can open it in any text editor and read it.'
                        }
                    ]
                },
                {
                    type: 'note',
                    html: 'Follow one chain in the table above: block 1 says <code>rf = 1</code>, '
                        + 'so it plays RF event 1; RF event 1 says <code>mag = 1</code> and '
                        + '<code>phase = 2</code>, so its envelope is shapes 1 and 2. Three levels, '
                        + 'and nothing repeated: <strong>blocks → events → shapes</strong>.'
                }
            ]
        },

        // ═══ 3 ═══════════════════════════════════════════════════════
        {
            id: 'blocks',
            nav: 'Blocks',
            title: 'Everything is a block',
            lead: 'A sequence is an ordered list of blocks executed one after another. Within '
                + 'a block, events happen in parallel, not consecutively.',
            check: {
                question: 'You need a 90° pulse and then, immediately after it, a slice '
                        + 'rephaser. How many blocks is that?',
                options: [
                    'One block holding both events',
                    'Two blocks',
                    'Three blocks: pulse, gap, rephaser'
                ],
                answer: 1,
                explain: 'Events inside a block play <em>together</em>. The rephaser has to '
                       + 'come after the pulse, so it needs its own block. Put them in one '
                       + 'block and the rephaser would run during the excitation, undoing it.'
            },
            task: {
                text: 'The Builder draws this same five-block structure for whatever you '
                    + 'configure. Open it on a gradient echo and compare.',
                label: 'Open the Builder on GRE + Cartesian',
                preset: { excitation: 'gradientEcho', trajectory: 'cartesian' }
            },
            blocks: [
                { type: 'widget', widget: 'block-anatomy' },
                {
                    type: 'cards',
                    title: 'The rules a block obeys',
                    columns: 2,
                    items: [
                        {
                            title: 'Blocks in series, events in parallel',
                            body: 'Two things that must happen at the same time go in the same '
                                + 'block. Two things that must happen one after the other go in '
                                + 'two blocks. That is the whole execution model.'
                        },
                        {
                            title: 'At most one of each',
                            body: 'Per block: 1 RF pulse, 3 gradients (Gx, Gy, Gz), 1 ADC, plus '
                                + 'extensions. You cannot play two RF pulses in one block — that '
                                + 'is two blocks.'
                        },
                        {
                            title: 'Nothing sticks out',
                            body: 'No event may exceed the duration of the block that contains it. '
                                + 'The block duration is the envelope everything inside must fit in.'
                        },
                        {
                            title: 'Three-level hierarchy',
                            body: 'Blocks reference events; events reference shapes. Each level is '
                                + 'written once and pointed at from above.'
                        }
                    ]
                },
                {
                    type: 'note',
                    html: 'In PyPulseq every <code>seq.add_block(...)</code> call produces exactly '
                        + 'one region of the timing diagram. The arguments you pass to it are the '
                        + 'events that will play in parallel inside that region.'
                }
            ]
        },

        // ═══ 4 ═══════════════════════════════════════════════════════
        {
            id: 'clock',
            nav: 'The clock',
            title: "The scanner's clock",
            lead: 'The scanner has a clock that ticks. Every event must begin and end on a '
                + 'tick — never in between.',
            check: {
                question: 'A block containing only gradients is 85 µs long. Will the scanner '
                        + 'accept it?',
                options: [
                    'Yes — 85 µs is a perfectly ordinary duration',
                    'No — that is 8.5 gradient ticks, so it is off the grid',
                    'Only if the sequence declares a finer raster'
                ],
                answer: 1,
                explain: 'Gradients tick every 10 µs, so the legal durations near 85 µs are '
                       + '80 and 90. <code>np.ceil(85e-6 / raster) * raster</code> gives 90 µs. '
                       + 'The raster is fixed by the hardware — a sequence cannot ask for a '
                       + 'finer one.'
            },
            task: {
                text: 'Every delay the Builder emits is snapped to the raster. Generate a '
                    + 'spin echo and read the rounding lines in the preview.',
                label: 'Open the Builder on SE + Cartesian',
                preset: { excitation: 'spinEcho', trajectory: 'cartesian', te: 20 }
            },
            blocks: [
                { type: 'widget', widget: 'raster-clock' },
                {
                    type: 'table',
                    title: 'Three parts, three tick rates',
                    head: ['Tick', 'Applies to', 'In PyPulseq'],
                    rows: [
                        ['10 µs', 'Gradients', 'system.grad_raster_time'],
                        ['1 µs', 'RF pulses', 'system.rf_raster_time'],
                        ['100 ns', 'ADC samples', 'system.adc_raster_time']
                    ],
                    note: 'All three are declared in the file header, so the scanner knows the '
                        + 'resolution the sequence was designed at.'
                },
                {
                    type: 'prose',
                    html: '<p><strong>Think of it as graph paper.</strong> You can only draw on the '
                        + 'lines, never between them. A duration that is not a whole number of '
                        + 'ticks simply cannot be played.</p>'
                        + '<p>A duration that is off the grid is the single most common reason a '
                        + 'sequence is rejected at the scanner. It is also the cheapest thing to '
                        + 'catch: one line of code, before you leave your desk.</p>'
                },
                {
                    type: 'note',
                    html: 'This is why every delay the generated scripts emit is snapped to the '
                        + 'raster before <code>pp.make_delay()</code>: '
                        + '<code>delay = np.ceil(delay / raster) * raster</code>. An off-raster '
                        + 'delay passes silently at some TE values and fails '
                        + '<code>seq.check_timing()</code> with a RASTER error at others.'
                }
            ]
        },

        // ═══ 5 ═══════════════════════════════════════════════════════
        {
            id: 'simulate',
            nav: 'Simulate',
            title: 'Simulate, review, then scan',
            lead: 'The .seq is a self-contained object, and therefore fully analysable before '
                + 'you ever touch the scanner.',
            check: {
                question: 'Which call tells you whether the sequence is legal at all?',
                options: [
                    'seq.plot()',
                    'seq.check_timing()',
                    'seq.test_report()'
                ],
                answer: 1,
                explain: '<code>plot()</code> and <code>test_report()</code> describe what the '
                       + 'sequence does; only <code>check_timing()</code> passes a verdict on '
                       + 'whether it can be played. It is also the one you should never skip '
                       + 'to save time — on a large 3D it is slow, and it is still the price '
                       + 'of knowing the sequence is valid.'
            },
            blocks: [
                {
                    type: 'cards',
                    title: 'What the toolbox tells you',
                    columns: 2,
                    items: [
                        { title: 'seq.plot()', tag: 'timing', body: 'The full timing diagram across every channel.' },
                        { title: 'seq.calculate_kspace()', tag: 'trajectory', body: 'The real k-space trajectory, by integrating gradient moments.' },
                        { title: 'seq.check_timing()', tag: 'validity', body: 'Conformance with the rasters and the hardware limits.' },
                        { title: 'seq.test_report()', tag: 'summary', body: 'Automatic summary: TE, TR, resolution, FOV, total duration.' }
                    ]
                },
                {
                    type: 'cards',
                    title: 'Safety, before anyone is in the bore',
                    columns: 2,
                    items: [
                        { title: 'PNS', body: 'Peripheral nerve stimulation estimated from the gradient waveforms.' },
                        { title: 'SAR', body: 'Specific absorption rate estimated against regulatory limits.' }
                    ]
                },
                {
                    type: 'cards',
                    title: 'Bloch simulation on the .seq itself',
                    columns: 3,
                    items: [
                        { title: 'KomaMRI', sub: 'Julia', body: 'GPU-accelerated Bloch simulation with its own graphical interface. Reads .seq directly.' },
                        { title: 'MRzero-Core', sub: 'Python', body: 'Differentiable simulation: lets you optimise the sequence by gradient descent.' },
                        { title: 'JEMRIS', sub: 'C++ / XML', body: 'Mature, general-purpose simulator with cluster parallelisation support.' }
                    ]
                },
                {
                    type: 'note',
                    html: 'All three consume the same <code>.seq</code>, with no conversion. That '
                        + 'is precisely the advantage of an open format: <strong>the tool ecosystem '
                        + 'grows without central coordination</strong>. You get an image on a '
                        + 'numerical phantom with no scanner time spent.'
                }
            ]
        },

        // ═══ 6 ═══════════════════════════════════════════════════════
        {
            id: 'pitfalls',
            nav: 'What breaks',
            title: 'The bugs that pass every check',
            lead: 'The dangerous mistakes in sequence design are not the ones that crash. '
                + 'They are the ones where the sequence builds, check_timing() passes, the '
                + 'scanner runs it — and the image is wrong.',
            check: {
                question: 'Your images come out with the wrong T1 weighting, but '
                        + '<code>check_timing()</code> passes and the scan takes longer than '
                        + 'you expected. What is the most likely cause?',
                options: [
                    'A delay that is off the raster',
                    'seq.add_block(pp.make_delay(tr)) at the end of the loop',
                    'The ADC delay does not match the gradient rise time'
                ],
                answer: 1,
                explain: 'An off-raster delay would have <em>failed</em> the timing check — '
                       + 'that bug is loud. Appending a full TR on top of an iteration that '
                       + 'already played a prologue and a readout is silent: the real TR '
                       + 'becomes TR + everything else, so both the contrast and the scan '
                       + 'time drift.'
            },
            task: {
                text: 'The spiral carries the most corrections of any trajectory here. '
                    + 'Generate one at 16 interleaves and read the comments in the script.',
                label: 'Open the Builder on a 16-interleave spiral',
                preset: {
                    excitation: 'gradientEcho',
                    trajectory: 'spiral',
                    nInterleaves: 16,
                    nShots: 16
                }
            },
            blocks: [
                {
                    type: 'prose',
                    html: '<p>Every entry below was found by running the generated scripts and '
                        + 'checking the result against ground truth, not by reading the '
                        + 'documentation. They are collected here because no tutorial teaches '
                        + 'failure modes — tutorials teach the happy path, and the happy path '
                        + 'is not where the time goes.</p>'
                },
                {
                    type: 'cards',
                    title: 'Silent failures, and how each one gives itself away',
                    columns: 2,
                    items: [
                        {
                            title: 'TR as a suffix',
                            tag: 'timing',
                            body: '<code>add_block(make_delay(tr))</code> at the end of a loop '
                                + 'adds a whole TR <em>on top of</em> the iteration. The real '
                                + 'TR is TR + prologue + readout. <strong>Tell:</strong> the '
                                + 'scan takes longer than n_y · TR. <strong>Fix:</strong> '
                                + 'subtract every block duration from TR.'
                        },
                        {
                            title: 'The prephaser sign in a spin echo',
                            tag: 'k-space',
                            body: 'In a GRE the readout prephaser is negative. In an SE it must '
                                + 'be <strong>positive</strong>, because the 180° already '
                                + 'inverts k to (−kx, −ky). <strong>Tell:</strong> the sequence '
                                + 'is valid and the image is garbage. <strong>Fix:</strong> '
                                + 'integrate the block areas and confirm k = 0 at each excitation.'
                        },
                        {
                            title: 'Clamping a negative delay',
                            tag: 'timing',
                            body: '<code>max(delay, 0)</code> looks defensive. It pins the delay '
                                + 'at zero when TE is too short, so the 180° stops sitting at '
                                + 'TE/2 and the echo never refocuses — and it still passes the '
                                + 'timing check. <strong>Fix:</strong> raise an error naming the '
                                + 'shortest usable TE.'
                        },
                        {
                            title: 'A rewinder on a spin echo',
                            tag: 'k-space',
                            body: 'A spiral gradient echo needs a rewinder to bring k back to '
                                + 'the origin. A spin echo must <strong>not</strong> get one — '
                                + 'its 180° already does it, so the extra area double-corrects '
                                + 'and collapses the image through the centre.'
                        },
                        {
                            title: 'Per-axis gradient limits',
                            tag: 'hardware',
                            body: 'When Gx and Gy play together it is the <em>vector</em> that '
                                + 'must respect max_grad and max_slew. Giving each channel the '
                                + 'full budget overshoots by up to √2 and the sequence is '
                                + 'rejected — or worse, accepted and stressful to the hardware.'
                        },
                        {
                            title: 'The spiral that turns into a line',
                            tag: 'geometry',
                            body: 'Folding the interleave rotation into the angle as '
                                + '<code>theta = a · round(8 / n_interleaves) + phi</code> makes '
                                + 'that factor hit <strong>zero at 16 interleaves</strong> — '
                                + 'exactly the count recommended for a 256² matrix. Every arm '
                                + 'degenerates into a straight radial line.'
                        }
                    ]
                },
                {
                    type: 'note',
                    html: '<strong>The common thread:</strong> none of these is caught by '
                        + '<code>check_timing()</code>, because none of them is a timing '
                        + 'violation. They are physics errors wearing valid syntax. The only '
                        + 'reliable defence is to check the <em>result</em>: integrate the '
                        + 'gradient areas and confirm k returns to zero where it should, and '
                        + 'walk the block durations between excitations to confirm the real TR.'
                },
                {
                    type: 'note',
                    html: '<strong>And one that is not silent.</strong> Rendering, not building, '
                        + 'is what freezes a large 3D: on a 24576-block sequence '
                        + '<code>seq.plot()</code> took <strong>523 s</strong> against 15 s to '
                        + 'build it. Write the .seq <em>before</em> plotting, and guard the '
                        + 'rendering on large sequences — otherwise a crash in matplotlib '
                        + 'costs you the file too.'
                }
            ]
        },

        // ═══ 7 ═══════════════════════════════════════════════════════
        {
            id: 'round-trip',
            nav: 'Round trip',
            title: 'From interface to scanner',
            lead: 'The same file travels the whole way: designed here, verified on a laptop, '
                + 'simulated on a phantom, and finally played unmodified by the scanner.',
            check: {
                question: 'In this app, what produces the .seq file?',
                options: [
                    'The Builder writes it directly from the browser',
                    'You run the Python script the Builder generates',
                    'The scanner generates it from the parameters'
                ],
                answer: 1,
                explain: 'The Builder emits a PyPulseq script. Running it with Python (and '
                       + 'pypulseq installed) is what writes the .seq, along with the diagram '
                       + 'PNGs and the run log. Porting the Pulseq writer to JavaScript would '
                       + 'close that gap — it is not done.'
            },
            blocks: [
                {
                    type: 'steps',
                    items: [
                        { title: 'Visual design', body: 'Parameters and block layout on the platform.' },
                        { title: 'Generation', body: 'PyPulseq source plus a validated .seq file.' },
                        { title: 'Verification', body: 'Timing diagram, k-space, automatic report.' },
                        { title: 'Bloch simulation', body: 'An image on a numerical phantom, no scanner time.' },
                        { title: 'Execution', body: 'The same .seq, unmodified, on the scanner interpreter.' }
                    ]
                },
                {
                    type: 'cards',
                    title: 'Why it matters',
                    columns: 3,
                    items: [
                        {
                            title: 'Reproducibility',
                            body: 'The sequence becomes a scientific object that can be shared, '
                                + 'versioned and cited.'
                        },
                        {
                            title: 'Education',
                            body: 'Students see the direct link between the physics, the timing '
                                + 'diagram and the code — something no textbook manages to convey.'
                        },
                        {
                            title: 'Access',
                            body: 'No dependency on proprietary licences. One protocol, running '
                                + 'across different platforms.'
                        }
                    ]
                },
                {
                    type: 'note',
                    html: '<strong>Where this app sits.</strong> The <em>Sequence Walkthrough</em> '
                        + 'covers the education leg and the <em>Sequence Builder</em> covers '
                        + 'generation — it emits a runnable PyPulseq script, and running that '
                        + 'script produces the .seq. Verification happens in Python, not yet in '
                        + 'the browser; the visual block editor and in-browser Bloch simulation '
                        + 'are not built.'
                }
            ]
        }
    ]
};

window.learnData = learnData;
