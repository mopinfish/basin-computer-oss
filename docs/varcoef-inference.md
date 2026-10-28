# 可変係数モデルの数値推論と固定条件の学習API

`basin_rc.varying_coefficient` は正規化ガウス基底と、明示した係数による数値推論を提供します。
公開名は `gaussian_partition`、`VaryingCoefficientReadout` と `fit_varying_coefficient` です。
rootの既存12入口と固定3流域デモは従来の動作を維持します。

```python
import numpy as np
from basin_rc.varying_coefficient import gaussian_partition, VaryingCoefficientReadout

centers = np.array([[0.0], [2.0]])
model = VaryingCoefficientReadout(
    centers=centers, width=1.0,
    coefficients=np.array([[[1.0]], [[3.0]]]),
    bias=np.array([0.5]),
)
print(model.predict(np.array([[2.0]]), np.array([[1.0]])))  # [[4.5]]
print(model.predict_one(np.array([2.0]), np.array([1.0])))  # [4.5]
```

この例は合成配列の計算であり、河川観測や予測性能の例ではありません。

## 入力と出力

| 入口 | 入力 | 出力 |
| --- | --- | --- |
| `gaussian_partition(z, centers, width)` | 座標 `(n,d)`、中心 `(M,d)`、幅 | 正規化した基底 `(n,M)` |
| `VaryingCoefficientReadout(*, centers, width, coefficients, bias)` | 中心 `(M,d)`、幅、係数 `(M,p,H)`、切片 `(H,)` | 数値推論オブジェクト |
| `model.predict(X, z)` | 特徴 `(n,p)`、座標 `(n,d)` | `(n,H)` |
| `model.predict_one(x, z)` | 特徴 `(p,)`、座標 `(d,)` | `(H,)` |

`M,d,p,H` は正とし、空のバッチでは `(0,M)` または `(0,H)` を返します。
Hは出力列の数で、先行時間の値や列の意味はこのAPIに保存しません。
配列は整数型か浮動小数型の通常のNumPy ndarrayを指定します。
MaskedArray、matrixなどのndarrayサブクラスは拒否します。
リスト、真偽値型、文字列型、複素数型、object型、非有限値、形状不整合はValueErrorになります。
配列はfloat64で計算し、入力を変更しません。
構築時に中心、係数、切片をコピーするため、元の配列の変更はモデルに伝播しません。
幅は真偽値以外の有限正の実数スカラーとし、計算分母 `2 * width * width` もfloat64で有限かつ正である必要があります。

## 計算の保証範囲

基底は距離の二乗からガウス重みを計算し、行ごとの最大対数重みを引いて正規化します。
推論は基底ごとの `X @ coefficients[m]` を基底の重みで合成し、切片を加えます。
M=1なら基底は1となり、与えられた係数と切片の線形読み出しです。
重複中心も受け付け、同じ距離の中心には同じ重みを割り当てます。

距離の差、二乗、分母、対数重み、予測結果が表現できない場合はValueErrorになります。
研究実装にある非有限計算後の最近接基底への代替をこのAPIでは行いません。
研究実装との数値照合は通常の有限計算領域に限り、ビット一致や計算領域外の挙動一致は保証しません。

研究の展開後係数Wを使う場合、基底、特徴の順で `(M,p,H)` に対応づけます。
中心化を戻す切片は `mean_y - mean_x @ W` で、mean_xは展開後特徴 `phi ⊗ X` の平均です。
推論クラスは平均や係数を学習せず、恒久モデル形式を読み込みません。
出力を元単位へ戻す処理も自動で行いません。

時刻、先行時間、特徴列順、単位、座標の生成、学習と選択の境界はこの数値配列APIでは検査しません。
実観測へ適用する際には別途、origin = target − horizon、未来情報の不使用、採用行と除外母数、入力と実装の版、利用条件を確認する必要があります。
数値の一致を、旧研究NPZの採用適格性や実観測の予測性能、流域の物理機構の確認に読み替えません。


## 固定基底・固定alphaでの学習

`fit_varying_coefficient(X, z, y, *, centers, width, alpha)` は既存の `VaryingCoefficientReadout` を返します。
Xは `(n,p)`、zは `(n,d)`、yは `(n,H)`、centersは `(M,d)` の整列済み配列で、nも正とします。
H=1でもyは2次元で指定し、型・有限値・コピーの扱いは推論と共通です。
alphaは真偽値以外の実数スカラーで、float64に変換した後も有限かつ正でなければValueErrorになります。

```python
from basin_rc.varying_coefficient import fit_varying_coefficient

X = np.array([[-1.], [1.]])
z = np.zeros((2, 1))
y = np.array([[-2.], [2.]])
fitted = fit_varying_coefficient(
    X, z, y, centers=np.zeros((1, 1)), width=0.5, alpha=2.0,
)
print(fitted.predict(X, z))  # [[-1.], [1.]]
```

展開した `T = phi ⊗ X` とyをそれぞれの平均で中心化し、`sum((y - T@W - bias)**2) + alpha * sum(W**2)` を解きます。
alphaをnで割らず、切片を正則化しません。切片は `mean(y) - mean(T) @ W` です。
M=1なら固定alphaの切片付きridgeと同じ数値問題になります。
学習行は返したモデルに保持せず、入力を変更しません。

展開 `8*n*M*p` とGram `8*(M*p)**2` を、それぞれ64 MiB以下に制限します。
これは全プロセスのメモリ上限ではなく、入力コピー、基底、中心化配列、H列、求解コピーは別に必要です。
中間計算の非有限値と求解失敗はValueErrorになります。alpha=0、擬似逆、jitter、alpha変更による代替は行いません。
極端な尺度や条件の悪い系で係数の精度を無条件に保証するものではありません。

中心選択、幅やalphaの探索、分割、標準化、時刻整列、指標、保存形式、旧NPZ読込は含みません。
研究の小合成学習問題との照合には `atol=rtol=1e-10` を使い、条件数1e4以下の固定ケースに限ります。
既存の数値推論の式照合 `1e-12` と区別し、実観測の因果性、性能や旧保存系列の採用適格性を認定しません。
