# Draft Timer Web

カードドラフトの進行を、タイマーと日本語音声で案内するWebアプリです。設定はブラウザ内に保存されます。

## 公開ページ

https://tcg-utility.github.io/DraftTimer-Web/

## ローカル開発

Node.js 22以降とpnpmを使用します。

```bash
pnpm install
pnpm dev
```

## GitHub Pages向けビルド

`main` ブランチへのプッシュ時にGitHub Actionsが静的サイトを生成し、GitHub Pagesへ公開します。
