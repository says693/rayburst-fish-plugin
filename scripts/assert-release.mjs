import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const tag = process.argv[2] || process.env.GITHUB_REF_NAME
assert.ok(tag, '缺少 Release 标签；传入 vX.Y.Z 或设置 GITHUB_REF_NAME')
const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
const plugin = readJson('plugin.json')
const pkg = readJson('package.json')
const metadata = readJson('dist/manifest.json')
const catalog = readJson('dist/catalog.json')
const version = tag.slice(1)
assert.match(tag, /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
assert.equal(plugin.version, version)
assert.equal(pkg.version, version)
assert.equal(metadata.version, version)
assert.equal(catalog.plugins[0].version, version)
assert.equal(metadata.package.url, `https://github.com/says693/rayburst-fish-plugin/releases/download/${tag}/rayburst.fish-plugin`)

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const heading = `## [${version}]`
const start = changelog.indexOf(heading)
assert.ok(start >= 0, `CHANGELOG.md 缺少 ${heading}`)
const remainder = changelog.slice(start)
const next = remainder.slice(heading.length).search(/^## \[/m)
const section = (next < 0 ? remainder : remainder.slice(0, heading.length + next)).trim()
const notes = `${section.replace(/^## .*$/m, `# Rayburst FISH-Dock 插件 ${tag}`)}\n\n## 安装\n\n下载 \`rayburst.fish-plugin\`，在 FISH-Dock 插件页导入，然后按 README 配置 Rayburst 本机 RPC 端口与密钥。\n`
fs.writeFileSync(path.join(root, 'dist/RELEASE_NOTES.md'), notes)
console.log(`Release ${tag} 校验通过；发布说明已写入 dist/RELEASE_NOTES.md`)
