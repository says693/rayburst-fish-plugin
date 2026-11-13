;(function (root) {
  const STATUS = {
    active: '下载中',
    waiting: '等待中',
    paused: '已暂停',
    complete: '已完成',
    error: '出错',
    removed: '已移除',
    unknown: '未知',
  }
  const ERRORS = {
    RPC_AUTH: 'RPC 密钥不正确，请打开连接设置重新填写。',
    RPC_UNREACHABLE: '未连接到 Rayburst，请启动应用并核对 RPC 端口。',
    RPC_TIMEOUT: '连接 Rayburst 超时，请确认应用正在运行。',
    RPC_UNSUPPORTED: '当前 Rayburst 版本不支持这个操作，请升级后重试。',
    INVALID_CONFIG: '连接设置无效，请检查端口和刷新间隔。',
    INVALID_URL: '下载链接无效，请检查协议与地址。',
    UNSUPPORTED_SCHEME: '仅支持 HTTP、HTTPS、FTP、SFTP、磁力、ED2K 和迅雷链接。',
    TOO_MANY_LINKS: '每次最多添加 20 个下载链接。',
    INVALID_FILENAME: '文件名无效；批量、磁力、ED2K 和迅雷任务不能指定文件名。',
    SELECTION_REQUIRED: '这个种子需要先选择文件，请在 Rayburst 中完成选择。',
    FILE_NOT_FOUND: '文件或下载目录尚不存在。',
    UNSUPPORTED_PLATFORM: '打开所在文件夹仅支持 Windows。',
    PLUGIN_OPERATION_FAILED: '插件操作失败，请检查连接设置后重试。',
  }
  function bytes(value) {
    let size = Number(value)
    if (!Number.isFinite(size) || size < 0) return '—'
    if (size === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
    size /= Math.pow(1024, index)
    const digits = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2
    return `${size.toFixed(digits)} ${units[index]}`
  }
  function speed(value) {
    const number = Number(value)
    return `${bytes(Number.isFinite(number) && number >= 0 ? number : 0)}/s`
  }
  function progress(task) {
    const total = Number(task?.totalLength) || 0
    const completed = Number(task?.completedLength) || 0
    if (total <= 0) return task?.status === 'complete' ? 100 : 0
    return Math.max(0, Math.min(100, completed / total * 100))
  }
  function eta(task) {
    const remaining = Math.max(0, (Number(task?.totalLength) || 0) - (Number(task?.completedLength) || 0))
    const rate = Number(task?.downloadSpeed) || 0
    if (!remaining || !rate || task?.status !== 'active') return ''
    const seconds = Math.ceil(remaining / rate)
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}时 ${Math.floor(seconds % 3600 / 60)}分`
    if (seconds >= 60) return `${Math.floor(seconds / 60)}分 ${seconds % 60}秒`
    return `${seconds}秒`
  }
  function statusLabel(status) {
    return STATUS[status] || STATUS.unknown
  }
  function filterTasks(tasks, filter, query) {
    const needle = String(query || '').trim().toLowerCase()
    return (Array.isArray(tasks) ? tasks : []).filter(task => {
      const statusMatch = filter === 'all'
        || (filter === 'waiting' && ['waiting', 'paused'].includes(task.status))
        || task.status === filter
      if (!statusMatch) return false
      if (!needle) return true
      return [task.name, task.gid, task.dir].some(value => String(value || '').toLowerCase().includes(needle))
    })
  }
  function errorMessage(error) {
    const code = String(error?.code || '')
    return ERRORS[code] || String(error?.message || '操作失败，请稍后重试。')
  }
  root.RayburstUtils = Object.freeze({ bytes, speed, progress, eta, statusLabel, filterTasks, errorMessage })
})(globalThis)
