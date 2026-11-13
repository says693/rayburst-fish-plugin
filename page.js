const $ = id => document.getElementById(id)
const utils = globalThis.RayburstUtils
const state = {
  snapshot: null,
  filter: 'all',
  query: '',
  pollMs: 2500,
  port: 29100,
  hasSecret: false,
  refreshing: false,
  connectionError: false,
  busy: false,
  pendingRemove: '',
  removeTimer: null,
  refreshTimer: null,
  busyControl: null,
}

function setStatus(tone, message) {
  $('status').dataset.tone = tone
  $('status').setAttribute('role', tone === 'bad' ? 'alert' : 'status')
  $('status').textContent = message
}

function setConnection(connected, label) {
  $('connection').dataset.tone = connected ? 'ok' : 'bad'
  const dot = document.createElement('span')
  dot.setAttribute('aria-hidden', 'true')
  $('connection').replaceChildren(dot, document.createTextNode(label))
}

function setBusy(busy) {
  state.busy = busy
  $('status').setAttribute('aria-busy', String(busy))
  if (busy && document.activeElement?.tagName === 'BUTTON') {
    const button = document.activeElement
    state.busyControl = { button, label: button.textContent, title: button.title }
    button.disabled = true
    button.title = '正在处理当前操作'
    button.textContent = '处理中…'
  } else if (!busy && state.busyControl) {
    const { button, label, title } = state.busyControl
    button.disabled = false
    button.title = title
    button.textContent = label
    state.busyControl = null
  }
}

function element(tag, className, content) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

function actionButton(action, label, danger = false) {
  const button = element('button', danger ? 'danger' : '', label)
  button.type = 'button'
  button.dataset.action = action
  return button
}

function renderTask(task) {
  const article = element('article', 'task')
  article.dataset.gid = task.gid
  article.dataset.status = task.status

  const top = element('div', 'task-top')
  const title = element('div', 'task-title')
  title.append(element('h3', '', task.name))
  if (task.selectionRequired) title.append(element('p', 'muted', '需要先在 Rayburst 中选择种子文件'))
  const badge = element('span', 'status', utils.statusLabel(task.status))
  badge.dataset.status = task.status
  top.append(title, badge)

  const progress = document.createElement('progress')
  progress.max = 100
  progress.value = utils.progress(task)
  progress.setAttribute('aria-label', `下载进度 ${Math.round(utils.progress(task))}%`)

  const meta = element('div', 'task-meta')
  const total = task.totalLength > 0 ? utils.bytes(task.totalLength) : '大小未知'
  meta.append(element('span', '', `${utils.bytes(task.completedLength)} / ${total}`))
  if (task.status === 'active' || task.downloadSpeed > 0) meta.append(element('span', '', `↓ ${utils.speed(task.downloadSpeed)}`))
  if (task.uploadSpeed > 0) meta.append(element('span', '', `↑ ${utils.speed(task.uploadSpeed)}`))
  if (task.connections > 0) meta.append(element('span', '', `${task.connections} 连接`))
  const eta = utils.eta(task)
  if (eta) meta.append(element('span', '', `剩余 ${eta}`))
  if (task.dir) meta.append(element('span', '', task.dir))
  article.append(top, progress, meta)

  if (task.errorMessage) article.append(element('p', 'task-error', task.errorMessage))
  const actions = element('div', 'task-actions')
  if (['active', 'waiting'].includes(task.status)) actions.append(actionButton('pause', '暂停'))
  if (task.status === 'paused') actions.append(actionButton('resume', task.selectionRequired ? '检查并恢复' : '恢复'))
  if (task.filePath || task.dir) actions.append(actionButton('reveal', '打开所在文件夹'))
  actions.append(actionButton('remove', state.pendingRemove === task.gid ? '确认移除' : '移除', state.pendingRemove === task.gid))
  article.append(actions)
  return article
}

