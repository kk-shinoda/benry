import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="home">
      <header className="home-hero">
        <p className="home-kicker">personal toolbox / port 1714</p>
        <h1 className="home-title">
          便利<span className="home-title-dot">。</span>
        </h1>
        <p className="home-sub">ブラウザでやる、じぶんの作業道具箱</p>
      </header>

      <main className="tool-list">
        <Link to="/video-frame" className="tool-card">
          <span className="tool-index">01</span>
          <span className="tool-body">
            <span className="tool-name">動画フレームキャプチャ</span>
            <span className="tool-desc">
              動画をアップロードして再生、1コマずつアジャストして、その瞬間を PNG
              でダウンロード / コピー
            </span>
          </span>
          <span className="tool-arrow" aria-hidden>
            →
          </span>
        </Link>

        <Link to="/dng-jpeg" className="tool-card">
          <span className="tool-index">02</span>
          <span className="tool-body">
            <span className="tool-name">DNG → JPEG 変換</span>
            <span className="tool-desc">
              スマホの RAW（DNG）を JPEG に。Finder でコピー → ボタン →
              クリップボードに変換済み JPEG が入る
            </span>
          </span>
          <span className="tool-arrow" aria-hidden>
            →
          </span>
        </Link>

        <div className="tool-card tool-card--ghost" aria-hidden>
          <span className="tool-index">03</span>
          <span className="tool-body">
            <span className="tool-name">（次の道具）</span>
            <span className="tool-desc">ここに次の便利機能が入る予定</span>
          </span>
        </div>
      </main>

      <footer className="home-foot">
        <span>benry</span>
        <span>localhost:1714</span>
      </footer>
    </div>
  )
}
