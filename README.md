# 買い物メモアプリ

夫婦でリアルタイム共有できる買い物リストアプリです。

## 構成

```
frontend/   → GitHub Pages（静的ホスティング）
backend/    → Render（Node.js + Express + WebSocket）
DB          → Supabase PostgreSQL（無料枠）
```

## デプロイ先

- フロントエンド: https://tatsuya-prog.github.io/shopping-app/
- バックエンド: https://shopping-app-api-ibu8.onrender.com

## Renderの環境変数

| Key | 説明 |
|---|---|
| DATABASE_URL | SupabaseのDB接続URL |
| FRONTEND_URL | https://tatsuya-prog.github.io |
| NODE_ENV | production |
| GEMINI_API_KEY | Google Gemini APIキー |
| VAPID_PUBLIC_KEY | プッシュ通知用公開鍵 |
| VAPID_PRIVATE_KEY | プッシュ通知用秘密鍵 |
| VAPID_EMAIL | mailto:toirotatsuyaseki@gmail.com |
