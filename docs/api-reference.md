# basin_rc 公開APIリファレンス

`basin_rc.__all__` の12名と、公開型のメソッドを説明する。
対象はアルファ版 `0.1.0a2` の既存実装であり、APIは今後変更され得る。
署名と挙動の参照元は [公開入口](../packages/basin-rc/src/basin_rc/__init__.py)、各節の実装リンクである。
導入と合成データの使用例は [README](../README.md) を参照する。
`basin-rc` は `basin-data` や研究チェックアウトに依存しない。
専用サブモジュールの[可変係数モデルの数値推論・固定条件の学習API](varcoef-inference.md)は別の3入口で、rootの12名には含めない。

## prepare_observations

```python
prepare_observations(frame: pd.DataFrame, missing: str = 'preserve') -> pd.DataFrame
```

[実装](../packages/basin-rc/src/basin_rc/preprocessing.py)。
`frame` は空でないDataFrameで、列名が一意であることを要求する。
indexはタイムゾーン付きDatetimeIndexで、NaTを含まず、一意かつ昇順で、UTCに換算して毎時の境界に一致する必要がある。
JSTなども受け付け、出力をUTCへ変換する。
最初から最後の時刻までの毎時格子を復元し、欠けた時刻をNaNにする。
入力を変更せず、新しいDataFrameを返す。

`*_quality` 以外の列は実数の数値型を要求し、真偽値、複素数、文字列、無限値を拒否する。
NaNは保持する。
`q` と `rain` の負値をNaNへ変更するが、それ以外の測定列の負値にはこの処理を行わない。
既存の `q_quality` と `rain_quality` があれば、負値を `negative`、未設定のフラグを `missing` にし、有効値の有無と `present` の対応を検査する。
品質列を新設せず、他の `*_quality` 列にはこの整合検査を行わない。

上記条件の違反、品質フラグの不一致、`missing='preserve'` 以外は `ValueError` となる。
自動補間は行わない。

## make_forecast_samples と ForecastSamples

```python
make_forecast_samples(
    observations: pd.DataFrame, inputs: Sequence[str] = ('q', 'rain'),
    target: str = 'q', tau_h: int = 12, horizon_h: int = 6,
) -> ForecastSamples

ForecastSamples(X: pd.DataFrame, y: pd.Series, metadata: pd.DataFrame,
                tau_h: int, horizon_h: int) -> None
```

[実装](../packages/basin-rc/src/basin_rc/embedding.py)。
`observations` は内部で `prepare_observations` に渡される。
`inputs` は存在する測定列名の重複しない空でないsequenceで、文字列一つを直接渡すことはできない。
`target` も存在する測定列名を指定する。
`*_quality` 列を入力や目的値には使えない。
`tau_h` は0以上、`horizon_h` は1以上の整数で、真偽値は拒否する。
これらの違反は `ValueError` となる。

目的時刻を `t` とすると、起点は `t - horizon_h` 時間である。
列はinputsの指定順、各列内では遅延0から `tau_h` の順に `<column>_lag_<lag>h` として作る。
その値は `t - horizon_h - lag` 時間の観測である。
特徴数は `len(inputs) * (tau_h + 1)` となる。

`ForecastSamples` は次のフィールドを持つfrozen dataclassである。
フィールドの再代入はできないが、内部のDataFrameやSeries自体を不変にはしない。
コンストラクタは内容の整合性を検査しないため、通常は関数から取得する。

| フィールド | 内容 |
|---|---|
| `X` | 全目的時刻格子の遅延特徴DataFrame。欠測と履歴不足も残す |
| `y` | 全格子の目的値Series。名称はtarget |
| `metadata` | 同じindexに `origin_time`、`target_time`、`accepted`、`reason` を持つDataFrame |
| `tau_h`, `horizon_h` | 使用した整数の最大遅延と予測時間 |

三つのindexはUTC毎時格子で、名称は `target_time` となる。
先頭 `tau_h + horizon_h` 行は履歴不足として `reason='context'`、残りは特徴または目的値にNaNがあれば `missing`、それ以外は `accepted` となる。
`accepted` 列は理由が `accepted` の行だけTrueである。
contextをmissingより優先し、欠測行を削除して時間を圧縮しない。

## temporal_split、ForecastPartition、TemporalSplit

```python
temporal_split(samples: ForecastSamples, train: float = 0.6,
               valid: float = 0.2, by: str = 'target_time') -> TemporalSplit

ForecastPartition(X: pd.DataFrame, y: pd.Series, metadata: pd.DataFrame,
                  period_start: pd.Timestamp, period_end: pd.Timestamp,
                  origin_cutoff: pd.Timestamp | None) -> None
TemporalSplit(train: ForecastPartition, valid: ForecastPartition,
              test: ForecastPartition) -> None
```

