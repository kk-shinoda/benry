import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import plist from 'simple-plist'

const run = promisify(execFile)

// Mousecape (SwiftUI 版) のライブラリと CLI の場所
export const CAPES_DIR = join(homedir(), 'Library/Application Support/Mousecape/capes')
export const MOUSECLOAK = '/Applications/Mousecape.app/Contents/MacOS/mousecloak'

export type CursorInfo = {
  id: string
  frameCount: number
  frameDuration: number
  hotSpotX: number
  hotSpotY: number
  pointsWide: number
  pointsHigh: number
  // 先頭 representation（全フレーム縦積みストリップ）を PNG にしたもの
  pngBase64: string
  pixelWidth: number
  pixelHeight: number
  repCount: number
}

export type CapeInfo = {
  file: string
  name: string
  author: string
  identifier: string
  version: number
  hiDPI: boolean
  hasBackup: boolean
  cursors: CursorInfo[]
}

export type CursorPatch = {
  frameCount?: number
  frameDuration?: number
  hotSpotX?: number
  hotSpotY?: number
  pointsWide?: number
  pointsHigh?: number
  imagePngBase64?: string
}

type CapeDict = {
  CapeName?: string
  Author?: string
  Identifier?: string
  CapeVersion?: number
  HiDPI?: boolean
  Cursors?: Record<string, CursorDict>
} & Record<string, unknown>

type CursorDict = {
  FrameCount?: number
  FrameDuration?: number
  HotSpotX?: number
  HotSpotY?: number
  PointsWide?: number
  PointsHigh?: number
  Representations?: Buffer[]
} & Record<string, unknown>

// ライブラリ外のパスを踏まないよう、ファイル名だけ受け取って結合する
function capePath(file: string): string {
  return join(CAPES_DIR, basename(file))
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// 画像データ（TIFF/PNG など）を PNG に変換して base64 と寸法を返す
async function toPngInfo(
  data: Buffer,
): Promise<{ pngBase64: string; pixelWidth: number; pixelHeight: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'benry-cape-'))
  try {
    const src = join(dir, 'in.bin')
    const out = join(dir, 'out.png')
    await writeFile(src, data)
    await run('sips', ['-s', 'format', 'png', src, '--out', out], {
      maxBuffer: 32 * 1024 * 1024,
    })
    const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out])
    return {
      pngBase64: (await readFile(out)).toString('base64'),
      pixelWidth: Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0),
      pixelHeight: Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function cursorInfo(id: string, c: CursorDict): Promise<CursorInfo> {
  const reps = c.Representations ?? []
  const png =
    reps.length > 0
      ? await toPngInfo(reps[0])
      : { pngBase64: '', pixelWidth: 0, pixelHeight: 0 }
  return {
    id,
    frameCount: Number(c.FrameCount ?? 1),
    frameDuration: Number(c.FrameDuration ?? 1),
    hotSpotX: Number(c.HotSpotX ?? 0),
    hotSpotY: Number(c.HotSpotY ?? 0),
    pointsWide: Number(c.PointsWide ?? 32),
    pointsHigh: Number(c.PointsHigh ?? 32),
    ...png,
    repCount: reps.length,
  }
}

// カーソル識別子の表示順: coregraphics 系 → com.apple.cursor.N の数値順
function cursorOrder(id: string): [number, number, string] {
  const m = /^com\.apple\.cursor\.(\d+)$/.exec(id)
  if (m) return [1, Number(m[1]), id]
  return [0, 0, id]
}

async function readCape(file: string): Promise<CapeDict> {
  // Buffer のまま渡す（XML / バイナリ plist の両対応判定は simple-plist 側で行われる）
  const raw = await readFile(capePath(file))
  return plist.parse<CapeDict>(raw, capePath(file))
}

async function writeCape(file: string, cape: CapeDict): Promise<void> {
  // 初回変更時のみ元ファイルを .bak として残す
  const path = capePath(file)
  const bak = `${path}.bak`
  if (!(await exists(bak))) await copyFile(path, bak)
  await writeFile(path, plist.stringify(cape))
}

export async function listCapes(): Promise<CapeInfo[]> {
  if (!(await exists(CAPES_DIR))) return []
  const files = (await readdir(CAPES_DIR)).filter((f) => f.endsWith('.cape')).sort()
  const capes: CapeInfo[] = []
  for (const file of files) {
    const cape = await readCape(file)
    const cursors = cape.Cursors ?? {}
    const ids = Object.keys(cursors).sort((a, b) => {
      const [ga, na, sa] = cursorOrder(a)
      const [gb, nb, sb] = cursorOrder(b)
      return ga - gb || na - nb || sa.localeCompare(sb)
    })
    capes.push({
      file,
      name: String(cape.CapeName ?? file),
      author: String(cape.Author ?? ''),
      identifier: String(cape.Identifier ?? ''),
      version: Number(cape.CapeVersion ?? 1),
      hiDPI: Boolean(cape.HiDPI),
      hasBackup: await exists(`${capePath(file)}.bak`),
      cursors: await Promise.all(ids.map((id) => cursorInfo(id, cursors[id]))),
    })
  }
  return capes
}

