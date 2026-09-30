###############################################################################
# GLIOMA HIGH- vs LOW-GRADE CLASSIFICATION — STRUCTURAL CONNECTOMICS
# Repeated Nested CV + Sequential Feature Selection + SHAP + Permutation Test
#
# Fixes applied vs. original draft:
#   - Windows-safe entry point (multiprocessing/loky requires __main__ guard)
#   - Thread-oversubscription control (sklearnex/oneDAL + joblib + GridSearchCV)
#   - Outer-loop (fold / permutation) parallelization via joblib
#   - Robust SHAP extraction (list / 3D ndarray / class-first ndarray, version-agnostic)
#   - Explicit positive-class handling (no hardcoded index assumptions)
#   - Safe column sanitization with duplicate-name protection
#   - Dynamic SFS feature-count grid clipping + error_score=nan for robustness
#   - Sensitivity/Specificity reporting for clinical interpretability
#   - Dynamic fold-count labeling in stability report
###############################################################################

import os

# Must be set BEFORE numpy / MKL / TBB initialize, and propagate to loky
# worker processes. We parallelize at the fold/permutation level, so every
# BLAS/OpenMP/TBB thread pool inside a worker is capped to 1 thread to avoid
# oversubscription against sklearnex (oneDAL/TBB) + GridSearchCV + SFS n_jobs.
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

from sklearnex import patch_sklearn
patch_sklearn()

import re
import time
import warnings

import numpy as np
import pandas as pd
import scipy.stats as stats
import threadpoolctl
from joblib import Parallel, delayed

from sklearn.model_selection import (
    RepeatedStratifiedKFold,
    StratifiedKFold,
    GridSearchCV,
)
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_selection import SequentialFeatureSelector, VarianceThreshold
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    confusion_matrix,
)
import shap

warnings.filterwarnings("ignore")


# =============================================================================
# 0. CONFIGURATION
# =============================================================================
DATA_PATH = r"C:\Users\neuro\Desktop\Conectomica"
DATA_FILENAME = "dataset_conectomicas_with_patient_details.csv"
RESULTS_PATH = r"C:\Users\neuro\Desktop\Conectomica\results"

N_REPEATS = 5
N_SPLITS_OUTER = 5
N_SPLITS_INNER = 3
RANDOM_STATE = 42

N_PERMUTATIONS = 200  # was 5 in the draft: statistically underpowered (min p = 1/6).
                       # With outer-loop parallelization this is now tractable.

# Parallelism: we parallelize the COARSE, embarrassingly-parallel axis (outer
# folds / permutations) and force everything nested inside a worker to be
# single-threaded. Do not raise GRID_N_JOBS / INNER_N_JOBS above 1 unless you
# also lower N_JOBS_OUTER accordingly — nested n_jobs=-1 x n_jobs=-1 is what
# caused the original script's oversubscription/slowdowns.
N_JOBS_OUTER = max(1, (os.cpu_count() or 4) - 1)
GRID_N_JOBS = 1
INNER_N_JOBS = 1

# Candidate positive class after label encoding (see LABEL_MAPPING section).
POSITIVE_LABEL = 1

SFS_K_CANDIDATES = [3, 5, 8, 10]
RF_PARAM_GRID_BASE = {
    "rf_classifier__n_estimators": [100, 200],
    "rf_classifier__max_depth": [3, 5, 8],
    "rf_classifier__min_samples_split": [4, 8],
    "rf_classifier__max_features": ["sqrt", "log2"],
}

os.makedirs(RESULTS_PATH, exist_ok=True)


# =============================================================================
# 1. HELPERS
# =============================================================================
def sanitize_and_dedupe_columns(columns):
    """
    Sanitizes raw connectome column names for safe use as Python/pandas
    identifiers, while guaranteeing uniqueness. The original regex
    `[^*A-Za-z0-9_ ]+` silently allowed literal '*' and stripped things like
    '-' or '.' that are common in atlas region names (e.g. 'ctx-lh-precentral'),
    which can collide two distinct regions into the same sanitized name and
    silently merge/overwrite a feature. We sanitize AND detect collisions.
    """
    sanitized, seen = [], {}
    for raw_col in columns:
        clean = re.sub(r"[^A-Za-z0-9_]+", "_", str(raw_col)).strip("_")
        if clean == "":
            clean = "feature"
        if clean in seen:
            seen[clean] += 1
            clean = f"{clean}__dup{seen[clean]}"
            warnings.warn(
                f"Column name collision after sanitization: '{raw_col}' -> "
                f"disambiguated as '{clean}'. Verify this is not a real duplicate feature."
            )
        else:
            seen[clean] = 0
        sanitized.append(clean)
    return sanitized


