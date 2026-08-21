import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/video-frame')({
  component: VideoFramePage,
})

const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]

const STRIP_RANGE = 5 // 前後何コマを比較するか

type StripTile = {
  frame: number
  rel: number
  url: string | null
  out: boolean // 動画の範囲外
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-4) {
      resolve()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      v.removeEventListener('seeked', finish)
      resolve()
    }
    v.addEventListener('seeked', finish)
    window.setTimeout(finish, 2000) // seeked が来ない場合の保険
    v.currentTime = t
  })
}

function formatTime(t: number) {
  if (!Number.isFinite(t)) return '00:00.000'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const ms = Math.floor((t % 1) * 1000)
  const mm = String(m).padStart(2, '0')
  return `${mm}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function VideoFramePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef(0)

  const [src, setSrc] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [fps, setFps] = useState(30)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [dragOver, setDragOver] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // コマ比較ストリップ
  const [compareOpen, setCompareOpen] = useState(false)
  const [strip, setStrip] = useState<StripTile[] | null>(null)
  const [stripBusy, setStripBusy] = useState(false)
  const extractRef = useRef<HTMLVideoElement | null>(null) // サムネイル抽出用のオフスクリーン video
  const extractSrcRef = useRef<string | null>(null)
  const stripJobRef = useRef(0)
  const tileSeekRef = useRef(false) // タイルクリック起因のシーク中は自動再生成しない

  const flashMsg = useCallback((kind: 'ok' | 'err', text: string) => {
    setFlash({ kind, text })
    window.setTimeout(() => setFlash(null), 2200)
  }, [])

  const loadFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(file.name)) {
        flashMsg('err', '動画ファイルを選んでください')
        return
      }
      setSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
      setFileName(file.name)
      setPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      setCompareOpen(false)
      setStrip(null)
      stripJobRef.current++
    },
    [flashMsg],
  )

  // アンマウント時に object URL を解放
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src)
    }
  }, [src])

  // 再生位置の表示を rAF で追従
  useEffect(() => {
    const tick = () => {
      const v = videoRef.current
      if (v) setCurrentTime(v.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [src])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }, [])

  const seekTo = useCallback(
    (t: number) => {
      const v = videoRef.current
      if (!v || !Number.isFinite(v.duration)) return
      v.currentTime = clamp(t, 0, Math.max(0, v.duration - 0.0005))
      setCurrentTime(v.currentTime)
    },
    [],
  )

  const stepFrames = useCallback(
    (n: number) => {
      const v = videoRef.current
      if (!v) return
      v.pause()
      // 現在のフレーム番号を取り、目標フレームの「中間時刻」へシークして丸め誤差を避ける
      const idx = Math.floor(v.currentTime * fps + 0.001)
      seekTo((idx + n + 0.5) / fps)
    },
    [fps, seekTo],
  )

  const stepSeconds = useCallback(
    (n: number) => {
      const v = videoRef.current
      if (!v) return
      seekTo(v.currentTime + n)
    },
    [seekTo],
  )

  const grabBlob = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const v = videoRef.current
      if (!v || !v.videoWidth) {
        reject(new Error('no video'))
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth
      canvas.height = v.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('no 2d context'))
        return
      }
      ctx.drawImage(v, 0, 0)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    })
  }, [])

  const frameIndex = Math.floor(currentTime * fps + 0.001)

  // 前後 STRIP_RANGE コマをオフスクリーン video からサムネイル化する
  const buildStrip = useCallback(async () => {
    const v = videoRef.current
    if (!v || !src) return
    const job = ++stripJobRef.current
    setStripBusy(true)
    try {
      let ev = extractRef.current
      if (!ev || extractSrcRef.current !== src) {
        ev = document.createElement('video')
        ev.muted = true
        ev.preload = 'auto'
        ev.src = src
        extractRef.current = ev
        extractSrcRef.current = src
        await new Promise<void>((resolve, reject) => {
          ev!.addEventListener('loadedmetadata', () => resolve(), { once: true })
          ev!.addEventListener('error', () => reject(new Error('load failed')), { once: true })
        })
      }
      if (job !== stripJobRef.current) return
      const scale = Math.min(1, 320 / (ev.videoWidth || 320))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(ev.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(ev.videoHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const center = Math.floor(v.currentTime * fps + 0.001)
      const tiles: StripTile[] = []
      for (let rel = -STRIP_RANGE; rel <= STRIP_RANGE; rel++) {
        const frame = center + rel
        const t = (frame + 0.5) / fps
        tiles.push({ frame, rel, url: null, out: frame < 0 || t >= ev.duration })
      }
      setStrip([...tiles])
      for (const tile of tiles) {
        if (tile.out) continue
        await seekVideo(ev, (tile.frame + 0.5) / fps)
        if (job !== stripJobRef.current) return
        ctx.drawImage(ev, 0, 0, canvas.width, canvas.height)
        tile.url = canvas.toDataURL('image/jpeg', 0.85)
        setStrip([...tiles])
      }
    } catch {
      flashMsg('err', 'コマの生成に失敗しました')
    } finally {
      if (job === stripJobRef.current) setStripBusy(false)
    }
  }, [src, fps, flashMsg])

  const toggleCompare = useCallback(() => {
    if (compareOpen) {
      setCompareOpen(false)
      return
    }
    videoRef.current?.pause()
    setCompareOpen(true)
    void buildStrip()
  }, [compareOpen, buildStrip])

  const pickTile = useCallback(
    (tile: StripTile) => {
      if (tile.out) return
      tileSeekRef.current = true
      videoRef.current?.pause()
      seekTo((tile.frame + 0.5) / fps)
    },
    [fps, seekTo],
  )

  // ストリップ表示中にコマ送り・シークしたら、現在位置を中心に作り直す
  useEffect(() => {
    if (!compareOpen || !strip) return
    const v = videoRef.current
    if (!v || !v.paused) return
    if (tileSeekRef.current) {
      tileSeekRef.current = false
      return
    }
    if (strip.some((t) => t.rel === 0 && t.frame === frameIndex)) return
    const id = window.setTimeout(() => void buildStrip(), 350)
    return () => window.clearTimeout(id)
  }, [compareOpen, strip, frameIndex, buildStrip])

  const downloadPng = useCallback(async () => {
    try {
      const blob = await grabBlob()
      const base = fileName.replace(/\.[^.]+$/, '') || 'frame'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${base}_f${Math.floor((videoRef.current?.currentTime ?? 0) * fps + 0.001)}.png`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 3000)
      flashMsg('ok', 'PNG をダウンロードしました')
    } catch {
      flashMsg('err', 'キャプチャに失敗しました')
    }
  }, [fileName, fps, grabBlob, flashMsg])

  const copyPng = useCallback(async () => {
    try {
      // Safari 対応: ClipboardItem に Promise<Blob> を渡す形にする
      const item = new ClipboardItem({ 'image/png': grabBlob() })
      await navigator.clipboard.write([item])
      flashMsg('ok', 'クリップボードにコピーしました')
    } catch {
      flashMsg('err', 'コピーに失敗しました（ブラウザ非対応の可能性）')
    }
  }, [grabBlob, flashMsg])

  // キーボードショートカット
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (!videoRef.current) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) stepSeconds(1)
          else stepFrames(1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) stepSeconds(-1)
          else stepFrames(-1)
          break
        case 's':
        case 'S':
          e.preventDefault()
          void downloadPng()
          break
        case 'c':
        case 'C':
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          void copyPng()
          break
        case 'v':
        case 'V':
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          toggleCompare()
          break
        case 'Escape':
          setCompareOpen(false)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, stepFrames, stepSeconds, downloadPng, copyPng, toggleCompare])

  return (
    <div className="vf">
      <header className="vf-header">
        <Link to="/" className="vf-back">
          ← 道具箱
        </Link>
        <h1 className="vf-title">
          <span className="vf-title-index">01</span> 動画フレームキャプチャ
        </h1>
        {fileName ? <span className="vf-file">{fileName}</span> : <span />}
      </header>

      {!src ? (
        <label
          className={`dropzone${dragOver ? ' dropzone--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files[0]
            if (f) loadFile(f)
          }}
        >
          <input
            type="file"
            accept="video/*,.mkv"
            className="dropzone-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) loadFile(f)
            }}
          />
          <span className="dropzone-mark" aria-hidden>
            ⬒
          </span>
          <span className="dropzone-main">動画をここにドロップ</span>
          <span className="dropzone-sub">またはクリックしてファイルを選択</span>
          <span className="dropzone-note">
            ファイルはこの Mac の中だけで処理されます（アップロードなし）
          </span>
        </label>
      ) : (
        <main
          className="vf-main"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) loadFile(f)
          }}
        >
          <div className="vf-stage">
            <video
              ref={videoRef}
              src={src}
              playsInline
              onClick={togglePlay}
              onPlay={() => {
                setPlaying(true)
                setCompareOpen(false)
              }}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                setDuration(v.duration)
                setDims({ w: v.videoWidth, h: v.videoHeight })
              }}
              onEnded={() => setPlaying(false)}
            />
          </div>

          {compareOpen && (
            <section className="vf-strip" aria-label="前後のコマ比較">
              <div className="vf-strip-head">
                <span className="vf-strip-title">
                  前後{STRIP_RANGE}コマ比較
                  {stripBusy && <span className="vf-strip-busy">生成中…</span>}
                </span>
                <span className="vf-strip-hint">クリックでそのコマへ移動 → コピー / PNG 保存</span>
                <button className="btn btn--mini" onClick={() => setCompareOpen(false)}>
                  閉じる (Esc)
                </button>
              </div>
              <div className="vf-strip-row">
                {(strip ?? []).map((tile) => (
                  <button
                    key={tile.rel}
                    className={`vf-tile${tile.frame === frameIndex ? ' vf-tile--active' : ''}${
                      tile.rel === 0 ? ' vf-tile--center' : ''
                    }`}
                    onClick={() => pickTile(tile)}
                    disabled={tile.out}
                    title={tile.out ? '動画の範囲外' : `F ${tile.frame} へ移動`}
                  >
                    <span className="vf-tile-thumb">
                      {tile.url ? (
                        <img src={tile.url} alt={`フレーム ${tile.frame}`} draggable={false} />
                      ) : (
                        <span className="vf-tile-empty">{tile.out ? '—' : '…'}</span>
                      )}
                    </span>
                    <span className="vf-tile-label">
                      <span className="vf-tile-rel">
                        {tile.rel > 0 ? `+${tile.rel}` : tile.rel === 0 ? '±0' : tile.rel}
                      </span>
                      <span className="vf-tile-frame">F {tile.frame}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="vf-console">
            <div className="vf-scrub-row">
              <input
                type="range"
                className="vf-scrub"
                min={0}
                max={duration || 0}
                step={0.001}
                value={Math.min(currentTime, duration || 0)}
                onChange={(e) => {
                  videoRef.current?.pause()
                  seekTo(Number(e.target.value))
                }}
                aria-label="シークバー"
              />
            </div>

            <div className="vf-controls">
              <div className="vf-tc" title="現在位置">
                <span className="vf-tc-time">{formatTime(currentTime)}</span>
                <span className="vf-tc-sep">/</span>
                <span className="vf-tc-dur">{formatTime(duration)}</span>
                <span className="vf-tc-frame">F {frameIndex}</span>
              </div>

              <div className="vf-transport">
                <button className="btn" onClick={() => stepSeconds(-1)} title="1秒戻る (Shift+←)">
                  ≪
                </button>
                <button className="btn" onClick={() => stepFrames(-1)} title="1コマ戻る (←)">
                  −1<span className="btn-unit">コマ</span>
                </button>
                <button className="btn btn--play" onClick={togglePlay} title="再生 / 停止 (Space)">
                  {playing ? '❚❚' : '▶'}
                </button>
                <button className="btn" onClick={() => stepFrames(1)} title="1コマ進む (→)">
                  +1<span className="btn-unit">コマ</span>
                </button>
                <button className="btn" onClick={() => stepSeconds(1)} title="1秒進む (Shift+→)">
                  ≫
                </button>
              </div>

              <div className="vf-fps">
                <label htmlFor="fps">fps</label>
                <select id="fps" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  {FPS_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div className="vf-actions">
                <button
                  className={`btn${compareOpen ? ' btn--toggled' : ''}`}
                  onClick={toggleCompare}
                  title="前後のコマを並べて比較 (V)"
                >
                  ±{STRIP_RANGE}コマ比較
                </button>
                <button className="btn btn--accent" onClick={() => void copyPng()} title="C">
                  コピー
                </button>
                <button className="btn btn--accent" onClick={() => void downloadPng()} title="S">
                  PNG 保存
                </button>
              </div>
            </div>

            <div className="vf-meta">
              <span>
                {dims.w}×{dims.h}
              </span>
              <span className="vf-keys">
                Space 再生 / ← → コマ送り / Shift+←→ 1秒 / V コマ比較 / C コピー / S 保存
              </span>
              <label className="vf-reload">
                別の動画を開く
                <input
                  type="file"
                  accept="video/*,.mkv"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) loadFile(f)
                  }}
                />
              </label>
            </div>
          </div>
        </main>
      )}

      {flash && <div className={`vf-flash vf-flash--${flash.kind}`}>{flash.text}</div>}
    </div>
  )
}
