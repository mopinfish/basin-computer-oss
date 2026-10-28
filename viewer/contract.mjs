const DECIMAL_NUMBER = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?(?![\s\S])/;
// Offline artifact contract. No third-party code or network services.
const HOUR = 3600000;
const VERSION_KEYS = [
  'schema_version',
  'dataset_version',
  'library_version',
  'data_library_version',
];
const ROW_KEYS = [
  'origin_time',
  'target_time',
  'accepted',
  'reason',
  'partition',
  'q',
  'rain',
  'observed',
  'prediction',
];
const ITEM_KEYS = [
  'basin_id',
  'task',
  'status',
  'inputs',
  'target',
  'horizon_h',
  'tau_h',
  'alpha',
  'standardize',
  'train_period_start',
  'train_period_end',
  'valid_period_start',
  'valid_period_end',
  'period_start',
  'period_end',
  'split',
  'metric',
  'value',
  'nse',
  'nse_reason',
  'rmse',
  'n_samples',
  'n_excluded',
  'n_context',
  'excluded_by_reason',
  'fit_cutoff',
  'selection_cutoff',
  'validation_rmse',
  'partitions',
  'prediction_path',
  'baselines',
];
const ROOT_KEYS = [
  ...VERSION_KEYS,
  'dataset_status',
  'public_release_blockers',
  'library_name',
  'data_library_name',
  'generated_at',
  'basins_path',
  'stations_path',
  'artifact_sha256',
  'implementation',
  'results',
];
function require(value, message) {
  if (!value) throw new Error(message);
}
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
function exactKeys(value, keys, label) {
  require(value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)), `Invalid ${label} fields`);
}
function utc(value) {
  require(typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)(?![\s\S])/.test(
      value,
    ), 'Expected explicit UTC timestamp');
  const time = Date.parse(value);
  require(Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 19) ===
      value.slice(0, 19), 'Invalid UTC timestamp');
  return time;
}
function hourlyUTC(value) {
  require(typeof value === 'string' &&
    !/\.\d*[1-9]\d*(?:Z|\+00:00)(?![\s\S])/.test(
      value,
    ), 'Subhour timestamp precision is unsupported');
  const time = utc(value);
  require(time % HOUR === 0, 'Expected hourly UTC timestamp');
  return time;
}
function safePath(path) {
  require(typeof path === 'string' &&
    /^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*(?![\s\S])/.test(path) &&
    path
      .split('/')
      .every((x) => x !== '.' && x !== '..'), 'Unsafe artifact path');
  return path;
}
function count(value) {
  return Number.isInteger(value) && value >= 0;
}
function close(a, b) {
  return (
    finite(a) && finite(b) && Math.abs(a - b) <= 1e-10 + 1e-9 * Math.abs(b)
  );
}
function checkCounts(value) {
  exactKeys(
    value,
    ['n_samples', 'n_context', 'n_excluded', 'excluded_by_reason'],
    'partition counts',
  );
  require(['n_samples', 'n_context', 'n_excluded'].every((key) =>
    count(value[key]),
  ), 'Invalid sample count');
  exactKeys(
    value.excluded_by_reason,
    ['missing', 'origin_before_cutoff'],
    'exclusion reasons',
  );
  require(Object.values(value.excluded_by_reason).every(
    count,
  ), 'Invalid exclusion count');
}
function extensionKeys(value, keys, version, label) {
  const hasExtensions = version === '0.3' && Object.hasOwn(value, 'extensions');
  exactKeys(value, hasExtensions ? [...keys, 'extensions'] : keys, label);
  if (hasExtensions) {
    require(value.extensions !== null && typeof value.extensions === 'object' &&
      !Array.isArray(value.extensions), 'Expected extensions object');
    require(!Object.hasOwn(value.extensions, 'synthetic') ||
      typeof value.extensions.synthetic === 'boolean', 'Expected synthetic boolean');
    const jsonValue = (item) => {
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
      if (typeof item === 'number') return finite(item);
      if (Array.isArray(item)) return item.every(jsonValue);
      return item && typeof item === 'object' && Object.values(item).every(jsonValue);
    };
    require(jsonValue(value.extensions), 'Invalid extension JSON value');
  }
}
function validateResults(root) {
  require(root && ['0.2', '0.3'].includes(root.schema_version), 'Unsupported schema_version');
  extensionKeys(root, ROOT_KEYS, root.schema_version, 'result root');
  require(VERSION_KEYS.every(
    (key) => typeof root[key] === 'string' && root[key].length > 0,
  ), 'Missing versions');
  require(root.library_name === 'basin-rc' &&
    root.data_library_name === 'basin-data', 'Unsupported library names');
  require(root.dataset_status === 'local_candidate_not_public_release' &&
    Array.isArray(root.public_release_blockers) &&
    root.public_release_blockers.length &&
    root.public_release_blockers.every(
      (x) => typeof x === 'string' && x,
    ), 'Missing candidate status/blockers');
  const identity = root.implementation;
  exactKeys(
    identity,
    ['generator_sha256', 'source_commit', 'source_dirty', 'packages'],
    'implementation identity',
  );
  const sha = (value) =>
    typeof value === 'string' && /^[0-9a-f]{64}(?![\s\S])/.test(value);
  require(sha(identity.generator_sha256), 'Invalid generator SHA-256');
  require(identity.source_commit === null ||
    (typeof identity.source_commit === 'string' &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})(?![\s\S])/.test(
        identity.source_commit,
      )), 'Invalid source commit');
  require(identity.source_dirty === null ||
    typeof identity.source_dirty === 'boolean', 'Invalid source dirty state');
  require(identity.source_commit !== null || identity.source_dirty === null,
    'Unknown source commit requires unknown dirty state');
  exactKeys(
    identity.packages,
    ['basin-rc', 'basin-data'],
    'implementation packages',
  );
  for (const [name, versionKey] of [
    ['basin-rc', 'library_version'],
    ['basin-data', 'data_library_version'],
  ]) {
    const packageIdentity = identity.packages[name];
    exactKeys(
      packageIdentity,
      ['version', 'python_sources_sha256', 'wheel_sha256'],
      'implementation package',
    );
    require(packageIdentity.version ===
      root[versionKey], 'Implementation package version mismatch');
    require(sha(packageIdentity.python_sources_sha256) &&
      (packageIdentity.wheel_sha256 === null ||
        sha(
          packageIdentity.wheel_sha256,
        )), 'Invalid implementation package SHA-256');
  }
  utc(root.generated_at);
  require(Array.isArray(root.results) &&
    root.results.length > 0, 'Empty results');
  const paths = [safePath(root.basins_path), safePath(root.stations_path)];
  for (const r of root.results) {
    extensionKeys(r, ITEM_KEYS, root.schema_version, 'result');
    require(typeof r.basin_id === 'string' &&
      r.basin_id &&
      r.task === 'forecast' &&
      r.status === root.dataset_status &&
      r.target === 'q' &&
      r.metric === 'NSE' &&
      r.split === 'test', 'Unsupported forecast result');
    require(JSON.stringify(r.inputs) === '["q","rain"]' &&
      count(r.tau_h) &&
      count(r.horizon_h) &&
      r.horizon_h > 0 &&
      finite(r.alpha) &&
      r.alpha >= 0 &&
      typeof r.standardize === 'boolean', 'Invalid forecast inputs/parameters');
    require(finite(r.rmse) &&
      r.rmse >= 0 &&
      (r.nse === null || finite(r.nse)) &&
      r.value === r.nse &&
      (r.nse_reason === null ||
        r.nse_reason === 'constant_target'), 'Invalid metrics');
    checkCounts({
      n_samples: r.n_samples,
      n_context: r.n_context,
      n_excluded: r.n_excluded,
      excluded_by_reason: r.excluded_by_reason,
    });
    exactKeys(r.baselines, ['persistence'], 'baselines');
    exactKeys(
      r.baselines.persistence,
      [
        'method',
        'horizon_h',
        'rmse',
        'nse',
        'nse_reason',
        'n_samples',
        'n_excluded',
        'excluded_by_reason',
        'n_context',
      ],
      'persistence baseline',
    );
    exactKeys(r.partitions, ['train', 'valid', 'test'], 'partitions');
    Object.values(r.partitions).forEach(checkCounts);
    require(r.validation_rmse &&
      typeof r.validation_rmse === 'object' &&
      !Array.isArray(r.validation_rmse) &&
      Object.keys(r.validation_rmse).length, 'Invalid validation metrics');
    const candidates = new Map();
    for (const [key, rmse] of Object.entries(r.validation_rmse)) {
      require(DECIMAL_NUMBER.test(key), 'Invalid alpha candidate key');
      const candidate = Number(key);
      require(finite(candidate) && candidate >= 0, 'Invalid alpha candidate');
      require(!candidates.has(candidate), 'Duplicate numeric alpha candidate');
      require(finite(rmse) && rmse >= 0, 'Invalid validation RMSE');
      candidates.set(candidate, rmse);
    }
    require(candidates.has(r.alpha), 'Selected alpha missing from validation candidates');
    const minimum = Array.from(candidates.values()).reduce((a, b) => Math.min(a, b));
    require(candidates.get(r.alpha) === minimum,
      'Selected alpha is not a saved validation RMSE minimum');
    paths.push(safePath(r.prediction_path));
  }
  require(new Set(paths).size === paths.length &&
    root.artifact_sha256 &&
    Object.keys(root.artifact_sha256).length === paths.length &&
    paths.every((path) =>
      /^[0-9a-f]{64}(?![\s\S])/.test(root.artifact_sha256[path]),
    ), 'Artifact hash/path identity mismatch');
  return paths;
}
function point(p) {
  require(Array.isArray(p) &&
    p.length === 2 &&
    p.every(finite) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90, 'Invalid geometry coordinates');
}
function geo(geojson, root) {
  require(geojson &&
    geojson.type === 'FeatureCollection' &&
    Array.isArray(geojson.features) &&
    geojson.features.length > 0, 'Invalid GeoJSON');
  require(Object.keys(geojson).every((key) =>
    [...VERSION_KEYS, 'type', 'features', 'provenance'].includes(key),
  ), 'Unexpected GeoJSON metadata');
  require(VERSION_KEYS.every(
    (key) => geojson[key] === root[key],
  ), 'Mixed artifact versions');
  for (const f of geojson.features) {
    exactKeys(f, ['type', 'properties', 'geometry'], 'GeoJSON feature');
    require(f.type === 'Feature', 'Invalid feature type');
    exactKeys(f.geometry, ['type', 'coordinates'], 'geometry');
  }
}
export function parseSeriesCSV(text) {
  require(typeof text === 'string' &&
    !text.includes('"') &&
    !text.replace(/\r\n/g, '').includes('\r'), 'Unsupported/malformed CSV');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const headers = lines.shift().split(',');
  require(headers.length === ROW_KEYS.length &&
    new Set(headers).size === ROW_KEYS.length &&
    ROW_KEYS.every((key) => headers.includes(key)), 'Unexpected CSV columns');
  require(lines.length > 0, 'Empty CSV');
  return lines.map((line) => {
    const values = line.split(',');
    require(values.length === headers.length, 'Malformed CSV row');
    const row = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
    require(row.accepted === 'True' ||
      row.accepted === 'False', 'Expected Python boolean CSV value');
    row.accepted = row.accepted === 'True';
    for (const key of ['q', 'rain', 'observed', 'prediction']) {
      const raw = row[key];
      require(raw === '' ||
        DECIMAL_NUMBER.test(
          raw,
        ), 'Invalid CSV numeric value');
      row[key] = raw === '' ? null : Number(raw);
      require(row[key] === null || finite(row[key]), 'Nonfinite CSV number');
    }
    return row;
  });
}
export function validateBundle(results, basins, stations, series) {
  validateResults(results);
  geo(basins, results);
  geo(stations, results);
  const ids = results.results.map((r) => r.basin_id);
  require(new Set(ids).size === ids.length &&
    series &&
    Object.keys(series).length === ids.length &&
    ids.every((id) =>
      Object.hasOwn(series, id),
    ), 'Duplicate or unknown series ID');
  const basinIds = basins.features.map((f) => f.properties.basin_id);
  require(new Set(basinIds).size === ids.length &&
    basinIds.length === ids.length &&
    ids.every((id) => basinIds.includes(id)), 'Unknown basin geometry ID');
  for (const f of basins.features) {
    const p = f.properties;
    exactKeys(
      p,
      ['basin_id', 'name', 'area_km2', 'source_id', 'cand_id'],
      'basin properties',
    );
    require(typeof p.name === 'string' &&
      p.name &&
      finite(p.area_km2) &&
      p.area_km2 > 0 &&
      typeof p.source_id === 'string' &&
      (p.cand_id === null ||
        typeof p.cand_id === 'string'), 'Invalid basin metadata');
    require(['Polygon', 'MultiPolygon'].includes(
      f.geometry.type,
    ), 'Expected basin polygon');
    const polygons =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    require(Array.isArray(polygons) && polygons.length, 'Empty basin geometry');
    for (const polygon of polygons) {
      require(Array.isArray(polygon) && polygon.length, 'Empty polygon');
      for (const ring of polygon) {
        require(Array.isArray(ring) &&
          ring.length >= 4 &&
          JSON.stringify(ring[0]) ===
            JSON.stringify(ring.at(-1)), 'Invalid polygon ring');
        ring.forEach(point);
      }
    }
  }
  const roles = Object.fromEntries(ids.map((id) => [id, []]));
  for (const f of stations.features) {
    const p = f.properties;
    exactKeys(
      p,
      ['basin_id', 'station_id', 'name', 'role', 'source_url'],
      'station properties',
    );
    require(Object.hasOwn(roles, p.basin_id) &&
      ['streamflow', 'rain'].includes(p.role), 'Unknown station ID/role');
    require(['station_id', 'name', 'source_url'].every(
      (key) => typeof p[key] === 'string' && p[key],
    ) && p.source_url.startsWith('https://'), 'Invalid station metadata');
    if (p.role === 'streamflow')
      require(p.station_id ===
        basins.features.find((f) => f.properties.basin_id === p.basin_id)
          .properties.source_id, 'Streamflow station/source ID mismatch');
    roles[p.basin_id].push(p.role);
    require(f.geometry.type === 'Point', 'Expected station Point');
    point(f.geometry.coordinates);
  }
  require(Object.values(roles).every(
    (value) => value.sort().join(',') === 'rain,streamflow',
  ), 'Require two matching station roles');
  for (const result of results.results) {
    validateSeries(result, series[result.basin_id]);
    validateExtensionSeries(result, series[result.basin_id]);
  }
  return true;
}
function validateExtensionSeries(result, rows) {
  const items = result.extensions?.series ?? [];
  // A present null is invalid rather than an absent optional series list.
  require(!result.extensions || !Object.hasOwn(result.extensions, 'series') ||
    Array.isArray(result.extensions.series), 'Expected extension series array');
  const ids = new Set(), reserved = ['observed', 'prediction', 'persistence', 'model', 'q', 'rain'];
  for (const item of items) {
    const keys = ['id', 'label', 'unit', 'evaluation_conditions', 'style', 'values'];
    exactKeys(item, item && Object.hasOwn(item, 'source') ? [...keys, 'source'] : keys, 'extension series');
    require(typeof item.id === 'string' && /^[a-z][a-z0-9_-]*(?![\s\S])/.test(item.id) &&
      !reserved.includes(item.id) && !ids.has(item.id), 'Invalid or duplicate extension series ID');
    ids.add(item.id);
    require(['label', 'unit', 'evaluation_conditions', ...(Object.hasOwn(item, 'source') ? ['source'] : [])].every(
      key => typeof item[key] === 'string' && /[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(item[key])), 'Missing extension series description');
    require(['solid', 'dashed', 'dotted'].includes(item.style), 'Invalid extension series style');
    require(Array.isArray(item.values) && item.values.length === rows.length &&
      item.values.every(value => value === null || finite(value)), 'Extension series must match finite/null full CSV grid');
  }
}

function validateSeries(r, rows) {
  require(Array.isArray(rows) && rows.length, 'Empty series');
  const times = rows.map((row) => hourlyUTC(row.target_time));
  require(times.every((time) => time % HOUR === 0) &&
    times.every(
      (time, i) => i === 0 || time - times[i - 1] === HOUR,
    ), 'CSV must preserve full hourly grid');
  const keys = [
    'train_period_start',
    'train_period_end',
    'valid_period_start',
    'valid_period_end',
    'period_start',
    'period_end',
    'fit_cutoff',
    'selection_cutoff',
  ];
  const ts = Object.fromEntries(keys.map((key) => [key, hourlyUTC(r[key])]));
  require(ts.train_period_start === times[0] &&
    ts.period_end === times.at(-1) + HOUR &&
    ts.train_period_end === ts.valid_period_start &&
    ts.valid_period_end === ts.period_start &&
    ts.train_period_start < ts.train_period_end &&
    ts.train_period_end < ts.valid_period_end &&
    ts.valid_period_end <
      ts.period_end, 'Partition periods must cover the full grid');
  require(ts.fit_cutoff === ts.train_period_end &&
    ts.selection_cutoff === ts.valid_period_end, 'Causal cutoff mismatch');
  const groups = { train: [], valid: [], test: [] };
  rows.forEach((row, i) => {
    exactKeys(row, ROW_KEYS, 'series row');
    require(typeof row.accepted === 'boolean', 'Invalid accepted boolean');
    for (const key of ['q', 'rain', 'observed', 'prediction'])
      require(row[key] === null || finite(row[key]), 'Nonfinite series number');
    require(row.q === row.observed &&
      ['q', 'rain', 'observed'].every(
        (key) => row[key] === null || row[key] >= 0,
      ), 'Invalid target observations');
    const time = times[i],
      origin = hourlyUTC(row.origin_time);
    require(time - origin ===
      r.horizon_h * HOUR, 'Origin/target horizon mismatch');
    const partition =
      time < ts.train_period_end
        ? 'train'
        : time < ts.valid_period_end
          ? 'valid'
          : 'test';
    require(row.partition === partition, 'CSV partition mismatch');
    const context = i < r.tau_h + r.horizon_h,
      cutoff =
        partition === 'train'
          ? null
          : partition === 'valid'
            ? ts.fit_cutoff
            : ts.selection_cutoff;
    let missing = row.observed === null;
    if (!context)
      for (let j = i - r.horizon_h - r.tau_h; j <= i - r.horizon_h; j++)
        for (const name of r.inputs) missing ||= rows[j][name] === null;
    const reason = context
      ? 'context'
      : cutoff !== null && origin < cutoff
        ? 'origin_before_cutoff'
        : missing
          ? 'missing'
          : 'accepted';
    require(row.reason === reason &&
      row.accepted ===
        (reason ===
          'accepted'), 'CSV acceptance/reason violates causal or missing contract');
    require((row.prediction !== null) ===
      (partition === 'test' &&
        row.accepted), 'Predictions only belong to accepted test rows');
    groups[partition].push(row);
  });
  for (const [name, group] of Object.entries(groups)) {
    const exclusions = {
      missing: group.filter((row) => row.reason === 'missing').length,
      origin_before_cutoff: group.filter(
        (row) => row.reason === 'origin_before_cutoff',
      ).length,
    };
    const expected = {
      n_samples: group.filter((row) => row.accepted).length,
      n_context: group.filter((row) => row.reason === 'context').length,
      n_excluded: exclusions.missing + exclusions.origin_before_cutoff,
      excluded_by_reason: exclusions,
    };
    for (const key of ['n_samples', 'n_context', 'n_excluded']) {
      require(r.partitions[name][key] ===
        expected[key], `${name} counts mismatch`);
      if (name === 'test')
        require(r[key] === expected[key], 'Metric denominator/count mismatch');
    }
    for (const key of Object.keys(exclusions)) {
      require(r.partitions[name].excluded_by_reason[key] ===
        exclusions[key], 'Exclusion count mismatch');
      if (name === 'test')
        require(r.excluded_by_reason[key] ===
          exclusions[key], 'Metric exclusions mismatch');
    }
  }
  const accepted = groups.test.filter((row) => row.accepted);
  require(accepted.length > 0, 'Empty accepted test rows');
  const mean =
    accepted.reduce((s, row) => s + row.observed, 0) / accepted.length;
  const num = accepted.reduce(
      (s, row) => s + (row.prediction - row.observed) ** 2,
      0,
    ),
    den = accepted.reduce((s, row) => s + (row.observed - mean) ** 2, 0);
  const rmse = Math.sqrt(num / accepted.length),
    nse = den === 0 ? null : 1 - num / den;
  require(close(r.rmse, rmse), 'RMSE mismatch');
  if (nse === null)
    require(r.nse === null &&
      r.nse_reason ===
        'constant_target', 'Undefined NSE needs constant_target reason');
  else require(close(r.nse, nse) && r.nse_reason === null, 'NSE mismatch');
  const baseline = r.baselines.persistence;
  require(baseline.method === 'origin_observation' &&
    baseline.horizon_h === r.horizon_h, 'Persistence method/horizon mismatch');
  checkCounts({
    n_samples: baseline.n_samples,
    n_context: baseline.n_context,
    n_excluded: baseline.n_excluded,
    excluded_by_reason: baseline.excluded_by_reason,
  });
  for (const key of ['n_samples', 'n_context', 'n_excluded'])
    require(baseline[key] === r[key], 'Persistence evaluation counts mismatch');
  for (const reason of ['missing', 'origin_before_cutoff'])
    require(baseline.excluded_by_reason[reason] ===
      r.excluded_by_reason[reason], 'Persistence exclusion counts mismatch');
  const qByTime = new Map(rows.map((row, i) => [times[i], row.q]));
  const originValues = accepted.map((row) =>
    qByTime.get(hourlyUTC(row.origin_time)),
  );
  require(originValues.every(
    finite,
  ), 'Persistence needs finite origin q from the complete CSV grid');
  const persistenceError = accepted.reduce(
    (sum, row, i) => sum + (originValues[i] - row.observed) ** 2,
    0,
  );
  const persistenceRMSE = Math.sqrt(persistenceError / accepted.length);
  const persistenceNSE = den === 0 ? null : 1 - persistenceError / den;
  require(close(baseline.rmse, persistenceRMSE), 'Persistence RMSE mismatch');
  if (persistenceNSE === null)
    require(baseline.nse === null &&
      baseline.nse_reason ===
        'constant_target', 'Undefined persistence NSE needs constant_target reason');
  else
    require(close(baseline.nse, persistenceNSE) &&
      baseline.nse_reason === null, 'Persistence NSE mismatch');
}
export async function loadBundle(baseUrl = 'data/', fetchImpl = fetch) {
  require(typeof baseUrl === 'string' &&
    !baseUrl.includes('%') &&
    !baseUrl.includes('\\') &&
    !baseUrl.split('/').includes('..'), 'Unsafe data base URL');
  const origin = globalThis.location?.href ?? 'http://localhost/';
  const base = new URL(baseUrl, origin);
  const allowedOrigin = globalThis.location
    ? base.origin === new URL(origin).origin
    : ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  require(['http:', 'https:'].includes(base.protocol) &&
    allowedOrigin &&
    !base.search &&
    !base.hash &&
    !base.pathname.includes('//'), 'Unsafe data base URL');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const request = async (path) => {
    safePath(path);
    const url = new URL(path, base);
    require(url.origin === base.origin &&
      url.pathname.startsWith(base.pathname), 'Unsafe fetch URL');
    const response = await fetchImpl(url.href, { redirect: 'error' });
    require(response.ok, `Artifact fetch failed (HTTP ${response.status}): ${path}`);
    return response.arrayBuffer
      ? new Uint8Array(await response.arrayBuffer())
      : new TextEncoder().encode(await response.text());
  };
  const decode = (raw) => new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const results = JSON.parse(decode(await request('results.json')));
  const paths = validateResults(results),
    payloads = {};
  for (const path of paths) {
    const raw = await request(path);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', raw)),
      (x) => x.toString(16).padStart(2, '0'),
    ).join('');
    require(digest ===
      results.artifact_sha256[path], `Artifact SHA-256 mismatch: ${path}`);
    payloads[path] = decode(raw);
  }
  const basins = JSON.parse(payloads[results.basins_path]),
    stations = JSON.parse(payloads[results.stations_path]);
  const series = Object.fromEntries(
    results.results.map((r) => [
      r.basin_id,
      parseSeriesCSV(payloads[r.prediction_path]),
    ]),
  );
  validateBundle(results, basins, stations, series);
  return { results, basins, stations, series };
}
