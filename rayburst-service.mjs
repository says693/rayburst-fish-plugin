import http from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

export const DEFAULT_PORT = 29100
export const DEFAULT_POLL_MS = 2500
const MAX_RPC_BYTES = 8 * 1024 * 1024
const MAX_LINKS = 20
const ACTIVE_LIMIT = 100
const WAITING_LIMIT = 100
const STOPPED_LIMIT = 30
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'ftp:', 'sftp:', 'magnet:', 'ed2k:', 'thunder:'])
const FINISHED_STATES = new Set(['complete', 'error', 'removed'])

export class PluginError extends Error {
  constructor(code, message) {
    super(String(message).slice(0, 200))
    this.name = 'PluginError'
    this.code = code
  }
}

const fail = (code, message) => { throw new PluginError(code, message) }
const text = (value, max = 300) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const number = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
const basename = value => String(value ?? '').split(/[\\/]/).filter(Boolean).pop() || ''

export function validatePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('INVALID_CONFIG', 'RPC 端口必须是 1–65535 的整数')
  return port
}

export function validatePollMs(value) {
  const pollMs = Number(value)
  if (!Number.isInteger(pollMs) || pollMs < 1000 || pollMs > 10000) fail('INVALID_CONFIG', '刷新间隔必须是 1000–10000 毫秒')
  return pollMs
}

export function validateGid(value) {
  const gid = String(value ?? '')
  if (!/^[a-f\d]{8,32}$/i.test(gid)) fail('INVALID_GID', '任务 GID 格式无效')
  return gid.toLowerCase()
}

export function validateFilename(value) {
  const name = String(value ?? '').trim()
  if (!name) return ''
  const stem = name.split('.')[0].toUpperCase()
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)
  if (name.length > 240 || name === '.' || name === '..' || reserved || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /[. ]$/.test(name)) {
    fail('INVALID_FILENAME', '文件名不能为空路径、保留名称或包含 \\ / : * ? " < > | 等字符')
  }
  return name
}

export function parseDownloadLinks(input) {
  const source = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/)
  const links = source.map(value => String(value).trim()).filter(Boolean)
  if (!links.length) fail('INVALID_URL', '请至少输入一个下载链接')
  if (links.length > MAX_LINKS) fail('TOO_MANY_LINKS', `每次最多添加 ${MAX_LINKS} 个下载链接`)
  return links.map(link => {
    if (link.length > 8192) fail('INVALID_URL', '单个下载链接不能超过 8192 个字符')
    const protocol = `${/^([a-z][a-z\d+.-]*):/i.exec(link)?.[1] || ''}:`.toLowerCase()
    if (!ALLOWED_SCHEMES.has(protocol)) fail('UNSUPPORTED_SCHEME', `不支持 ${protocol || '未知'} 协议`)
    // ED2K 的竖线分段格式不是标准 URL；Rayburst 与引擎按原始字符串接收它。
    if (['ed2k:', 'thunder:'].includes(protocol)) {
      if (!link.toLowerCase().startsWith(`${protocol}//`) || link.length <= protocol.length + 2 || /[\u0000-\u001f\u007f]/.test(link)) fail('INVALID_URL', 'ED2K 或迅雷链接格式无效')
      return link
    }
    if (/\s/.test(link)) fail('INVALID_URL', '下载链接不能包含未编码的空白字符')
    let parsed
    try { parsed = new URL(link) } catch { fail('INVALID_URL', '存在无法识别的下载链接') }
    if (['http:', 'https:', 'ftp:', 'sftp:'].includes(protocol) && !parsed.hostname) fail('INVALID_URL', '下载链接缺少主机名')
    if (protocol === 'magnet:' && !parsed.searchParams.get('xt')) fail('INVALID_URL', '磁力链接缺少 xt 参数')
    return link
  })
}

function cleanMessage(value, secret = '') {
  let message = text(value || 'Rayburst 返回了未知错误', 180)
  if (secret) message = message.split(secret).join('[已隐藏]')
  return message
}

function rpcError(error, secret) {
  const code = Number(error?.code)
  const message = cleanMessage(error?.message, secret)
  if (code === 1 || /unauthori[sz]ed|token|secret/i.test(message)) return new PluginError('RPC_AUTH', 'RPC 密钥不正确，请检查 Rayburst 高级设置')
  if (code === -32601) return new PluginError('RPC_UNSUPPORTED', '当前 Rayburst 引擎不支持此操作')
  return new PluginError('RPC_ERROR', `Rayburst RPC：${message}`)
}

export class RayburstRpc {
  constructor({ port = DEFAULT_PORT, secret = '', timeoutMs = 5000 } = {}) {
    this.port = validatePort(port)
    this.secret = String(secret ?? '')
    this.timeoutMs = timeoutMs
    this.host = '127.0.0.1'
  }