function render() {
  const snapshot = state.snapshot
  if (!snapshot) return
  $('down-speed').textContent = utils.speed(snapshot.stat.downloadSpeed)
  $('up-speed').textContent = utils.speed(snapshot.stat.uploadSpeed)
  $('active-count').textContent = String(snapshot.stat.numActive)
  $('waiting-count').textContent = String(snapshot.stat.numWaiting)
  $('engine-version').textContent = `${snapshot.engine.product} ${snapshot.engine.version} · RPC ${snapshot.engine.rpcVersion || '—'} · 端口 ${state.port}`
  $('poll-label').textContent = String(state.pollMs / 1000)
  const tasks = utils.filterTasks(snapshot.tasks, state.filter, state.query)
  const focused = document.activeElement
  const focusedGid = focused?.closest('[data-gid]')?.dataset.gid
  const focusedAction = focused?.dataset.action
  $('tasks').replaceChildren(...tasks.map(renderTask))
  if (focusedGid && focusedAction) {
    const replacement = [...$('tasks').querySelectorAll('button[data-action]')].find(button =>
      button.dataset.action === focusedAction && button.closest('[data-gid]').dataset.gid === focusedGid)
    replacement?.focus()
  }
  $('empty').hidden = tasks.length > 0
  $('task-count').textContent = tasks.length === snapshot.tasks.length ? `${tasks.length} 条` : `${tasks.length} / ${snapshot.tasks.length} 条`
  $('truncated').hidden = !snapshot.truncated.waiting && !snapshot.truncated.stopped
}

async function refresh(silent = false) {
  if (state.refreshing) return
  state.refreshing = true
  if (!silent) setStatus('busy', '正在读取 Rayburst 任务…')
  try {
    state.snapshot = await FishDock.call('rayburst.snapshot', {})
    render()
    setConnection(true, '已连接')
    if (!silent || state.connectionError) setStatus('ok', '已连接，任务列表已更新')
    state.connectionError = false
  } catch (error) {
    setConnection(false, '连接失败')
    state.connectionError = true
    setStatus('bad', `${utils.errorMessage(error)}${state.snapshot ? '；当前列表可能已过期，请检查连接后重试' : ''}`)
    throw error
  } finally {
    state.refreshing = false
  }
}

async function run(operation) {
  if (state.busy) {
    setStatus('busy', '请等待当前操作完成后重试')
    return false
  }
  setBusy(true)
  setStatus('busy', '正在处理…')
  try {
    const message = await operation()
    if (message) setStatus('ok', message)
    return true
  } catch (error) {
    setStatus('bad', utils.errorMessage(error))
    return false
  } finally {
    setBusy(false)
  }
}

function clearPendingRemove() {
  state.pendingRemove = ''
  if (state.removeTimer) clearTimeout(state.removeTimer)
  state.removeTimer = null
  if (state.snapshot) render()
}

function toggleAdd(open) {
  $('add-panel').hidden = !open
  $('add-toggle').setAttribute('aria-expanded', String(open))
  if (open) {
    $('settings-panel').hidden = true
    $('settings-toggle').setAttribute('aria-expanded', 'false')
    $('urls').focus()
  }
}

function toggleSettings(open) {
  $('settings-panel').hidden = !open
  $('settings-toggle').setAttribute('aria-expanded', String(open))
  if (open) {
    toggleAdd(false)
    $('port').focus()
  }
}

async function loadSettings() {
  const settings = await FishDock.call('rayburst.settings', {})
  state.port = settings.port
  state.pollMs = settings.pollMs
  state.hasSecret = settings.hasSecret
  $('port').value = String(settings.port)
  $('poll').value = String(settings.pollMs)
  $('secret').value = ''
  $('clear-secret').checked = false
  $('secret-state').textContent = settings.hasSecret ? '已保存密钥；留空保持不变' : '尚未保存密钥'
  $('poll-label').textContent = String(settings.pollMs / 1000)
  return settings
}

async function saveSettings() {
  const settings = await FishDock.call('rayburst.saveSettings', {
    port: Number($('port').value),
    pollMs: Number($('poll').value),
    secret: $('secret').value,
    clearSecret: $('clear-secret').checked,
  })
  await loadSettings()
  return settings
}

$('add-toggle').onclick = () => toggleAdd($('add-panel').hidden)
$('add-cancel').onclick = () => toggleAdd(false)
$('settings-toggle').onclick = () => run(async () => {
  const open = $('settings-panel').hidden
  if (open) await loadSettings()
  toggleSettings(open)
  return open ? '连接设置已读取' : '连接设置已收起'
})