def build_full_pipeline(n_features_to_select=5, random_state=42, inner_n_jobs=1):
    """
    End-to-end, leakage-safe pipeline:
      1. Median imputation
      2. Variance-threshold filtering
      3. Standard scaling
      4. Forward Sequential Feature Selection (screened by a shallow RF)
      5. Final Random Forest classifier
    Every step is a Pipeline member, so during GridSearchCV/cross_val it is
    always refit on the training fold only -> no leakage into validation/test.
    """
    screener_rf = RandomForestClassifier(
        n_estimators=50,
        max_depth=4,
        random_state=random_state,
        class_weight="balanced",
        n_jobs=inner_n_jobs,
    )
    sfs = SequentialFeatureSelector(
        estimator=screener_rf,
        n_features_to_select=n_features_to_select,
        direction="forward",
        scoring="f1_macro",
        cv=3,
        n_jobs=inner_n_jobs,
    )
    pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("variance_threshold", VarianceThreshold(threshold=1e-5)),
            ("scaler", StandardScaler()),
            ("feature_selection", sfs),
            (
                "rf_classifier",
                RandomForestClassifier(
                    random_state=random_state,
                    class_weight="balanced",
                    n_jobs=inner_n_jobs,
                ),
            ),
        ]
    )
    return pipeline


def map_selected_features(fitted_pipeline, all_columns):
    """
    Maps SFS-selected indices back to original column names, correctly
    composing the two boolean masks:
      raw columns -> VarianceThreshold mask -> SFS mask
    (This chaining was actually correct in the draft; kept here with an
    explicit length assertion so a future pipeline change fails loudly
    instead of silently misaligning names.)
    """
    var_step = fitted_pipeline.named_steps["variance_threshold"]
    sfs_step = fitted_pipeline.named_steps["feature_selection"]

    var_support = var_step.get_support()
    assert len(var_support) == len(all_columns), (
        "VarianceThreshold support mask length does not match X_raw.columns; "
        "the pipeline must be fit on a frame with the same columns as X_raw."
    )
    cols_after_var = np.asarray(all_columns)[var_support]

    sfs_support = sfs_step.get_support()
    assert len(sfs_support) == len(cols_after_var), (
        "SFS support mask length does not match post-VarianceThreshold columns."
    )
    return cols_after_var[sfs_support].tolist()


def extract_positive_class_shap(explainer, X, fitted_estimator, positive_label=POSITIVE_LABEL):
    """
    Version-robust extraction of SHAP values for the positive class from a
    TreeExplainer fit on a RandomForestClassifier.

    shap.TreeExplainer.shap_values() has returned, across versions:
      - a list of 2 arrays [class0_vals, class1_vals], each (n_samples, n_features)
      - a single ndarray of shape (n_samples, n_features, n_classes)
      - (older/edge cases) shape (n_classes, n_samples, n_features)
    We resolve the class index via `fitted_estimator.classes_` rather than
    assuming index 1 always corresponds to the label we care about.
    """
    try:
        raw_shap = explainer.shap_values(X, check_additivity=False)
    except TypeError:
        # Older SHAP versions do not accept check_additivity kwarg.
        raw_shap = explainer.shap_values(X)

    classes = list(fitted_estimator.classes_)
    if positive_label not in classes:
        raise ValueError(f"positive_label={positive_label} not found in estimator classes_={classes}")
    pos_idx = classes.index(positive_label)

    if isinstance(raw_shap, list):
        return np.asarray(raw_shap[pos_idx])

    raw_shap = np.asarray(raw_shap)
    if raw_shap.ndim == 3:
        if raw_shap.shape[-1] == len(classes):
            return raw_shap[:, :, pos_idx]
        elif raw_shap.shape[0] == len(classes):
            return raw_shap[pos_idx, :, :]
        raise ValueError(f"Unexpected SHAP array shape {raw_shap.shape} for {len(classes)} classes.")

    # Already 2D (n_samples, n_features) -> binary case some SHAP versions
    # return only the positive-class contributions directly.
    return raw_shap


