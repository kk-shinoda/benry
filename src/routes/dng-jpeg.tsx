import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

export const Route = createFileRoute('/dng-jpeg')({
  component: DngJpegPage,
})

import type { ConvertResult } from '../server/dng'

// クリップボード上の（Finder でコピーされた）RAW ファイルを JPEG に変換し、
// 変換結果をクリップボードに書き戻す。すべてこの Mac 上のサーバー側で行う。
const convertClipboardFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { quality: number }) => d)
  .handler(async ({ data }): Promise<ConvertResult> => {
    const dng = await import('../server/dng')
    const paths = await dng.readClipboardFilePaths()
    if (paths.length === 0) {
      return {
        ok: false,
        message:
          'クリップボードにファイルがありません。Finder で DNG をコピー（⌘C）してから押してください',
      }
    }
    const raws = paths.filter(dng.isRawFile)
    if (raws.length === 0) {
      return {
        ok: false,
        message: `対応形式のファイルがありません（${paths.length} 件中 0 件が DNG / RAW / HEIC / TIFF）`,
      }
    }
    return dng.convertAndReply(raws[0], data.quality, raws.length - 1)
  })

const convertUploadFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { name: string; quality: number; base64: string }) => d)
  .handler(async ({ data }): Promise<ConvertResult> => {
    const dng = await import('../server/dng')
    if (!dng.isRawFile(data.name)) {
      return { ok: false, message: 'DNG / RAW / HEIC / TIFF ファイルを選んでください' }
    }
    const dir = await dng.makeTempDir()
    const srcPath = await dng.writeTempInput(dir, data.name, data.base64)
    return dng.convertAndReply(srcPath, data.quality, 0)
  })

function fmtBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function DngJpegPage() {
  const [quality, setQuality] = useState(85)
  const [busy, setBusy] = useState<null | 'clipboard' | 'upload'>(null)
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [jpegUrl, setJpegUrl] = useState<string | null>(null)
  const jpegUrlRef = useRef<string | null>(null)

  // 変換結果の base64 を blob URL 化（プレビューとダウンロードに使う）
  useEffect(() => {
    if (jpegUrlRef.current) {
      URL.revokeObjectURL(jpegUrlRef.current)
      jpegUrlRef.current = null
    }
    if (result?.ok) {
      const bin = atob(result.jpegBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
      jpegUrlRef.current = url
      setJpegUrl(url)
    } else {
      setJpegUrl(null)
    }
    return () => {
      if (jpegUrlRef.current) {
        URL.revokeObjectURL(jpegUrlRef.current)
        jpegUrlRef.current = null
      }
    }
  }, [result])

  const runClipboard = useCallback(async () => {
    if (busy) return
    setBusy('clipboard')
    try {
      setResult(await convertClipboardFn({ data: { quality } }))
    } catch (e) {
      setResult({ ok: false, message: `サーバーエラー: ${String(e).slice(0, 200)}` })
    } finally {
      setBusy(null)
    }
  }, [busy, quality])

  const runUpload = useCallback(
    async (file: File) => {
      if (busy) return
      setBusy('upload')
      try {
        const base64 = await fileToBase64(file)
        setResult(await convertUploadFn({ data: { name: file.name, quality, base64 } }))
      } catch (e) {
        setResult({ ok: false, message: `サーバーエラー: ${String(e).slice(0, 200)}` })
      } finally {
        setBusy(null)
      }
    },
    [busy, quality],
  )

  const outName = result?.ok ? result.fileName.replace(/\.[^.]+$/, '') + '.jpg' : 'converted.jpg'

  return (
    <div className="vf dj">
      <header className="vf-header">
        <Link to="/" className="vf-back">
          ← 道具箱
        </Link>
        <h1 className="vf-title">
          <span className="vf-title-index">02</span> DNG → JPEG 変換
        </h1>
        <span />
      </header>

      <main
        className="dj-main"
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files[0]
          if (f) void runUpload(f)
        }}
      >
        <section className="dj-hero">
          <ol className="dj-flow">
            <li>
              <span className="dj-flow-num">1</span>Finder で DNG を <b>⌘C</b>
            </li>
            <li>
              <span className="dj-flow-num">2</span>下のボタンを押す
            </li>
            <li>
              <span className="dj-flow-num">3</span>好きな場所に <b>⌘V</b>
            </li>
          </ol>

          <button
            className="dj-big-btn"
            onClick={() => void runClipboard()}
            disabled={busy !== null}
          >
            {busy === 'clipboard' ? '変換中…' : 'クリップボードの DNG を JPEG に変換'}
          </button>

          <div className="dj-options">
            <label className="dj-quality">
              <span>
                品質 <b className="dj-quality-val">{quality}</b>
              </span>
              <input
                type="range"
                min={60}
                max={100}
                step={1}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </label>
            <label className={`dj-drop${dragOver ? ' dj-drop--over' : ''}`}>
              {busy === 'upload' ? '変換中…' : 'またはファイルをドロップ / クリックで選択'}
              <input
                type="file"
                accept=".dng,.arw,.cr2,.cr3,.nef,.nrw,.orf,.raf,.rw2,.pef,.srw,.heic,.heif,.tif,.tiff"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void runUpload(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </section>

        {result && !result.ok && <div className="dj-result dj-result--err">{result.message}</div>}

        {result?.ok && (
          <section className="dj-result">
            <div className="dj-preview">
              {jpegUrl && <img src={jpegUrl} alt={`${outName} のプレビュー`} />}
            </div>
            <div className="dj-info">
              <p className="dj-info-status">
                {result.clipboardWritten
                  ? '✓ クリップボードに JPEG が入っています — そのまま ⌘V で貼り付けできます'
                  : '変換は成功しましたが、クリップボードへの書き込みに失敗しました（下のボタンで保存できます）'}
              </p>
              <dl className="dj-stats">
                <div>
                  <dt>ファイル</dt>
                  <dd>{result.fileName}</dd>
                </div>
                <div>
                  <dt>サイズ</dt>
                  <dd>
                    {result.width}×{result.height}
                  </dd>
                </div>
                <div>
                  <dt>容量</dt>
                  <dd>
                    {fmtBytes(result.srcBytes)} → {fmtBytes(result.outBytes)}（
                    {Math.round((1 - result.outBytes / result.srcBytes) * 100)}% 減）
                  </dd>
                </div>
                <div>
                  <dt>品質</dt>
                  <dd>{result.quality}</dd>
                </div>
              </dl>
              {result.skipped > 0 && (
                <p className="dj-note">
                  ※ 複数コピーされていたため最初の 1 件のみ変換しました（残り {result.skipped} 件）
                </p>
              )}
              <div className="dj-result-actions">
                {jpegUrl && (
                  <a className="btn btn--accent" href={jpegUrl} download={outName}>
                    JPEG を保存
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        <p className="dj-foot-note">
          変換はこの Mac の中（sips = macOS 標準の RAW 現像エンジン）で行われ、外部には何も送信されません。
          DNG のほか ARW / CR2 / CR3 / NEF / RAF / HEIC / TIFF なども変換できます。
        </p>
      </main>
    </div>
  )
}
