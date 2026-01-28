const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let floatWindow = null; // 40x40 悬浮球
let inputWindow = null; // 输入框面板
let positionTimer = null; // 节流计时器
const dragState = new Map(); // rendererId -> { timer, startCursor, startWin }

// 淡入动画 - 先显示窗口，然后等待 CSS 动画完成（300ms）
async function fadeIn(win, duration = 300) {
  if (!win || win.isDestroyed()) return;
  
  // 先通知渲染进程重置状态（移除 fade-in 类，确保 opacity 为 0）
  win.webContents.send('window:fade-out');
  
  // 显示窗口（此时 CSS 中 opacity 为 0）
  win.show();
  
  // 给浏览器一点时间渲染初始状态（opacity: 0）
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // 通知渲染进程触发淡入动画
  win.webContents.send('window:fade-in');
  
  // 等待 CSS 动画完成
  await new Promise(resolve => setTimeout(resolve, duration));
}

// 淡出动画 - 触发淡出动画，等待完成后隐藏窗口
async function fadeOut(win, duration = 300) {
  if (!win || win.isDestroyed()) return;
  
  // 通知渲染进程触发淡出动画
  win.webContents.send('window:fade-out');
  
  // 等待 CSS 动画完成后再隐藏
  await new Promise(resolve => setTimeout(resolve, duration));
  
  if (!win.isDestroyed()) {
    win.hide();
  }
}

function positionInputWindow() {
  if (!floatWindow || floatWindow.isDestroyed()) return;
  if (!inputWindow || inputWindow.isDestroyed()) return;

  const [fx, fy] = floatWindow.getPosition();
  const { width: iwW } = inputWindow.getBounds();

  // 输入框窗口显示在悬浮球左侧，右边缘与悬浮球左边缘对齐
  inputWindow.setPosition(fx - iwW + 40, fy);
}

function createFloatWindow() {
  floatWindow = new BrowserWindow({
    width: 40,
    height: 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    show: false,
    skipTaskbar: true, // 不在任务栏显示
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 悬浮球置于最高层级，确保始终在屏幕最顶部
  // 'screen-saver' 是最高级别，高于所有普通窗口
  floatWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  
  // 设置窗口级别（额外保险）
  if (process.platform === 'darwin') {
    // macOS: 使用 floating 或 pop-up-menu 级别
    floatWindow.setAlwaysOnTop(true, 'pop-up-menu');
  } else if (process.platform === 'linux') {
    // Linux: 确保在 X11/Wayland 上正确置顶
    floatWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  }

  floatWindow.loadFile('float-ball.html');

  floatWindow.once('ready-to-show', async () => {
    // 确保显示时重新置顶
    floatWindow.moveTop();
    // 淡入动画（fadeIn 内部会设置 opacity 为 0 并 show）
    await fadeIn(floatWindow);
  });

  // 默认打开悬浮球的开发者工具
  // floatWindow.webContents.openDevTools({ mode: 'detach' });

  // 监听焦点变化，确保始终在最上层
  floatWindow.on('blur', () => {
    // 即使失去焦点也保持在最上层
    if (floatWindow && !floatWindow.isDestroyed()) {
      floatWindow.moveTop();
    }
  });

  floatWindow.on('closed', () => {
    floatWindow = null;
    if (inputWindow && !inputWindow.isDestroyed()) inputWindow.close();
    inputWindow = null;
  });
}

function createInputWindow() {
  if (inputWindow && !inputWindow.isDestroyed()) return inputWindow;

  inputWindow = new BrowserWindow({
    width: 180,
    height: 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    show: false,
    focusable: true,
    // skipTaskbar: true, // 不在任务栏显示
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  inputWindow.setAlwaysOnTop(true, 'floating');

  inputWindow.loadFile('input-panel.html');

  inputWindow.on('closed', () => {
    inputWindow = null;
  });

  return inputWindow;
}

// 应用准备就绪
app.whenReady().then(() => {
  createFloatWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createFloatWindow();
    }
  });
});

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============== IPC 通信处理 ==============

// 渲染进程日志转发到主进程
ipcMain.on('app:log', (event, { level, args }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const winType = win === floatWindow ? '[悬浮球]' : win === inputWindow ? '[输入框]' : '[未知窗口]';
  
  // 根据日志级别调用对应的 console 方法
  if (level === 'error') {
    console.error(winType, ...args);
  } else if (level === 'warn') {
    console.warn(winType, ...args);
  } else if (level === 'info') {
    console.info(winType, ...args);
  } else {
    console.log(winType, ...args);
  }
});

// 获取窗口位置
ipcMain.handle('app:window:get-position', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const [x, y] = win.getPosition();
    return [x, y];
  }
  return [0, 0];
});

