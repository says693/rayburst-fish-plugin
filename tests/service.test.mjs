import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
  DEFAULT_PORT,
  PluginError,
  RayburstRpc,
  RayburstService,
  normalizeTask,
  parseDownloadLinks,
  validateFilename,
  validateGid,
} from '../rayburst-service.mjs'

async function rpcServer(handler) {
  const requests = []
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        requests.push(body)
        const answer = await handler(body, requests.length)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...answer }))
      } catch (error) {
        response.writeHead(500)
        response.end(String(error))
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    port: address.port,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function context() {
  const values = new Map()
  const secrets = new Map()
  return {
    values,
    secrets,
    storage: {
      read: async (category, name) => values.has(`${category}/${name}`) ? values.get(`${category}/${name}`) : null,
      write: async (category, name, value) => { values.set(`${category}/${name}`, value) },
    },
    secretsApi: {
      read: async (category, name) => secrets.has(`${category}/${name}`) ? secrets.get(`${category}/${name}`) : null,
      write: async (category, name, value) => { secrets.set(`${category}/${name}`, value) },
    },
  }
}

function serviceFor(port, extra = {}) {
  const ctx = context()
  const service = new RayburstService({ storage: ctx.storage, secrets: ctx.secretsApi }, extra)
  if (port) {
    ctx.values.set('config/settings.json', JSON.stringify({ port, pollMs: 2500 }))
    ctx.secrets.set('credentials/rpc-secret', 'test-secret')
  }
  return { service, ctx }
}

function task(gid, status = 'active', overrides = {}) {
  return {
    gid,
    status,
    totalLength: '1048576',
    completedLength: '524288',
    downloadSpeed: '1024',
    uploadSpeed: '0',
    connections: '2',
    dir: 'C:\\Downloads',
    files: [{ path: `C:\\Downloads\\${gid}.zip`, uris: [{ uri: `https://example.com/${gid}.zip` }] }],
    ...overrides,
  }
}

function snapshotAnswer(version = '1.37.0') {
  return body => {
    assert.equal(body.method, 'system.multicall')
    const values = {
      'aria2.getVersion': { version, product: 'aria2-next', rpcVersion: 4, enabledFeatures: ['BitTorrent'] },
      'aria2.getGlobalStat': { downloadSpeed: '2048', uploadSpeed: '128', numActive: '1', numWaiting: '1', numStopped: '1', numStoppedTotal: '1' },
      'aria2.tellActive': [task('a'.repeat(16))],
      'aria2.tellWaiting': [task('b'.repeat(16), 'paused')],
      'aria2.tellStopped': [task('c'.repeat(16), 'complete', { downloadSpeed: '0' })],
    }
    return { result: body.params[0].map(call => [values[call.methodName]]) }
  }
}

test('链接、GID 与文件名验证拒绝危险或不可用输入', () => {
  const links = [
    'https://example.com/a.zip',
    'ftp://example.com/a.zip',
    'sftp://example.com/a.zip',
    'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    'ed2k://|file|example file.zip|123|0123456789ABCDEF0123456789ABCDEF|/',
    'thunder://QUFodHRwOi8vZXhhbXBsZS5jb20vYS56aXBaWg==',
  ]
  assert.deepEqual(parseDownloadLinks(links.join('\n')), links)
  assert.throws(() => parseDownloadLinks('file:///C:/Windows/System32/config/SAM'), error => error.code === 'UNSUPPORTED_SCHEME')
  assert.throws(() => parseDownloadLinks('javascript:alert(1)'), error => error.code === 'UNSUPPORTED_SCHEME')
  assert.throws(() => parseDownloadLinks('magnet:?dn=missing-xt'), error => error.code === 'INVALID_URL')
  assert.throws(() => validateGid('../../etc/passwd'), error => error.code === 'INVALID_GID')
  assert.throws(() => validateFilename('../escape.exe'), error => error.code === 'INVALID_FILENAME')
  assert.throws(() => validateFilename('NUL.zip'), error => error.code === 'INVALID_FILENAME')
  assert.equal(validateFilename('报告 2026.zip'), '报告 2026.zip')
})

test('RPC 密钥按 Rayburst 原生规则注入普通调用与 multicall 子调用', async t => {
  const server = await rpcServer(body => {
    if (body.method === 'aria2.getVersion') return { result: { version: '1.37.0' } }
    return { result: body.params[0].map(() => [{ downloadSpeed: '0' }]) }
  })
  t.after(server.close)
  const rpc = new RayburstRpc({ port: server.port, secret: 'secret-value' })
  await rpc.call('aria2.getVersion')
  await rpc.multicall([{ method: 'aria2.getGlobalStat', params: [] }, { method: 'aria2.tellActive', params: [] }])
  assert.deepEqual(server.requests[0].params, ['token:secret-value'])
  assert.equal(server.requests[1].params[0][0].params[0], 'token:secret-value')
  assert.equal(server.requests[1].params[0][1].params[0], 'token:secret-value')
  assert.equal(server.requests[1].params[0][0].methodName, 'aria2.getGlobalStat')
})

test('设置使用加密凭据接口，空白密钥保留且从不清空回显', async () => {
  const { service, ctx } = serviceFor()
  assert.deepEqual(await service.settings(), { port: DEFAULT_PORT, pollMs: 2500, hasSecret: false })
  await service.saveSettings({ port: 29101, pollMs: 5000, secret: 'private-secret' })
  assert.deepEqual(await service.settings(), { port: 29101, pollMs: 5000, hasSecret: true })
  assert.equal(ctx.secrets.get('credentials/rpc-secret'), 'private-secret')
  assert.equal(JSON.stringify(await service.settings()).includes('private-secret'), false)
  await service.saveSettings({ secret: '' })
  assert.equal(ctx.secrets.get('credentials/rpc-secret'), 'private-secret')
  await service.saveSettings({ clearSecret: true })
  assert.equal((await service.settings()).hasSecret, false)
})

test('任务快照使用一次 multicall，并规范化速度、进度字段和停止记录', async t => {
  const server = await rpcServer(snapshotAnswer())
  t.after(server.close)
  const { service } = serviceFor(server.port)
  const snapshot = await service.snapshot()
  assert.equal(snapshot.connected, true)
  assert.equal(snapshot.engine.product, 'aria2-next')
  assert.equal(snapshot.stat.downloadSpeed, 2048)
  assert.equal(snapshot.tasks.length, 3)
  assert.equal(snapshot.tasks[0].totalLength, 1048576)
  assert.equal(snapshot.tasks[0].filePath.endsWith('.zip'), true)
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0].params[0].length, 5)
})

