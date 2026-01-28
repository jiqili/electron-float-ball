const { contextBridge, ipcRenderer } = require('electron');

// 通过 contextBridge 暴露 IPC API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 发送消息（单向）
  send: (channel, data) => {
    // 白名单验证
    const validChannels = [
      'app:window:set-position',
      'app:drag:start',
      'app:drag:stop',
      'app:window:restore-main',
      'app:window:minimize-to-mini',
      'app:quit',
      'app:toggle-devtools',
      'app:log'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // 调用并等待返回结果（双向）
  invoke: (channel, data) => {
    const validChannels = [
      'app:window:get-position',
      'app:input:toggle',
      'app:input:focus',
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
  },

  // 监听主进程消息
  on: (channel, callback) => {
    const validChannels = [
      'app:window:mouse-enter',
      'app:window:mouse-leave',
      'input:expand',
      'input:collapse',
      'window:fade-in',
      'window:fade-out',
      'input:visible'
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      
      // 返回取消订阅函数
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
  },

  // 移除监听器
  removeListener: (channel, callback) => {
    const validChannels = [
      'navigate-to',
      'app:window:mouse-enter',
      'app:window:mouse-leave'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback);
    }
  },

  // 日志工具：将渲染进程的日志转发到主进程
  log: (...args) => {
    ipcRenderer.send('app:log', { level: 'log', args });
  },
  error: (...args) => {
    ipcRenderer.send('app:log', { level: 'error', args });
  },
  warn: (...args) => {
    ipcRenderer.send('app:log', { level: 'warn', args });
  },
  info: (...args) => {
    ipcRenderer.send('app:log', { level: 'info', args });
  }
});
