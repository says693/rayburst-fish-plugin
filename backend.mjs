import { createPlugin } from './sdk/node/plugin.mjs'
import { PluginError, RayburstService } from './rayburst-service.mjs'

let service

function handle(operation) {
  return async params => {
    try {
      return await operation(params || {})
    } catch (error) {
      if (error instanceof PluginError) throw error
      throw new PluginError('PLUGIN_OPERATION_FAILED', '插件操作失败，请检查连接设置后重试')
    }
  }
}

createPlugin({
  id: 'says693.rayburst',
  activate(context) {
    service = new RayburstService(context)
  },
  deactivate() {
    service = null
  },
  commands: {
    'plugin.health': () => ({ ready: true }),
    'rayburst.settings': handle(() => service.settings()),
    'rayburst.saveSettings': handle(params => service.saveSettings(params)),
    'rayburst.test': handle(() => service.testConnection()),
    'rayburst.snapshot': handle(() => service.snapshot()),
    'rayburst.add': handle(params => service.add(params)),
    'rayburst.action': handle(params => service.action(params)),
    'rayburst.pauseAll': handle(() => service.pauseAll()),
    'rayburst.resumeAll': handle(() => service.resumeAll()),
    'rayburst.reveal': handle(params => service.reveal(params)),
  },
})