  authorize(method, params) {
    if (!this.secret) return params
    const token = `token:${this.secret}`
    if (method === 'system.multicall') {
      return [params[0].map(call => ({ ...call, params: [token, ...(call.params || [])] }))]
    }
    return [token, ...params]
  }

  async call(method, params = []) {
    const id = randomUUID()
    const payload = { jsonrpc: '2.0', id, method, params: this.authorize(method, params) }
    const body = await this.request(payload)
    if (body.id !== id) fail('RPC_INVALID_RESPONSE', 'Rayburst 返回了不匹配的 RPC 响应')
    if (body.error) throw rpcError(body.error, this.secret)
    if (!Object.hasOwn(body, 'result')) fail('RPC_INVALID_RESPONSE', 'Rayburst RPC 响应缺少 result')
    return body.result
  }

  async multicall(calls) {
    const result = await this.call('system.multicall', [calls.map(call => ({ methodName: call.method, params: call.params || [] }))])
    if (!Array.isArray(result)) fail('RPC_INVALID_RESPONSE', 'Rayburst 批量响应格式无效')
    return result
  }

  request(payload) {
    const serialized = JSON.stringify(payload)
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve(value)
      }
      const request = http.request({
        hostname: this.host,
        port: this.port,
        path: '/jsonrpc',
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized), accept: 'application/json' },
      }, response => {
        if (response.statusCode === 401 || response.statusCode === 403) {
          response.resume()
          finish(new PluginError('RPC_AUTH', 'Rayburst 拒绝了 RPC 密钥'))
          return
        }
        if (response.statusCode !== 200) {
          response.resume()
          finish(new PluginError('RPC_HTTP', `Rayburst RPC 返回 HTTP ${response.statusCode}`))
          return
        }
        const chunks = []
        let size = 0
        response.on('data', chunk => {
          size += chunk.length
          if (size > MAX_RPC_BYTES) {
            request.destroy()
            finish(new PluginError('RPC_TOO_LARGE', 'Rayburst RPC 响应超过 8 MiB 限制'))
            return
          }
          chunks.push(chunk)
        })
        response.on('error', () => finish(new PluginError('RPC_UNREACHABLE', '读取 Rayburst RPC 响应失败')))
        response.on('end', () => {
          if (settled) return
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
            finish(null, parsed)
          } catch {
            finish(new PluginError('RPC_INVALID_RESPONSE', 'Rayburst 返回了无效 JSON'))
          }
        })
      })
      request.setTimeout(this.timeoutMs, () => request.destroy(new PluginError('RPC_TIMEOUT', '连接 Rayburst 超时，请确认应用正在运行')))
      request.on('error', error => {
        if (error instanceof PluginError) finish(error)
        else finish(new PluginError('RPC_UNREACHABLE', '未连接到 Rayburst，请启动应用并核对 RPC 端口'))
      })
      request.end(serialized)
    })
  }
}

function unwrap(row, secret) {
  if (row && !Array.isArray(row) && typeof row === 'object' && row.code !== undefined) throw rpcError(row, secret)
  if (!Array.isArray(row) || row.length !== 1) fail('RPC_INVALID_RESPONSE', 'Rayburst 批量响应缺少结果')
  return row[0]
}

export function normalizeTask(task) {
  const files = Array.isArray(task?.files) ? task.files : []
  const firstFile = files.find(file => file?.path) || files[0] || {}
  const btName = task?.bittorrent?.info?.name
  let name = text(btName || basename(firstFile.path), 300)
  if (!name && Array.isArray(firstFile.uris) && firstFile.uris[0]?.uri) {
    try { name = text(decodeURIComponent(basename(new URL(firstFile.uris[0].uri).pathname)), 300) } catch { /* 下方使用兜底名 */ }
  }
  return {
    gid: text(task?.gid, 40),
    name: name || '未命名下载',
    status: text(task?.status || 'unknown', 20),
    totalLength: number(task?.totalLength),
    completedLength: number(task?.completedLength),
    uploadLength: number(task?.uploadLength),
    downloadSpeed: number(task?.downloadSpeed),
    uploadSpeed: number(task?.uploadSpeed),
    connections: number(task?.connections),
    dir: text(task?.dir, 512),
    filePath: text(firstFile?.path, 1024),
    kind: task?.bittorrent ? 'bittorrent' : task?.ed2k ? 'ed2k' : 'uri',
    selectionRequired: ['awaiting', 'ready'].includes(task?.bittorrent?.fileSelectionState),
    errorCode: text(task?.errorCode, 20),
    errorMessage: text(task?.errorMessage, 240),
  }
}

