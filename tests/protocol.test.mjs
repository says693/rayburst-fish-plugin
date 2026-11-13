import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

class HostHarness {
  constructor() {
    this.values = new Map()
    this.secrets = new Map()
    this.pending = new Map()
    this.next = 0
    this.child = spawn(process.execPath, [fileURLToPath(new URL('../backend.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.lines = readline.createInterface({ input: this.child.stdout })
    this.lines.on('line', line => this.onLine(JSON.parse(line)))
  }

  onLine(row) {
    if (row.method) {
      void this.onCallback(row)
      return
    }
    const pending = this.pending.get(row.id)
    if (!pending) return
    this.pending.delete(row.id)
    clearTimeout(pending.timer)
    if (row.error) {
      const error = new Error(row.error.message)
      error.code = row.error.code
      pending.reject(error)
    } else pending.resolve(row.result)
  }

  async onCallback(row) {
    const { category, name, value } = row.params || {}
    let result = {}
    if (row.method === 'host.storage.read') result = { value: this.values.has(`${category}/${name}`) ? this.values.get(`${category}/${name}`) : null }
    else if (row.method === 'host.storage.write') { this.values.set(`${category}/${name}`, value); result = { written: true } }
    else if (row.method === 'host.storage.readSecret') result = { value: this.secrets.has(`${category}/${name}`) ? this.secrets.get(`${category}/${name}`) : null }
    else if (row.method === 'host.storage.writeSecret') { this.secrets.set(`${category}/${name}`, value); result = { written: true } }
    this.child.stdin.write(`${JSON.stringify({ id: row.id, result })}\n`)
  }

  call(method, params = {}) {
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`宿主测试超时：${method}`)) }, 5000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  async close() {
    this.lines.close()
    this.child.kill()
    await new Promise(resolve => { this.child.once('exit', resolve); setTimeout(resolve, 1000).unref() })
  }
}

async function fakeRayburst() {
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      let result
      if (body.method === 'aria2.getVersion') result = { version: '1.37.0', product: 'aria2-next', rpcVersion: 4 }
      else if (body.method === 'system.multicall') {
        result = body.params[0].map(call => {
          if (call.methodName === 'aria2.getVersion') return [{ version: '1.37.0', product: 'aria2-next', rpcVersion: 4 }]
          if (call.methodName === 'aria2.getGlobalStat') return [{ downloadSpeed: '0', uploadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' }]
          if (call.methodName === 'aria2.addUri') return ['a'.repeat(16)]
          return [[]]
        })
      } else result = 'OK'
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) }
}

test('真实 SDK 完成握手、配置存储、RPC 调用与停用闭环', async t => {
  const rayburst = await fakeRayburst()
  const host = new HostHarness()
  t.after(async () => { await host.close(); await rayburst.close() })
  const hello = await host.call('host.hello', {
    protocol: 1,
    pluginId: 'says693.rayburst',
    hostVersion: '2.2.3',
    dataDirectory: 'C:\\PluginData',
    storage: {},
    capabilities: ['storage', 'network', 'services'],
    hostCallTimeoutMs: 2000,
  })
  assert.equal(hello.type, 'plugin.hello')
  assert.equal(hello.protocol, 1)
  assert.equal(hello.pluginId, 'says693.rayburst')
  assert.deepEqual(await host.call('plugin.activate'), { active: true })
  assert.deepEqual(await host.call('plugin.health'), { ready: true })
  assert.equal((await host.call('rayburst.settings')).port, 29100)
  await host.call('rayburst.saveSettings', { port: rayburst.port, pollMs: 2500, secret: 'protocol-secret' })
  assert.equal(host.secrets.get('credentials/rpc-secret'), 'protocol-secret')
  const tested = await host.call('rayburst.test')
  assert.equal(tested.product, 'aria2-next')
  const view = await host.call('rayburst.snapshot')
  assert.equal(view.connected, true)
  const added = await host.call('rayburst.add', { urls: 'https://example.com/a.zip' })
  assert.equal(added.added, 1)
  await assert.rejects(host.call('rayburst.unknown'), error => error.code === 'UNKNOWN_METHOD')
  assert.deepEqual(await host.call('plugin.deactivate'), { active: false })
})
