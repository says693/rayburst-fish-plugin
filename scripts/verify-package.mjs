import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const dist = path.join(root, 'dist')
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const text = bytes => Buffer.from(bytes).toString('utf8')

function safeArchive(names) {
  for (const name of names) {
    assert.ok(!name.includes('\\'), `${name} 使用了反斜杠路径`)
    assert.ok(!path.posix.isAbsolute(name), `${name} 是绝对路径`)
    assert.ok(!name.split('/').includes('..'), `${name} 包含目录穿越`)
  }
}

const metadata = readJson(path.join(dist, 'manifest.json'))
const packageBytes = fs.readFileSync(path.join(dist, metadata.package.file))
assert.equal(packageBytes.length, metadata.package.bytes)
assert.equal(digest(packageBytes), metadata.package.sha256)
const files = unzipSync(packageBytes)
const names = Object.keys(files)
safeArchive(names)

const manifest = JSON.parse(text(files['plugin.json']))
assert.equal(manifest.schema, 1)
assert.equal(manifest.hostApi, 1)
assert.equal(manifest.id, metadata.id)
assert.match(manifest.id, /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/)
assert.equal(manifest.version, metadata.version)
assert.deepEqual(manifest.platforms, ['windows-x86_64'])
assert.deepEqual(manifest.capabilities, ['storage', 'network', 'services'])
assert.equal(manifest.storage.directory, `.plugin.${manifest.id}`)
assert.equal(manifest.storage.dataSchema, 1)
assert.equal(manifest.backend.runtime, 'node')
assert.ok(manifest.files[manifest.backend.entry])
assert.ok(manifest.pages.length > 0)
for (const page of manifest.pages) assert.ok(manifest.files[page.entry], `缺少页面资源 ${page.entry}`)
for (const required of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'sdk/LICENSE.txt']) assert.ok(manifest.files[required], `缺少 ${required}`)
assert.deepEqual(names.sort(), ['plugin.json', ...Object.keys(manifest.files)].sort())
assert.equal(metadata.resources, Object.keys(manifest.files).length)
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.ok(files[name], `缺少 ${name}`)
  assert.equal(digest(files[name]), expected, `${name} SHA-256 不符`)
  assert.ok(files[name].length <= 128 * 1024 * 1024, `${name} 超过宿主资源限制`)
}
assert.ok(!names.some(name => name.startsWith('node_modules/') || name.startsWith('tests/')))
const html = text(files['page.html'])
assert.ok(!/(?:src|href)=["']https?:\/\//i.test(html), '页面引用了远程资源')
assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), '页面包含内联脚本')
assert.ok(!/url\(["']?https?:\/\//i.test(text(files['page.css'])), '样式引用了远程资源')

const sourceBytes = fs.readFileSync(path.join(dist, metadata.source.file))
assert.equal(sourceBytes.length, metadata.source.bytes)
assert.equal(digest(sourceBytes), metadata.source.sha256)
const source = unzipSync(sourceBytes)
safeArchive(Object.keys(source))
for (const required of ['plugin.json', 'backend.mjs', 'tests/service.test.mjs', 'scripts/build.mjs', 'docs/PLUGIN-COMPLIANCE.md']) assert.ok(source[required], `源码包缺少 ${required}`)
assert.ok(!Object.keys(source).some(name => name.startsWith('node_modules/') || name.startsWith('dist/') || name.startsWith('.git/')))

const catalog = readJson(path.join(dist, metadata.catalog.file))
assert.equal(catalog.schema, 1)
assert.equal(catalog.plugins.length, 1)
const entry = catalog.plugins[0]
assert.equal(entry.id, manifest.id)
assert.equal(entry.version, manifest.version)
assert.equal(entry.hostApi, manifest.hostApi)
assert.equal(entry.platform, manifest.platforms[0])
assert.equal(entry.url, metadata.package.url)
assert.equal(entry.sha256, metadata.package.sha256)
assert.equal(entry.bytes, metadata.package.bytes)
assert.equal(digest(fs.readFileSync(path.join(dist, metadata.catalog.file))), metadata.catalog.sha256)

const sums = fs.readFileSync(path.join(dist, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)
assert.equal(sums.length, 4)
for (const line of sums) {
  const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
  assert.ok(match, `无效校验行：${line}`)
  assert.equal(digest(fs.readFileSync(path.join(dist, match[2]))), match[1], `${match[2]} 校验值不符`)
}
console.log(JSON.stringify({ ok: true, id: manifest.id, version: manifest.version, resources: metadata.resources, packageSha256: metadata.package.sha256 }, null, 2))