export async function updateCursor(
  file: string,
  cursorId: string,
  patch: CursorPatch,
): Promise<CursorInfo> {
  const cape = await readCape(file)
  const cursor = cape.Cursors?.[cursorId]
  if (!cursor) throw new Error(`カーソルが見つかりません: ${cursorId}`)
  if (patch.frameCount !== undefined) cursor.FrameCount = Math.max(1, Math.round(patch.frameCount))
  if (patch.frameDuration !== undefined) cursor.FrameDuration = Math.max(0.01, patch.frameDuration)
  if (patch.hotSpotX !== undefined) cursor.HotSpotX = patch.hotSpotX
  if (patch.hotSpotY !== undefined) cursor.HotSpotY = patch.hotSpotY
  if (patch.pointsWide !== undefined) cursor.PointsWide = Math.max(1, patch.pointsWide)
  if (patch.pointsHigh !== undefined) cursor.PointsHigh = Math.max(1, patch.pointsHigh)
  if (patch.imagePngBase64 !== undefined) {
    cursor.Representations = [Buffer.from(patch.imagePngBase64, 'base64')]
  }
  await writeCape(file, cape)
  return cursorInfo(cursorId, cursor)
}

// .bak から cape を復元する
export async function restoreCape(file: string): Promise<void> {
  const path = capePath(file)
  const bak = `${path}.bak`
  if (!(await exists(bak))) throw new Error('バックアップがありません')
  await copyFile(bak, path)
  await rm(bak)
}

const READ_IMAGE_JXA = `
ObjC.import("AppKit");
const pb = $.NSPasteboard.generalPasteboard;
function b64(t) {
  const d = pb.dataForType(t);
  return d.isNil() ? null : d.base64EncodedStringWithOptions(0).js;
}
let out = null;
const png = b64("public.png");
if (png) out = { type: "png", data: png };
if (!out) {
  const tiff = b64("public.tiff");
  if (tiff) out = { type: "tiff", data: tiff };
}
if (!out) {
  const items = pb.pasteboardItems;
  for (let i = 0; i < items.count && !out; i++) {
    const s = items.objectAtIndex(i).stringForType("public.file-url");
    if (!s.isNil()) out = { type: "file", path: $.NSURL.URLWithString(s).path.js };
  }
}
JSON.stringify(out);
`

export type ClipboardImage = { ok: true; pngBase64: string } | { ok: false; message: string }

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.gif', '.heic', '.webp', '.bmp']

// クリップボードから画像（画像データ or 画像ファイル）を PNG として取り出す
export async function readClipboardImagePng(): Promise<ClipboardImage> {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', READ_IMAGE_JXA], {
    maxBuffer: 64 * 1024 * 1024,
  })
  let parsed: { type: string; data?: string; path?: string } | null = null
  try {
    parsed = JSON.parse(stdout.trim() || 'null')
  } catch {
    parsed = null
  }
  if (!parsed) {
    return { ok: false, message: 'クリップボードに画像がありません（画像 or 画像ファイルをコピーしてください）' }
  }
  if (parsed.type === 'png' && parsed.data) return { ok: true, pngBase64: parsed.data }
  if (parsed.type === 'tiff' && parsed.data) {
    const info = await toPngInfo(Buffer.from(parsed.data, 'base64'))
    return { ok: true, pngBase64: info.pngBase64 }
  }
  if (parsed.type === 'file' && parsed.path) {
    const ext = parsed.path.slice(parsed.path.lastIndexOf('.')).toLowerCase()
    if (!IMAGE_EXTS.includes(ext)) {
      return { ok: false, message: `画像ファイルではありません: ${basename(parsed.path)}` }
    }
    const info = await toPngInfo(await readFile(parsed.path))
    return { ok: true, pngBase64: info.pngBase64 }
  }
  return { ok: false, message: 'クリップボードに画像がありません' }
}

export type CloakResult = { ok: true; output: string } | { ok: false; message: string }

async function mousecloak(args: string[]): Promise<CloakResult> {
  if (!(await exists(MOUSECLOAK))) {
    return { ok: false, message: `mousecloak が見つかりません: ${MOUSECLOAK}` }
  }
  try {
    const { stdout, stderr } = await run(MOUSECLOAK, args, { maxBuffer: 8 * 1024 * 1024 })
    return { ok: true, output: `${stdout}${stderr}`.trim().slice(0, 500) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg.slice(0, 300) }
  }
}

export async function applyCape(file: string): Promise<CloakResult> {
  return mousecloak(['--apply', capePath(file)])
}

export async function resetCursors(): Promise<CloakResult> {
  return mousecloak(['--reset'])
}