def clip_sfs_grid(k_candidates, n_available_features):
    clipped = sorted({min(k, max(1, n_available_features - 1)) for k in k_candidates})
    return clipped


def compute_bootstrap_ci(data, n_bootstraps=2000, ci=95, random_state=RANDOM_STATE):
    rng = np.random.RandomState(random_state)
    clean_data = np.asarray(data, dtype=float)
    clean_data = clean_data[~np.isnan(clean_data)]
    boot_means = np.empty(n_bootstraps)
    for i in range(n_bootstraps):
        sample = rng.choice(clean_data, size=len(clean_data), replace=True)
        boot_means[i] = np.mean(sample)
    lower = np.percentile(boot_means, (100 - ci) / 2)
    upper = np.percentile(boot_means, 100 - (100 - ci) / 2)
    return float(np.mean(clean_data)), float(lower), float(upper)


# =============================================================================
# 2. DATA LOADING & TARGET DETECTION
# =============================================================================
def load_data():
    full_data_path = os.path.join(DATA_PATH, DATA_FILENAME)
    if not os.path.exists(full_data_path):
        raise FileNotFoundError(f"Could not find target file at: {full_data_path}")
    df_raw = pd.read_csv(full_data_path)

    label_candidates = ["labels", "label", "Class", "target", "group", "Grade", "Diagnosis"]
    target_col = next((c for c in label_candidates if c in df_raw.columns), None)
    if target_col is None:
        raise KeyError(
            f"Could not automatically detect target column. Available columns: {list(df_raw.columns)}"
        )
    print(f"Target column detected: '{target_col}'")

    id_candidates = ["Patient_ID", "Subject_ID", "ID", "Patient", "Subject"]
    id_cols_to_drop = [c for c in id_candidates if c in df_raw.columns]

    labels_raw = df_raw[target_col].values
    features_df = df_raw.drop(columns=[target_col] + id_cols_to_drop, errors="ignore")

    if labels_raw.dtype == "object":
        y_vec, uniques = pd.factorize(labels_raw, sort=True)
        print(
            "WARNING: target was factorized from string labels using alphabetical "
            f"order: {list(uniques)} -> encoded as {list(range(len(uniques)))}. "
            "Verify that the clinically 'positive'/high-grade class received the "
            "intended encoded value before interpreting ROC-AUC/SHAP direction."
        )
    else:
        uniques = np.unique(labels_raw)
        y_vec, _ = pd.factorize(labels_raw, sort=True)
        print(
            f"Target is numeric with raw values {list(uniques)}; re-encoded to "
            f"{list(range(len(uniques)))} in ascending order for consistency."
        )
    y = pd.Series(y_vec, name="y")

    n_classes = y.nunique()
    if n_classes != 2:
        raise ValueError(
            f"This pipeline assumes BINARY classification (high vs. low grade), "
            f"but {n_classes} classes were detected: {sorted(y.unique())}. "
            "roc_auc_score / SHAP positive-class extraction below are binary-only."
        )

    mapping_table = pd.crosstab(pd.Series(labels_raw, name="original_label"), y)
    print("\nLabel encoding map (original -> encoded):")
    print(mapping_table)
    print(f"\nClass balance:\n{y.value_counts().rename('n_samples')}\n")

    features_df.columns = sanitize_and_dedupe_columns(features_df.columns)
    X_raw = features_df.copy()

    print(f"Dataset Loaded: N = {X_raw.shape[0]} samples, P = {X_raw.shape[1]} features.")
    return X_raw, y