test('快照去重并把返回值控制在宿主单帧预算内', async t => {
  const huge = []
  for (let index = 0; index < 230; index += 1) {
    huge.push(task(index.toString(16).padStart(16, '0'), index < 100 ? 'active' : index < 200 ? 'waiting' : 'complete', {
      files: [{ path: `C:\\${'目录'.repeat(250)}\\${'文件名'.repeat(200)}.zip`, uris: [] }],
      dir: `C:\\${'目录'.repeat(250)}`,
      errorMessage: '错误'.repeat(200),
    }))
  }
  const server = await rpcServer(body => {
    const values = {
      'aria2.getVersion': { version: '1', product: 'aria2-next' },
      'aria2.getGlobalStat': {},
      'aria2.tellActive': huge.slice(0, 100),
      'aria2.tellWaiting': [huge[0], ...huge.slice(100, 200)],
      'aria2.tellStopped': huge.slice(200),
    }
    return { result: body.params[0].map(call => [values[call.methodName]]) }
  })
  t.after(server.close)
  const { service } = serviceFor(server.port)
  const snapshot = await service.snapshot()
  assert.equal(new Set(snapshot.tasks.map(row => row.gid)).size, snapshot.tasks.length)
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 900_000)
  assert.equal(snapshot.truncated.stopped, true)
})

test('批量添加返回逐项结果，自定义文件名只传给单个 URI 任务', async t => {
  const server = await rpcServer(body => {
    const calls = body.params[0]
    return { result: calls.map((call, index) => index === 1 ? { code: 3, message: 'duplicate' } : ['a'.repeat(16)]) }
  })
  t.after(server.close)
  const { service } = serviceFor(server.port)
  const result = await service.add({ urls: ['https://example.com/a.zip', 'https://example.com/b.zip'] })
  assert.equal(result.added, 1)
  assert.equal(result.failed, 1)
  assert.equal(result.results[1].code, 'RPC_ERROR')
  await service.add({ urls: 'https://example.com/c.zip', filename: 'custom.zip' })
  const last = server.requests.at(-1).params[0][0]
  assert.deepEqual(last.params[2], { out: 'custom.zip' })
  await assert.rejects(service.add({ urls: ['https://example.com/a', 'https://example.com/b'], filename: 'x.zip' }), error => error.code === 'INVALID_FILENAME')
})

