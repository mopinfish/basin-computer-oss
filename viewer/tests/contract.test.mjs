import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle, parseSeriesCSV, validateBundle } from '../contract.mjs';
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL('../../tests/fixtures/viewer_bundle.json', import.meta.url),
    ),
  );
const coreCases = JSON.parse(readFileSync(
  new URL('../../tests/fixtures/core_contract_cases.json', import.meta.url),
));
for (const c of coreCases) test(`core contract ${c.name}`, () => {
  const b = c.bundle;
  const validate = () => validateBundle(b.results, b.basins, b.stations, b.series);
  if (c.accept) assert.equal(validate(), true);
  else assert.throws(validate);
});
test('CSV interprets Python booleans, empty numeric fields, rejects NaN/malformed rows', () => {
  const header =
    'origin_time,target_time,accepted,reason,partition,q,rain,observed,prediction\n';
  const csv =
    header +
    '2024-01-01T00:00:00+00:00,2024-01-01T01:00:00+00:00,False,missing,test,,0,,\n';
  assert.equal(parseSeriesCSV(csv)[0].q, null);
  assert.equal(parseSeriesCSV(csv)[0].accepted, false);
  assert.throws(() => parseSeriesCSV(csv.replace(',,0,,', ',NaN,0,,')));
  assert.throws(() => parseSeriesCSV(csv.replace('False', 'false')));
});
test('loadBundle refuses unsafe fetch paths before fetching them', async () => {
  for (const path of [
    '../bad.csv',
    'https://example.com/x',
    'predictions//a.csv',
    '/a.csv',
    '%2e%2e/x',
  ]) {
    const b = fixture();
    b.results.results[0].prediction_path = path;
    const calls = [];
    const fetcher = async (url) => {
      calls.push(String(url));
      return { ok: true, text: async () => JSON.stringify(b.results) };
    };
    await assert.rejects(loadBundle('http://localhost/data/', fetcher));
    assert.equal(calls.length, 1);
  }
});
test('reject streamflow station identity mismatch', () => {
  const b = fixture();
  b.stations.features[0].properties.station_id = 'other';
  assert.throws(() =>
    validateBundle(b.results, b.basins, b.stations, b.series),
  );
});
for (const version of ['0.2', '0.3']) test(`loadBundle ${version} verifies all checksums and rejects corruption`, async () => {
  const b = fixture();
  for (const value of [b.results, b.basins, b.stations]) value.schema_version = version;
  if (version === '0.3') b.results.extensions = {note: 'checksum still mandatory'};
  b.stations.features[0].properties.station_id = 'a';
  const headers = [
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
  const csv =
    headers.join(',') +
    '\n' +
    b.series.a
      .map((row) =>
        headers
          .map((key) =>
            key === 'accepted'
              ? row[key]
                ? 'True'
                : 'False'
              : (row[key] ?? ''),
          )
          .join(','),
      )
      .join('\n') +
    '\n';
  const payloads = {
    'basins.geojson': JSON.stringify(b.basins),
    'stations.geojson': JSON.stringify(b.stations),
    'predictions/a.csv': csv,
  };
  const { createHash } = await import('node:crypto');
  b.results.artifact_sha256 = Object.fromEntries(
    Object.entries(payloads).map(([key, value]) => [
      key,
      createHash('sha256').update(value).digest('hex'),
    ]),
  );
  const fetcher = async (url) => ({
    ok: true,
    text: async () =>
      url.endsWith('results.json')
        ? JSON.stringify(b.results)
        : payloads[new URL(url).pathname.replace('/data/', '')],
  });
  assert.equal(
    (await loadBundle('http://localhost/data/', fetcher)).series.a[22].observed,
    null,
  );
  assert.equal(
    (await loadBundle('http://127.0.0.1:8765/data/', fetcher)).series.a[22]
      .observed,
    null,
  );
  payloads['predictions/a.csv'] += '\n';
  await assert.rejects(
    loadBundle('http://localhost/data/', fetcher),
    /SHA-256/,
  );
});
test('reject submillisecond grid shifts without truncating timestamps', () => {
  const b = fixture(),
    r = b.results.results[0];
  for (const row of b.series.a)
    for (const key of ['origin_time', 'target_time'])
      row[key] = row[key].replace('+00:00', '.000001+00:00');
  for (const key of [
    'train_period_start',
    'train_period_end',
    'valid_period_start',
    'valid_period_end',
    'period_start',
    'period_end',
    'fit_cutoff',
    'selection_cutoff',
  ])
    r[key] = r[key].replace('+00:00', '.000001+00:00');
  assert.throws(() =>
    validateBundle(b.results, b.basins, b.stations, b.series),
  );
});
test('reject unsafe base traversal, double slash and external origins before fetch', async () => {
  for (const base of [
    '../data/',
    'http://localhost/data//',
    'http://localhost/%2e%2e/data/',
    'https://example.com/data/',
  ]) {
    let calls = 0;
    await assert.rejects(
      loadBundle(base, async () => {
        calls++;
        throw new Error('fetch called');
      }),
      /Unsafe/,
    );
    assert.equal(calls, 0);
  }
});
for (const problem of [
  'missing',
  'rmse',
  'nse',
  'count',
  'reason',
  'horizon',
  'origin_q',
  'old_schema',
])
  test(`saved persistence rejects ${problem}`, () => {
    const b = fixture(),
      r = b.results.results[0],
      p = r.baselines.persistence;
    if (problem === 'missing') delete r.baselines;
    if (problem === 'rmse') p.rmse = 2;
    if (problem === 'nse') p.nse = 0;
    if (problem === 'count') p.n_samples++;
    if (problem === 'reason') p.nse_reason = null;
    if (problem === 'horizon') p.horizon_h++;
    if (problem === 'origin_q') {
      b.series.a[20].q = 4;
      b.series.a[20].observed = 4;
    }
    if (problem === 'old_schema')
      for (const x of [b.results, b.basins, b.stations])
        x.schema_version = '0.1';
    assert.throws(() =>
      validateBundle(b.results, b.basins, b.stations, b.series),
    );
  });
test('nonconstant persistence looks up rejected origin rows with unchanged target adoption', () => {
  const b = fixture(),
    r = b.results.results[0];
  b.series.a.forEach((row, i) => {
    row.q = row.observed = i === 22 ? null : i;
    row.prediction = row.partition === 'test' && row.accepted ? i + 2 : null;
  });
  const targets = [21, 24, 25, 26, 27, 28, 29],
    mean = targets.reduce((a, b) => a + b, 0) / 7,
    denominator = targets.reduce((s, x) => s + (x - mean) ** 2, 0);
  Object.assign(r, {
    rmse: 2,
    nse: 1 - 28 / denominator,
    value: 1 - 28 / denominator,
    nse_reason: null,
  });
  Object.assign(r.baselines.persistence, {
    rmse: 1,
    nse: 1 - 7 / denominator,
    nse_reason: null,
  });
  assert.equal(validateBundle(b.results, b.basins, b.stations, b.series), true);
});
test('implementation identity is required', () => {
  const b = fixture();
  delete b.results.implementation;
  assert.throws(() =>
    validateBundle(b.results, b.basins, b.stations, b.series),
  );
});
for (const problem of [
  'version',
  'digest',
  'wheel_digest',
  'unknown_package',
  'unknown_field',
])
  test(`implementation identity rejects ${problem}`, () => {
    const b = fixture(),
      identity = b.results.implementation,
      p = identity.packages['basin-rc'];
    if (problem === 'version') p.version = 'different';
    if (problem === 'digest') identity.generator_sha256 = 'bad';
    if (problem === 'wheel_digest') p.wheel_sha256 = 'bad';
    if (problem === 'unknown_package') identity.packages.other = { ...p };
    if (problem === 'unknown_field') identity.local_path = '/private/path';
    assert.throws(() =>
      validateBundle(b.results, b.basins, b.stations, b.series),
    );
  });
for (const dirty of [false, true]) {
  test(`unknown source commit rejects dirty=${dirty}`, () => {
    const b=fixture();
    Object.assign(b.results.implementation,{source_commit:null,source_dirty:dirty});
    assert.throws(()=>validateBundle(b.results,b.basins,b.stations,b.series));
  });
  test(`known source commit accepts dirty=${dirty}`, () => {
    const b=fixture();
    Object.assign(b.results.implementation,{source_commit:'a'.repeat(40),source_dirty:dirty});
    assert.equal(validateBundle(b.results,b.basins,b.stations,b.series),true);
  });
}

 test('loadBundle preserves HTTP status for missing artifact guidance', async () => {
  await assert.rejects(loadBundle('http://localhost/data/', async () => ({ok:false,status:404})), /HTTP 404/);
});

function version03() {
  const b = fixture();
  for (const value of [b.results, b.basins, b.stations]) value.schema_version = '0.3';
  return b;
}
test('0.3 accepts optional nested extensions without changing core metrics', () => {
  const b = version03();
  b.results.extensions = {note: '<script>bad()</script>', nested: [null, true, {unit: 'm³/s'}]};
  b.results.results[0].extensions = {n_samples: -999, period_start: 'ignored'};
  assert.equal(validateBundle(b.results, b.basins, b.stations, b.series), true);
  assert.equal(b.results.results[0].n_samples, fixture().results.results[0].n_samples);
  const bare = version03();
  assert.equal(validateBundle(bare.results, bare.basins, bare.stations, bare.series), true);
});
test('0.3 rejects malformed extensions, misplaced fields and altered core', () => {
  const mutations = [
    b => {b.results.extensions = null;},
    b => {b.results.extensions = [];},
    b => {b.results.results[0].extensions = 'bad';},
    b => {b.results.extensions = {nested: [Infinity]};},
    b => {b.results.results[0].extensions = {bad: NaN};},
    b => {b.results.unknown = true;},
    b => {b.results.results[0].unknown = true;},
    b => {b.results.results[0].extensions = {n_samples: b.results.results[0].n_samples}; delete b.results.results[0].n_samples;},
    b => {b.results.results[0].n_samples += 1;},
    b => {b.series.a[0].origin_time = b.series.a[0].target_time;},
    b => {b.basins.schema_version = '0.2';},
    b => {b.results.schema_version = '0.4';},
  ];
  for (const mutate of mutations) {
    const b = version03(); mutate(b);
    assert.throws(() => validateBundle(b.results, b.basins, b.stations, b.series));
  }
  const legacy = fixture(); legacy.results.extensions = {};
  assert.throws(() => validateBundle(legacy.results, legacy.basins, legacy.stations, legacy.series));
});

function seriesCase(name) {
  const b=version03(), result=b.results.results[0];
  const descriptor={id:'saved_a', label:'Saved A', unit:'m³/s',
    evaluation_conditions:'different adopted rows; no comparison metrics',
    style:'dashed',values:b.series[result.basin_id].map((_,i)=>i)};
  let items=[descriptor];
  if(name==='empty') items=[];
  else if(name==='null_gap') descriptor.values[0]=null;
  else if(name==='optional_source') descriptor.source='local saved test fixture';
  else if(name==='different_unit') descriptor.unit='mm/h';
  else if(name==='different_conditions') descriptor.evaluation_conditions='test-only alternate period';
  else if(name==='unicode_nel') descriptor.label='\u0085';
  else if(name==='unicode_bom') descriptor.label='\ufeff';
  else if(name==='not_array') items=descriptor;
  else if(name==='not_object') items=[null];
  else if(name.startsWith('missing_')) delete descriptor[({conditions:'evaluation_conditions'})[name.slice(8)]??name.slice(8)];
  else if(name==='unknown_field') descriptor.rmse=0;
  else if(name==='bad_id') descriptor.id='../saved';
  else if(name==='reserved_id') descriptor.id='prediction';
  else if(name==='duplicate_id') items.push(structuredClone(descriptor));
  else if(name.startsWith('blank_')) descriptor[({conditions:'evaluation_conditions'})[name.slice(6)]??name.slice(6)]='   ';
  else if(name==='bad_style') descriptor.style='url(javascript:bad)';
  else if(name==='bad_value') descriptor.values[0]='2';
  else if(name==='boolean_value') descriptor.values[0]=true;
  else if(name==='overflow_value') descriptor.values[0]=Infinity;
  else if(name==='short_values') descriptor.values.pop();
  else if(name==='long_values') descriptor.values.push(null);
  else if(name==='bad_source') descriptor.source=4;
  result.extensions={series:items,future_metadata:{untouched:true}};
  return b;
}
const seriesCases=JSON.parse(readFileSync(new URL('../../tests/fixtures/extension_series_cases.json',import.meta.url)));
for(const c of seriesCases) test(`saved series descriptor ${c.name}`,()=>{
  const b=seriesCase(c.name), validate=()=>validateBundle(b.results,b.basins,b.stations,b.series);
  if(c.accept) assert.equal(validate(),true); else assert.throws(validate);
});

const alphaCases = JSON.parse(readFileSync(new URL('../../tests/fixtures/alpha_selection_cases.json', import.meta.url)));
for (const version of ['0.2', '0.3']) for (const c of alphaCases) {
  test(`saved alpha ${version} ${c.name}`, () => {
    const b = fixture();
    for (const scope of [b.results, b.basins, b.stations]) scope.schema_version = version;
    Object.assign(b.results.results[0], {alpha: c.alpha, validation_rmse: c.validation_rmse});
    const validate = () => validateBundle(b.results, b.basins, b.stations, b.series);
    if (c.accept) assert.equal(validate(), true); else assert.throws(validate);
  });
}

for (const value of [NaN, Infinity, -Infinity]) for (const field of ['alpha', 'rmse']) {
  test(`saved alpha rejects native ${field} ${value}`, () => {
    const b = fixture(), r = b.results.results[0];
    r.alpha = field === 'alpha' ? value : 1;
    r.validation_rmse = {'1': field === 'rmse' ? value : 2};
    assert.throws(() => validateBundle(b.results, b.basins, b.stations, b.series));
  });
}