# =============================================================================
# 3. OUTER-FOLD WORKER (used both by main Nested CV and by permutation test)
# =============================================================================
def _evaluate_outer_fold(fold_idx, train_idx, test_idx, X_raw, y, param_grid, base_seed,
                          collect_shap=False):
    """
    Fully isolated evaluation of a single outer fold: inner GridSearchCV
    (imputation/variance/scaling/SFS/RF all refit on the training fold only),
    scoring on the held-out test fold, and optional SHAP extraction.
    Runs single-threaded internally; parallelism happens across calls to this
    function (see joblib.Parallel in section 4/6).
    """
    with threadpoolctl.threadpool_limits(limits=1):
        X_train_raw, X_test_raw = X_raw.iloc[train_idx], X_raw.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

        fold_seed = base_seed + fold_idx
        inner_cv = StratifiedKFold(n_splits=N_SPLITS_INNER, shuffle=True, random_state=fold_seed)
        base_pipeline = build_full_pipeline(random_state=fold_seed, inner_n_jobs=INNER_N_JOBS)

        grid_search = GridSearchCV(
            estimator=base_pipeline,
            param_grid=param_grid,
            cv=inner_cv,
            scoring="f1_macro",
            n_jobs=GRID_N_JOBS,
            error_score=np.nan,  # a clipped/invalid k for a given fold shouldn't crash the run
            refit=True,
        )
        grid_search.fit(X_train_raw, y_train)
        best_pipe = grid_search.best_estimator_

        pos_idx = list(best_pipe.classes_).index(POSITIVE_LABEL)
        y_pred = best_pipe.predict(X_test_raw)
        y_prob = best_pipe.predict_proba(X_test_raw)[:, pos_idx]

        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, average="macro", zero_division=0)
        rec = recall_score(y_test, y_pred, average="macro", zero_division=0)
        f1 = f1_score(y_test, y_pred, average="macro", zero_division=0)
        try:
            auc_score = roc_auc_score(y_test, y_prob)
        except ValueError:
            auc_score = np.nan

        tn, fp, fn, tp = confusion_matrix(y_test, y_pred, labels=best_pipe.classes_).ravel()
        sensitivity = tp / (tp + fn) if (tp + fn) > 0 else np.nan
        specificity = tn / (tn + fp) if (tn + fp) > 0 else np.nan

        selected_feature_names = map_selected_features(best_pipe, X_raw.columns)

        record = {
            "Iteration": fold_idx + 1,
            "Accuracy": acc,
            "Precision_Macro": prec,
            "Recall_Macro": rec,
            "F1_Macro": f1,
            "ROC_AUC": auc_score,
            "Sensitivity_PositiveClass": sensitivity,
            "Specificity_PositiveClass": specificity,
            "Optimal_K_Features": len(selected_feature_names),
            "Best_Params": str(grid_search.best_params_),
        }

        result = {
            "record": record,
            "selected_features": {"Fold": fold_idx + 1, "Selected_Features": selected_feature_names},
            "shap_data": None,
        }

        if collect_shap:
            imputer = best_pipe.named_steps["imputer"]
            var_step = best_pipe.named_steps["variance_threshold"]
            scaler = best_pipe.named_steps["scaler"]
            sfs_step = best_pipe.named_steps["feature_selection"]
            fitted_rf = best_pipe.named_steps["rf_classifier"]

            X_test_transformed = scaler.transform(var_step.transform(imputer.transform(X_test_raw)))
            X_test_sfs = X_test_transformed[:, sfs_step.get_support()]

            explainer = shap.TreeExplainer(fitted_rf, feature_perturbation="tree_path_dependent")
            shap_vals_target = extract_positive_class_shap(explainer, X_test_sfs, fitted_rf)

            result["shap_data"] = {
                "Fold": fold_idx + 1,
                "Features": selected_feature_names,
                "SHAP_Values": shap_vals_target,
                "X_Test_Val": X_test_sfs,
            }

        return result


# =============================================================================
# 4. REPEATED NESTED CROSS-VALIDATION (parallel across outer folds)
# =============================================================================
def run_nested_cv(X_raw, y, param_grid):
    outer_cv = RepeatedStratifiedKFold(
        n_splits=N_SPLITS_OUTER, n_repeats=N_REPEATS, random_state=RANDOM_STATE
    )
    fold_specs = list(enumerate(outer_cv.split(X_raw, y)))
    print(
        f"\nStarting {N_REPEATS}x{N_SPLITS_OUTER}-Fold Repeated Nested CV "
        f"({len(fold_specs)} outer folds, {N_JOBS_OUTER} parallel workers)..."
    )

    t0 = time.time()
    results = Parallel(n_jobs=N_JOBS_OUTER)(
        delayed(_evaluate_outer_fold)(
            fold_idx, train_idx, test_idx, X_raw, y, param_grid, RANDOM_STATE, collect_shap=True
        )
        for fold_idx, (train_idx, test_idx) in fold_specs
    )
    print(f"Nested CV completed in {(time.time() - t0) / 60.0:.2f} minutes.")

    fold_records = [r["record"] for r in results]
    fold_selected_features = [r["selected_features"] for r in results]
    fold_shap_data = [r["shap_data"] for r in results]
    return pd.DataFrame(fold_records), fold_selected_features, fold_shap_data