[実装](../packages/basin-rc/src/basin_rc/splitting.py)。
`make_forecast_samples` の戻り値を渡す。
`by` は `target_time` のみ、trainとvalidはそれぞれ0より大きく1より小さく、合計は1未満を要求する。
全metadata格子の行数を `n` とし、境界位置を `floor(n * train)` と `floor(n * (train + valid))` で決める。
残りがtestとなる。
欠測やcontextを除く前に決めるため、欠測の増加で境界は移動しない。
比率の違反や三つの期間を作れない短い格子は `ValueError` となる。
期間が非空でも、採用行が非空になる保証はない。
空の採用行をfit、predict、evaluateへ渡すと拒否される。

各 `ForecastPartition` の期間はUTCの半開区間 `[period_start, period_end)` である。
最終期間の終端は最後の格子時刻の1時間後となる。
`X` と `y` は採用行のみのコピー、metadataは除外行を含む期間全体のコピーである。
validの `origin_cutoff` はtrainの終端、testではvalidの終端で、起点がcutoff未満の行を `origin_before_cutoff` として除外する。
trainのcutoffは `None` である。
理由の優先順はcontext、origin_before_cutoff、missing、acceptedとなる。
cutoffは起点を制限し、起点以前の遅延特徴が前区間の観測を参照することは許す。

`ForecastPartition.n_context: int` はcontextの行数である。
`ForecastPartition.excluded_by_reason: dict[str, int]` は `missing` と `origin_before_cutoff` の行数を、0件のキーも含めて返す。
contextはこの除外数や評価母数に含めない。
`TemporalSplit` はtrain、valid、testを保持する。
両型はfrozen dataclassだが、内包オブジェクトは変更可能で、コンストラクタは整合性を検査しない。

## DelayRidgeForecaster

```python
DelayRidgeForecaster(alpha: float = 1.0, standardize: bool = True)
fit(self, X: pd.DataFrame, y: pd.Series) -> 'DelayRidgeForecaster'
predict(self, X: pd.DataFrame) -> pd.Series
```

[実装](../packages/basin-rc/src/basin_rc/forecast.py)。
`alpha` は有限の0以上の実数を要求し、真偽値や文字列は `ValueError` となる。
`standardize` は真偽値を指定する。
現実装はその型を検査せず、真偽の評価で標準化の有無を選ぶ。

`fit` は空でないX、一意の特徴名、重複と欠損のないindexを要求する。
yはSeriesで、Xとindexの値と順序が完全に一致する必要がある。
両者の値は有限の実数の数値型を要求し、NaN、無限値、真偽値、複素数、文字列を拒否する。
モデル単体ではindexの日時型、UTC、毎時性、昇順を検査しない。
遅延特徴の作成や時系列分割は呼出側で済ませる。

標準化を有効にすると、fitに渡したXだけでStandardScalerを学習し、変換した特徴でRidgeを学習する。
yは標準化しない。
fitは自分自身を返し、成功した再fitは既存の学習状態を置き換える。
学習後は `scaler_`（無効時はNone）、`model_`、`feature_names_in_`、`n_fit_samples_` を持つ。

`predict` はfitと同じXの条件を要求し、特徴名と順序が学習時と一致する必要がある。
学習済みscalerで変換し、再学習や暗黙の時刻シフトは行わない。
入力indexと順序を保つ、名称 `prediction` のSeriesを返す。
fitとpredictは入力のXとyを変更しない。
入力条件の違反、未fitでのpredict、特徴の不一致、非有限の予測は `ValueError` となる。

## select_forecaster と ForecastSelection

```python
select_forecaster(split: TemporalSplit, standardize: bool = True) -> ForecastSelection
ForecastSelection(model: DelayRidgeForecaster, validation_rmse: dict[float, float]) -> None
```

[実装](../packages/basin-rc/src/basin_rc/forecast.py)。
各alpha（0.1、1.0、10.0）でtrainのみをfitし、validの同じ採用行でRMSEを評価する。
最小RMSEのモデルと、alphaをキーにした全候補のRMSE辞書を返す。
同値なら先に試した小さいalphaを選ぶ。
`standardize` は各モデルへ渡す。
選択後のtrainとvalidの結合による再fitは行わず、testは選択に使用しない。
trainやvalidが空、非有限、index不整合などの場合は、fit、predict、evaluateの `ValueError` が伝わる。

