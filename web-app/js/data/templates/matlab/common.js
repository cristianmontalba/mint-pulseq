/**
 * MATLAB / COMMON — header, body preamble and footer of the exported .m script.
 *
 * The MATLAB mirror of ../common.js. Same assembly contract, same variable
 * names (snake_case, as in the Python export) and the same gradient
 * identifiers from names.js, so the .py and the .m of one sequence can be read
 * side by side.
 *
 *  preamble(params) → header comment + run flags
 *  body(params)     → scan params, system limits, seq object, validator state
 *  footer(params)   → validation report, timing check, definitions, write,
 *                     plot, and the MINT validation helpers as LOCAL FUNCTIONS
 *
 *  lobeCheck(names) → the `mint = mint_check_lobes(mint, {...});` statement.
 *
 * Local functions at the end of a script need MATLAB R2016b or newer; the
 * header of the generated file says so.
 */

(function () {
    'use strict';

    window.pulseqTemplates = window.pulseqTemplates || {};
    window.pulseqTemplates.matlab = window.pulseqTemplates.matlab || {};

    // One spelling of the MATLAB-safe name rule, shared with ../common.js
    // (which loads first): the .m and the .py must agree on the file name.
    const safeMatlabName = (text) => window.pulseqTemplates.common.safeMatlabName(text);

    function seqBaseName(params) {
        // A console blank sequence passes its own name; the Free builder never does.
        return safeMatlabName(params.fileBase || `seq_${params.excitation}_${params.trajectory}_${params.dimension}`);
    }

    // MATLAB runs a script only when its FILE name is a valid identifier, and a
    // browser that already has a copy saves the next download as "name (1).m".
    // Said at the top of every .m, because that is where the user looks first.
    function fileNameNote(base) {
        return `% Save this file as ${base}.m - MATLAB only runs a script whose name is a\n` +
               '% letter followed by letters, digits or underscores. A browser copy such as\n' +
               `% "${base} (1).m" will NOT run: rename it to ${base}.m first.`;
    }

    // ms from the form → a MATLAB literal in seconds, exactly as typed.
    function msLiteral(ms) {
        return `${Number(ms)}e-3`;
    }

    /** `mint = mint_check_lobes(mint, {'a', a; 'b', b});`, one row per line. */
    function lobeCheck(names, indentSpaces) {
        const pad = ' '.repeat(indentSpaces || 0);
        if (names.length === 1) {
            return `${pad}mint = mint_check_lobes(mint, {'${names[0]}', ${names[0]}});`;
        }
        return [
            `${pad}mint = mint_check_lobes(mint, { ...`,
            ...names.map((n) => `${pad}    '${n}', ${n}; ...`),
            `${pad}    });`
        ].join('\n');
    }

    // The validator travels inside every generated script as local functions,
    // so the checks run against the real event structs and still apply after
    // the user edits the script by hand. It mirrors MintValidator in ../common.js
    // rule for rule; change one, change the other.
    const VALIDATOR = `% =========================================================================
%  MINT validation helpers (local functions)
%
%  WARNINGS are collected in mint.warnings and printed by mint_report: the
%  sequence still builds - it is legal Pulseq - but it will not time the way
%  it reads. ERRORS stop the script before the offending block reaches the
%  sequence: the combination is physically impossible.
% =========================================================================

function mint = mint_init(sys)
    mint.sys = sys;
    % A lobe is routinely split in half: TE runs to the MIDDLE of the readout
    % lobe, a rephaser carries HALF the selection area. So every lobe, TE and
    % TR must be a whole number of DOUBLE gradient rasters - 20 us on a 10 us
    % raster. Otherwise the half lands off the raster and a ceil() further
    % down shifts everything that follows it.
    mint.lobe_raster = 2 * sys.gradRasterTime;
    mint.warnings = {};
    mint.n_blocks = 0;
    mint.clock = 0;                    % [s] start time of the next block
    mint.slice_ramp_down_start = [];   % [s] absolute; set by each RF block
end

function tf = mint_is_multiple(value, raster)
    ratio = value / raster;
    tf = abs(ratio - round(ratio)) < 1e-6;
end

function t = mint_round_to(value, raster)
    t = round(value / raster) * raster;
end

function t = mint_ceil_to(value, raster)
    % Round first: 2.56e-3 / 2e-5 is 128.00000000000003 in floating point,
    % and a bare ceil() would turn that into 129.
    t = ceil(round(value / raster * 1e6) / 1e6) * raster;
end

function t = mint_floor_to(value, raster)
    t = floor(round(value / raster * 1e6) / 1e6) * raster;
end

function mint = mint_warn(mint, text)
    if ~any(strcmp(mint.warnings, text))   % a check inside a loop reports once
        mint.warnings{end + 1} = text;
    end
end

function mint = mint_check_adc_dwell(mint, dwell, name)
    % The dwell must be an exact integer multiple of adcRasterTime.
    raster = mint.sys.adcRasterTime;
    if ~mint_is_multiple(dwell, raster)
        mint = mint_warn(mint, sprintf([ ...
            '%s = %.2f ns is NOT an integer multiple of adcRasterTime (%.0f ns): ' ...
            'the scanner cannot sample at that rate. Nearest valid dwell below it: %.0f ns.'], ...
            name, dwell * 1e9, raster * 1e9, mint_floor_to(dwell, raster) * 1e9));
    end
end

function mint = mint_check_adc(mint, adc, name)
    % Dwell on the ADC raster, sample count a multiple of the divisor.
    mint = mint_check_adc_dwell(mint, adc.dwell, [name '.dwell']);
    divisor = 1;
    if isfield(mint.sys, 'adcSamplesDivisor') && mint.sys.adcSamplesDivisor > 0
        divisor = mint.sys.adcSamplesDivisor;
    end
    if mod(adc.numSamples, divisor) ~= 0
        mint = mint_warn(mint, sprintf([ ...
            '%s: %d samples is not a multiple of adcSamplesDivisor (%d); ' ...
            'some scanners reject it.'], name, adc.numSamples, divisor));
    end
end

function mint = mint_check_lobes(mint, lobes)
    % Every gradient lobe must last a whole number of 2 * gradRasterTime.
    % lobes is an N-by-2 cell: {'name', event; ...}
    for i = 1:size(lobes, 1)
        name = lobes{i, 1};
        grad = lobes{i, 2};
        if strcmp(grad.type, 'trap')
            duration = grad.riseTime + grad.flatTime + grad.fallTime;
        else
            duration = grad.shape_dur;
        end
        if ~mint_is_multiple(duration, mint.lobe_raster)
            mint = mint_warn(mint, sprintf([ ...
                '%s: duration %.1f us is not a multiple of 2 * gradRasterTime (%.0f us). ' ...
                'Half of it falls off the gradient raster, so splitting it forces a ceil() ' ...
                'that drifts the timing. Use %.0f us.'], ...
                name, duration * 1e6, mint.lobe_raster * 1e6, ...
                mint_ceil_to(duration, mint.lobe_raster) * 1e6));
        end
    end
end

function mint = mint_check_timing_parameter(mint, name, value)
    % TE, TR and TI must be whole numbers of 2 * gradRasterTime.
    if ~mint_is_multiple(value, mint.lobe_raster)
        mint = mint_warn(mint, sprintf([ ...
            '%s = %.4f ms is not a multiple of 2 * gradRasterTime (%.0f us). Its half falls ' ...
            'off the gradient raster, so the delays are rounded and the sequence plays at a ' ...
            'slightly different %s. Nearest valid value: %.2f ms.'], ...
            name, value * 1e3, mint.lobe_raster * 1e6, name, ...
            mint_round_to(value, mint.lobe_raster) * 1e3));
    end
end

function mint = mint_check_b1(mint, name, rf, max_b1)
    % Peak B1 of a pulse against the scanner limit [T].
    peak = max(abs(rf.signal)) / mint.sys.gamma;   % Hz -> T
    if peak > max_b1 * (1 + 1e-9)
        mint = mint_warn(mint, sprintf([ ...
            '%s: peak B1 %.2f uT exceeds max_b1 (%.2f uT). ' ...
            'Lengthen the pulse or lower the flip angle.'], name, peak * 1e6, max_b1 * 1e6));
    end
end

function events = mint_flatten(args)
    % mr.rotate returns a cell array; unwrap any nesting into one flat list.
    events = {};
    for i = 1:numel(args)
        if iscell(args{i})
            events = [events, mint_flatten(args{i})]; %#ok<AGROW>
        elseif isstruct(args{i}) && isfield(args{i}, 'type')
            events{end + 1} = args{i}; %#ok<AGROW>
        end
    end
end

function mint = mint_add_block(mint, seq, varargin)
    % Check a block for impossible RF / gradient / ADC combinations and only
    % then add it to the sequence. Every block of the script goes through here.
    events = mint_flatten(varargin);
    types = cellfun(@(e) e.type, events, 'UniformOutput', false);
    is_rf = strcmp(types, 'rf');
    is_adc = strcmp(types, 'adc');
    is_grad = strcmp(types, 'trap') | strcmp(types, 'grad');
    grads = events(is_grad);

    mint.n_blocks = mint.n_blocks + 1;
    where = sprintf('Block %d (t = %.3f ms)', mint.n_blocks, mint.clock * 1e3);
    tol = 1e-9;

    if sum(is_rf) > 1
        error('MINT:block', '%s: %d RF pulses in one block. A block holds at most one.', where, sum(is_rf));
    end
    if sum(is_adc) > 1
        error('MINT:block', '%s: %d ADC events in one block. A block holds at most one.', where, sum(is_adc));
    end
    if any(is_rf) && any(is_adc)
        error('MINT:block', ['%s: RF and ADC in the same block. The scanner cannot transmit and ' ...
            'receive at once - put the readout in its own block.'], where);
    end
    channels = cellfun(@(g) g.channel, grads, 'UniformOutput', false);
    for channel = {'x', 'y', 'z'}
        n_on_channel = sum(strcmp(channels, channel{1}));
        if n_on_channel > 1
            error('MINT:block', ['%s: %d gradient events on the %s axis. They would overlap - ' ...
                'combine them into one event or split them into two blocks.'], ...
                where, n_on_channel, channel{1});
        end
    end

    if any(is_rf)
        rf = events{find(is_rf, 1)};
        rf_start = rf.delay;
        rf_end = rf.delay + rf.shape_dur;
        selection = [];
        for i = 1:numel(grads)
            if strcmp(grads{i}.channel, 'z') && strcmp(grads{i}.type, 'trap')
                selection = grads{i};
            end
        end
        if ~isempty(selection)
            plateau_start = selection.delay + selection.riseTime;
            plateau_end = plateau_start + selection.flatTime;
            if rf_start < plateau_start - tol || rf_end > plateau_end + tol
                error('MINT:block', ['%s: the RF pulse plays from %.1f to %.1f us but the ' ...
                    'slice-selection plateau (flatTime) spans %.1f to %.1f us. RF on a gradient ' ...
                    'ramp excites a distorted slice: delay the RF or lengthen the plateau.'], ...
                    where, rf_start * 1e6, rf_end * 1e6, plateau_start * 1e6, plateau_end * 1e6);
            end
            mint.slice_ramp_down_start = mint.clock + plateau_end;
        else
            % No selection lobe: nothing in-plane may start under the pulse.
            mint.slice_ramp_down_start = mint.clock + rf_end;
        end
    end

    if ~isempty(mint.slice_ramp_down_start)
        for i = 1:numel(grads)
            if strcmp(grads{i}.channel, 'z')
                continue;
            end
            start = mint.clock + grads{i}.delay;
            if start < mint.slice_ramp_down_start - tol
                error('MINT:block', ['%s: the g%s event starts at %.1f us, before the ' ...
                    'slice-selection ramp-down begins at %.1f us. Phase-encoding and ' ...
                    'readout-prephasing lobes may start with the ramp-down or after it, ' ...
                    'never under the RF pulse.'], ...
                    where, grads{i}.channel, start * 1e6, mint.slice_ramp_down_start * 1e6);
            end
        end
    end

    if ~isempty(events)
        seq.addBlock(events{:});
        mint.clock = mint.clock + mr.calcDuration(events{:});
    end
end

function mint_report(mint)
    % Print the verdict: a banner when anything was flagged.
    if isempty(mint.warnings)
        fprintf(['MINT validation passed: ADC dwell, gradient-lobe rasters, TE/TR rasters, ' ...
            'RF on the slice-selection plateau and block combinations.\\n']);
        return;
    end
    banner = repmat('!', 1, 78);
    fprintf('%s\\nMINT VALIDATION: %d WARNING(S)\\n', banner, numel(mint.warnings));
    for i = 1:numel(mint.warnings)
        fprintf('WARNING: %s\\n', mint.warnings{i});
    end
    fprintf('%s\\n', banner);
end

function lobe = mint_make_lobe(channel, area, sys, lobe_raster)
    % Shortest trapezoid for the area, stretched to a whole number of lobe
    % rasters. mr.makeTrapezoid(..., 'Area', a) alone returns the shortest lobe
    % on the GRADIENT raster, which is an odd number of rasters about half the
    % time. Stretching it to 2 * gradRasterTime keeps its half on the raster.
    lobe = mr.makeTrapezoid(channel, sys, 'Area', area);
    shortest = mr.calcDuration(lobe);
    duration = mint_ceil_to(shortest, lobe_raster);
    if duration - shortest > 1e-9
        lobe = mr.makeTrapezoid(channel, sys, 'Area', area, 'Duration', duration);
    end
end`;

    function preamble(params) {
        const { fov, resolution, dimension } = params;
        const sys = window.pulseqTemplates.system;
        const base = seqBaseName(params);
        const heavy = dimension === '3D' || (params.nSlices || 1) > 1;
        const irLine = params.inversionRecovery
            ? `\n% Inversion Recovery: on | TI: ${params.ti} ms`
            : '';
        const heavyNote = heavy
            ? `\n% Plots default to OFF: this is a ${dimension} sequence with ${params.nSlices || 1} slices,\n` +
              '% and rendering it costs far more than building it.'
            : '';

        return `% ${base}.m
% MRI sequence generated by the MRI Design web-app (Pulseq for MATLAB).
%
${fileNameNote(base)}
%
% Dimension: ${dimension} | FOV: ${fov.x} x ${fov.y} cm | Resolution: ${resolution.x} x ${resolution.y} mm
% System limits: ${sys.describe(params.system)}${irLine}${heavyNote}
%
% Requires the Pulseq toolbox on the MATLAB path (github.com/pulseq/pulseq,
% v1.5) and MATLAB R2016b or newer: the MINT validation helpers are local
% functions at the end of this file. Running the script writes
% ${base}.seq into the current folder.
%
% This is the MATLAB twin of ${base}.py: the same
% events, the same names, the same checks.

% --- Run flags ---------------------------------------------------------
plot_sequence = ${heavy ? 'false' : 'true'};   % open the sequence diagram
test_report = true;      % print the Pulseq test report
write_seq = true;        % write the .seq file the scanner reads
seq_filename = '${base}.seq';`;
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
        const sliceThk = dimension === '3D'
            ? (fov.z / 100).toFixed(4)
            : '10e-3';

        let sliceGeom = '';
        if (dimension === 'multislice') {
            sliceGeom = `
% Multi-slice geometry. Slices are excited one at a time by shifting the RF
% centre frequency; z_positions holds their offsets from isocentre.
slice_gap = 0.0;   % [m] edge-to-edge gap between slices
delta_z = slice_thickness + slice_gap;
z_positions = ((0:n_slices - 1) - (n_slices - 1) / 2) * delta_z;
`;
        } else if (dimension === '3D') {
            sliceGeom = `
% 3D partition encoding. The slab (slice_thickness = FOV Z) is divided into
% n_slices partitions, each selected by its own kz phase-encode area.
delta_kz = 1 / slice_thickness;
kz_areas = ((0:n_slices - 1) - n_slices / 2) * delta_kz;
pre_time_z = 1e-3;   % [s] duration of the kz slice-encoding lobe
`;
        }

        const multisliceCheck = (dimension === 'multislice' && nSlices > 1)
            ? "\nmint = mint_check_timing_parameter(mint, 'TR / n_slices', tr / n_slices);"
            : '';

        return `
% --- Scan parameters ---------------------------------------------------
fov_x = ${fovX_m};   % [m]
fov_y = ${fovY_m};   % [m]
n_x = ${Nx};
n_y = ${Ny};
n_slices = ${nSlices};
slice_thickness = ${sliceThk};   % [m]
te = ${msLiteral(te)};   % [s]
tr = ${msLiteral(tr)};   % [s]
delta_kx = 1 / fov_x;
delta_ky = 1 / fov_y;
${sliceGeom}
% System limits (${sys.describe(params.system)})
sys = mr.opts( ...
    'MaxGrad', ${s.maxGrad}, 'GradUnit', 'mT/m', ...
    'MaxSlew', ${s.maxSlew}, 'SlewUnit', 'T/m/s', ...
    'rfRingdownTime', ${s.rfRingdownTime}e-6, ...
    'rfDeadTime', ${s.rfDeadTime}e-6, ...
    'adcDeadTime', ${s.adcDeadTime}e-6, ...
    'gradRasterTime', ${Math.round(r.grad * 1e6)}e-6, ...
    'rfRasterTime', ${Math.round(r.rf * 1e6)}e-6, ...
    'adcRasterTime', ${Math.round(r.adc * 1e9)}e-9, ...
    'blockDurationRaster', ${Math.round(r.block * 1e6)}e-6);
max_b1 = ${s.maxB1}e-6;   % [T] peak B1 the scanner allows

seq = mr.Sequence(sys);

% MINT validation. Raster findings are collected as warnings and printed with
% the report; impossible RF / gradient combinations stop the script before the
% block is built. Every block is added through mint_add_block for that reason.
mint = mint_init(sys);
lobe_raster = mint.lobe_raster;   % [s] 2 * gradRasterTime

mint = mint_check_timing_parameter(mint, 'TE', te);
mint = mint_check_timing_parameter(mint, 'TR', tr);${multisliceCheck}`;
    }

    function footer(params) {
        return `% --- Checks and output -------------------------------------------------
% How many excitations this sequence plays. Everything expensive scales with it.
n_repetitions = n_y * n_slices;

% The MINT validation verdict comes first, so a warning is the first thing read.
mint_report(mint);

[ok, error_report] = seq.checkTiming;
if ok
    fprintf('Timing check passed successfully\\n');
else
    fprintf('Timing check failed. Error listing follows:\\n');
    fprintf([error_report{:}]);
    fprintf('\\n');
end

% seq.testReport computes the k-space trajectory internally, which is what makes
% a large sequence slow, so it sits behind the same guard as the plot.
if test_report && n_repetitions > 1000
    fprintf('Test report skipped: %d repetitions. Re-run a small version to inspect it.\\n', n_repetitions);
elseif test_report
    rep = seq.testReport;
    fprintf([rep{:}]);
end

% Definitions and the .seq file come before any rendering: writing is cheap and
% must not be held hostage by the plot.
seq.setDefinition('FOV', [fov_x fov_y slice_thickness]);
seq.setDefinition('Name', '${seqBaseName(params)}');

if write_seq
    seq.write(seq_filename);
    fprintf('Wrote %s\\n', fullfile(pwd, seq_filename));
end

if plot_sequence && n_repetitions > 1000
    fprintf('Large sequence: plot skipped to keep MATLAB responsive.\\n');
elseif plot_sequence
    seq.plot();
end


${VALIDATOR}`;
    }

    window.pulseqTemplates.matlab.common = {
        preamble, body, footer, lobeCheck, msLiteral, seqBaseName, fileNameNote,
        validator: VALIDATOR
    };
})();
