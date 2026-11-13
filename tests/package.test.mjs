import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { build } from '../scripts/build.mjs'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

test('发行包只包含声明资源，所有 SHA-256 与宿主契约一致', async () => {
  const metadata = await build()
  const bytes = fs.readFileSync(path.join(root, 'dist/rayburst.fish-plugin'))
  assert.equal(digest(bytes), metadata.package.sha256)
  const files = unzipSync(bytes)
  const manifest = JSON.parse(Buffer.from(files['plugin.json']).toString('utf8'))
  assert.equal(manifest.schema, 1)
  assert.equal(manifest.hostApi, 1)
  assert.deepEqual(manifest.behaviors, { autostart: false })
  assert.equal(manifest.id, 'says693.rayburst')
  assert.deepEqual(manifest.capabilities, ['storage', 'network', 'services'])
  assert.deepEqual(Object.keys(files).sort(), ['plugin.json', ...Object.keys(manifest.files)].sort())
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.ok(files[name], `缺少 ${name}`)
    assert.equal(digest(files[name]), expected, `${name} 摘要不符`)
    assert.ok(files[name].length <= 128 * 1024 * 1024)
  }
  assert.ok(files['README.md'])
  assert.ok(files['LICENSE'])
  assert.ok(files['sdk/LICENSE.txt'])
  assert.equal(Object.keys(files).some(name => name.includes('node_modules') || name.includes('tests/')), false)
  const html = Buffer.from(files['page.html']).toString('utf8')
  assert.equal(/(?:src|href)=["']https?:\/\//i.test(html), false)
  assert.equal(/<script(?![^>]*\bsrc=)/.test(html), false)
  const source = unzipSync(fs.readFileSync(path.join(root, 'dist/rayburst-fish-plugin-source.zip')))
  assert.ok(source['tests/service.test.mjs'])
  assert.ok(source['scripts/build.mjs'])
  assert.equal(Object.keys(source).some(name => name.startsWith('node_modules/') || name.startsWith('dist/')), false)
})
