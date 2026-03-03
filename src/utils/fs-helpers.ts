import fs from 'fs'
import path from 'path'

/**
 * Recursively reads a directory and returns file paths.
 *
 * @param dirPath Directory path.
 * @param keepDirPath When true, returns absolute paths rooted at the resolved input directory, even when `dirPath` is relative.
 * @param extensions Optional file extensions to include; matching is case-insensitive.
 * @param followSymlinks When true, resolves symlinked entries and traverses symlinked directories. Disabled by default, so symlinked files and directories are skipped.
 * @returns Collected file paths.
 */
export function readDirRecursively(
  dirPath: string,
  keepDirPath = false,
  extensions: string[] | null = null,
  followSymlinks = false,
): string[] {
  const rootPath = path.resolve(dirPath)
  let rootRealPath: string

  try {
    if (!fs.statSync(rootPath).isDirectory()) {
      throw new Error('Not a directory')
    }
    rootRealPath = fs.realpathSync(rootPath)
  } catch {
    throw new Error(`Directory ${dirPath} not found`)
  }

  const paths: string[] = []
  const normalizedExtensions = extensions?.map(ext => ext.toLowerCase()) ?? null
  const normalizeDirectoryKey = (dir: string): string => {
    const normalizedPath = path.normalize(dir)
    return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
  }

  /**
   * Recursive helper that walks nested directories and pushes matching file paths into the shared result array.
   *
   * @param p Directory path to traverse.
   * @param ancestorDirs Canonical directories already visited in the current traversal branch.
   */
  const readDir = (p: string, ancestorDirs: Set<string>): void => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const fullPath = path.join(p, entry.name)
      let isDirectory = entry.isDirectory()
      let isFile = entry.isFile()

      if (!isDirectory && !isFile) {
        if (entry.isSymbolicLink() && !followSymlinks) continue
        try {
          const stat = fs.statSync(fullPath)
          isDirectory = stat.isDirectory()
          isFile = stat.isFile()
        } catch {
          continue
        }
      }

      if (isDirectory) {
        let nextRealPath: string
        try {
          nextRealPath = normalizeDirectoryKey(fs.realpathSync(fullPath))
        } catch {
          continue
        }
        if (ancestorDirs.has(nextRealPath)) continue

        const nextAncestors = new Set(ancestorDirs)
        nextAncestors.add(nextRealPath)
        readDir(fullPath, nextAncestors)
      } else if (isFile) {
        const fileExtension = path.extname(entry.name).toLowerCase()
        if (!normalizedExtensions || normalizedExtensions.includes(fileExtension)) {
          paths.push(fullPath)
        }
      }
    }
  }

  readDir(rootPath, new Set([normalizeDirectoryKey(rootRealPath)]))

  return keepDirPath ? paths : paths.map(p => path.relative(rootPath, p))
}
