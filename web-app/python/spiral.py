from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

import pypulseq as pp


def main(
    plot: bool = False,
    test_report: bool = True,
    write_seq: bool = True,
    save_plots: bool = True,
    save_report: bool = True,
    seq_filename: str = 'C:/Users/neuro/Desktop/Test_pulseq/Sequences/spiral_1.seq',
    *,
    fov: float | tuple[float, float] = 256e-3,
    n_x: int = 64,
    n_interleaves: int = 5,
    flip_angle_deg: float = 90,
    slice_thickness: float = 10e-3,
    tr: float = 800e-3,
    te: float = 17e-3,
    oversampling: int = 1,
    adc_samples_per_segment: int = 200,
):
    """Create an Archimedean spiral gradient-echo sequence.

    Parameters
    ----------
    plot : bool, optional
        Plot the sequence diagram. Default is False.
    test_report : bool, optional
        Print a test report. Default is False.
    write_seq : bool, optional
        Write the sequence to a .seq file. Default is False.
    save_plots : bool, optional
        Save the sequence diagrams as PNG next to THIS script
        (Path(__file__).parent), regardless of the current working directory:
        '<seq_filename stem>_rf_adc.png', '<stem>_gradients.png' and
        '<stem>_kspace.png'.
        Default is True.
    save_report : bool, optional
        Save the run log (timing check + test report) next to THIS script as
        '<seq_filename stem>_report.txt'. Needs test_report=True for the full
        report. Default is True.
    seq_filename : str, optional
        Output filename for the .seq file. Default is 'spiral_pypulseq.seq'.
    fov : float or tuple of float, optional
        Field of view in meters. If a single value, it is used for both x and y.
        If a tuple, it is (fov_x, fov_y). Default is 256e-3.
    n_x : int, optional
        Spiral k-space matrix radius (readout resolution). Default is 64.
    n_interleaves : int, optional
        Number of spiral interleaves, one excitation played per interleave.
        Default is 5.
    flip_angle_deg : float, optional
        Flip angle in degrees. Default is 90.
    slice_thickness : float, optional
        Slice thickness in meters. Default is 10e-3.
    tr : float, optional
        Repetition time in seconds. Default is 800e-3.
    te : float, optional
        Echo time in seconds. Default is 17e-3.
    oversampling : int, optional
        Oversampling factor along the spiral trajectory. Default is 1.
    adc_samples_per_segment : int, optional
        ADC segment length used to chunk the readout (Siemens-compatible).
        Default is 200.

    Returns
    -------
    seq : pypulseq.Sequence
        The spiral sequence object.
    """
    fov_x, fov_y = (fov, fov) if isinstance(fov, (int, float)) else fov

    # Set system limits
    system = pp.Opts(
        max_grad=28,
        grad_unit='mT/m',
        max_slew=150,
        slew_unit='T/m/s',
        rf_ringdown_time=20e-6,
        rf_dead_time=100e-6,
        adc_dead_time=10e-6,
    )

    seq = pp.Sequence(system)

    # Create slice selection pulse and gradient
    rf, gz, _ = pp.make_sinc_pulse(
        flip_angle=np.deg2rad(flip_angle_deg),
        duration=3e-3,
        slice_thickness=slice_thickness,
        apodization=0.5,
        time_bw_product=4,
        system=system,
        return_gz=True,
        delay=system.rf_dead_time,
        use='excitation',
    )
    gz_reph = pp.make_trapezoid(channel='z', area=-gz.area * 0.5, duration=1.5e-3, system=system)
    gz_reph_duration = pp.calc_duration(gz_reph)

    # Spiral k-space trajectory parameters
    delta_k = 1 / fov_x
    # Number of turns. k_max = delta_k * k_radius must equal n_x / (2 * FOV),
    # so k_radius is HALF the matrix size — using n_x sends the spiral out to
    # twice the required k, i.e. it acquires a resolution nobody asked for.
    k_radius = round(n_x / 2)
    k_samples = round(2 * np.pi * k_radius) * oversampling

    safety_margin = 0.94  # stay slightly below hardware limits to absorb rounding error
    min_points_per_revolution = 0.265  # keep at least ~4 points per revolution

    # One excitation + spiral readout per interleave
    for i_interleave in range(n_interleaves):
        phi = (i_interleave + 1) * (2 * np.pi / n_interleaves)

        # Raw Archimedean spiral trajectory for this interleave
        c = np.arange(0, k_radius * k_samples / n_interleaves, 0.01)
        r = n_interleaves * delta_k * c / k_samples
        a = np.mod(c, k_samples) * 2 * np.pi / k_samples
        theta = a * round(8 / n_interleaves) + phi
        ka = np.stack([r * np.cos(theta), r * np.sin(theta)])

        # Gradients and slew rates implied by the raw trajectory
        ga, sa = pp.traj_to_grad(ka)

        # Time-optimal reparametrization to respect gradient/slew limits
        dt_grad = np.abs(ga[0] + 1j * ga[1]) / (system.max_grad * safety_margin) * seq.grad_raster_time
        dt_slew = np.sqrt(np.abs(sa[0] + 1j * sa[1]) / (system.max_slew * safety_margin)) * seq.grad_raster_time
        dt_smooth = np.maximum(dt_grad, dt_slew)

        dt_min = min_points_per_revolution * seq.grad_raster_time / (k_samples / n_interleaves)
        dt_smooth[dt_smooth < dt_min] = dt_min
        t_smooth = np.concatenate(([0.0], np.cumsum(dt_smooth)))
        t_opt = np.arange(0, np.floor(t_smooth[-1] / seq.grad_raster_time) + 1) * seq.grad_raster_time
        k_opt = np.stack([
            np.interp(t_opt, t_smooth, ka[0]),
            np.interp(t_opt, t_smooth, ka[1]),
        ])

        spiral_grad_shape, _ = pp.traj_to_grad(k_opt)

        # ADC aligned to a 100 ns dwell grid, chunked into fixed-length segments.
        # Fix the segment count first, then round the dwell DOWN so the window still
        # fits inside the readout. Rounding the dwell up (and re-flooring the segment
        # count to compensate) drops a whole segment, which stops the ADC early and
        # leaves the outer turns of the spiral unsampled — costing real resolution.
        adc_time = seq.grad_raster_time * spiral_grad_shape.shape[1]
        adc_samples_desired = k_radius * k_samples / n_interleaves
        adc_segments = max(round(adc_samples_desired / adc_samples_per_segment), 1)
        adc_samples = adc_segments * adc_samples_per_segment
        adc_dwell = np.floor(adc_time / adc_samples / 100e-9) * 100e-9
        adc = pp.make_adc(num_samples=adc_samples, dwell=adc_dwell, delay=system.adc_dead_time, system=system)

        # Ramp both channels down to zero so the block connects cleanly to the
        # following delay (also covers the ADC tuning delay at the tail end)
        last_gx, last_gy = spiral_grad_shape[0, -1], spiral_grad_shape[1, -1]
        # Slew is a VECTOR: ramping x and y together over max(|gx|, |gy|) makes the
        # combined slew up to sqrt(2) times the limit. Size the ramp by the magnitude.
        ramp_time = np.hypot(last_gx, last_gy) / (system.max_slew * safety_margin)
        ramp_time = np.ceil(ramp_time / seq.grad_raster_time) * seq.grad_raster_time
        n_ramp = max(int(round(ramp_time / seq.grad_raster_time)), 1)
        ramp_x = np.linspace(last_gx, 0.0, n_ramp + 1)[1:]
        ramp_y = np.linspace(last_gy, 0.0, n_ramp + 1)[1:]
        spiral_grad_shape = np.concatenate([spiral_grad_shape, np.stack([ramp_x, ramp_y])], axis=1)

        # The spiral waveform and its ADC share one delay so they stay aligned.
        # Using gz_reph_duration here double-counted it: the rephaser is already
        # its own block.
        gx_spiral = pp.make_arbitrary_grad(channel='x', waveform=spiral_grad_shape[0], delay=system.adc_dead_time, system=system)
        gy_spiral = pp.make_arbitrary_grad(channel='y', waveform=spiral_grad_shape[1], delay=system.adc_dead_time, system=system)

        # Long spiral arms blur the image: off-resonance and T2* dephase across the
        # readout. Keep each arm under ~6 ms by using more interleaves.
        if pp.calc_duration(gx_spiral) > 6e-3 and i_interleave == 0:
            needed = int(np.ceil(n_interleaves * pp.calc_duration(gx_spiral) / 6e-3))
            print(f'WARNING: spiral readout is {pp.calc_duration(gx_spiral) * 1e3:.1f} ms per arm '
                  f'(target <= 6 ms). Use about {needed} interleaves instead of '
                  f'{n_interleaves} to stay under the blurring limit.')

        # REWINDER — this is a GRADIENT echo, so nothing refocuses k and the spiral
        # would end at the edge of k-space, leaving the next shot to start from
        # there. A spin echo must NOT get one: its 180 already inverts k to
        # (-kx, -ky), and extra area on top collapses the reconstruction.
        k_end = np.sum(spiral_grad_shape, axis=1) * seq.grad_raster_time
        # x and y play together, so each channel may only claim 1/sqrt(2) of the
        # gradient and slew budget — otherwise the COMBINED vector exceeds the limit.
        rew_system = pp.Opts(
            max_grad=system.max_grad / np.sqrt(2),
            max_slew=system.max_slew * safety_margin / np.sqrt(2),
            grad_raster_time=system.grad_raster_time,
        )
        gx_rew = pp.make_trapezoid(channel='x', area=-k_end[0], system=rew_system)
        gy_rew = pp.make_trapezoid(channel='y', area=-k_end[1], system=rew_system)
        rewinder_duration = pp.calc_duration(gx_rew, gy_rew)

        # Calculate timing. A spiral samples the centre of k-space FIRST, so TE runs
        # from the middle of the excitation to the START of the readout.
        # Delays are snapped to the block-duration raster (same convention as
        # trajectories.js); an off-raster delay fails check_timing() with a RASTER error.
        bd_raster = system.block_duration_raster
        te_delay = te - pp.calc_duration(gz, rf) / 2 - gz_reph_duration
        te_delay = np.round(te_delay / bd_raster) * bd_raster
        assert te_delay >= 0, 'TE is too short for this spiral readout'

        # TR is measured from the CENTRE of one excitation to the centre of the next.
        tr_delay = (tr - pp.calc_duration(gz, rf) / 2 - te
                    - pp.calc_duration(gx_spiral, gy_spiral, adc) - rewinder_duration)
        tr_delay = np.round(tr_delay / bd_raster) * bd_raster
        assert tr_delay >= 0, 'TR is too short'

        seq.add_block(rf, gz)
        seq.add_block(gz_reph)
        seq.add_block(pp.make_delay(te_delay))
        seq.add_block(gx_spiral, gy_spiral, adc)
        seq.add_block(gx_rew, gy_rew)  # back to the centre of k-space
        seq.add_block(pp.make_delay(tr_delay))

    # Everything this script writes goes next to the script itself, whatever
    # the current working directory is.
    out_dir = Path(__file__).resolve().parent
    stem = Path(seq_filename).stem

    # Collect the run log so it can be printed AND saved as <stem>_report.txt.
    report_lines = []

    ok, error_report = seq.check_timing()
    if ok:
        report_lines.append('Timing check passed successfully')
    else:
        report_lines.append('Timing check failed. Error listing follows:')
        report_lines += [str(e) for e in error_report]

    if test_report:
        report_lines.append(seq.test_report())

    report = '\n'.join(report_lines)
    if report:
        print(report)

    if save_report and report:
        report_path = out_dir / f'{stem}_report.txt'
        report_path.write_text(report, encoding='utf-8')
        print(f'Saved report: {report_path}')

    if plot or save_plots:
        # plot_now=False builds the figures without blocking, so they can be
        # saved first and only then (optionally) shown.
        # seq.plot() returns two figures: fig1 = RF/ADC, fig2 = gradients.
        seq_plot = seq.plot(time_range=(0.0, tr), plot_now=False)

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

    seq.set_definition(key='FOV', value=[fov_x, fov_y, slice_thickness])
    seq.set_definition(key='Name', value='spiral')
    seq.set_definition(key='MaxAdcSegmentLength', value=adc_samples_per_segment)

    if write_seq:
        seq.write(seq_filename)

    return seq


if __name__ == '__main__':
    main(plot=True, write_seq=True, save_plots=True, save_report=True)
