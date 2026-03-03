import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs'
import os from 'os'
import path from 'path'
import { readDirRecursively } from '../src/utils/fs-helpers'

let tmpDir: string
let cwdTmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'od-fs-'))
  cwdTmpDir = mkdtempSync(path.join(process.cwd(), 'od-fs-cwd-'))
  const dirLinkType = process.platform === 'win32' ? 'junction' : 'dir'
  mkdirSync(path.join(tmpDir, 'sub'))
  mkdirSync(path.join(tmpDir, 'sub', 'deep'))
  mkdirSync(path.join(tmpDir, 'empty'))
  writeFileSync(path.join(tmpDir, 'a.ts'), 'a')
  writeFileSync(path.join(tmpDir, 'b.js'), 'b')
  writeFileSync(path.join(tmpDir, 'upper.TS'), 'u')
  writeFileSync(path.join(tmpDir, 'sub', 'c.ts'), 'c')
  writeFileSync(path.join(tmpDir, 'sub', 'd.txt'), 'd')
  writeFileSync(path.join(tmpDir, 'sub', 'deep', 'e.ts'), 'e')
  symlinkSync(path.join(tmpDir, 'sub'), path.join(tmpDir, 'sub-link'), dirLinkType)
  symlinkSync(tmpDir, path.join(tmpDir, 'sub', 'deep', 'loop'), dirLinkType)
  writeFileSync(path.join(cwdTmpDir, 'cwd.ts'), 'cwd')
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  rmSync(cwdTmpDir, { recursive: true, force: true })
})

describe('readDirRecursively – error cases', () => {
  test('throws when directory does not exist', () => {
    expect(() => readDirRecursively('/nonexistent/od-test-abc123')).toThrow('not found')
  })

  test('throws when path points to a file, not a directory', () => {
    const file = path.join(tmpDir, 'a.ts')
    expect(() => readDirRecursively(file)).toThrow('not found')
  })
})

describe('readDirRecursively – relative paths (default)', () => {
  test('returns relative paths by default', () => {
    const files = readDirRecursively(tmpDir)
    expect(files.every(f => !path.isAbsolute(f))).toBe(true)
  })

  test('includes top-level files', () => {
    const files = readDirRecursively(tmpDir)
    expect(files).toContain('a.ts')
    expect(files).toContain('b.js')
  })

  test('recurses into subdirectories', () => {
    const files = readDirRecursively(tmpDir)
    expect(files).toContain(path.join('sub', 'c.ts'))
    expect(files).toContain(path.join('sub', 'd.txt'))
    expect(files).toContain(path.join('sub', 'deep', 'e.ts'))
  })

  test('skips symlinked directories by default', () => {
    const files = readDirRecursively(tmpDir)
    expect(files).not.toContain(path.join('sub-link', 'c.ts'))
    expect(files).not.toContain(path.join('sub-link', 'deep', 'e.ts'))
  })
})

describe('readDirRecursively – followSymlinks', () => {
  test('follows symlinked directories when enabled', () => {
    const files = readDirRecursively(tmpDir, false, null, true)
    expect(files).toContain(path.join('sub-link', 'c.ts'))
    expect(files).toContain(path.join('sub-link', 'deep', 'e.ts'))
  })

  test('skips cyclic directory links when symlink traversal is enabled', () => {
    const files = readDirRecursively(tmpDir, false, null, true)
    expect(files).not.toContain(path.join('sub', 'deep', 'loop', 'a.ts'))
    expect(files).not.toContain(path.join('sub-link', 'deep', 'loop', 'a.ts'))
  })
})

describe('readDirRecursively – keepDirPath', () => {
  test('returns absolute paths when keepDirPath is true', () => {
    const files = readDirRecursively(tmpDir, true)
    expect(files.every(f => path.isAbsolute(f))).toBe(true)
  })

  test('absolute paths include the base directory', () => {
    const files = readDirRecursively(tmpDir, true)
    expect(files).toContain(path.join(tmpDir, 'a.ts'))
    expect(files).toContain(path.join(tmpDir, 'sub', 'deep', 'e.ts'))
  })

  test('resolves relative directory input before returning absolute paths', () => {
    const relativeDir = path.relative(process.cwd(), cwdTmpDir)
    const files = readDirRecursively(relativeDir, true)
    expect(files).toContain(path.join(cwdTmpDir, 'cwd.ts'))
  })
})

describe('readDirRecursively – extension filter', () => {
  test('filters to only .ts files', () => {
    const files = readDirRecursively(tmpDir, false, ['.ts'])
    expect(files.every(f => f.toLowerCase().endsWith('.ts'))).toBe(true)
    expect(files).not.toContain('b.js')
    expect(files).not.toContain(path.join('sub', 'd.txt'))
  })

  test('matches extensions case-insensitively', () => {
    const files = readDirRecursively(tmpDir, false, ['.ts'])
    expect(files).toContain('upper.TS')
  })

  test('includes deep files matching the extension', () => {
    const files = readDirRecursively(tmpDir, false, ['.ts'])
    expect(files).toContain(path.join('sub', 'deep', 'e.ts'))
  })

  test('multiple extensions are supported', () => {
    const files = readDirRecursively(tmpDir, false, ['.ts', '.js'])
    const exts = files.map(f => path.extname(f))
    expect(exts).toContain('.ts')
    expect(exts).toContain('.js')
    expect(exts).not.toContain('.txt')
  })

  test('returns empty array when no files match the extension', () => {
    const files = readDirRecursively(tmpDir, false, ['.xyz'])
    expect(files).toEqual([])
  })

  test('null extension filter returns all files', () => {
    const files = readDirRecursively(tmpDir, false, null)
    const exts = files.map(f => path.extname(f))
    expect(exts).toContain('.ts')
    expect(exts).toContain('.js')
    expect(exts).toContain('.txt')
  })
})

describe('readDirRecursively – empty directory', () => {
  test('returns empty array for an empty directory', () => {
    const files = readDirRecursively(path.join(tmpDir, 'empty'))
    expect(files).toEqual([])
  })
})