`ForecastSelection` はfrozen dataclassで、モデルと辞書の内容を不変にするものではない。
コンストラクタは内容の整合性を検査しない。

## evaluate と ForecastEvaluation

```python
evaluate(prediction: pd.Series, partition: ForecastPartition) -> ForecastEvaluation
ForecastEvaluation(rmse: float, nse: float | None, nse_reason: str | None,
                   n_samples: int, n_excluded: int,
                   excluded_by_reason: dict[str, int], n_context: int) -> None
to_dict(self) -> dict
```

[実装](../packages/basin-rc/src/basin_rc/metrics.py)。
predictionは空でないSeriesを要求する。
そのindexは一意で、partitionのX、y、metadataのaccepted行のindexと値も順序も完全に一致する必要がある。
内部で並べ直したり、一部行だけを評価したりしない。
予測とyの値は有限の実数の数値型を要求する。
この関数自体は日時のUTCや毎時性を検査せず、通常はtemporal_splitの区間を渡す。

RMSEは `sqrt(mean((prediction - y)**2))`、NSEは `1 - sum((prediction - y)**2) / sum((y - mean(y))**2)` である。
NSEの分母が0（1行だけの場合も含む）なら `nse=None`、`nse_reason='constant_target'`、それ以外の理由はNoneとなる。
入力条件の違反と、誤差計算やNSEのオーバーフローは `ValueError` となる。

| フィールド | 内容 |
|---|---|
| `rmse` | 目的値と同じ単位のRMSE |
| `nse`, `nse_reason` | NSEと未定義理由 |
| `n_samples` | 評価した採用行数 |
| `n_excluded` | missingとorigin_before_cutoffの合計 |
| `excluded_by_reason` | 区間の除外理由別件数 |
| `n_context` | 履歴不足の行数。評価母数とは別に保持 |

`ForecastEvaluation` はfrozen dataclassで、コンストラクタは内容の整合性を検査しない。
`to_dict()` はdataclasses.asdictによる辞書を返す。
辞書をJSON化するとNoneはnullとなる。

## persistence_prediction

```python
persistence_prediction(partition: ForecastPartition, target: str = 'q') -> pd.Series
```

[実装](../packages/basin-rc/src/basin_rc/metrics.py)。
標準化前の特徴を保持したForecastPartitionを渡す。
targetは空でない文字列で、partition.yの名称と一致し、Xに `<target>_lag_0h` 列が必要である。
この列は予測起点の観測値であり、目的時刻の実測yとは異なる。

Xはモデルの入力条件、yは有限の実数の数値型の条件を満たす必要がある。
XとmetadataのindexはUTCのDatetimeIndexで、一意かつ昇順、NaTなし、毎時境界の時刻である必要がある。
採用行間に欠測による穴があっても受け付け、穴を埋めない。
metadataは空でなく一意の列名を持ち、accepted列は欠損のない真偽値型であることを要求する。
X、y、metadataのaccepted行のindexは順序まで一致する必要がある。
これらの違反やForecastPartition以外の引数は `ValueError` となる。

採用indexを保持した起点値の独立したコピーを、名称 `prediction` のSeriesとして返す。
出力を変更しても元の特徴は変わらない。
採用行を選び直さず、同じpartitionをevaluateへ渡すとRidgeと同じ母数で比較できる。

## 小さい合成データでの利用例

実観測を使わず、欠けた1時刻を含む100時間の格子で、分割、選択、持続予測と評価を確認する。
これは操作例であり、流域での予測性能の検証ではない。

```python
import numpy as np
import pandas as pd
from basin_rc import (
    prepare_observations, make_forecast_samples, temporal_split,
    select_forecaster, persistence_prediction, evaluate,
)

index = pd.date_range('2024-01-01', periods=100, freq='h', tz='UTC')
observations = pd.DataFrame(
    {'q': np.arange(100, dtype=float), 'rain': np.arange(100) % 7},
    index=index,
).drop(index[90])
prepared = prepare_observations(observations)
assert len(prepared) == 100 and prepared.loc[index[90]].isna().all()
split = temporal_split(make_forecast_samples(prepared, tau_h=2, horizon_h=3))
selection = select_forecaster(split)
prediction = selection.model.predict(split.test.X)
baseline = persistence_prediction(split.test)
assert prediction.index.equals(baseline.index)
assert baseline.index.equals(split.test.y.index)
assert baseline.index.equals(split.test.metadata.index[split.test.metadata.accepted])
score = evaluate(prediction, split.test)
baseline_score = evaluate(baseline, split.test)
assert score.n_samples == baseline_score.n_samples == 13
assert baseline_score.rmse == 3.0
assert score.excluded_by_reason == {'missing': 4, 'origin_before_cutoff': 3}

constant = observations.copy()
constant['q'] = 2.0
constant_split = temporal_split(make_forecast_samples(constant, tau_h=2, horizon_h=3))
constant_score = evaluate(persistence_prediction(constant_split.test), constant_split.test)
assert constant_score.rmse == 0.0
assert constant_score.nse is None
assert constant_score.nse_reason == 'constant_target'
print(score.n_samples, baseline_score.rmse, constant_score.nse_reason)
# 13 3.0 constant_target
```