function normalizeStat(stat) {
  return {
    downloadSpeed: number(stat?.downloadSpeed),
    uploadSpeed: number(stat?.uploadSpeed),
    numActive: number(stat?.numActive),
    numWaiting: number(stat?.numWaiting),
    numStopped: number(stat?.numStopped),
    numStoppedTotal: number(stat?.numStoppedTotal),
  }
}

async function readOptional(storage, category, name) {
  const value = await storage.read(category, name)
  return value === null || value === undefined ? null : String(value)
}

export class RayburstService {
  constructor(context, {
    rpcFactory = config => new RayburstRpc(config),
    platform = process.platform,
    spawnProcess = spawn,
    fileExists = fs.existsSync,
  } = {}) {
    this.context = context
    this.rpcFactory = rpcFactory
    this.platform = platform
    this.spawnProcess = spawnProcess
    this.fileExists = fileExists
  }

  async connection() {
    let config = {}
    const raw = await readOptional(this.context.storage, 'config', 'settings.json')
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
        config = parsed
      } catch { fail('INVALID_CONFIG', '保存的插件配置损坏，请重新保存连接设置') }
    }
    const secret = await this.context.secrets.read('credentials', 'rpc-secret')
    return {
      port: config.port === undefined ? DEFAULT_PORT : validatePort(config.port),
      pollMs: config.pollMs === undefined ? DEFAULT_POLL_MS : validatePollMs(config.pollMs),
      secret: secret === null || secret === undefined ? '' : String(secret),
    }
  }

  async rpc() {
    const { port, secret } = await this.connection()
    return this.rpcFactory({ port, secret })
  }

  async settings() {
    const { port, pollMs, secret } = await this.connection()
    return { port, pollMs, hasSecret: secret.length > 0 }
  }

  async saveSettings(input = {}) {
    const previous = await this.connection()
    const port = input.port === undefined ? previous.port : validatePort(input.port)
    const pollMs = input.pollMs === undefined ? previous.pollMs : validatePollMs(input.pollMs)
    let secret = previous.secret
    if (input.clearSecret === true) secret = ''
    else if (input.secret !== undefined && String(input.secret) !== '') {
      secret = String(input.secret)
      if (secret.length > 1024 || /[\u0000-\u001f]/.test(secret)) fail('INVALID_CONFIG', 'RPC 密钥最长 1024 字符且不能包含控制字符')
    }
    await this.context.secrets.write('credentials', 'rpc-secret', secret)
    await this.context.storage.write('config', 'settings.json', JSON.stringify({ port, pollMs }))
    return { port, pollMs, hasSecret: secret.length > 0 }
  }

  async testConnection() {
    const rpc = await this.rpc()
    const version = await rpc.call('aria2.getVersion')
    return {
      ok: true,
      version: text(version?.version || '未知', 60),
      product: text(version?.product || 'aria2', 60),
      rpcVersion: number(version?.rpcVersion),
      enabledFeatures: Array.isArray(version?.enabledFeatures) ? version.enabledFeatures.length : 0,
    }
  }

  async snapshot() {
    const rpc = await this.rpc()
    const rows = await rpc.multicall([
      { method: 'aria2.getVersion', params: [] },
      { method: 'aria2.getGlobalStat', params: [] },
      { method: 'aria2.tellActive', params: [] },
      { method: 'aria2.tellWaiting', params: [0, WAITING_LIMIT] },
      { method: 'aria2.tellStopped', params: [0, STOPPED_LIMIT] },
    ])
    if (rows.length !== 5) fail('RPC_INVALID_RESPONSE', 'Rayburst 任务快照不完整')
    const [version, stat, active, waiting, stopped] = rows.map(row => unwrap(row, rpc.secret))
    if (![active, waiting, stopped].every(Array.isArray)) fail('RPC_INVALID_RESPONSE', 'Rayburst 任务列表格式无效')
    const seen = new Set()
    const tasks = [...active, ...waiting, ...stopped]
      .filter(task => {
        const gid = String(task?.gid ?? '')
        if (!gid || seen.has(gid)) return false
        seen.add(gid)
        return true
      })
      .map(normalizeTask)
    const snapshot = {
      connected: true,
      fetchedAt: Date.now(),
      engine: {
        version: text(version?.version || '未知', 60),
        product: text(version?.product || 'aria2', 60),
        rpcVersion: number(version?.rpcVersion),
      },
      stat: normalizeStat(stat),
      tasks,
      truncated: { waiting: waiting.length >= WAITING_LIMIT, stopped: stopped.length >= STOPPED_LIMIT },
    }
    // 宿主页面的单条业务响应上限为 1 MiB；为 JSON 帧包装预留余量。
    while (Buffer.byteLength(JSON.stringify(snapshot)) > 850_000 && snapshot.tasks.length > 1) {
      const dropped = snapshot.tasks.pop()
      if (FINISHED_STATES.has(dropped.status)) snapshot.truncated.stopped = true
      else snapshot.truncated.waiting = true
    }
    return snapshot
  }

  async add(input = {}) {
    const links = parseDownloadLinks(input.urls ?? input.text)
    const filename = validateFilename(input.filename)
    if (filename && links.length !== 1) fail('INVALID_FILENAME', '只有单个下载链接可以指定文件名')
    if (filename && !['http:', 'https:', 'ftp:', 'sftp:'].includes(new URL(links[0]).protocol.toLowerCase())) {
      fail('INVALID_FILENAME', '磁力、ED2K 和迅雷链接不支持在这里指定文件名')
    }
    const rpc = await this.rpc()
    const options = filename ? { out: filename } : {}
    const rows = await rpc.multicall(links.map(link => ({ method: 'aria2.addUri', params: [[link], options] })))
    if (rows.length !== links.length) fail('RPC_INVALID_RESPONSE', 'Rayburst 添加任务的响应数量不一致')
    const results = rows.map((row, index) => {
      if (row && !Array.isArray(row) && typeof row === 'object' && row.code !== undefined) {
        const error = rpcError(row, rpc.secret)
        return { index, ok: false, code: error.code, message: error.message }
      }
      try {
        const gid = text(unwrap(row, rpc.secret), 40)
        validateGid(gid)
        return { index, ok: true, gid }
      } catch {
        return { index, ok: false, code: 'RPC_INVALID_RESPONSE', message: 'Rayburst 未返回有效任务 GID' }
      }
    })
    return { added: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length, results }
  }

  async action(input = {}) {
    const gid = validateGid(input.gid)
    const action = text(input.action, 20)
    const rpc = await this.rpc()
    if (action === 'pause') {
      await rpc.call('aria2.forcePause', [gid])
      return { ok: true, gid, action }
    }
    if (action === 'resume') {
      const task = await rpc.call('aria2.tellStatus', [gid])
      if (['awaiting', 'ready'].includes(task?.bittorrent?.fileSelectionState)) fail('SELECTION_REQUIRED', '请先在 Rayburst 中完成种子文件选择')
      await rpc.call('aria2.unpause', [gid])
      return { ok: true, gid, action }
    }
    if (action === 'remove') {
      const task = await rpc.call('aria2.tellStatus', [gid])
      const method = FINISHED_STATES.has(task?.status) ? 'aria2.removeDownloadResult' : 'aria2.forceRemove'
      await rpc.call(method, [gid])
      return { ok: true, gid, action, filesDeleted: false }
    }
    fail('INVALID_ACTION', '不支持的任务操作')
  }

  async pauseAll() {
    const rpc = await this.rpc()
    await rpc.call('aria2.forcePauseAll')
    return { ok: true }
  }

  async resumeAll() {
    const rpc = await this.rpc()
    const waiting = await rpc.call('aria2.tellWaiting', [0, 500])
    if (!Array.isArray(waiting)) fail('RPC_INVALID_RESPONSE', 'Rayburst 等待队列格式无效')
    const paused = waiting.filter(task => task?.status === 'paused')
    const blocked = paused.filter(task => ['awaiting', 'ready'].includes(task?.bittorrent?.fileSelectionState)).length
    const eligible = paused.filter(task => !['awaiting', 'ready'].includes(task?.bittorrent?.fileSelectionState))
    if (!eligible.length) return { resumed: 0, failed: 0, blocked }
    const rows = await rpc.multicall(eligible.map(task => ({ method: 'aria2.unpause', params: [validateGid(task.gid)] })))
    let resumed = 0
    for (const row of rows) {
      try { unwrap(row, rpc.secret); resumed += 1 } catch { /* 汇总失败数量，保留其他任务的成功结果 */ }
    }
    return { resumed, failed: rows.length - resumed, blocked }
  }

  async reveal(input = {}) {
    const gid = validateGid(input.gid)
    if (this.platform !== 'win32') fail('UNSUPPORTED_PLATFORM', '打开所在文件夹仅支持 Windows')
    const rpc = await this.rpc()
    const task = await rpc.call('aria2.tellStatus', [gid])
    const filePath = Array.isArray(task?.files) ? task.files.find(file => file?.path)?.path : ''
    const directory = text(task?.dir, 1024)
    const fileExists = filePath && this.fileExists(filePath)
    if (!fileExists && (!directory || !this.fileExists(directory))) fail('FILE_NOT_FOUND', '文件或下载目录尚不存在')
    const args = fileExists ? ['/select,', filePath] : [directory]
    const child = this.spawnProcess('explorer.exe', args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false })
    child.unref()
    return { ok: true }
  }
}