$('refresh').onclick = () => run(async () => {
  await refresh(true)
  return '任务列表已更新'
})

$('filter').onchange = () => { state.filter = $('filter').value; render() }
$('search').oninput = () => { state.query = $('search').value; render() }

$('add-panel').addEventListener('submit', event => {
  event.preventDefault()
  void run(async () => {
    const links = $('urls').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    const result = await FishDock.call('rayburst.add', { urls: links, filename: $('filename').value })
    if (result.failed) {
      const failed = result.results.filter(row => !row.ok)
      $('urls').value = failed.map(row => links[row.index]).join('\n')
      setStatus('bad', `已添加 ${result.added} 个，失败 ${result.failed} 个：${failed[0].message}`)
    } else {
      $('urls').value = ''
      $('filename').value = ''
      toggleAdd(false)
    }
    await refresh(true)
    return result.failed ? '' : `已添加 ${result.added} 个下载任务`
  })
})

$('settings-panel').addEventListener('submit', event => {
  event.preventDefault()
  void run(async () => {
    await saveSettings()
    await refresh(true)
    scheduleRefresh()
    return '连接设置已保存'
  })
})

$('test-connection').onclick = () => run(async () => {
  await saveSettings()
  scheduleRefresh()
  const result = await FishDock.call('rayburst.test', {})
  await refresh(true)
  return `连接成功：${result.product} ${result.version}`
})

$('pause-all').onclick = () => run(async () => {
  await FishDock.call('rayburst.pauseAll', {})
  await refresh(true)
  return '已暂停全部下载任务'
})

$('resume-all').onclick = () => run(async () => {
  const result = await FishDock.call('rayburst.resumeAll', {})
  await refresh(true)
  const parts = [`已恢复 ${result.resumed} 个任务`]
  if (result.blocked) parts.push(`${result.blocked} 个需在 Rayburst 中选择文件`)
  if (result.failed) parts.push(`${result.failed} 个恢复失败`)
  return parts.join('，')
})

$('tasks').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]')
  if (!button || state.busy) return
  const taskElement = button.closest('[data-gid]')
  const gid = taskElement?.dataset.gid
  const action = button.dataset.action
  if (!gid) return
  if (action === 'remove' && state.pendingRemove !== gid) {
    clearPendingRemove()
    state.pendingRemove = gid
    render()
    ;[...$('tasks').querySelectorAll('button[data-action=remove]')].find(item => item.closest('[data-gid]').dataset.gid === gid)?.focus()
    setStatus('busy', '再次点击「确认移除」只会移除任务记录，不会删除文件')
    state.removeTimer = setTimeout(clearPendingRemove, 5000)
    return
  }
  void run(async () => {
    if (action === 'reveal') {
      await FishDock.call('rayburst.reveal', { gid })
      return '已打开所在文件夹'
    }
    await FishDock.call('rayburst.action', { gid, action })
    clearPendingRemove()
    await refresh(true)
    return action === 'pause' ? '任务已暂停' : action === 'resume' ? '任务已恢复' : '任务记录已移除，文件未删除'
  })
})

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !state.pendingRemove) return
  const gid = state.pendingRemove
  clearPendingRemove()
  ;[...$('tasks').querySelectorAll('button[data-action=remove]')].find(item => item.closest('[data-gid]').dataset.gid === gid)?.focus()
  setStatus('idle', '已取消移除')
})

function scheduleRefresh() {
  if (state.refreshTimer) clearTimeout(state.refreshTimer)
  state.refreshTimer = setTimeout(async () => {
    if (!document.hidden && !state.busy) {
      try { await refresh(true) } catch { /* 连接徽标与错误状态已由 refresh 更新 */ }
    }
    scheduleRefresh()
  }, state.pollMs)
}

window.addEventListener('pagehide', () => {
  if (state.refreshTimer) clearTimeout(state.refreshTimer)
  if (state.removeTimer) clearTimeout(state.removeTimer)
})

void (async () => {
  try {
    await loadSettings()
    await refresh(false)
  } catch (error) {
    if (!state.snapshot) setStatus('bad', utils.errorMessage(error))
  } finally {
    scheduleRefresh()
  }
})()
