import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

export const Route = createFileRoute('/cursor-cape')({
  component: CursorCapePage,
})

import type { CapeInfo, CloakResult, CursorInfo, CursorPatch } from '../server/cape'

const listCapesFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<CapeInfo[]> => {
    const cape = await import('../server/cape')
    return cape.listCapes()
  },
)

type UpdateResult = { ok: true; cursor: CursorInfo } | { ok: false; message: string }

const updateCursorFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { file: string; cursorId: string; patch: CursorPatch }) => d)
  .handler(async ({ data }): Promise<UpdateResult> => {
    const cape = await import('../server/cape')
    try {
      return { ok: true, cursor: await cape.updateCursor(data.file, data.cursorId, data.patch) }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, message: msg.slice(0, 300) }
    }
  })

const clipboardImageFn = createServerFn({ method: 'POST' }).handler(async () => {
  const cape = await import('../server/cape')
  return cape.readClipboardImagePng()
})

const applyCapeFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { file: string }) => d)
  .handler(async ({ data }): Promise<CloakResult> => {
    const cape = await import('../server/cape')
    return cape.applyCape(data.file)
  })

const resetCursorsFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<CloakResult> => {
    const cape = await import('../server/cape')
    return cape.resetCursors()
  },
)

const restoreCapeFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { file: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const cape = await import('../server/cape')
    try {
      await cape.restoreCape(data.file)
      return { ok: true, message: '' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, message: msg.slice(0, 300) }
    }
  })

// Mousecape (mousecloak/MCDefs.m) の名前表 + coregraphics 系
const CURSOR_NAMES: Record<string, string> = {
  'com.apple.coregraphics.Arrow': '矢印',
  'com.apple.coregraphics.IBeam': 'テキスト (I ビーム)',
  'com.apple.coregraphics.IBeamXOR': 'テキスト XOR',
  'com.apple.coregraphics.Alias': 'エイリアス',
  'com.apple.coregraphics.Copy': 'コピー',
  'com.apple.coregraphics.Move': '移動',
  'com.apple.coregraphics.ArrowCtx': '右クリックメニュー',
  'com.apple.coregraphics.Wait': '待機 (レインボー)',
  'com.apple.coregraphics.Empty': '非表示',
  'com.apple.cursor.2': 'リンク (指差し)',
  'com.apple.cursor.3': '禁止',
  'com.apple.cursor.4': 'ビジー',
  'com.apple.cursor.5': 'コピードラッグ',
  'com.apple.cursor.7': '十字',
  'com.apple.cursor.8': '十字 2',
  'com.apple.cursor.9': 'カメラ 2',
  'com.apple.cursor.10': 'カメラ',
  'com.apple.cursor.11': '閉じた手',
  'com.apple.cursor.12': '開いた手',
  'com.apple.cursor.13': '指差し',
  'com.apple.cursor.14': 'カウントアップ',
  'com.apple.cursor.15': 'カウントダウン',
  'com.apple.cursor.16': 'カウント両方向',
  'com.apple.cursor.17': 'リサイズ W',
  'com.apple.cursor.18': 'リサイズ E',
  'com.apple.cursor.19': 'リサイズ W-E',
  'com.apple.cursor.20': 'セル XOR',
  'com.apple.cursor.21': 'リサイズ N',
  'com.apple.cursor.22': 'リサイズ S',
  'com.apple.cursor.23': 'リサイズ N-S',
  'com.apple.cursor.24': 'コンテキストメニュー',
  'com.apple.cursor.25': 'ポフッ (消滅)',
  'com.apple.cursor.26': 'I ビーム横',
  'com.apple.cursor.27': 'ウインドウ E',
  'com.apple.cursor.28': 'ウインドウ E-W',
  'com.apple.cursor.29': 'ウインドウ NE',
  'com.apple.cursor.30': 'ウインドウ NE-SW',
  'com.apple.cursor.31': 'ウインドウ N',
  'com.apple.cursor.32': 'ウインドウ N-S',
  'com.apple.cursor.33': 'ウインドウ NW',
  'com.apple.cursor.34': 'ウインドウ NW-SE',
  'com.apple.cursor.35': 'ウインドウ SE',
  'com.apple.cursor.36': 'ウインドウ S',
  'com.apple.cursor.37': 'ウインドウ SW',
  'com.apple.cursor.38': 'ウインドウ W',
  'com.apple.cursor.39': 'リサイズ四角',
  'com.apple.cursor.40': 'ヘルプ',
  'com.apple.cursor.41': 'セル',
  'com.apple.cursor.42': 'ズームイン',
  'com.apple.cursor.43': 'ズームアウト',
}

