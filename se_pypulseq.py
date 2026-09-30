import numpy as np

import pypulseq as pp


def main(
    plot: bool = False,
    test_report: bool = False,
    write_seq: bool = False,
    seq_filename: str = 'se_pypulseq.seq',
    *,
    fov: float | tuple[float, float] = 256e-3,
    n_x: int = 256,
    n_y: int = 256,
    n_slices: int = 1,
    slice_thickness: float = 5e-3,
    te: float = 20e-3,
    tr: float = 500e-3,
):
    """Create a single spin-echo (SE) sequence.

    A 90 deg excitation pulse is followed by a 180 deg refocusing pulse,
    with crusher gradients flanking the refocusing pulse to suppress
    unwanted FID/stimulated-echo pathways. Readout dephase and
    phase-encoding gradients are played after the refocusing pulse so
    that no sign inversion needs to be tracked across the 180 deg pulse.

    Parameters
    ----------
    plot : bool, optional
        Plot the sequence diagram. Default is False.
    test_report : bool, optional
        Print a test report. Default is False.
    write_seq : bool, optional
        Write the sequence to a .seq file. Default is False.
    seq_filename : str, optional
        Output filename for the .seq file. Default is 'se_pypulseq.seq'.
    fov : float or tuple of float, optional
        Field of view in meters. If a single value, it is used for both x and y.
        If a tuple, it is (fov_x, fov_y). Default is 256e-3.
    n_x : int, optional
        Number of readout samples. Default is 256.
    n_y : int, optional
        Number of phase encoding steps. Default is 256.
    n_slices : int, optional
        Number of slices. Default is 1.
    slice_thickness : float, optional
        Slice thickness in meters. Default is 5e-3.
    te : float, optional
        Echo time in seconds. Default is 20e-3.
    tr : float, optional
        Repetition time in seconds. Default is 500e-3.

    Returns
    -------
    seq : pypulseq.Sequence
        The SE sequence object.
    """
    fov_x, fov_y = (fov, fov) if isinstance(fov, (int, float)) else fov

    # Set system limits
    system = pp.Opts(
        max_grad=32,
        grad_unit='mT/m',
        max_slew=130,
        slew_unit='T/m/s',
        rf_ringdown_time=100e-6,
        rf_dead_time=100e-6,
        adc_dead_time=10e-6,
    )

    seq = pp.Sequence(system)

    # Excitation pulse (90 deg) with slice-select gradient
    rf, gz, _ = pp.make_sinc_pulse(
        flip_angle=np.deg2rad(90),
        system=system,
        duration=3e-3,
        slice_thickness=slice_thickness,
        apodization=0.5,
        time_bw_product=4,
        return_gz=True,
        delay=system.rf_dead_time,
        use='excitation',
    )
    gz_reph = pp.make_trapezoid(channel='z', system=system, area=-gz.area / 2, duration=1e-3)

    # Refocusing pulse (180 deg) with slice-select gradient
    rf180, gz180, _ = pp.make_sinc_pulse(
        flip_angle=np.deg2rad(180),
        system=system,
        duration=3e-3,
        slice_thickness=slice_thickness,
        apodization=0.5,
        time_bw_product=4,
        phase_offset=np.pi / 2,
        return_gz=True,
        delay=system.rf_dead_time,
        use='refocusing',
    )

    # Crusher gradients flanking the refocusing pulse (z-axis spoiling)
    gz_spoil = pp.make_trapezoid(channel='z', system=system, area=gz.area * 2, duration=2e-3)

    # Readout gradient and ADC
    delta_kx = 1 / fov_x
    delta_ky = 1 / fov_y
    k_width = n_x * delta_kx
    readout_time = 6.4e-3
    gx = pp.make_trapezoid(channel='x', system=system, flat_area=k_width, flat_time=readout_time)
    adc = pp.make_adc(num_samples=n_x, duration=gx.flat_time, delay=gx.rise_time, system=system)

    # Readout dephase gradient (played after refocusing, before readout)
    gx_pre = pp.make_trapezoid(channel='x', system=system, area=gx.area / 2, duration=2e-3)
    dur_pre = pp.calc_duration(gx_pre)

    # Phase-encoding areas
    phase_areas = (np.arange(n_y) - n_y / 2) * delta_ky

    # Timing: TE/2 from rf90 center to rf180 center, and rf180 center to ADC center
    t_exc_to_end = pp.calc_duration(gz, rf) - pp.calc_rf_center(rf)[0] - rf.delay
    t_180_center = pp.calc_rf_center(rf180)[0] + rf180.delay
    delay_te1 = te / 2 - t_exc_to_end - pp.calc_duration(gz_reph) - pp.calc_duration(gz_spoil) - t_180_center
    delay_te1 = np.ceil(delay_te1 / system.grad_raster_time) * system.grad_raster_time

    t_180_to_end = pp.calc_duration(gz180, rf180) - pp.calc_rf_center(rf180)[0] - rf180.delay
    t_adc_center = adc.delay + adc.num_samples * adc.dwell / 2
    delay_te2 = te / 2 - t_180_to_end - pp.calc_duration(gz_spoil) - dur_pre - t_adc_center
    delay_te2 = np.ceil(delay_te2 / system.grad_raster_time) * system.grad_raster_time

    assert delay_te1 >= 0, 'TE too short to accommodate excitation/refocusing pulses'
    assert delay_te2 >= 0, 'TE too short to accommodate refocusing pulse/readout'

    # Total duration of one excitation-to-readout block (used for TR delay)
    te_train = (
        pp.calc_duration(gz, rf)
        + pp.calc_duration(gz_reph)
        + delay_te1
        + pp.calc_duration(gz_spoil)
        + pp.calc_duration(gz180, rf180)
        + pp.calc_duration(gz_spoil)
        + delay_te2
        + dur_pre
        + pp.calc_duration(gx, adc)
    )
    tr_delay = (tr - n_slices * te_train) / n_slices
    tr_delay = system.grad_raster_time * np.round(tr_delay / system.grad_raster_time)
    if tr_delay < 0:
        tr_delay = 1e-3
        import warnings

        warnings.warn(f'TR too short, adapted to include all slices to: {1000 * n_slices * (te_train + tr_delay)} ms')

    for i_phase in range(n_y):
        for i_slice in range(n_slices):
            freq_offset = gz.amplitude * slice_thickness * (i_slice - (n_slices - 1) / 2)
            rf.freq_offset = freq_offset
            rf180.freq_offset = freq_offset
            rf.phase_offset = -2 * np.pi * rf.freq_offset * pp.calc_rf_center(rf)[0]
            rf180.phase_offset = np.pi / 2 - 2 * np.pi * rf180.freq_offset * pp.calc_rf_center(rf180)[0]

            gy_pre = pp.make_trapezoid(channel='y', system=system, area=phase_areas[i_phase], duration=dur_pre)

            seq.add_block(rf, gz)
            seq.add_block(gz_reph)
            seq.add_block(pp.make_delay(delay_te1))
            seq.add_block(gz_spoil)
            seq.add_block(rf180, gz180)
            seq.add_block(gz_spoil)
            seq.add_block(pp.make_delay(delay_te2))
            seq.add_block(gx_pre, gy_pre)
            seq.add_block(gx, adc)
            seq.add_block(pp.make_delay(tr_delay))

    ok, error_report = seq.check_timing()
    if ok:
        print('Timing check passed successfully')
    else:
        print('Timing check failed. Error listing follows:')
        [print(e) for e in error_report]

    if test_report:
        print(seq.test_report())

    if plot:
        seq.plot(time_range=(0.0, te + 5e-3))

    seq.set_definition(key='FOV', value=[fov_x, fov_y, slice_thickness * n_slices])
    seq.set_definition(key='Name', value='se')

    if write_seq:
        seq.write(seq_filename)

    return seq


if __name__ == '__main__':
    main(plot=True, write_seq=True)