// 设置窗口位置
ipcMain.on('app:window:set-position', (event, { x, y }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setPosition(Math.round(x), Math.round(y));
  }
});

function stopWindowDrag(senderId) {
  const state = dragState.get(senderId);
  if (state?.timer) {
    clearInterval(state.timer);
  }
  dragState.delete(senderId);
}

// 开始窗口拖动（在主进程使用全局鼠标坐标）
ipcMain.on('app:drag:start', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const senderId = event.sender.id;
  stopWindowDrag(senderId);

  const startCursor = screen.getCursorScreenPoint();
  const [startWinX, startWinY] = win.getPosition();

  const timer = setInterval(() => {
    if (win.isDestroyed()) {
      stopWindowDrag(senderId);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - startCursor.x;
    const dy = cursor.y - startCursor.y;
    const nextX = Math.round(startWinX + dx);
    const nextY = Math.round(startWinY + dy);
    win.setPosition(nextX, nextY);
  }, 16);

  dragState.set(senderId, { timer, startCursor, startWinX, startWinY });
});

// 结束窗口拖动
ipcMain.on('app:drag:stop', (event) => {
  stopWindowDrag(event.sender.id);
});

// 悬浮球：点击左半区域切换输入框窗口
let isToggling = false; // 防止动画期间重复切换

ipcMain.handle('app:input:toggle', async () => {
  if (!floatWindow || floatWindow.isDestroyed()) return false;
  
  // 如果正在切换动画中，忽略新的切换请求
  if (isToggling) {
    console.log('动画进行中，忽略切换请求');
    return false;
  }
  
  isToggling = true;
  
  try {
    const win = createInputWindow();
    if (!win) return false;

    if (win.isVisible()) {
      // 收起输入框，显示悬浮球
      // 先获取输入框的当前位置
      const [inputX, inputY] = win.getPosition();
      const { width: inputWidth } = win.getBounds();
      
      console.log('[Toggle] 收起输入框 - 输入框位置:', inputX, inputY, '宽度:', inputWidth);
      
      // 计算悬浮球应该出现的位置（输入框右侧的图标位置）
      const floatX = inputX + inputWidth - 40;
      const floatY = inputY;
      
      console.log('[Toggle] 悬浮球应该出现在:', floatX, floatY);
      
      // 先淡出输入框窗口（200ms），窗口消失
      await fadeOut(win);
      
      if (floatWindow && !floatWindow.isDestroyed()) {
        // 输入框消失后，设置悬浮球位置并淡入
        floatWindow.setPosition(floatX, floatY);
        try { floatWindow.focus(); } catch (_) {}
        
        // 然后淡入悬浮球窗口（2秒）
        await fadeIn(floatWindow);
        
        floatWindow.webContents.send('input:visible', false);
      }
      return false;
    }

    // 展开输入框，将输入框放在悬浮球的位置
    if (floatWindow && !floatWindow.isDestroyed()) {
      const [floatX, floatY] = floatWindow.getPosition();
      const { width: inputWidth } = win.getBounds();
      
      console.log('[Toggle] 展开输入框 - 悬浮球位置:', floatX, floatY);
      console.log('[Toggle] 输入框宽度:', inputWidth);
      
      // 计算输入框应该出现的位置（让右侧图标和悬浮球对齐）
      const inputX = floatX - inputWidth + 40;
      const inputY = floatY;
      
      console.log('[Toggle] 输入框应该出现在:', inputX, inputY);
      
      // 先淡出悬浮球窗口（200ms），窗口消失
      await fadeOut(floatWindow);
      
      // 悬浮球消失后，设置输入框位置并淡入
      win.setPosition(inputX, inputY);
      win.focus();
      
      // 然后淡入输入框窗口（2秒）
      await fadeIn(win);
      
      floatWindow.webContents.send('input:visible', true);
    }
    
    return true;
  } finally {
    isToggling = false;
  }
});

// 允许 renderer 请求聚焦输入框（用于自动 focus）
ipcMain.handle('app:input:focus', async () => {
  if (!inputWindow || inputWindow.isDestroyed()) return false;
  try { inputWindow.focus(); } catch (_) {}
  return true;
});