function cursorName(id: string): string {
  return CURSOR_NAMES[id] ?? id.replace(/^com\.apple\.(coregraphics|cursor)\./, '')
}

// 縦積みストリップ画像の 1 フレーム目だけを箱サイズに収めて表示し、
// フレームが複数あれば Web Animations API の steps() でコマ送りする
function CursorAnim({
  cursor,
  box,
  pngOverride,
}: {
  cursor: CursorInfo
  box: number
  pngOverride?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const png = pngOverride ?? cursor.pngBase64
  const frames = Math.max(1, cursor.frameCount)
  const frameH = cursor.pixelHeight / frames

  // 1 フレームを box に収める倍率（差し替えプレビュー時は画像実寸が不明なので幅基準）
  const scale = cursor.pixelWidth > 0 ? Math.min(box / cursor.pixelWidth, box / Math.max(1, frameH)) : 1
  const w = Math.max(1, Math.round(cursor.pixelWidth * scale))
  const h = Math.max(1, Math.round(frameH * scale))

  useEffect(() => {
    const el = ref.current
    if (!el || frames <= 1) return
    const anim = el.animate(
      [{ backgroundPositionY: '0px' }, { backgroundPositionY: `${-h * frames}px` }],
      {
        duration: Math.max(0.05, cursor.frameDuration) * frames * 1000,
        easing: `steps(${frames})`,
        iterations: Infinity,
      },
    )
    return () => anim.cancel()
  }, [frames, h, cursor.frameDuration, png])

  if (!png) return <div className="cc-anim cc-anim--empty" style={{ width: box, height: box }} />
  return (
    <div className="cc-anim" style={{ width: box, height: box }}>
      <div
        ref={ref}
        style={{
          width: w,
          height: h,
          backgroundImage: `url(data:image/png;base64,${png})`,
          backgroundSize: `${w}px auto`,
          backgroundRepeat: 'no-repeat',
          imageRendering: cursor.pixelWidth <= 64 ? 'pixelated' : 'auto',
        }}
      />
    </div>
  )
}

type Draft = {
  frameCount: string
  frameDuration: string
  hotSpotX: string
  hotSpotY: string
  pointsWide: string
  pointsHigh: string
}

function draftFrom(c: CursorInfo): Draft {
  const f = (n: number) => String(Math.round(n * 1000) / 1000)
  return {
    frameCount: f(c.frameCount),
    frameDuration: f(c.frameDuration),
    hotSpotX: f(c.hotSpotX),
    hotSpotY: f(c.hotSpotY),
    pointsWide: f(c.pointsWide),
    pointsHigh: f(c.pointsHigh),
  }
}

function fileToPngBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/png')
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('画像を読み込めませんでした'))
    }
    img.src = url
  })
}

