/** Saved comparison presentation only. Input must have passed validateBundle.
 * Never derives scientific metrics or infers adoption masks from extension values.
 */
const idOrder = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function savedRow(id, label, saved) {
  return {
    id, label, nse: saved.nse, rmse: saved.rmse,
    nseReason: saved.nse_reason ?? null,
    nSamples: saved.n_samples, nExcluded: saved.n_excluded,
    nContext: saved.n_context,
    excludedByReason: structuredClone(saved.excluded_by_reason),
  };
}

export function buildEvaluationTable(bundle) {
  const root = bundle.results;
  const synthetic = root.extensions?.synthetic === true;
  const basins = root.results.map(result => ({
    basinId: result.basin_id,
    basinName: bundle.basins?.features.find(feature => feature.properties.basin_id === result.basin_id)?.properties.name ?? result.basin_id,
    synthetic: synthetic || result.extensions?.synthetic === true,
    predictionPath: result.prediction_path ?? null,
    periodStart: result.period_start, periodEnd: result.period_end,
    horizonH: result.horizon_h, unit: 'm³/s',
    sameRowsEvidence: '読み込み時の検査で、評価に採用した時刻が同一であることを確認。持続予測は各時刻の予測開始時点の観測値を参照。',
    comparable: [savedRow('model', '6時間先予測', result), savedRow('persistence', '持続予測', result.baselines.persistence)].sort(idOrder),
    nonComparable: (result.extensions?.series ?? []).map(series => ({
      id: series.id, label: series.label, unit: series.unit,
      evaluationConditions: series.evaluation_conditions,
      source: series.source ?? null,
      status: 'not_comparable',
      reason: '系列別の採用行・評価母数・保存指標がなく、同一条件での比較を確認できません。',
      nse: null, rmse: null, nSamples: null, nExcluded: null,
    })).sort(idOrder),
  })).sort((a, b) => idOrder({id:a.basinId}, {id:b.basinId}));
  return {
    datasetVersion: root.dataset_version,
    schemaVersion: root.schema_version,
    libraryVersion: root.library_version,
    dataLibraryVersion: root.data_library_version,
    synthetic,
    implementation: structuredClone(root.implementation ?? null),
    publicReleaseBlockers: structuredClone(root.public_release_blockers ?? []),
    basins,
  };
}
