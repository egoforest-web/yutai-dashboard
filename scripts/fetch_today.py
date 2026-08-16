# -*- coding: utf-8 -*-
"""
GitHub Actions から定期実行し、対象銘柄の当日終値(直近値)を Yahoo Finance
(yfinance) から取得して data/today.json を更新するスクリプト。

holdings.json は前日分までの静的データなので、このスクリプトは
「当日分だけをYahooから取る」役割に限定する。取得に失敗した銘柄は
既存の today.json の値をそのまま残す(全体を空にしない)。
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
HOLDINGS_PATH = ROOT / "data" / "holdings.json"
TODAY_PATH = ROOT / "data" / "today.json"


def load_codes():
    with open(HOLDINGS_PATH, "r", encoding="utf-8") as f:
        holdings = json.load(f)
    return [h["code"] for h in holdings]


def load_existing_prices():
    if not TODAY_PATH.exists():
        return {}
    try:
        with open(TODAY_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("prices", {})
    except (json.JSONDecodeError, OSError):
        return {}


def fetch_latest_prices(codes):
    """直近終値と前日比(%)をYahoo自身の直近2営業日分から計算して返す。
    前日比はYahoo基準に統一し、こちらのDBの値とは混在させない。
    """
    tickers = [f"{code}.T" for code in codes]
    df = yf.download(
        tickers=tickers,
        period="5d",
        interval="1d",
        group_by="ticker",
        threads=True,
        progress=False,
        auto_adjust=False,
    )

    prices = {}
    for code, ticker in zip(codes, tickers):
        try:
            if len(tickers) == 1:
                series = df["Close"].dropna()
            else:
                series = df[ticker]["Close"].dropna()
            if series.empty:
                continue
            last_date = series.index[-1]
            last_close = float(series.iloc[-1])
            change_pct = None
            if len(series) >= 2:
                prev_close = float(series.iloc[-2])
                if prev_close:
                    change_pct = round((last_close - prev_close) / prev_close * 100, 2)
            prices[code] = {
                "date": last_date.strftime("%Y-%m-%d"),
                "close": last_close,
                "change_pct": change_pct,
            }
        except (KeyError, IndexError):
            continue
    return prices


def main():
    codes = load_codes()
    existing = load_existing_prices()
    fetched = fetch_latest_prices(codes)

    merged = dict(existing)
    merged.update(fetched)

    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "prices": merged,
    }
    with open(TODAY_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print(f"対象銘柄数: {len(codes)} / 取得成功: {len(fetched)} / 合計保持: {len(merged)}")


if __name__ == "__main__":
    main()