## 記載の確認方法

リポジトリのルートで、上のPythonコードブロックを実行する。
ソースからimportする場合は `PYTHONPATH=packages/basin-rc/src` を設定する。
公開名と署名は `basin_rc.__all__` と `inspect.signature` で確認できる。

既存の時刻、欠測、分割、fit、predict、評価、持続予測の受入条件は次で確認する。
実データの再生成や依存追加は不要である。

```sh
PYTHONPATH=packages/basin-rc/src python -m pytest -q packages/basin-rc/tests/test_samples.py packages/basin-rc/tests/test_forecast.py tests/test_persistence.py
```

## 保存結果の検査

`basin-rc[validation]` はjsonschema `>=4.18,<5` を追加します。
rootの12公開名は変更せず、検査入口は専用moduleで提供します。

```python
from pathlib import Path
from basin_rc.validation import validate_bundle, validate_directory
bundle = validate_directory(Path("/path/to/saved/data"))
assert validate_bundle(**bundle) is True
```

`validate_bundle(results, basins, stations, series) -> bool` は正常時にTrueを返します。
`validate_directory(root: Path) -> dict` はresults/basins/stations/seriesの4キーを返します。
内容不正はValueError、ファイル読込失敗はOSError等、extra不足は導入方法付きImportErrorです。
0.2/0.3、CSV、時刻、地理、指標、hashとpathの既存契約を検査します。
結果内のbasin-data識別情報は保存来歴であり、basin-dataの導入や現行SDKとの版一致を要求しません。
同梱の3schemaはroot `schemas/` 正本のコピーで、ネットワークやcwdに依存せず読み込みます。
旧 `scripts/validate_viewer_data.py` の関数、補助名とCLIは同じ検査器へ委譲します。

## 計算と予測専用出力

[生成module](../packages/basin-rc/src/basin_rc/generation.py)はbasin-dataを読みません。
rootの12公開名を保ち、専用moduleから明示importします。

```python
from basin_rc.generation import (
    ForecastArtifact, compute_forecast, assemble_result, write_forecast,
)
# ForecastArtifact(series: pd.DataFrame, result: dict)
# compute_forecast(observations: pd.DataFrame) -> ForecastArtifact
# assemble_result(artifact, *, basin_id, prediction_path) -> dict
# write_forecast(output: Path, *, artifacts, provenance, implementation) -> dict
```

`compute_forecast` は書込みを行わず、全目的時刻格子の系列と、IDとCSV pathを除いた結果を返します。
設定はq/rain入力、q目的値、遅延12時間、6時間先、train/valid比率0.6/0.2、標準化あり、alpha候補0.1/1/10で固定します。
標準化とfitはtrain、alpha選択はvalidだけを使い、選択後の再fitは行いません。
戻り値には学習済み推定器を含めません。
`assemble_result` は安全なIDと相対CSV名を付け、計算項目の任意上書きは受け付けません。

`artifacts` はIDからartifactへのmapping、またはIDとartifactの組のiterableです。
`provenance` の必須キーは `dataset_version`、`dataset_status`、`public_release_blockers`、`library_version`、`data_library_version` です。
任意キーは `schema_version`、`library_name`、`data_library_name`、`extensions` で、未知キーは拒否します。
既定のschemaは0.2です。
合成fixtureの来歴は合成と明示し、0.3の `extensions.synthetic` と0.2の互換fixtureを分けます。
`implementation` は `basin_rc.implementation.implementation_identity(generator, modules)` の実証した識別辞書を渡します。

`write_forecast` はUTC ISO表現のCSV、hashとJSONをstageへ書いて検査し、新規出力先だけを確定します。
`basin_rc.validation.validate_forecast_directory(root) -> dict` は `results` と `series` を返します。
既存schemaの必須地理pathは検査中だけ仮欄を補いますが、保存物へ仮地理を足しません。
この検査成功は予測専用出力の整合を示し、完全bundleの地理検査成功とは区別します。
旧単独CLIの空白区切りUTC時刻を読む場合だけ、`normalize_timestamps=True` を明示します。
