# benry — 便利。

ブラウザでやる、じぶんの作業道具箱。TanStack Start 製。**http://localhost:1714**

## 道具

- **01 動画フレームキャプチャ** (`/video-frame`)
  動画をドロップ → 再生 / コマ送りで位置をアジャスト → その瞬間を PNG でダウンロード or クリップボードにコピー。
  ファイルはブラウザ内（ObjectURL）だけで処理され、どこにもアップロードされない。
  - ショートカット: `Space` 再生/停止, `←/→` 1コマ, `Shift+←/→` 1秒, `V` ±5コマ比較, `C` コピー, `S` PNG 保存
  - コマ送りの粒度は fps セレクタで変更（動画の実 fps に合わせる。既定 30）
  - `V` で前後 5 コマのサムネイル比較。タイルクリックでそのコマへジャンプ

- **02 DNG → JPEG 変換** (`/dng-jpeg`)
  Finder で DNG を ⌘C → ボタンを押す → クリップボードに変換済み JPEG が入るので ⌘V。
  ブラウザの Clipboard API では DNG を扱えないため、**ローカルサーバー側で macOS のクリップボードを直接読み書き**する
  （osascript/JXA でファイルパス取得 → `sips` で現像 → JPEG をペーストボードへ）。外部送信なし。
  - ファイルのドロップ / 選択でも変換可（この場合もクリップボードに JPEG が入る + 保存ボタン）
  - 品質スライダー（60–100、既定 85）。DNG のほか ARW / CR2 / CR3 / NEF / RAF / HEIC / TIFF 等も対応
  - 複数ファイルがコピーされていた場合は最初の 1 件のみ変換

## 場所と自動起動

- 実体: `~/apps/benry`（`~/Documents/08_app/benry` はシンボリックリンク）
  ※ `~/Documents` 配下だと macOS の TCC が launchd からの読み取りをブロックするため実体を外に置いている。
- LaunchAgent: `~/Library/LaunchAgents/com.shinoda.benry.plist`（ログイン時に自動起動、落ちたら再起動）
- 起動スクリプト: `scripts/launchd-start.sh`（mise の shims を PATH に通して `npm run dev`）
- ログ: `~/Library/Logs/benry.log` / `benry.error.log`

```sh
# 状態確認
launchctl print gui/$(id -u)/com.shinoda.benry | grep -E 'state|pid'
# 停止（次回ログインまで） / 再開
launchctl bootout gui/$(id -u)/com.shinoda.benry
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.shinoda.benry.plist
# 再起動（コード変更は HMR で反映されるので通常は不要）
launchctl kickstart -k gui/$(id -u)/com.shinoda.benry
```

## 開発

```sh
npm run dev    # ポート 1714 固定（vite.config.ts で strictPort）
npx tsc --noEmit
```
