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
    seq_filename: str = 'C:/Users/neuro/Desktop/Test_pulseq/Sequences/gre_1.seq',
    *,
    fov: float | tuple[float, float] = 256e-3,
    n_x: int = 128,
    n_y: int = 128,
    flip_angle_deg: float = 90,
    slice_thickness: float = 10e-3,
    tr: float = 800e-3,
    te: float = 10e-3,
):
    """Create a basic gradient echo (GRE) sequence.

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
        Output filename for the .seq file. Default is 'gre_pypulseq.seq'.
    fov : float or tuple of float, optional
        Field of view in meters. If a single value, it is used for both x and y.
        If a tuple, it is (fov_x, fov_y). Default is 256e-3.
    n_x : int, optional
        Number of readout samples. Default is 64.
    n_y : int, optional
        Number of phase encoding steps. Default is 64.
    flip_angle_deg : float, optional
        Flip angle in degrees. Default is 10.
    slice_thickness : float, optional
        Slice thickness in meters. Default is 3e-3.
    tr : float, optional
        Repetition time in seconds. Default is 12e-3.
    te : float, optional
        Echo time in seconds. Default is 5e-3.

    Returns
    -------
    seq : pypulseq.Sequence
        The GRE sequence object.
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
        apodization=0.42,
        time_bw_product=4,
        system=system,
        return_gz=True,
        delay=system.rf_dead_time,
        use='excitation',
    )

    # Define other gradients and ADC events
    delta_kx = 1 / fov_x
    delta_ky = 1 / fov_y
    gx = pp.make_trapezoid(channel='x', flat_area=n_x * delta_kx, flat_time=2.56e-3, system=system)
    adc = pp.make_adc(num_samples=n_x, duration=gx.flat_time, delay=gx.rise_time, system=system)
    gx_pre = pp.make_trapezoid(channel='x', area=-gx.area*0.5, duration=1.28e-3, system=system)
    gz_reph = pp.make_trapezoid(channel='z', area=-gz.area*0.5, duration=1.28e-3, system=system)
    phase_areas = (np.arange(n_y) - n_y / 2) * delta_ky

    # Calculate timing
    te_delay = (
        te
        - (pp.calc_duration(gz, rf) - pp.calc_rf_center(rf)[0] - rf.delay)
        - pp.calc_duration(gx_pre)
        - pp.calc_duration(gx) / 2
        - pp.eps
    )
    te_delay = np.ceil(te_delay / seq.grad_raster_time) * seq.grad_raster_time

    tr_delay = tr - pp.calc_duration(gz, rf) - pp.calc_duration(gx_pre) - pp.calc_duration(gx) - te_delay
    tr_delay = np.ceil(tr_delay / seq.grad_raster_time) * seq.grad_raster_time

    assert np.all(te_delay >= 0)

    rf_phase = 0
    rf_inc = 0

    # Loop over phase encodes and define sequence blocks
    for i_phase in range(n_y):
        G = 0.5*n_y*delta_ky-i_phase*delta_ky
        rf.phase_offset = rf_phase / 180 * np.pi
        adc.phase_offset = rf_phase / 180 * np.pi
        rf_inc = divmod(rf_inc, 360.0)[1]
        rf_phase = divmod(rf_phase + rf_inc, 360.0)[1]

        seq.add_block(rf, gz)
        seq.add_block(gz_reph)
        gy_pre = pp.make_trapezoid(
            channel='y',
            area=-G,
            duration=pp.calc_duration(gx_pre),
            system=system,
        )

        seq.add_block(pp.make_delay(te_delay))
        seq.add_block(gx_pre, gy_pre)
        seq.add_block(gx, adc)
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
    seq.set_definition(key='Name', value='gre')

    if write_seq:
        seq.write(seq_filename)

    return seq


if __name__ == '__main__':
    main(plot=True, write_seq=True, save_plots=True, save_report=True)