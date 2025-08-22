# jig-intern-public

このプロジェクトは、Denoを使用して構築されたWebアプリケーションです。  
地図上で位置情報を指定して、その場所で購入した金額を入力します。  
また、入力されたデータをサーバー側で保存し、地図上に表示することができます。

## 使用技術

- **Deno**: サーバーサイドの実行環境
- **Leaflet**: 地図表示ライブラリ
- **OpenStreetMap**: 地図データの提供
- **HTML/CSS/JavaScript**: フロントエンドの構築

## 機能概要

### フロントエンド
- **data_input.html**: 購入データを入力し、地図上で位置情報を指定するページ。
  - 緯度・経度を手入力または地図上でピンをドラッグやクリックして指定可能。
  - 送信ボタンでデータをサーバーにPOST。
- **index.html**: サーバーに保存されたデータを地図上に表示するページ。
  - GETリクエストでデータを取得し、地図上にマーカーを表示。
  - 月ごとのデータ取得も可能。

### サーバーサイド
- **server.deno.js**: Denoを使用したサーバーコード。
  - `/submit-data`: POSTリクエストを受け取り、データを保存。
  - `/get-data`: GETリクエストで保存されたデータを返却。
  - `/get-search-data`: 検索条件に基づいたデータを返却。

## セットアップ

### 必要な環境
- Deno（最新バージョンを推奨）

### 実行方法
1. リポジトリをクローンします。
   ```bash
   git clone <リポジトリURL>
   cd jig-intern-public
   ```
2. サーバーを起動します。
   ```bash
   deno task start
   ```
3. ブラウザで以下のURLにアクセスします。
   - `http://localhost:8000/data_input.html`: 購入データ入力ページ
   - `http://localhost:8000`: 地図表示ページ

## Web上での利用

1. https://2gpigeon-jig-intern-42.deno.dev/ にアクセス

## ファイル構成

```
├── public
│   ├── data_input.html   # 購入データ入力ページ
│   ├── index.html        # 地図表示ページ
│   ├── data_input.css    # data_input.htmlのスタイル
│   ├── index.css         # index.htmlのスタイル
│   ├── leaflet.sprite.js # Leaflet関連のスクリプト
│   └── favicon.ico       # サイトアイコン
├── server.deno.js         # サーバーコード
└── README.md              # プロジェクトの説明
```
