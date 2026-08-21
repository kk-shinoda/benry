#!/bin/zsh
# launchd から benry の開発サーバーを起動するためのラッパー。
# launchd はユーザーのシェル環境(PATH)を持たないため、mise の shims を明示的に通す。
export PATH="$HOME/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.." || exit 1
exec npm run dev
