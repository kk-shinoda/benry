import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

const run = promisify(execFile)

// sips (Apple の RAW 現像エンジン) が扱える入力として受け付ける拡張子
export const RAW_EXTS = [
  '.dng',
  '.arw',
  '.cr2',
  '.cr3',
  '.nef',
  '.nrw',
  '.orf',
  '.raf',
  '.rw2',
  '.pef',
  '.srw',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
]

export function isRawFile(path: string): boolean {
  return RAW_EXTS.includes(extname(path).toLowerCase())
}

const READ_PATHS_JXA = `
ObjC.import("AppKit");
const pb = $.NSPasteboard.generalPasteboard;
const items = pb.pasteboardItems;
const out = [];
for (let i = 0; i < items.count; i++) {
  const s = items.objectAtIndex(i).stringForType("public.file-url");
  if (!s.isNil()) out.push($.NSURL.URLWithString(s).path.js);
}
JSON.stringify(out);
`

// macOS のクリップボードから（Finder でコピーされた）ファイルのパス一覧を得る
export async function readClipboardFilePaths(): Promise<string[]> {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', READ_PATHS_JXA])
  try {
    return JSON.parse(stdout.trim() || '[]') as string[]
  } catch {
    return []
  }
}

// JPEG ファイルを macOS のクリップボードに画像として載せる
export async function writeJpegToClipboard(path: string): Promise<void> {
  const script = `
ObjC.import("AppKit");
const pb = $.NSPasteboard.generalPasteboard;
const data = $.NSData.dataWithContentsOfFile(${JSON.stringify(path)});
if (data.isNil()) throw new Error("read failed");
pb.clearContents;
if (!pb.setDataForType(data, "public.jpeg")) throw new Error("clipboard write failed");
"ok";
`
  await run('osascript', ['-l', 'JavaScript', '-e', script])
}

export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'benry-dng-'))
}

export async function writeTempInput(dir: string, name: string, base64: string): Promise<string> {
  const safe = basename(name).replace(/[/\\:]/g, '_')
  const path = join(dir, safe)
  await writeFile(path, Buffer.from(base64, 'base64'))
  return path
}

export type ConvertOutput = {
  outPath: string
  width: number
  height: number
  srcBytes: number
  outBytes: number
}

export async function convertToJpeg(srcPath: string, quality: number): Promise<ConvertOutput> {
  const dir = await makeTempDir()
  const base = basename(srcPath, extname(srcPath))
  const outPath = join(dir, `${base}.jpg`)
  const q = String(Math.min(100, Math.max(1, Math.round(quality))))
  await run(
    'sips',
    ['-s', 'format', 'jpeg', '-s', 'formatOptions', q, srcPath, '--out', outPath],
    { maxBuffer: 8 * 1024 * 1024 },
  )
  const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', outPath])
  const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0)
  const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0)
  const [srcStat, outStat] = await Promise.all([stat(srcPath), stat(outPath)])
  return { outPath, width, height, srcBytes: srcStat.size, outBytes: outStat.size }
}

export async function fileToBase64(path: string): Promise<string> {
  return (await readFile(path)).toString('base64')
}

export type ConvertResult =
  | {
      ok: true
      fileName: string
      width: number
      height: number
      srcBytes: number
      outBytes: number
      quality: number
      jpegBase64: string
      skipped: number
      clipboardWritten: boolean
    }
  | { ok: false; message: string }

// 変換 → クリップボード書き戻し → クライアントへ返す結果の組み立てまで
export async function convertAndReply(
  srcPath: string,
  quality: number,
  skipped: number,
): Promise<ConvertResult> {
  try {
    const out = await convertToJpeg(srcPath, quality)
    let clipboardWritten = true
    try {
      await writeJpegToClipboard(out.outPath)
    } catch {
      clipboardWritten = false
    }
    return {
      ok: true,
      fileName: basename(srcPath),
      width: out.width,
      height: out.height,
      srcBytes: out.srcBytes,
      outBytes: out.outBytes,
      quality,
      jpegBase64: await fileToBase64(out.outPath),
      skipped,
      clipboardWritten,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `変換に失敗しました: ${msg.slice(0, 200)}` }
  }
}