test('暂停、恢复与移除使用正确 RPC；完成记录移除不删除文件', async t => {
  const methods = []
  const server = await rpcServer(body => {
    methods.push(body.method)
    if (body.method === 'aria2.tellStatus') {
      const gid = body.params.at(-1)
      return { result: task(gid, gid.startsWith('c') ? 'complete' : gid.startsWith('d') ? 'paused' : 'active', gid.startsWith('d') ? { bittorrent: { fileSelectionState: 'awaiting' } } : {}) }
    }
    return { result: 'OK' }
  })
  t.after(server.close)
  const { service } = serviceFor(server.port)
  await service.action({ gid: 'a'.repeat(16), action: 'pause' })
  await service.action({ gid: 'a'.repeat(16), action: 'resume' })
  await service.action({ gid: 'a'.repeat(16), action: 'remove' })
  await service.action({ gid: 'c'.repeat(16), action: 'remove' })
  await assert.rejects(service.action({ gid: 'd'.repeat(16), action: 'resume' }), error => error.code === 'SELECTION_REQUIRED')
  assert.ok(methods.includes('aria2.forcePause'))
  assert.ok(methods.includes('aria2.unpause'))
  assert.ok(methods.includes('aria2.forceRemove'))
  assert.ok(methods.includes('aria2.removeDownloadResult'))
  const removed = await service.action({ gid: 'c'.repeat(16), action: 'remove' })
  assert.equal(removed.filesDeleted, false)
})

test('全部恢复跳过等待种子选择的任务并汇总失败', async t => {
  const server = await rpcServer(body => {
    if (body.method === 'aria2.tellWaiting') {
      return { result: [
        task('a'.repeat(16), 'paused'),
        task('b'.repeat(16), 'paused', { bittorrent: { fileSelectionState: 'ready' } }),
        task('c'.repeat(16), 'waiting'),
      ] }
    }
    return { result: body.params[0].map((call, index) => index === 0 ? ['a'.repeat(16)] : { code: 3, message: 'failed' }) }
  })
  t.after(server.close)
  const { service } = serviceFor(server.port)
  await service.resumeAll()
  const result = await service.resumeAll()
  assert.deepEqual(result, { resumed: 1, failed: 0, blocked: 1 })
})

test('认证失败与连接失败返回稳定错误码', async t => {
  const server = await rpcServer(() => ({ error: { code: 1, message: 'Unauthorized secret-value' } }))
  t.after(server.close)
  const { service } = serviceFor(server.port)
  await assert.rejects(service.testConnection(), error => error.code === 'RPC_AUTH' && !error.message.includes('secret-value'))
  const unreachable = new RayburstRpc({ port: 1, timeoutMs: 100 })
  await assert.rejects(unreachable.call('aria2.getVersion'), error => error.code === 'RPC_UNREACHABLE')
})

test('打开目录使用 explorer 参数数组且不经过 shell', async () => {
  const calls = []
  const fakeRpc = { call: async () => task('a'.repeat(16), 'complete') }
  const { service } = serviceFor(null, {
    rpcFactory: () => fakeRpc,
    platform: 'win32',
    fileExists: () => true,
    spawnProcess: (command, args, options) => { calls.push({ command, args, options }); return { unref() {} } },
  })
  await service.reveal({ gid: 'a'.repeat(16) })
  assert.equal(calls[0].command, 'explorer.exe')
  assert.deepEqual(calls[0].args, ['/select,', `C:\\Downloads\\${'a'.repeat(16)}.zip`])
  assert.equal(calls[0].options.shell, false)
})

test('normalizeTask 优先使用 BT 名称并清理控制字符', () => {
  const normalized = normalizeTask(task('a'.repeat(16), 'active', {
    bittorrent: { info: { name: '示例\u0000任务' }, fileSelectionState: 'ready' },
  }))
  assert.equal(normalized.name, '示例 任务')
  assert.equal(normalized.kind, 'bittorrent')
  assert.equal(normalized.selectionRequired, true)
  assert.ok(new PluginError('TEST', 'x') instanceof Error)
})
