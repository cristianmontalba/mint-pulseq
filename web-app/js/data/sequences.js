/**
 * Educational database of MRI sequences.
 *
 * Organized into two categories:
 *   category: 'excitation'  → Excitation types (determined by RF pulses)
 *   category: 'trajectory'  → Trajectories (determined by Gx, Gy gradients)
 *
 * Any real sequence combines ONE excitation + ONE trajectory.
 * The Sequence Builder allows that combination.
 *
 * Each section can have:
 *   content   — plain text (wrapped in <p>; supports \n\n for paragraphs)
 *   html:true — content contains HTML and is injected directly
 *   diagrams  — array of diagram types (see diagrams.js)
 */

const mriData = [

    // ═══════════════════════════════════════════════════════════════════
    //  EXCITATION TYPES — determined by RF pulses
    // ═══════════════════════════════════════════════════════════════════

    {
        id: 'gre',
        category: 'excitation',
        title: 'Gradient Echo (GRE)',
        subtitle: 'RF pulse with excitation flip angle α',
        sections: [
            {
                group: 'Introduction',
                heading: 'Physical Principle',
                content: 'GRE uses a single radiofrequency pulse with an excitation flip angle α (typically less than 90°). It does not employ a 180° refocusing pulse, so the echo is formed solely by the reversal of the readout gradient. This makes the signal dependent on T2* (not true T2) and allows very short repetition times.'
            },
            {
                heading: 'RF Characteristics',
                content: 'Without a refocusing pulse, magnetic field inhomogeneities are NOT corrected. This provides sensitivity to magnetic susceptibility (useful for detecting hemorrhages, calcifications). The contrast depends strongly on the flip angle α: small angles → proton density/T2* weighting; large angles → T1 weighting.'
            },
            {
                group: 'Relaxation',
                heading: 'Nutation and T1 Relaxation',
                content: 'When the RF pulse is applied, the net magnetization M₀ (aligned with B0 along the z-axis) is rotated toward the transverse plane (xy). This process is called nutation: the B1 field of the RF pulse causes M₀ to rotate by an angle α. In GRE, α is typically less than 90°, transferring only a fraction of the magnetization to the xy plane.\n\nImmediately after the pulse, T1 relaxation begins: the longitudinal component Mz recovers exponentially toward M₀ according to Mz(t) = M₀·(1 − e^(−t/T1)). The T1 constant is tissue-specific and depends on the B0 field. At 1.5T: fat ≈ 270 ms, white matter ≈ 780 ms, gray matter ≈ 920 ms, CSF ≈ 4000 ms. Tissues with short T1 (fat) rapidly recover their longitudinal magnetization; tissues with long T1 (CSF) take much longer.',
                diagrams: ['nutation-recovery']
            },
            {
                heading: 'T2 and T2* Decay',
                content: 'Simultaneously with T1 recovery, the transverse magnetization (Mxy) decays through two mechanisms:\n\n• T2 relaxation (spin-spin): random interactions between neighboring spins cause irreversible dephasing. This is an intrinsic tissue property.\n\n• T2* effects: static B0 inhomogeneities add an additional reversible dephasing. The result is a faster decay: 1/T2* = 1/T2 + 1/T2\', where T2\' represents the inhomogeneities.\n\nIn GRE, the echo is formed only by gradient reversal (no 180° pulse), so the inhomogeneities are NOT corrected. The signal depends on T2*, not T2. This makes GRE sensitive to magnetic susceptibility (useful for detecting hemorrhages and calcifications) but vulnerable to artifacts at air-tissue interfaces.',
                diagrams: ['t2-curves']
            },
            {
                group: 'Contrast & Variants',
                heading: 'GRE Contrast: T1, T2* and Proton Density',
                html: true,
                content: '<p>In GRE, contrast is controlled by three parameters: <strong>flip angle (α)</strong>, <strong>TR</strong> and <strong>TE</strong>:</p>' +
                    '<table class="contrast-table">' +
                    '<thead><tr><th>Flip Angle</th><th>TR</th><th>TE</th><th>Weighting</th></tr></thead>' +
                    '<tbody>' +
                    '<tr><td>Large (&gt; 40°)</td><td>Short</td><td>Short</td><td class="cell-t1"><strong>T1</strong></td></tr>' +
                    '<tr><td>Small (&lt; 20°)</td><td>Long</td><td>Long</td><td class="cell-t2"><strong>T2*</strong></td></tr>' +
                    '<tr><td>Small (&lt; 20°)</td><td>Long</td><td>Short</td><td class="cell-dp"><strong>PD</strong></td></tr>' +
                    '</tbody></table>' +
                    '<p>The <strong>Ernst angle</strong> maximizes signal for a given TR: α<sub>E</sub> = arccos(e<sup>−TR/T1</sup>). With a large flip angle and short TR, differences in T1 recovery dominate the contrast. With a small flip angle, long TR and long TE, differences in T2* decay become visible.</p>',
                diagrams: ['t1-curves']
            },
            {
                heading: 'Coherent and Incoherent Sequences',
                content: 'GRE sequences are classified by how they handle residual transverse magnetization between TRs:\n\n• Spoiled / Incoherent (FLASH, SPGR, T1-FFE): after each readout, a spoiler gradient or RF spoiling destroys the residual transverse magnetization. Only Mz contributes to the next excitation. Result: pure T1 contrast (short TR + large flip angle). Typical use: T1-weighted anatomical images, post-contrast.\n\n• Balanced / Coherent (TrueFISP, FIESTA, b-SSFP): ALL gradients (readout, phase, slice) are fully refocused — the net area of each gradient is zero per TR. This preserves both Mz and Mxy, establishing a steady state with T2/T1 contrast. Advantage: very high SNR. Limitation: very sensitive to off-resonance (dark band artifacts).\n\nGradient refocusing is the key to balanced SSFP: each gradient lobe has its symmetric compensating lobe, maintaining phase coherence across multiple TRs.',
                diagrams: ['coherent-incoherent']
            }
        ],
        parameters: [
            { name: 'RF Pulse', value: 'Single pulse, flip angle α (typically 5°–60°)' },
            { name: 'Refocusing', value: 'None (echo formed by gradient reversal)' },
            { name: 'Contrast', value: 'Depends on T1, T2* and flip angle α' },
            { name: 'Speed', value: 'Fast (very short TR possible)' }
        ],
        equation: 'S = \\rho \\frac{\\sin(\\alpha)(1 - e^{-TR/T1})}{1 - \\cos(\\alpha)\\,e^{-TR/T1}} \\cdot e^{-TE/T2^*}',
        animationType: 'gre-rf'
    },
    {
        id: 'spinecho',
        category: 'excitation',
        title: 'Spin Echo (SE)',
        subtitle: '90° Excitation + 180° Refocusing',
        sections: [
            {
                group: 'Introduction',
                heading: 'Physical Principle',
                content: 'Spin Echo uses a 90° excitation pulse followed by a 180° refocusing pulse. The 180° pulse reverses the dephasing caused by B0 field inhomogeneities, producing an echo that depends on the true T2 of the tissue (not T2*). This makes it robust against susceptibility artifacts.'
            },
            {
                heading: 'RF Characteristics',
                content: 'The timing sequence is: 90° pulse → wait TE/2 → 180° pulse → wait TE/2 → echo. The 180° pulse "refocuses" the spins, eliminating the effect of static inhomogeneities. The trade-off is a longer TR (T1 recovery must be waited for), making acquisition slower than GRE.'
            },
            {
                group: 'Refocusing',
                heading: 'The 90° Pulse and 180° Refocusing',
                content: 'The 90° pulse rotates all longitudinal magnetization (Mz = M₀) into the transverse plane. Immediately after, all spins are in phase and the signal is at its maximum. But they quickly begin to dephase: spins in regions with a stronger field precess faster ("get ahead") and those in weaker field regions precess slower ("fall behind"). A "fan" of phases opens up, reducing the signal.\n\nAt time TE/2, the 180° pulse is applied, acting like a mirror: it inverts the phase positions of all spins. Those that were ahead are now behind and vice versa. Since they continue precessing at the same speed, at time TE they meet again in phase, forming the spin echo.\n\nKey point: the 180° pulse ONLY corrects dephasing from static B0 inhomogeneities (T2\' effect). Dephasing from random spin-spin interactions (true T2) is irreversible and is NOT corrected. This is why Spin Echo produces pure T2 contrast.',
                diagrams: ['spin-refocus']
            },
            {
                group: 'Relaxation & Contrast',
                heading: 'T1 and T2 Relaxation',
                content: 'After the 90° pulse, two simultaneous and independent processes occur:\n\nT1 relaxation (longitudinal recovery): the Mz component grows exponentially from 0 toward M₀ according to Mz(t) = M₀·(1 − e^(−t/T1)). Tissues with short T1 (fat ≈ 270 ms at 1.5T) recover Mz quickly → they produce strong signal if excited soon (short TR). Tissues with long T1 (CSF ≈ 4000 ms) have barely recovered → weak signal.\n\nT2 relaxation (transverse decay): the Mxy component decays exponentially according to Mxy(t) = M₀·e^(−t/T2). Tissues with long T2 (CSF ≈ 2000 ms) maintain coherence for a long time → persistent signal. Tissues with short T2 (muscle ≈ 45 ms) lose signal quickly.\n\nThe combination of how much Mz has recovered (controlled by TR) and how much Mxy has decayed (controlled by TE) determines the image contrast.',
                diagrams: ['t1-curves', 't2-curves']
            },
            {
                heading: 'T1, T2 and Proton Density Contrast',
                html: true,
                content: '<p>The signal in Spin Echo is: S ∝ ρ · (1 − e<sup>−TR/T1</sup>) · e<sup>−TE/T2</sup>. The first factor depends on TR and T1; the second on TE and T2. The combination of TR and TE selects the weighting:</p>' +
                    '<table class="contrast-table">' +
                    '<thead><tr>' +
                    '<th></th>' +
                    '<th>Short TE<br><span class="table-hint">10-20 ms</span></th>' +
                    '<th>Long TE<br><span class="table-hint">80-120 ms</span></th>' +
                    '</tr></thead>' +
                    '<tbody>' +
                    '<tr>' +
                    '<th>Short TR<br><span class="table-hint">400-600 ms</span></th>' +
                    '<td class="cell-t1"><strong>T1-Weighted</strong><br>Fat → bright<br>CSF → dark</td>' +
                    '<td class="cell-na"><strong>Not useful</strong><br>Very low signal<br>Mixed contrast</td>' +
                    '</tr>' +
                    '<tr>' +
                    '<th>Long TR<br><span class="table-hint">2000+ ms</span></th>' +
                    '<td class="cell-dp"><strong>PD-Weighted</strong><br>Proton density<br>Soft contrast</td>' +
                    '<td class="cell-t2"><strong>T2-Weighted</strong><br>CSF → bright<br>Muscle → dark</td>' +
                    '</tr>' +
                    '</tbody></table>' +
                    '<ul>' +
                    '<li><strong>Short TR</strong> → the factor (1 − e<sup>−TR/T1</sup>) differentiates tissues with different T1. Fat (short T1) recovers quickly → high signal. CSF (long T1) barely recovers → low signal.</li>' +
                    '<li><strong>Long TR</strong> → all tissues reach equilibrium → T1 difference is erased.</li>' +
                    '<li><strong>Long TE</strong> → the factor e<sup>−TE/T2</sup> differentiates tissues with different T2. CSF (long T2) maintains signal → bright.</li>' +
                    '<li><strong>Short TE</strong> → all tissues retain signal → T2 difference is erased.</li>' +
                    '</ul>'
            }
        ],
        parameters: [
            { name: 'Excitation Pulse', value: '90°' },
            { name: 'Refocusing Pulse', value: '180° (at TE/2 after the 90° pulse)' },
            { name: 'Contrast', value: 'True T2 (insensitive to B0 inhomogeneities)' },
            { name: 'Speed', value: 'Moderate to slow (long TRs)' }
        ],
        equation: 'S = k \\cdot \\rho \\cdot (1 - e^{-TR/T1}) \\cdot e^{-TE/T2}',
        animationType: 'se-rf'
    },
    {
        id: 'ir',
        category: 'excitation',
        title: 'Inversion Recovery (IR)',
        subtitle: '180° Inversion + 90° Excitation + 180° Refocusing',
        sections: [
            {
                group: 'Introduction',
                heading: 'Physical Principle',
                content: 'Inversion Recovery (IR) is a magnetization preparation that precedes any acquisition sequence (typically Spin Echo). Its fundamental characteristic is a 180° inversion pulse that rotates the longitudinal magnetization from +M₀ to −M₀. From that moment, Mz recovers exponentially from −M₀ toward +M₀ following each tissue\'s T1 constant.\n\nThe time between the inversion pulse and the excitation pulse is called TI (Inversion Time). This parameter is IR\'s most powerful tool: each tissue crosses zero (Mz = 0) at a different instant. If the 90° excitation pulse arrives exactly when a tissue has Mz = 0, that tissue produces no signal → it is suppressed in the image.'
            },
            {
                heading: 'Pulse Sequence',
                content: 'The complete timing sequence is: 180° (inversion) → wait TI → 90° (excitation) → wait TE/2 → 180° (refocusing) → echo. The block after TI is essentially a standard Spin Echo sequence. Therefore, IR inherits the properties of SE: the echo depends on true T2 (not T2*), it is robust against susceptibility artifacts, and T2 contrast is controlled by TE.\n\nThe inversion pulse can be a hard pulse (rectangular, fast but imperfect) or an adiabatic pulse (slower but guarantees uniform inversion even with B1 inhomogeneities). In clinical practice, adiabatic pulses are preferred to ensure complete and uniform inversion throughout the volume.'
            },
            {
                group: 'Post-Inversion Recovery',
                heading: 'T1 Recovery from −M₀',
                content: 'After the 180° inversion pulse, each tissue\'s magnetization recovers according to:\n\nMz(t) = M₀ · (1 − 2·e^(−t/T1))\n\nThis curve starts at −M₀ (t = 0), crosses zero at a specific time, and asymptotically approaches +M₀. The recovery speed depends exclusively on the tissue\'s T1:\n\n• Fat (T1 ≈ 270 ms at 1.5T): recovers rapidly, crosses zero at ~187 ms.\n• White matter (T1 ≈ 780 ms): crosses zero at ~541 ms.\n• Gray matter (T1 ≈ 920 ms): crosses zero at ~638 ms.\n• CSF (T1 ≈ 4000 ms): very slow recovery, crosses zero at ~2773 ms.\n\nThe dynamic range of Mz spans from −M₀ to +M₀ (twice that of SE, which spans 0 to +M₀). This gives IR greater separation between tissues with different T1 values, producing the strongest T1 contrast of all sequences.',
                diagrams: ['ir-recovery']
            },
            {
                heading: 'Inversion Time and Null Point',
                content: 'The null point is the instant when Mz = 0 for a given tissue. It is easily calculated:\n\nTI_null = T1 · ln(2) ≈ 0.693 · T1\n\nIf the 90° excitation pulse is applied exactly at a tissue\'s null point, that tissue has Mz = 0, transfers no magnetization to the transverse plane, and produces no signal. The result: that tissue appears black in the image, regardless of its proton density or T2.\n\nThis selective suppression is impossible to achieve with standard SE or GRE, where contrasts can only be weighted but specific tissues cannot be nulled. The selectivity of TI is what makes IR indispensable in neuroimaging (FLAIR) and in musculoskeletal/abdominal imaging (STIR).'
            },
            {
                group: 'Contrast & Clinical Variants',
                heading: 'IR Contrast',
                html: true,
                content: '<p>IR contrast depends on <strong>three parameters</strong>: TI controls which tissue is suppressed, TR controls the T1 recovery between successive inversions, and TE controls the T2 weighting of the Spin Echo block:</p>' +
                    '<table class="contrast-table">' +
                    '<thead><tr>' +
                    '<th>Variant</th>' +
                    '<th>TI</th>' +
                    '<th>TR</th>' +
                    '<th>TE</th>' +
                    '<th>Effect</th>' +
                    '</tr></thead>' +
                    '<tbody>' +
                    '<tr>' +
                    '<td class="cell-t1"><strong>Standard IR</strong></td>' +
                    '<td>Intermediate</td><td>Long</td><td>Short</td>' +
                    '<td>Maximum T1 contrast (range −M₀ to +M₀)</td>' +
                    '</tr>' +
                    '<tr>' +
                    '<td class="cell-dp"><strong>STIR</strong></td>' +
                    '<td>~150 ms</td><td>Long</td><td>Short-Medium</td>' +
                    '<td>Suppresses fat (TI = T1_fat · ln2)</td>' +
                    '</tr>' +
                    '<tr>' +
                    '<td class="cell-t2"><strong>FLAIR</strong></td>' +
                    '<td>~2400 ms</td><td>Very long</td><td>Long</td>' +
                    '<td>Suppresses CSF → periventricular lesions visible</td>' +
                    '</tr>' +
                    '</tbody></table>' +
                    '<p><strong>Magnitude vs. Real Phase:</strong> magnitude reconstruction (|Mz|) is normally used, which makes tissues with negative Mz appear bright instead of dark. In real-phase reconstruction (phase-sensitive IR, PSIR), the sign of Mz is preserved, providing greater dynamic range of contrast and better delineation of the null point.</p>'
            },
            {
                heading: 'STIR and FLAIR',
                content: 'STIR (Short TI Inversion Recovery): uses a short TI (~150 ms at 1.5T) that coincides with the null point of fat. Result: fat appears black, making lesions with edema visible in bones, muscles, and subcutaneous tissues. STIR suppresses fat based on T1, not on resonance frequency, so it works even with inhomogeneous fields where spectral fat suppression fails.\n\nFLAIR (Fluid-Attenuated Inversion Recovery): uses a long TI (~2400–2800 ms at 1.5T) that coincides with the null point of CSF. Result: CSF appears black and periventricular lesions (multiple sclerosis plaques, infarcts, gliosis) are clearly visualized. It is used routinely in neuroimaging. The TE is long to add T2 weighting, highlighting lesions that also have elevated T2.\n\nMain limitation of IR: acquisition times are long because TR must be sufficient to allow complete recovery of Mz before the next inversion (TR > 5·T1 of the slowest tissue). To mitigate this, it is frequently combined with fast acquisitions such as Turbo/Fast Spin Echo or EPI.'
            }
        ],
        parameters: [
            { name: 'Inversion Pulse', value: '180° (adiabatic or hard pulse)' },
            { name: 'TI (Inversion Time)', value: 'Variable — TI_null = T1 · ln(2)' },
            { name: 'Excitation + Refocusing', value: '90° + 180° (Spin Echo block)' },
            { name: 'Variants', value: 'STIR (TI~150 ms), FLAIR (TI~2400 ms), PSIR' }
        ],
        equation: 'S = k \\cdot \\rho \\cdot \\left|1 - 2\\,e^{-TI/T1} + e^{-TR/T1}\\right| \\cdot e^{-TE/T2}',
        animationType: 'ir-rf'
    },

    // ═══════════════════════════════════════════════════════════════════
    //  TRAJECTORIES — determined by Gx, Gy gradients
    // ═══════════════════════════════════════════════════════════════════

    {
        id: 'cartesian',
        category: 'trajectory',
        title: '2D-DFT Cartesian',
        subtitle: 'Line-by-line k-space filling',
        sections: [
            {
                heading: 'Physical Principle',
                content: 'The Cartesian trajectory fills k-space line by line. In each TR, the phase-encoding gradient (Gy) positions the readout on a different ky line, while the readout gradient (Gx) traverses kx from left to right. It is the most commonly used trajectory in clinical MRI due to its simplicity and robustness.'
            },
            {
                heading: 'Advantages and Limitations',
                content: 'Advantages: simple reconstruction with direct FFT, low computational cost, compatible with parallel acceleration (GRAPPA, SENSE). Limitations: total acquisition time is N×TR (one line per TR), which can be slow for large matrices or long TRs.'
            }
        ],
        parameters: [
            { name: 'Gx (Readout)', value: 'Constant during each readout → traverses kx' },
            { name: 'Gy (Phase)', value: 'Changes each TR → selects the ky line' },
            { name: 'Total Time', value: 'N_phase × TR' },
            { name: 'Reconstruction', value: 'Direct 2D FFT' }
        ],
        equation: 'k_x(t) = \\gamma \\int_0^t G_x(\\tau)\\,d\\tau, \\quad k_y = \\gamma \\cdot \\Delta G_y \\cdot t_{pe}',
        animationType: 'gre'
    },
    {
        id: 'epi',
        category: 'trajectory',
        title: 'Echo Planar Imaging (EPI)',
        subtitle: 'Ultra-fast zigzag k-space filling',
        sections: [
            {
                heading: 'Physical Principle',
                content: 'EPI fills ALL of k-space after a single excitation pulse (single-shot) or a few (multi-shot). The readout gradient (Gx) oscillates rapidly from positive to negative, creating a zigzag path, while small Gy "blips" advance from one ky line to the next.'
            },
            {
                heading: 'Advantages and Limitations',
                content: 'Advantages: acquisition in less than 100 ms per slice, fundamental for fMRI, diffusion (DWI) and perfusion. Limitations: very sensitive to B0 inhomogeneities (geometric distortions and ghosting), limited spatial resolution, and requires very powerful hardware gradients.'
            }
        ],
        parameters: [
            { name: 'Gx (Readout)', value: 'Oscillating (zigzag) → traverses kx in both directions' },
            { name: 'Gy (Blips)', value: 'Short pulses between each echo → advances ky' },
            { name: 'Speed', value: 'Ultra-fast (< 100 ms per slice)' },
            { name: 'Reconstruction', value: '2D FFT (with phase correction for even echoes)' }
        ],
        equation: 'S(t) = S_0 \\cdot e^{-TE_{eff}/T2^*}',
        animationType: 'epi'
    },
    {
        id: 'radial',
        category: 'trajectory',
        title: 'Radial',
        subtitle: 'Diametral filling with rotated spokes',
        sections: [
            {
                heading: 'Physical Principle',
                content: 'The radial trajectory fills k-space by tracing diameters that pass through the center, each at a different angle. In each TR, the Gx and Gy gradients are combined as Gx = G·cos(θ) and Gy = G·sin(θ), rotating the angle θ between repetitions. The center of k-space is naturally oversampled.'
            },
            {
                heading: 'Advantages and Limitations',
                content: 'Advantages: excellent robustness against motion (the k-space center is always sampled), reduces ghosting artifacts. Limitations: artifacts appear as streaking instead of ghosts, requires regridding reconstruction (not direct FFT), and needs more spokes than Cartesian lines for the same resolution.'
            }
        ],
        parameters: [
            { name: 'Gx', value: 'G · cos(θ) → horizontal component of the spoke' },
            { name: 'Gy', value: 'G · sin(θ) → vertical component of the spoke' },
            { name: 'Angle θ', value: 'Rotates each TR (uniform or golden angle)' },
            { name: 'Reconstruction', value: 'Regridding + FFT (or NUFFT)' }
        ],
        equation: 'k_x(t) = \\gamma t \\cdot G \\cos(\\theta), \\quad k_y(t) = \\gamma t \\cdot G \\sin(\\theta)',
        animationType: 'radial'
    },
    {
        id: 'spiral',
        category: 'trajectory',
        title: 'Spiral',
        subtitle: 'K-space filling with spiral trajectories',
        sections: [
            {
                heading: 'Physical Principle',
                content: 'The spiral trajectory fills k-space from the center outward (spiral-out) or from the edge inward (spiral-in), tracing an Archimedean spiral. This is achieved by applying Gx and Gy gradients that oscillate with simultaneously increasing amplitude. To cover all of k-space, multiple interleaves (rotated spirals) are used.'
            },
            {
                heading: 'Advantages and Limitations',
                content: 'Advantages: very efficient gradient utilization (high duty cycle), excellent for flow and motion, less acoustic noise than EPI. Limitations: sensitive to off-resonance (produces blurring), requires regridding reconstruction, and gradient design is complex (slew rate and maximum amplitude).'
            }
        ],
        parameters: [
            { name: 'Gx', value: 'Oscillates with increasing amplitude → cos(ωt) · r(t)' },
            { name: 'Gy', value: 'Oscillates with increasing amplitude → sin(ωt) · r(t)' },
            { name: 'Interleaves', value: 'Multiple rotated spirals for complete coverage' },
            { name: 'Reconstruction', value: 'NUFFT (non-uniform sampling)' }
        ],
        equation: 'k(t) = \\lambda \\cdot t \\cdot e^{i\\omega t} \\quad (\\text{Archimedean spiral})',
        animationType: 'spiral'
    }
];
