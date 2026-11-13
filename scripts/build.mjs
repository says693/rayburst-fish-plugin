import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const REPOSITORY = 'https://github.com/says693/rayburst-fish-plugin'
const RUNTIME_FILES = [
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'backend.mjs',
  'rayburst-service.mjs',
  'page.html',
  'page.css',
  'page.js',
  'page-utils.js',
  'sdk/node/plugin.mjs',
  'sdk/browser/bridge.js',
  'sdk/LICENSE.txt',
]
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')
const archiveEntry = (value, date) => [value, { mtime: date }]

function sourceFiles(directory = ROOT, prefix = '') {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.work'].includes(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...sourceFiles(absolute, relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files.sort()
}

export async function build() {
  const manifestPath = path.join(ROOT, 'plugin.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const entries = {}
  const date = new Date('2026-01-01T00:00:00Z')
  manifest.files = {}
  for (const name of RUNTIME_FILES) {
    const bytes = fs.readFileSync(path.join(ROOT, name))
    manifest.files[name] = sha256(bytes)
    entries[name] = archiveEntry(bytes, date)
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  entries['plugin.json'] = archiveEntry(fs.readFileSync(manifestPath), date)
  const packageBytes = Buffer.from(zipSync(entries, { level: 9 }))

  const sourceEntries = {}
  for (const name of sourceFiles()) sourceEntries[name] = archiveEntry(fs.readFileSync(path.join(ROOT, name)), date)
  const sourceBytes = Buffer.from(zipSync(sourceEntries, { level: 9 }))
  const dist = path.join(ROOT, 'dist')
  fs.mkdirSync(dist, { recursive: true })
  const packageName = 'rayburst.fish-plugin'
  const sourceName = 'rayburst-fish-plugin-source.zip'
  const downloadBase = `${REPOSITORY}/releases/download/v${manifest.version}`
  fs.writeFileSync(path.join(dist, packageName), packageBytes)
  fs.writeFileSync(path.join(dist, sourceName), sourceBytes)

  const catalogBytes = Buffer.from(`${JSON.stringify({
    schema: 1,
    plugins: [{
      id: manifest.id,
      name: manifest.name,
      description: '在 FISH-Dock 中添加和管理 Rayburst 下载任务',
      authors: ['says693'],
      version: manifest.version,
      hostApi: manifest.hostApi,
      platform: manifest.platforms[0],
      url: `${downloadBase}/${packageName}`,
      sha256: sha256(packageBytes),
      bytes: packageBytes.length,
    }],
  }, null, 2)}\n`)
  fs.writeFileSync(path.join(dist, 'catalog.json'), catalogBytes)

  const metadata = {
    schema: 1,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    hostApi: manifest.hostApi,
    platforms: manifest.platforms,
    repository: REPOSITORY,
    package: {
      file: packageName,
      bytes: packageBytes.length,
      sha256: sha256(packageBytes),
      url: `${downloadBase}/${packageName}`,
    },
    source: {
      file: sourceName,
      bytes: sourceBytes.length,
      sha256: sha256(sourceBytes),
      url: `${downloadBase}/${sourceName}`,
    },
    catalog: { file: 'catalog.json', bytes: catalogBytes.length, sha256: sha256(catalogBytes) },
    resources: Object.keys(manifest.files).length,
  }
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)
  fs.writeFileSync(path.join(dist, 'manifest.json'), metadataBytes)
  const sums = [
    `${sha256(packageBytes)}  ${packageName}`,
    `${sha256(sourceBytes)}  ${sourceName}`,
    `${sha256(metadataBytes)}  manifest.json`,
    `${sha256(catalogBytes)}  catalog.json`,
    '',
  ]
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), sums.join('\n'))
  return metadata
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await build()
  console.log(JSON.stringify(result, null, 2))
}