# =============================================================================
# 5. PERFORMANCE SUMMARY (bootstrap CIs)
# =============================================================================
def summarize_performance(df_nested_results):
    print("\n================ REPEATED NESTED CV PERFORMANCE SUMMARY ================")
    metrics = ["Accuracy", "Precision_Macro", "Recall_Macro", "F1_Macro", "ROC_AUC",
               "Sensitivity_PositiveClass", "Specificity_PositiveClass"]
    summary_rows = []
    for metric in metrics:
        mean_val, ci_low, ci_high = compute_bootstrap_ci(df_nested_results[metric])
        std_val = df_nested_results[metric].std()
        summary_rows.append({
            "Metric": metric,
            "Mean": mean_val,
            "Std": std_val,
            "CV_Bootstrap_95%_CI_Lower": ci_low,
            "CV_Bootstrap_95%_CI_Upper": ci_high,
        })
        print(f"{metric:28s}: Mean = {mean_val:.4f} +/- {std_val:.4f} | "
              f"95% CI: [{ci_low:.4f}, {ci_high:.4f}]")
    df_summary = pd.DataFrame(summary_rows)
    df_summary.to_csv(os.path.join(RESULTS_PATH, "unbiased_repeated_nested_cv_performance.csv"), index=False)
    return df_summary


# =============================================================================
# 6. PERMUTATION TEST (parallel across permutations)
# =============================================================================
def _run_one_permutation(p_idx, X_raw, y, param_grid):
    with threadpoolctl.threadpool_limits(limits=1):
        rng_perm = np.random.RandomState(RANDOM_STATE + p_idx)
        y_permuted = pd.Series(rng_perm.permutation(y.values), index=y.index)

        perm_outer_cv = RepeatedStratifiedKFold(
            n_splits=N_SPLITS_OUTER, n_repeats=N_REPEATS, random_state=RANDOM_STATE
        )
        f1_scores = []
        for fold_idx, (train_idx, test_idx) in enumerate(perm_outer_cv.split(X_raw, y_permuted)):
            result = _evaluate_outer_fold(
                fold_idx, train_idx, test_idx, X_raw, y_permuted, param_grid,
                base_seed=RANDOM_STATE + p_idx * 1000, collect_shap=False,
            )
            f1_scores.append(result["record"]["F1_Macro"])
        return float(np.mean(f1_scores))


def run_permutation_test(X_raw, y, param_grid, actual_f1_mean):
    print(f"\nRunning Permutation Test Benchmark ({N_PERMUTATIONS} permutations, "
          f"{N_JOBS_OUTER} parallel workers)...")
    t0 = time.time()
    permuted_f1_scores = Parallel(n_jobs=N_JOBS_OUTER)(
        delayed(_run_one_permutation)(p_idx, X_raw, y, param_grid)
        for p_idx in range(N_PERMUTATIONS)
    )
    total_elapsed = time.time() - t0
    avg_time_per_perm = total_elapsed / N_PERMUTATIONS

    print("\n================ PERMUTATION TEST TIMING SUMMARY ================")
    print(f"Total time: {total_elapsed / 60.0:.2f} minutes for {N_PERMUTATIONS} permutations "
          f"({N_JOBS_OUTER} workers)")
    print(f"Average wall time per permutation (amortized): {avg_time_per_perm / 60.0:.2f} minutes")

    p_value = (np.sum(np.array(permuted_f1_scores) >= actual_f1_mean) + 1) / (N_PERMUTATIONS + 1)
    print(f"\nPermutation Test Empirical p-value: p = {p_value:.5f} (N={N_PERMUTATIONS})")

    pd.DataFrame({
        "Actual_F1_Mean": [actual_f1_mean],
        "Permutation_p_value": [p_value],
        "N_Permutations": [N_PERMUTATIONS],
        "Total_Minutes": [total_elapsed / 60.0],
    }).to_csv(os.path.join(RESULTS_PATH, "permutation_test_results.csv"), index=False)
    return p_value, permuted_f1_scores


