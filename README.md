# 優待候補ダッシュボード

保有中(売却済みを除く)の株主優待候補銘柄を、スマホのブラウザから確認するための静的ページです。

- `data/holdings.json` … 銘柄名・市場・配当月・配当金・優待月・優待内容(ローカルのExcel台帳から生成、手動更新)
- `data/history/<code>.json` … 銘柄ごとの日次終値(前日分まで。ローカルのSQLite DBから生成、手動更新)
- `data/today.json` … 当日終値(GitHub Actionsが平日日中に自動更新、Yahoo Financeから取得)

株数・買い日・取得金額・損益などのポジション情報は含めていません。

GitHub Pages: `https://egoforest-web.github.io/yutai-dashboard/`
