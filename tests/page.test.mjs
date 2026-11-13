import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const html = fs.readFileSync(new URL('../page.html', import.meta.url), 'utf8')
const utils = fs.readFileSync(new URL('../page-utils.js', import.meta.url), 'utf8')
const script = fs.readFileSync(new URL('../page.js', import.meta.url), 'utf8')
const gid = letter => letter.repeat(16)

function snapshot() {
  return {
    connected: true,
    fetchedAt: Date.now(),
    engine: { product: 'aria2-next', version: '1.37.0', rpcVersion: 4 },
    stat: { downloadSpeed: 2048, uploadSpeed: 128, numActive: 1, numWaiting: 1, numStopped: 1, numStoppedTotal: 1 },
    truncated: { waiting: false, stopped: false },
    tasks: [
      { gid: gid('a'), name: '系统镜像.iso', status: 'active', totalLength: 2048, completedLength: 1024, downloadSpeed: 2048, uploadSpeed: 0, connections: 4, dir: 'D:\\ISO', filePath: 'D:\\ISO\\系统镜像.iso' },
      { gid: gid('b'), name: '季度报告.pdf', status: 'paused', totalLength: 100, completedLength: 20, downloadSpeed: 0, uploadSpeed: 0, connections: 0, dir: 'D:\\Docs', filePath: '' },
      { gid: gid('c'), name: '旧文件.zip', status: 'complete', totalLength: 100, completedLength: 100, downloadSpeed: 0, uploadSpeed: 0, connections: 0, dir: 'D:\\Archive', filePath: 'D:\\Archive\\旧文件.zip' },
    ],
  }
}

async function waitFor(predicate, message = '页面状态未就绪') {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}

async function fixture(t) {
  const dom = new JSDOM(html, { url: 'https://says693.rayburst/downloads/page.html', runScripts: 'outside-only', pretendToBeVisual: true })
  const calls = []
  const fishDock = {
    setLayout() {},
    call: async (method, params) => {
      calls.push({ method, params })
      if (method === 'rayburst.settings') return { port: 29100, pollMs: 10000, hasSecret: true }
      if (method === 'rayburst.saveSettings') return { port: params.port, pollMs: params.pollMs, hasSecret: true }
      if (method === 'rayburst.snapshot') return snapshot()
      if (method === 'rayburst.test') return { ok: true, product: 'aria2-next', version: '1.37.0' }
      if (method === 'rayburst.add') return { added: params.urls.length, failed: 0, results: params.urls.map((url, index) => ({ index, ok: true, gid: gid('d') })) }
      if (method === 'rayburst.pauseAll') return { ok: true }
      if (method === 'rayburst.resumeAll') return { resumed: 1, failed: 0, blocked: 0 }
      return { ok: true }
    },
  }
  Object.defineProperty(dom.window, 'FishDock', { value: fishDock })
  dom.window.eval(utils)
  dom.window.eval(script)
  await waitFor(() => dom.window.document.querySelectorAll('.task').length === 3)
  t.after(() => dom.window.close())
  return { dom, calls, document: dom.window.document }
}

test('页面渲染真实统计、任务与引擎信息，密钥不回显', async t => {
  const { document } = await fixture(t)
  assert.equal(document.getElementById('down-speed').textContent, '2.00 KB/s')
  assert.equal(document.querySelectorAll('.task').length, 3)
  assert.match(document.getElementById('engine-version').textContent, /aria2-next 1.37.0/)
  assert.equal(document.getElementById('secret').value, '')
  assert.match(document.getElementById('secret-state').textContent, /留空保持不变/)
})

test('状态筛选和文件名搜索只操作本地视图', async t => {
  const { document, calls } = await fixture(t)
  const before = calls.length
  document.getElementById('filter').value = 'waiting'
  document.getElementById('filter').dispatchEvent(new document.defaultView.Event('change'))
  assert.equal(document.querySelectorAll('.task').length, 1)
  assert.match(document.querySelector('.task h3').textContent, /季度报告/)
  document.getElementById('filter').value = 'all'
  document.getElementById('filter').dispatchEvent(new document.defaultView.Event('change'))
  document.getElementById('search').value = '旧文件'
  document.getElementById('search').dispatchEvent(new document.defaultView.Event('input'))
  assert.equal(document.querySelectorAll('.task').length, 1)
  assert.equal(calls.length, before)
})

test('移除任务必须二次确认，调用不包含删除文件参数', async t => {
  const { document, calls } = await fixture(t)
  const selector = `[data-gid="${gid('a')}"] [data-action="remove"]`
  document.querySelector(selector).click()
  assert.equal(calls.some(row => row.method === 'rayburst.action'), false)
  const confirm = document.querySelector(selector)
  assert.equal(confirm.textContent, '确认移除')
  confirm.click()
  await waitFor(() => calls.some(row => row.method === 'rayburst.action'))
  const action = calls.find(row => row.method === 'rayburst.action')
  assert.deepEqual(JSON.parse(JSON.stringify(action.params)), { gid: gid('a'), action: 'remove' })
  assert.equal(Object.hasOwn(action.params, 'deleteFiles'), false)
  await waitFor(() => document.getElementById('status').textContent.includes('文件未删除'))
})

test('添加下载发送逐行链接并在成功后清空表单', async t => {
  const { document, calls } = await fixture(t)
  document.getElementById('add-toggle').click()
  document.getElementById('urls').value = 'https://example.com/a.zip\nhttps://example.com/b.zip'
  document.getElementById('add-panel').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }))
  await waitFor(() => calls.some(row => row.method === 'rayburst.add'))
  const added = calls.find(row => row.method === 'rayburst.add')
  assert.deepEqual(JSON.parse(JSON.stringify(added.params.urls)), ['https://example.com/a.zip', 'https://example.com/b.zip'])
  await waitFor(() => document.getElementById('status').textContent === '已添加 2 个下载任务')
  assert.equal(document.getElementById('add-panel').hidden, true)
})

test('保存设置发送端口与刷新间隔，空密钥表示保留', async t => {
  const { document, calls } = await fixture(t)
  document.getElementById('settings-toggle').click()
  await waitFor(() => !document.getElementById('settings-panel').hidden)
  document.getElementById('port').value = '29102'
  document.getElementById('poll').value = '5000'
  document.getElementById('secret').value = ''
  document.getElementById('settings-panel').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }))
  await waitFor(() => calls.some(row => row.method === 'rayburst.saveSettings'))
  const saved = calls.find(row => row.method === 'rayburst.saveSettings')
  assert.deepEqual(JSON.parse(JSON.stringify(saved.params)), { port: 29102, pollMs: 5000, secret: '', clearSecret: false })
  assert.equal(document.getElementById('secret').value, '')
  await waitFor(() => document.getElementById('status').textContent === '连接设置已保存')
})