function CursorCapePage() {
  const [capes, setCapes] = useState<CapeInfo[] | null>(null)
  const [capeFile, setCapeFile] = useState<string | null>(null)
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingPng, setPendingPng] = useState<string | null>(null)
  const [pendingSize, setPendingSize] = useState<{ w: number; h: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const note = useCallback((kind: 'ok' | 'err', text: string) => {
    setFlash({ kind, text })
  }, [])

  const reload = useCallback(async () => {
    const list = await listCapesFn()
    setCapes(list)
    return list
  }, [])

  useEffect(() => {
    reload().catch(() => setCapes([]))
  }, [reload])

  const cape = capes?.find((c) => c.file === capeFile) ?? capes?.[0] ?? null
  const cursor = cape?.cursors.find((c) => c.id === cursorId) ?? null

  const selectCursor = useCallback((c: CursorInfo) => {
    setCursorId(c.id)
    setDraft(draftFrom(c))
    setPendingPng(null)
    setPendingSize(null)
    setFlash(null)
  }, [])

  // 差し替え候補画像を受け取ったら、寸法を測ってフレーム数の推定も添える
  const acceptPng = useCallback(
    (pngBase64: string) => {
      const img = new Image()
      img.onload = () => {
        setPendingPng(pngBase64)
        setPendingSize({ w: img.naturalWidth, h: img.naturalHeight })
      }
      img.src = `data:image/png;base64,${pngBase64}`
    },
    [],
  )

  const pickFile = useCallback(
    async (file: File) => {
      try {
        acceptPng(await fileToPngBase64(file))
      } catch (e) {
        note('err', e instanceof Error ? e.message : String(e))
      }
    },
    [acceptPng, note],
  )

  const fromClipboard = useCallback(async () => {
    setBusy('clipboard')
    try {
      const res = await clipboardImageFn()
      if (res.ok) {
        acceptPng(res.pngBase64)
        note('ok', 'クリップボードの画像を取り込みました（保存するまで反映されません）')
      } else {
        note('err', res.message)
      }
    } finally {
      setBusy(null)
    }
  }, [acceptPng, note])

  const save = useCallback(async () => {
    if (!cape || !cursor || !draft) return
    const num = (s: string, fallback: number) => {
      const n = Number(s)
      return Number.isFinite(n) ? n : fallback
    }
    const patch: CursorPatch = {
      frameCount: num(draft.frameCount, cursor.frameCount),
      frameDuration: num(draft.frameDuration, cursor.frameDuration),
      hotSpotX: num(draft.hotSpotX, cursor.hotSpotX),
      hotSpotY: num(draft.hotSpotY, cursor.hotSpotY),
      pointsWide: num(draft.pointsWide, cursor.pointsWide),
      pointsHigh: num(draft.pointsHigh, cursor.pointsHigh),
    }
    if (pendingPng) patch.imagePngBase64 = pendingPng
    setBusy('save')
    try {
      const res = await updateCursorFn({ data: { file: cape.file, cursorId: cursor.id, patch } })
      if (!res.ok) {
        note('err', res.message)
        return
      }
      setCapes(
        (prev) =>
          prev?.map((cp) =>
            cp.file !== cape.file
              ? cp
              : {
                  ...cp,
                  hasBackup: true,
                  cursors: cp.cursors.map((cu) => (cu.id === cursor.id ? res.cursor : cu)),
                },
          ) ?? prev,
      )
      setDraft(draftFrom(res.cursor))
      setPendingPng(null)
      setPendingSize(null)
      note('ok', `${cursorName(cursor.id)} を保存しました（適用ボタンで反映）`)
    } finally {
      setBusy(null)
    }
  }, [cape, cursor, draft, pendingPng, note])

  const apply = useCallback(async () => {
    if (!cape) return
    setBusy('apply')
    try {
      const res = await applyCapeFn({ data: { file: cape.file } })
      if (res.ok) note('ok', `「${cape.name}」を適用しました。マウスを動かして確認！`)
      else note('err', `適用に失敗: ${res.message}`)
    } finally {
      setBusy(null)
    }
  }, [cape, note])

  const reset = useCallback(async () => {
    setBusy('reset')
    try {
      const res = await resetCursorsFn()
      if (res.ok) note('ok', 'macOS 標準カーソルに戻しました')
      else note('err', `リセットに失敗: ${res.message}`)
    } finally {
      setBusy(null)
    }
  }, [note])

  const restore = useCallback(async () => {
    if (!cape) return
    setBusy('restore')
    try {
      const res = await restoreCapeFn({ data: { file: cape.file } })
      if (!res.ok) {
        note('err', res.message)
        return
      }
      const list = await reload()
      const cur = list
        .find((c) => c.file === cape.file)
        ?.cursors.find((c) => c.id === cursorId)
      setDraft(cur ? draftFrom(cur) : null)
      setPendingPng(null)
      setPendingSize(null)
      note('ok', '編集前のバックアップ (.bak) に戻しました')
    } finally {
      setBusy(null)
    }
  }, [cape, cursorId, note, reload])

  // ホットスポットはプレビュー上のクリックでも設定できる
  const hotspotClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cursor || !draft) return
      const rect = e.currentTarget.getBoundingClientRect()
      const pw = Number(draft.pointsWide) || cursor.pointsWide
      const ph = Number(draft.pointsHigh) || cursor.pointsHigh
      const x = ((e.clientX - rect.left) / rect.width) * pw
      const y = ((e.clientY - rect.top) / rect.height) * ph
      setDraft({ ...draft, hotSpotX: (Math.round(x * 10) / 10).toString(), hotSpotY: (Math.round(y * 10) / 10).toString() })
    },
    [cursor, draft],
  )

  const dirty =
    cursor !== null &&
    draft !== null &&
    (pendingPng !== null ||
      JSON.stringify(draft) !== JSON.stringify(draftFrom(cursor)))

  const frames = cursor ? Math.max(1, Number(draft?.frameCount) || cursor.frameCount) : 1
  const previewCursor: CursorInfo | null =
    cursor && pendingPng && pendingSize
      ? { ...cursor, pngBase64: pendingPng, pixelWidth: pendingSize.w, pixelHeight: pendingSize.h, frameCount: frames }
      : cursor
      ? { ...cursor, frameCount: frames }
      : null

  return (
    <div className="vf cc">
      <header className="vf-header">
        <Link to="/" className="vf-back">
          ← 道具箱
        </Link>
        <h1 className="vf-title">
          <span className="vf-title-index">03</span> カーソルテーマ工房
        </h1>
        <span />
      </header>

      <p className="cc-lead">
        Mousecape の cape（カーソルテーマ）をブラウザで編集。画像を差し替えて、そのまま Mac に適用。
      </p>

      {flash && <p className={`vf-flash vf-flash--${flash.kind}`}>{flash.text}</p>}

      {capes === null ? (
        <p className="cc-empty">読み込み中…</p>
      ) : capes.length === 0 ? (
        <div className="cc-empty">
          <p>cape がまだありません。</p>
          <p className="cc-dim">
            ~/Library/Application Support/Mousecape/capes に .cape を置くか、Mousecape.app で作成してください。
          </p>
        </div>
      ) : (
        <div className="cc-layout">
          <section className="cc-left">
            <div className="cc-cape-bar">
              <select
                className="cc-select"
                value={cape?.file ?? ''}
                onChange={(e) => {
                  setCapeFile(e.target.value)
                  setCursorId(null)
                  setDraft(null)
                  setPendingPng(null)
                }}
              >
                {capes.map((c) => (
                  <option key={c.file} value={c.file}>
                    {c.name}（{c.author}）
                  </option>
                ))}
              </select>
              <button className="cc-btn cc-btn--accent" onClick={apply} disabled={busy !== null}>
                {busy === 'apply' ? '適用中…' : 'この cape を適用'}
              </button>
              <button className="cc-btn" onClick={reset} disabled={busy !== null}>
                標準に戻す
              </button>
            </div>

            <div className="cc-grid">
              {cape?.cursors.map((c) => (
                <button
                  key={c.id}
                  className={`cc-tile${c.id === cursorId ? ' cc-tile--active' : ''}`}
                  onClick={() => selectCursor(c)}
                >
                  <CursorAnim cursor={c} box={56} />
                  <span className="cc-tile-name">{cursorName(c.id)}</span>
                  {c.frameCount > 1 && <span className="cc-tile-frames">{c.frameCount}f</span>}
                </button>
              ))}
            </div>
          </section>

          <section className="cc-right">
            {!cursor || !draft || !previewCursor ? (
              <p className="cc-dim cc-editor-hint">← カーソルを選ぶと、ここで編集できます</p>
            ) : (
              <div className="cc-editor">
                <h2 className="cc-editor-title">{cursorName(cursor.id)}</h2>
                <p className="cc-dim cc-editor-id">{cursor.id}</p>

                <div className="cc-preview-row">
                  <div>
                    <p className="cc-label">動きプレビュー</p>
                    <CursorAnim cursor={previewCursor} box={96} />
                  </div>
                  <div>
                    <p className="cc-label">1 フレーム目（クリックでホットスポット設定）</p>
                    <div className="cc-hotspot-box" onClick={hotspotClick}>
                      <div
                        className="cc-hotspot-img"
                        style={{
                          backgroundImage: `url(data:image/png;base64,${previewCursor.pngBase64})`,
                        }}
                      />
                      <span
                        className="cc-hotspot-dot"
                        style={{
                          left: `${((Number(draft.hotSpotX) || 0) / (Number(draft.pointsWide) || cursor.pointsWide)) * 100}%`,
                          top: `${((Number(draft.hotSpotY) || 0) / (Number(draft.pointsHigh) || cursor.pointsHigh)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div
                  className={`cc-drop${dragOver ? ' cc-drop--over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const f = e.dataTransfer.files[0]
                    if (f) void pickFile(f)
                  }}
                >
                  <p>
                    画像をドロップして差し替え（アニメは全フレームを縦に積んだ 1 枚画像）
                  </p>
                  <div className="cc-drop-btns">
                    <button
                      className="cc-btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy !== null}
                    >
                      ファイルを選ぶ
                    </button>
                    <button className="cc-btn" onClick={fromClipboard} disabled={busy !== null}>
                      {busy === 'clipboard' ? '取得中…' : 'クリップボードの画像を使う'}
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void pickFile(f)
                      e.target.value = ''
                    }}
                  />
                  {pendingPng && pendingSize && (
                    <p className="cc-pending">
                      差し替え待ち: {pendingSize.w}×{pendingSize.h}px
                      {pendingSize.h % pendingSize.w === 0 && pendingSize.h !== pendingSize.w && (
                        <>（正方形フレーム換算 {pendingSize.h / pendingSize.w} コマ）</>
                      )}
                      <button
                        className="cc-btn cc-btn--mini"
                        onClick={() => {
                          setPendingPng(null)
                          setPendingSize(null)
                        }}
                      >
                        取り消し
                      </button>
                    </p>
                  )}
                </div>

                <div className="cc-fields">
                  {(
                    [
                      ['frameCount', 'フレーム数', '1'],
                      ['frameDuration', '1コマの秒数', '0.01'],
                      ['hotSpotX', 'ホットスポット X (pt)', '0.1'],
                      ['hotSpotY', 'ホットスポット Y (pt)', '0.1'],
                      ['pointsWide', '幅 (pt)', '1'],
                      ['pointsHigh', '高さ (pt)', '1'],
                    ] as const
                  ).map(([key, label, step]) => (
                    <label key={key} className="cc-field">
                      <span>{label}</span>
                      <input
                        type="number"
                        step={step}
                        value={draft[key]}
                        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>

                <div className="cc-actions">
                  <button
                    className="cc-btn cc-btn--accent"
                    onClick={save}
                    disabled={busy !== null || !dirty}
                  >
                    {busy === 'save' ? '保存中…' : '保存'}
                  </button>
                  {cape?.hasBackup && (
                    <button className="cc-btn" onClick={restore} disabled={busy !== null}>
                      編集をすべて元に戻す (.bak)
                    </button>
                  )}
                </div>
                <p className="cc-dim">
                  保存は cape ファイルの書き換えまで。マウスへの反映は「この cape を適用」。初回保存時に
                  .bak を自動作成します。
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
