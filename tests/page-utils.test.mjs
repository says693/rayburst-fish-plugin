import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const context = { console }
vm.createContext(context)
vm.runInContext(fs.readFileSync(new URL('../page-utils.js', import.meta.url), 'utf8'), context)
const utils = context.RayburstUtils

test('字节、速度与进度格式化覆盖零值和未知大小', () => {
  assert.equal(utils.bytes(0), '0 B')
  assert.equal(utils.bytes(1024), '1.00 KB')
  assert.equal(utils.bytes(1048576), '1.00 MB')
  assert.equal(utils.speed(2048), '2.00 KB/s')
  assert.equal(utils.progress({ totalLength: 200, completedLength: 50 }), 25)
  assert.equal(utils.progress({ totalLength: 0, completedLength: 0, status: 'complete' }), 100)
  assert.equal(utils.progress({ totalLength: 100, completedLength: 500 }), 100)
})

test('ETA 仅在活动任务有速度与剩余大小时显示', () => {
  assert.equal(utils.eta({ status: 'active', totalLength: 1000, completedLength: 0, downloadSpeed: 10 }), '1分 40秒')
  assert.equal(utils.eta({ status: 'paused', totalLength: 1000, completedLength: 0, downloadSpeed: 10 }), '')
  assert.equal(utils.eta({ status: 'active', totalLength: 1000, completedLength: 1000, downloadSpeed: 10 }), '')
})

test('任务筛选组合状态、文件名、GID 与目录', () => {
  const tasks = [
    { gid: 'aaa', name: '系统镜像.iso', status: 'active', dir: 'D:\\ISO' },
    { gid: 'bbb', name: '季度报告.pdf', status: 'paused', dir: 'D:\\Docs' },
    { gid: 'ccc', name: '旧文件.zip', status: 'complete', dir: 'D:\\Archive' },
  ]
  assert.deepEqual(utils.filterTasks(tasks, 'waiting', '').map(row => row.gid), ['bbb'])
  assert.deepEqual(utils.filterTasks(tasks, 'all', '报告').map(row => row.gid), ['bbb'])
  assert.deepEqual(utils.filterTasks(tasks, 'all', 'docs').map(row => row.gid), ['bbb'])
  assert.deepEqual(utils.filterTasks(tasks, 'complete', '').map(row => row.gid), ['ccc'])
})

test('稳定错误码映射为可执行的中文提示', () => {
  assert.match(utils.errorMessage({ code: 'RPC_AUTH' }), /密钥/)
  assert.match(utils.errorMessage({ code: 'SELECTION_REQUIRED' }), /选择文件/)
  assert.equal(utils.errorMessage({ message: '自定义错误' }), '自定义错误')
})
