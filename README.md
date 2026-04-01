# 買い物メモアプリ

夫婦でリアルタイム共有できる買い物リストアプリです。

## 構成

```
frontend/   → GitHub Pages（静的ホスティング）
backend/    → Render（Node.js + Express + WebSocket）
DB          → Render PostgreSQL（無料枠）
```

### 通信量削減の仕組み
- **Service Worker**: HTML/CSS/JSをブラウザにキャッシュ → 2回目以降アプリ本体の通信ゼロ
- **localStorageキャッシュ**: 起動時はキャッシュを即表示してからバックグラウンドで最新取得
- **楽観的更新**: チェックや在庫変更は即座にローカル反映（API待ちなし）
- **gzip圧縮**: サーバーレスポンスを自動圧縮（転送量1/5〜1/10）
- **システムフォント**: Google Fontsへの外部通信ゼロ
- **最小WSペイロード**: WebSocketは変更内容だけ送信（全データ再送しない）

**推定月間通信量: 3〜8MB**（夫婦2人で毎日使用した場合）

---

## セットアップ手順

### 1. GitHubリポジトリを作成・プッシュ

```bash
git init
git add .
git commit -m "初期コミット"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/shopping-app.git
git push -u origin main
```

---

### 2. Render で PostgreSQL を作成

1. [render.com](https://render.com) にログイン
2. **New → PostgreSQL**
3. Name: `shopping-db`、Plan: **Free** → **Create Database**
4. 作成後の画面で **Internal Database URL** をコピーしておく

---

### 3. Render で Web Service を作成

1. **New → Web Service**
2. GitHubリポジトリを連携・選択
3. 以下の通り設定：

| 項目 | 値 |
|---|---|
| Root Directory | `backend` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Plan | `Free` |

4. **Environment Variables** に追加：

| Key | Value |
|---|---|
| `DATABASE_URL` | 手順2でコピーしたURL |
| `FRONTEND_URL` | `https://あなたのユーザー名.github.io` |
| `NODE_ENV` | `production` |

5. **Create Web Service** → デプロイ完了後のURL（例: `https://shopping-app-xxxx.onrender.com`）をメモ

---

### 4. フロントエンドのURLを設定

`frontend/app.js` の1行目を書き換え：

```js
const API = 'https://shopping-app-xxxx.onrender.com'; // ← 手順3のURL
```

コミット・プッシュ：

```bash
git add frontend/app.js
git commit -m "API URLを設定"
git push
```

---

### 5. GitHub Pages を有効化

1. GitHubリポジトリ → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / Folder: `/frontend`
4. **Save**
5. 数分後に `https://あなたのユーザー名.github.io/shopping-app/` で公開される

---

### 6. Renderスリープ対策（UptimeRobot）

Renderの無料プランは15分間アクセスがないとスリープします。
UptimeRobot（無料）を使って自動で起こし続けます。

1. [uptimerobot.com](https://uptimerobot.com) で無料アカウント作成
2. **Add New Monitor** をクリック
3. 以下の通り設定：

| 項目 | 値 |
|---|---|
| Monitor Type | `HTTP(s)` |
| Friendly Name | `shopping-app` |
| URL | `https://あなたのアプリURL.onrender.com/health` |
| Monitoring Interval | `5 minutes` |

4. **Create Monitor** → これでスリープしなくなります

---

## 使い方

| 操作 | 説明 |
|---|---|
| 右上のボタン | 妻／夫を切り替え（誰が追加したかの記録用） |
| ヘッダーの緑ドット | WebSocket接続状態（緑＝リアルタイム同期中） |
| ＋ 商品を追加 | タップしてフォームを開く |
| 商品名を入力 | 過去の商品がサジェスト表示される |
| 購入頻度 | 随時・毎週・毎月 を選択 |
| チェック | スーパーで買いながらタップ |
| 買い物完了ボタン | チェック済みを在庫へ移動 |
| 在庫タブ | 満タン・多い・少ない・なし の4段階で管理 |
| 「なし」を選択 | 確認後に買い物リストへ自動追加・在庫から削除 |
| 定期タブ | 毎週・毎月の登録一覧と次回追加予定日 |
| 履歴タブ | 誰がいつどこで買ったかを記録 |

---

## 今後の拡張予定（Render経由で対応予定）
- AI献立提案（Anthropic API）
- 商品画像登録
- PWAインストール（ホーム画面に追加）
