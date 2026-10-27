/**
 * COMMON — preamble, body preamble and footer common to all sequences (PyPulseq).
 *
 *  preamble(params) → imports + the MINT validation helpers + `def main(...):`
 *                     signature + docstring (column 0)
 *  body(params)     → scan params, system limits, seq object, validator
 *                     (indented by composer)
 *  footer(params)   → MINT validation report, timing check, report, plot,
 *                     definitions, write + return
 *
 *  lobeCheck(names) → the `mint.check_lobes({...})` statement for a list of
 *                     gradient identifiers; shared by the excitation and
 *                     trajectory blocks so the check is spelled one way only.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};

    /**
     * Turn any text into a name MATLAB can run.
     *
     * MATLAB only runs a script whose file name is a valid identifier: a
     * letter first, then letters, digits and underscores, at most 63
     * characters (namelengthmax). A space, a hyphen, a dot, an accent, a
     * bracket — "seq (1).m", "t2-tse.m", "secuencia_ñ.m" — and MATLAB refuses
     * the file. Every file name and every `Name` definition the app writes
     * goes through here, so the .py, the .m and the .seq always share one
     * name that works in both languages.
     */
    function safeMatlabName(text) {
        let s = String(text == null ? '' : text)
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // á → a, ñ → n
            .replace(/[^A-Za-z0-9_]+/g, '_')                    // anything else → _
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (!/^[A-Za-z]/.test(s)) s = 'seq_' + s;               // must start with a letter
        s = s.slice(0, 63).replace(/_+$/, '');
        return s || 'seq';
    }

    /**
     * Name of the .seq the script writes: the script name plus what tells one
     * scan from the next on the scanner, as in the GRE used on the Disc Scanner
     * (mint_GRE.m): resolution x slice, TE, TR and the flip angle (TI for an
     * inversion recovery). seq_gradientEcho_cartesian_2D_2x2x10mm_TE250_TR2500_FA90.seq
     * Decimal points become "p" so the name stays one plain word.
     */
    function seqFileName(params) {
        const n = (x) => String(Number(x)).replace('.', 'p');
        const dim = params.dimension;
        const slices = Math.max(1, Math.round(params.nSlices || 1));
        const thk = dim === '3D' ? (params.fov.z * 10) / slices : 10;   // [mm]
        const res = `${n(params.resolution.x)}x${n(params.resolution.y)}x${n(Number(thk.toFixed(3)))}mm`;
        let tail = `_TE${n(params.te)}_TR${n(params.tr)}`;
        if (params.excitation === 'gradientEcho') tail += `_FA${n(params.flipAngle)}`;
        if (params.inversionRecovery) tail += `_TI${n(params.ti)}`;
        return `${seqBaseName(params)}_${res}${tail}.seq`;
    }

    /** True when `name` is usable as a MATLAB script / function name. */
    function isMatlabName(name) {
        return /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(String(name));
    }

    function seqBaseName(params) {
        // A console blank sequence passes its own name; the Free builder never does.
        return safeMatlabName(params.fileBase || `seq_${params.excitation}_${params.trajectory}_${params.dimension}`);
    }

    // ms from the form → a Python literal in seconds, exactly as typed. An
    // earlier version used toFixed(5), which silently rounded TE to 10 us and
    // so hid precisely the off-raster values the validator exists to report.
    function msLiteral(ms) {
        return `${Number(ms)}e-3`;
    }

    /** `mint.check_lobes({'a': a, 'b': b})`, one entry per line. */
    function lobeCheck(names, indentSpaces) {
        const pad = ' '.repeat(indentSpaces || 0);
        if (names.length === 1) {
            return `${pad}mint.check_lobes({'${names[0]}': ${names[0]}})`;
        }
        return [
            `${pad}mint.check_lobes({`,
            ...names.map((n) => `${pad}    '${n}': ${n},`),
            `${pad}})`
        ].join('\n');
    }

    // The validator travels inside every generated script, so the checks run
    // against the real event objects and still apply after the user edits the
    // script by hand. validation.js mirrors the same rules in the browser.
    const VALIDATOR = `class MintValidator:
    """MINT timing and physical checks for one sequence build.

    Two kinds of finding:

    * WARNINGS are collected and printed at the top of the run log. The
      sequence still builds - it is legal Pulseq - but it will not time the
      way it reads.
    * ERRORS raise ValueError before the offending block reaches the
      sequence: the combination is physically impossible.
    """

    def __init__(self, system):
        self.system = system
        # A lobe is routinely split in half: TE runs to the MIDDLE of the
        # readout lobe, a rephaser carries HALF the selection area. So every
        # lobe, TE and TR must be a whole number of DOUBLE gradient rasters -
        # 20 us on a 10 us raster. Otherwise the half lands off the raster and
        # a ceil() further down shifts everything that follows it.
        self.lobe_raster = 2 * system.grad_raster_time
        self.warnings = []
        self.n_blocks = 0
        self.clock = 0.0                    # [s] start time of the next block
        self.slice_ramp_down_start = None   # [s] absolute; set by each RF block

    # -- raster arithmetic -------------------------------------------------
    @staticmethod
    def is_multiple(value, raster):
        ratio = value / raster
        return abs(ratio - round(ratio)) < 1e-6

    @staticmethod
    def round_to(value, raster):
        return np.round(value / raster) * raster

    @staticmethod
    def ceil_to(value, raster):
        # Round first: 2.56e-3 / 2e-5 is 128.00000000000003 in floating
        # point, and a bare ceil() would turn that into 129.
        return np.ceil(np.round(value / raster, 6)) * raster

    @staticmethod
    def floor_to(value, raster):
        return np.floor(np.round(value / raster, 6)) * raster

    def warn(self, text):
        if text not in self.warnings:  # a check inside a loop reports once
            self.warnings.append(text)

    # -- raster checks (warnings) ------------------------------------------
    def check_adc_dwell(self, dwell, name='ADC dwell'):
        """The dwell must be an exact integer multiple of adc_raster_time."""
        raster = self.system.adc_raster_time
        if self.is_multiple(dwell, raster):
            return True
        self.warn(
            f'{name} = {dwell * 1e9:.2f} ns is NOT an integer multiple of adc_raster_time '
            f'({raster * 1e9:.0f} ns): the scanner cannot sample at that rate. '
            f'Nearest valid dwell below it: {self.floor_to(dwell, raster) * 1e9:.0f} ns.'
        )
        return False

    def check_adc(self, adc, name='adc'):
        """Dwell on the ADC raster, sample count a multiple of the divisor."""
        self.check_adc_dwell(adc.dwell, f'{name}.dwell')
        divisor = int(getattr(self.system, 'adc_samples_divisor', 1) or 1)
        if adc.num_samples % divisor:
            self.warn(
                f'{name}: {adc.num_samples} samples is not a multiple of adc_samples_divisor '
                f'({divisor}); some scanners reject it.'
            )

    def check_lobes(self, lobes):
        """Every gradient lobe must last a whole number of 2 * grad_raster_time."""
        for name, grad in lobes.items():
            if grad.type == 'trap':
                duration = grad.rise_time + grad.flat_time + grad.fall_time
            else:
                duration = grad.shape_dur
            if not self.is_multiple(duration, self.lobe_raster):
                self.warn(
                    f'{name}: duration {duration * 1e6:.1f} us is not a multiple of '
                    f'2 * grad_raster_time ({self.lobe_raster * 1e6:.0f} us). Half of it falls off the '
                    f'gradient raster, so splitting it forces a ceil() that drifts the timing. '
                    f'Use {self.ceil_to(duration, self.lobe_raster) * 1e6:.0f} us.'
                )

    def check_timing_parameter(self, name, value):
        """TE, TR and TI must be whole numbers of 2 * grad_raster_time."""
        if not self.is_multiple(value, self.lobe_raster):
            nearest = self.round_to(value, self.lobe_raster)
            self.warn(
                f'{name} = {value * 1e3:.4f} ms is not a multiple of 2 * grad_raster_time '
                f'({self.lobe_raster * 1e6:.0f} us). Its half falls off the gradient raster, so the '
                f'delays are rounded and the sequence plays at a slightly different {name}. '
                f'Nearest valid value: {nearest * 1e3:.2f} ms.'
            )

    def check_b1(self, name, rf, max_b1):
        """Peak B1 of a pulse against the scanner limit [T]."""
        peak = np.max(np.abs(rf.signal)) / self.system.gamma  # Hz -> T
        if peak > max_b1 * (1 + 1e-9):
            self.warn(
                f'{name}: peak B1 {peak * 1e6:.2f} uT exceeds max_b1 ({max_b1 * 1e6:.2f} uT). '
                f'Lengthen the pulse or lower the flip angle.'
            )

    # -- physical checks (errors) ------------------------------------------
    def check_block(self, *events):
        """Reject an impossible RF / gradient / ADC combination.

        Called for every block BEFORE it is built. Raises ValueError.
        """
        flat = []
        for event in events:
            flat.extend(event if isinstance(event, (list, tuple)) else [event])
        flat = [e for e in flat if e is not None and hasattr(e, 'type')]

        self.n_blocks += 1
        where = f'Block {self.n_blocks} (t = {self.clock * 1e3:.3f} ms)'
        tol = 1e-9
        rf = [e for e in flat if e.type == 'rf']
        adc = [e for e in flat if e.type == 'adc']
        grads = [e for e in flat if e.type in ('trap', 'grad')]

        if len(rf) > 1:
            raise ValueError(f'{where}: {len(rf)} RF pulses in one block. A block holds at most one.')
        if len(adc) > 1:
            raise ValueError(f'{where}: {len(adc)} ADC events in one block. A block holds at most one.')
        if rf and adc:
            raise ValueError(
                f'{where}: RF and ADC in the same block. The scanner cannot transmit and '
                f'receive at once - put the readout in its own block.'
            )
        for channel in 'xyz':
            n_on_channel = sum(1 for g in grads if g.channel == channel)
            if n_on_channel > 1:
                raise ValueError(
                    f'{where}: {n_on_channel} gradient events on the {channel} axis. They would '
                    f'overlap - combine them into one event or split them into two blocks.'
                )

        if rf:
            rf_start = rf[0].delay
            rf_end = rf[0].delay + rf[0].shape_dur
            selection = [g for g in grads if g.channel == 'z' and g.type == 'trap']
            if selection:
                plateau_start = selection[0].delay + selection[0].rise_time
                plateau_end = plateau_start + selection[0].flat_time
                if rf_start < plateau_start - tol or rf_end > plateau_end + tol:
                    raise ValueError(
                        f'{where}: the RF pulse plays from {rf_start * 1e6:.1f} to {rf_end * 1e6:.1f} us '
                        f'but the slice-selection plateau (flat_time) spans {plateau_start * 1e6:.1f} to '
                        f'{plateau_end * 1e6:.1f} us. RF on a gradient ramp excites a distorted '
                        f'slice: delay the RF or lengthen the plateau.'
                    )
                self.slice_ramp_down_start = self.clock + plateau_end
            else:
                # No selection lobe: nothing in-plane may start under the pulse.
                self.slice_ramp_down_start = self.clock + rf_end

        if self.slice_ramp_down_start is not None:
            for g in grads:
                if g.channel == 'z':
                    continue
                start = self.clock + g.delay
                if start < self.slice_ramp_down_start - tol:
                    raise ValueError(
                        f'{where}: the g{g.channel} event starts at {start * 1e6:.1f} us, before the '
                        f'slice-selection ramp-down begins at {self.slice_ramp_down_start * 1e6:.1f} us. '
                        f'Phase-encoding and readout-prephasing lobes may start with the ramp-down '
                        f'or after it, never under the RF pulse.'
                    )

        self.clock += pp.calc_duration(*flat) if flat else 0.0

    def guard(self, add_block):
        """Wrap seq.add_block so every block is checked before it is built."""

        def checked_add_block(*events):
            self.check_block(*events)
            add_block(*events)

        return checked_add_block

    def report(self):
        """Lines for the run log: a banner when anything was flagged."""
        if not self.warnings:
            return [
                'MINT validation passed: ADC dwell, gradient-lobe rasters, TE/TR rasters, '
                'RF on the slice-selection plateau and block combinations.'
            ]
        banner = '!' * 78
        lines = [banner, f'MINT VALIDATION: {len(self.warnings)} WARNING(S)']
        lines += [f'WARNING: {text}' for text in self.warnings]
        lines.append(banner)
        return lines


def make_lobe_on_raster(channel, area, system, lobe_raster):
    """Shortest trapezoid for \`area\`, stretched to a whole number of lobe rasters.

    pp.make_trapezoid(area=...) alone returns the shortest lobe on the GRADIENT
    raster, which is an odd number of rasters about half the time. Stretching
    it to the lobe raster (2 * grad_raster_time) keeps its half on the raster.
    """
    lobe = pp.make_trapezoid(channel=channel, area=area, system=system)
    shortest = pp.calc_duration(lobe)
    duration = np.ceil(np.round(shortest / lobe_raster, 6)) * lobe_raster
    if duration - shortest > 1e-9:
        lobe = pp.make_trapezoid(channel=channel, area=area, duration=duration, system=system)
    return lobe`;

    function preamble(params) {
        const { fov, resolution, dimension } = params;
        const sys = window.pulseqTemplates.system;
        const fname = seqFileName(params);
        const irLine = params.inversionRecovery
            ? `\n    Inversion Recovery: on | TI: ${params.ti} ms\n`
            : '';

        // Rendering dominates the run time of a big sequence: on a 5940-block 3D,
        // seq.plot() took 101 s against 2 s for calculate_kspace() and 0.7 s for
        // write(). Anything with more than one slice defaults to no plots.
        const heavy = dimension === '3D' || (params.nSlices || 1) > 1;
        const plotsDefault = heavy ? 'False' : 'True';
        const heavyNote = heavy
            ? `\n    Plots default to OFF: this is a ${dimension} sequence with ${params.nSlices || 1}\n` +
              `    slices, and rendering it costs far more than building it.\n`
            : '';

        return `from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

import pypulseq as pp


${VALIDATOR}


def main(
    plot: bool = False,
    test_report: bool = True,
    write_seq: bool = True,
    save_plots: bool = ${plotsDefault},
    save_report: bool = True,
    seq_filename: str = '${fname}',
):
    """MRI sequence generated by the MRI Design web-app (PyPulseq).

    Dimension: ${dimension} | FOV: ${fov.x} x ${fov.y} cm | Resolution: ${resolution.x} x ${resolution.y} mm
    System limits: ${sys.describe(params.system)}
${irLine}${heavyNote}
    Parameters
    ----------
    plot : bool
        Open the sequence diagrams in interactive matplotlib windows. Blocks
        until the windows are closed.
    test_report : bool
        Print the PyPulseq test report.
    write_seq : bool
        Write the .seq file the scanner reads.
    save_plots : bool
        Save the sequence diagrams as PNG next to THIS script
        (Path(__file__).parent), regardless of the current working directory:
          <name>_rf_adc.png      RF magnitude/phase + ADC
          <name>_gradients.png   Gx, Gy, Gz
          <name>_kspace.png      k-space filling (trajectory + ADC samples)
    save_report : bool
        Save the run log (MINT validation + timing check + test report) next to
        THIS script as <name>_report.txt. Needs test_report=True to include the
        full report.
    seq_filename : str
        Output name for the .seq file; the PNGs and the report reuse its stem.

    Returns
    -------
    seq : pypulseq.Sequence
        The generated sequence object.
    """`;
    }

    function body(params) {
        const { fov, resolution, tr, te, dimension } = params;
        const sys = window.pulseqTemplates.system;
        const s = sys.resolve(params.system);
        const r = sys.rasters;

        const fovX_m = (fov.x / 100).toFixed(4);   // cm -> m
        const fovY_m = (fov.y / 100).toFixed(4);
        const Nx = Math.round((fov.x / 100) / (resolution.x / 1000));
        const Ny = Math.round((fov.y / 100) / (resolution.y / 1000));
        const nSlices = Math.max(1, Math.round(params.nSlices || 1));
        // 3D excites one slab of thickness FOV Z and splits it into n_slices kz
        // partitions; 2D and multislice excite one 10 mm slice at a time.
        const sliceThk = dimension === '3D'
            ? (fov.z / 100).toFixed(4)
            : '10e-3';

        // Geometry that only some dimensions need.
        let sliceGeom = '';
        if (dimension === 'multislice') {
            sliceGeom = `
# Multi-slice geometry. Slices are excited one at a time by shifting the RF
# centre frequency; z_positions holds their offsets from isocentre.
slice_gap = 0.0  # [m] edge-to-edge gap between slices
delta_z = slice_thickness + slice_gap
z_positions = (np.arange(n_slices) - (n_slices - 1) / 2) * delta_z
`;
        } else if (dimension === '3D') {
            sliceGeom = `
# 3D partition encoding. The slab (slice_thickness = FOV Z) is divided into
# n_slices partitions, each selected by its own kz phase-encode area.
delta_kz = 1 / slice_thickness
kz_areas = (np.arange(n_slices) - n_slices / 2) * delta_kz
pre_time_z = 1e-3  # [s] duration of the kz slice-encoding lobe
`;
        }

        // Multislice shares one TR between the slices, so the budget each
        // excitation really gets is TR / n_slices — that has to be on the raster too.
        const multisliceCheck = (dimension === 'multislice' && nSlices > 1)
            ? "\nmint.check_timing_parameter('TR / n_slices', tr / n_slices)"
            : '';

        return `fov_x = ${fovX_m}  # [m]
fov_y = ${fovY_m}  # [m]
n_x = ${Nx}
n_y = ${Ny}
n_slices = ${nSlices}
slice_thickness = ${sliceThk}  # [m]
te = ${msLiteral(te)}  # [s]
tr = ${msLiteral(tr)}  # [s]${params.excitation === 'gradientEcho' ? `
flip_angle = np.deg2rad(${params.flipAngle})  # [rad]` : ''}
delta_kx = 1 / fov_x
delta_ky = 1 / fov_y
${sliceGeom}
# System limits (${sys.describe(params.system)})
system = pp.Opts(
    max_grad=${s.maxGrad},
    grad_unit='mT/m',
    max_slew=${s.maxSlew},
    slew_unit='T/m/s',
    rf_ringdown_time=${s.rfRingdownTime}e-6,
    rf_dead_time=${s.rfDeadTime}e-6,
    adc_dead_time=${s.adcDeadTime}e-6,
    grad_raster_time=${Math.round(r.grad * 1e6)}e-6,
    rf_raster_time=${Math.round(r.rf * 1e6)}e-6,
    adc_raster_time=${Math.round(r.adc * 1e9)}e-9,
    block_duration_raster=${Math.round(r.block * 1e6)}e-6,
)
max_b1 = ${s.maxB1}e-6  # [T] peak B1 the scanner allows (pp.Opts has no field for it)

seq = pp.Sequence(system)

# MINT validation. Raster findings are collected as warnings and open the run
# log; impossible RF / gradient combinations raise before the block is built.
mint = MintValidator(system)
lobe_raster = mint.lobe_raster  # [s] 2 * grad_raster_time
# From here on every seq.add_block() runs the MINT block checks first.
seq.add_block = mint.guard(seq.add_block)

mint.check_timing_parameter('TE', te)
mint.check_timing_parameter('TR', tr)${multisliceCheck}`;
    }

    function footer(params) {
        return `# Everything this script writes goes next to the script itself, whatever
# the current working directory is.
out_dir = Path(__file__).resolve().parent
stem = Path(seq_filename).stem

# How many excitations this sequence plays. Everything expensive scales with it.
n_repetitions = n_y * n_slices

# Collect the run log so it can be printed AND saved as <stem>_report.txt.
# The MINT validation verdict opens it, so a warning is the first thing read.
report_lines = mint.report()

ok, error_report = seq.check_timing()
if ok:
    report_lines.append('Timing check passed successfully')
else:
    report_lines.append('Timing check failed. Error listing follows:')
    report_lines += [str(e) for e in error_report]

# seq.test_report() calls calculate_kspace() internally, so it carries the same
# cost as the plots and has to sit behind the same guard. The timing check above
# is the safety-critical part and stays.
if test_report and n_repetitions > 1000:
    report_lines.append(
        f'Test report skipped: {n_repetitions} repetitions. seq.test_report() '
        'internally calls seq.calculate_kspace(), which is what makes a large '
        'sequence slow. Re-run a small version to inspect the report.'
    )
elif test_report:
    report_lines.append(seq.test_report())

report = '\\n'.join(report_lines)
if report:
    print(report)

if save_report and report:
    report_path = out_dir / f'{stem}_report.txt'
    report_path.write_text(report, encoding='utf-8')
    print(f'Saved report: {report_path}')

# Definitions and the .seq file come FIRST. Writing is cheap — well under a
# second even for a large 3D — and it must not be held hostage by the rendering
# below, which is the part that can take minutes or run out of memory.
seq.set_definition(key='FOV', value=[fov_x, fov_y, slice_thickness])
seq.set_definition(key='Name', value='${seqBaseName(params)}')

if write_seq:
    seq.write(seq_filename)
    print(f'Wrote {out_dir / seq_filename}')

# Rendering guard. Measured on a 5940-block 3D sequence:
#     seq.write()              0.7 s
#     seq.calculate_kspace()   2.1 s
#     seq.plot()             101.2 s   <-- this is what freezes Python
# so the guard has to cover the WHOLE rendering block, not just the k-space call.
if n_repetitions > 1000 and (plot or save_plots):
    print('Secuencia 3D grande detectada. Se omite la visualización de k-space '
          'para evitar saturación de memoria.')
elif plot or save_plots:
    # plot_now=False builds the figures without blocking, so they can be saved
    # first and only then (optionally) shown.
    # seq.plot() returns two figures: fig1 = RF/ADC, fig2 = gradients.
    seq_plot = seq.plot(plot_now=False)

    # k-space filling: the continuous path the gradients trace, plus the points
    # the ADC actually samples. Row 0 is kx, row 1 is ky, row 2 is kz.
    k_traj_adc, k_traj, _, _, _ = seq.calculate_kspace()

    fig_k, ax_k = plt.subplots(figsize=(6, 6))
    ax_k.plot(k_traj[0], k_traj[1], color='0.75', linewidth=0.5, label='gradient trajectory')
    ax_k.plot(k_traj_adc[0], k_traj_adc[1], '.', color='tab:red', markersize=2, label='ADC samples')
    ax_k.set_xlabel('$k_x$ (1/m)')
    ax_k.set_ylabel('$k_y$ (1/m)')
    ax_k.set_title('k-space filling')
    ax_k.set_aspect('equal', adjustable='box')
    ax_k.legend(loc='upper right', fontsize='small')

    # Frame the view on what is actually sampled. The grey path may wander far
    # outside it (spoilers, rewinders, a misbehaving trajectory); letting it set
    # the limits would squash the sampled k-space into an unreadable dot.
    pad = 0.08 * max(np.ptp(k_traj_adc[0]), np.ptp(k_traj_adc[1]), 1e-9)
    ax_k.set_xlim(np.min(k_traj_adc[0]) - pad, np.max(k_traj_adc[0]) + pad)
    ax_k.set_ylim(np.min(k_traj_adc[1]) - pad, np.max(k_traj_adc[1]) + pad)
    fig_k.tight_layout()

    if save_plots:
        for suffix, fig in (('rf_adc', seq_plot.fig1), ('gradients', seq_plot.fig2), ('kspace', fig_k)):
            if fig is None:
                continue
            png_path = out_dir / f'{stem}_{suffix}.png'
            fig.savefig(png_path, dpi=200, bbox_inches='tight', facecolor=fig.get_facecolor())
            print(f'Saved plot: {png_path}')

    if plot:
        seq_plot.show()

return seq`;
    }

    window.pulseqTemplates.common = {
        preamble, body, footer, lobeCheck, msLiteral, seqBaseName,
        safeMatlabName, isMatlabName, seqFileName, validator: VALIDATOR
    };
})();
