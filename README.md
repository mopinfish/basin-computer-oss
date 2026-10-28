# basin-computer OSS

流量・雨量などの観測履歴から将来値を予測するPython SDKと、結果を比較するWeb画面です。アルファ版のためAPIは変更される場合があります。

[合成データのデモを開く](https://mopinfish.github.io/basin-computer-oss/)

## この公開版に含まれるもの

- `basin-rc`：前処理、遅延特徴、時系列分割、リッジ回帰、持続予測、RMSE・NSE、保存結果の検査。
- 可変係数モデルの数値推論と、基底・正則化を固定した学習。
- 地図・時系列・比較表・表示期間指定・URLによる表示状態の共有。
- 表示確認用の合成データ。値・地形・地点名は人工で、実際の観測や予測性能を示しません。表示用予測値も人工的に設定しており、モデルを学習して生成したものではありません。

実観測データの同梱パッケージ `basin-data`、全国データの取得、リアルタイム配信、観測点の推薦はこの公開版には含みません。研究用のデータと履歴は公開対象から分離しています。

## Python SDK

Python 3.10以上が必要です。PyPIへの公開はまだ行っていません。

```sh
git clone https://github.com/mopinfish/basin-computer-oss.git
cd basin-computer-oss
python -m venv .venv
. .venv/bin/activate
python -m pip install './packages/basin-rc[validation]'
```

Windowsでは有効化を `.venv\Scripts\activate` に読み替えてください。

```python
import numpy as np
import pandas as pd
from basin_rc import make_forecast_samples, temporal_split, select_forecaster, evaluate

# 実観測ではなく、小さな人工系列によるAPIの使用例です。
t = np.arange(240)
observations = pd.DataFrame(
    {'q': 10 + np.sin(t / 12), 'rain': (t % 24 == 0).astype(float)},
    index=pd.date_range('2024-01-01', periods=len(t), freq='h', tz='UTC'),
)
split = temporal_split(make_forecast_samples(observations, tau_h=12, horizon_h=6))
selected = select_forecaster(split)
print(evaluate(selected.model.predict(split.test.X), split.test).to_dict())
```

[APIリファレンス](docs/api-reference.md)／[可変係数モデル](docs/varcoef-inference.md)

## デモをローカルで開く

```sh
python -m pip install jsonschema
python scripts/build_review_preview.py --output site
python -m http.server 8767 --bind 127.0.0.1 --directory site
```

http://127.0.0.1:8767/ を開いてください。Pythonで学習する画面ではなく、保存された人工系列をブラウザで表示します。

## 検証と継続更新

```sh
python -m pip install pytest './packages/basin-rc[validation]'
python -m pytest
node --test viewer/tests/*.test.mjs
python scripts/build_review_preview.py --output site
```

公開版への同期はPRで行い、テスト後にマージします。mainへの反映後、GitHub Actionsが合成データを再生成・検査してGitHub Pagesへ配置します。
`PUBLIC_SOURCE.json` は書き出し元の版と公開ファイルのSHA-256を記録します。公開版の修正も開発側へ戻し、次の同期で消えないようにします。公開版を正本の全面コピーとして扱わず、公開範囲は許可リストで管理します。

## ライセンスと用途

コードと、この公開版で生成する人工データは [BSD-3-Clause](LICENSE) です。第三者の観測データや地理データを再配布するものではありません。
実観測での予測性能や防災上の有効性を、この合成デモから判断することはできません。