# =============================================================================
# 7. FEATURE SELECTION FREQUENCY & SHAP STABILITY
# =============================================================================
def summarize_feature_stability(X_raw, fold_selected_features, fold_shap_data, total_folds):
    all_selected_flat = [feat for fold in fold_selected_features for feat in fold["Selected_Features"]]
    feature_counts = pd.Series(all_selected_flat).value_counts()

    feature_shap_stats = {feat: {"abs_shap": [], "correlation": []} for feat in X_raw.columns}
    for item in fold_shap_data:
        features = item["Features"]
        shap_vals = item["SHAP_Values"]
        x_vals = item["X_Test_Val"]
        assert shap_vals.shape[1] == len(features) == x_vals.shape[1], (
            "Mismatch between selected feature names and SHAP/X column count for this fold; "
            "aborting to avoid silently misattributing SHAP values to the wrong feature."
        )
        for idx, feat in enumerate(features):
            feat_shap = shap_vals[:, idx]
            feat_raw = x_vals[:, idx]
            feature_shap_stats[feat]["abs_shap"].append(np.mean(np.abs(feat_shap)))
            if np.std(feat_raw) > 0 and np.std(feat_shap) > 0:
                corr, _ = stats.pearsonr(feat_raw, feat_shap)
                feature_shap_stats[feat]["correlation"].append(corr)
            else:
                feature_shap_stats[feat]["correlation"].append(0.0)

    stability_records = []
    for feat in X_raw.columns:
        freq = feature_counts.get(feat, 0)
        if freq > 0:
            mean_abs_shap = np.mean(feature_shap_stats[feat]["abs_shap"])
            mean_corr = np.mean(feature_shap_stats[feat]["correlation"])
            direction = "Positive" if mean_corr > 0.05 else ("Negative" if mean_corr < -0.05 else "Neutral/Non-linear")
            stability_records.append({
                "Feature_Name": feat,
                f"Selection_Frequency_Out_of_{total_folds}": freq,
                "Selection_Percentage": (freq / total_folds) * 100,
                "Mean_Absolute_SHAP_When_Selected": mean_abs_shap,
                "SHAP_Directional_Impact": direction,
                "Mean_Feature_SHAP_Correlation": mean_corr,
            })

    df_stability = pd.DataFrame(stability_records).sort_values(
        by=[f"Selection_Frequency_Out_of_{total_folds}", "Mean_Absolute_SHAP_When_Selected"],
        ascending=[False, False],
    )
    df_stability.to_csv(os.path.join(RESULTS_PATH, "feature_stability_and_shap_analysis.csv"), index=False)
    print("\n================ TOP SELECTED FEATURES & SHAP IMPACT ================")
    print(df_stability.head(10).to_string(index=False))
    return df_stability


# =============================================================================
# 8. MAIN ENTRY POINT
# =============================================================================
def main():
    X_raw, y = load_data()

    sfs_k_candidates = clip_sfs_grid(SFS_K_CANDIDATES, X_raw.shape[1])
    param_grid = {"feature_selection__n_features_to_select": sfs_k_candidates, **RF_PARAM_GRID_BASE}

    df_nested_results, fold_selected_features, fold_shap_data = run_nested_cv(X_raw, y, param_grid)
    summarize_performance(df_nested_results)

    actual_f1_mean = df_nested_results["F1_Macro"].mean()
    run_permutation_test(X_raw, y, param_grid, actual_f1_mean)

    summarize_feature_stability(X_raw, fold_selected_features, fold_shap_data, total_folds=len(df_nested_results))

    print(f"\nPipeline Execution Complete. All outputs exported to: {RESULTS_PATH}")


if __name__ == "__main__":
    # REQUIRED on Windows: joblib's loky backend and sklearn's n_jobs use
    # process-based multiprocessing, which re-imports this module in each
    # child process on win32 (no fork()). Without this guard, running the
    # module directly on Windows either raises a RuntimeError or spawns
    # runaway child processes that each try to re-run the whole script.
    main()
