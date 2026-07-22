// DeskWidget — 바탕화면에 내 투명 PNG를 위젯으로 띄운다.
// 배포 최상위 "사진을 넣으면 위젯이 됩니다" 폴더(개발 모드는 userData) 이미지 하나당 창 하나. 드래그 이동, 스크롤 크기조절, 우클릭 메뉴.
// 투명·프레임 없음·"바탕화면 레벨"(다른 프로그램 뒤, 항상 위 아님). 위치/크기 자동 저장.
const { app, BrowserWindow, Tray, Menu, screen, nativeImage, ipcMain, shell, globalShortcut, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { fileURLToPath, pathToFileURL } = require('url')

const {
  DEFAULT_WINDOW_DIMENSION,
  dimensionsForWidth,
  inspectImageFile,
  isSupportedFilename,
  normalizeAspect,
  sizeForAspect,
} = require('./src/image-utils')
const { boundsFromSavedState, normalizeConfig } = require('./src/config-utils')
const { buildAutostartScript } = require('./src/windows-utils')

const QUIT_HOTKEY = 'CommandOrControl+Alt+Q'
const DROP_DIR = '사진을 넣으면 위젯이 됩니다'   // 사용자가 이미지를 떨구는 폴더(자기설명적 이름)
const ZOOM = 1.10            // 스크롤 한 칸당 배율
const MAX_WIDGETS = 100
const WIDGET_PAGE = path.join(__dirname, 'widget.html')

let tray = null
const windows = new Map()    // filename -> BrowserWindow
let config = {}
let saveTimer = null
let watchTimer = null
let stackTimer = null        // 위젯끼리의 겹침 순서(z) 재적용 디바운스
let imageWatcher = null
let configDirty = false
const imageCache = new Map()  // filename -> 안전 검사 결과(signature 포함)

function imagesDir() {
  // 개발 중 개인 이미지가 source tree와 배포 bundle에 섞이지 않도록 dev 데이터는 userData에 둔다.
  // packaged 상태에서는 실제 exe가 배포 최상위의 "안 보셔도 됩니다" 내부 폴더에 있으므로,
  // 사진 폴더는 그 부모(배포 최상위)에 둔다 — exe 바로 옆이 아니다.
  const base = app.isPackaged
    ? path.resolve(path.dirname(app.getPath('exe')), '..')
    : path.join(app.getPath('userData'), 'development')
  return path.join(base, DROP_DIR)
}
function configPath() { return path.join(app.getPath('userData'), 'widgets.json') }

function reportError(label, error) {
  const code = error && typeof error.code === 'string' ? error.code : 'ERROR'
  console.error(`[DeskWidget] ${label}: ${code}`)
}

function loadConfig() {
  try { config = normalizeConfig(JSON.parse(fs.readFileSync(configPath(), 'utf8'))) }
  catch { config = normalizeConfig({}) }
}

function writeConfigNow() {
  if (!configDirty) return
  const target = configPath()
  const temporary = `${target}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, target)
    configDirty = false
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch (_) {}
    reportError('config-save', error)
  }
}

function saveConfig() {
  configDirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(writeConfigNow, 400)
}

function listImages() {
  const dir = imagesDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && isSupportedFilename(entry.name))
      .map(entry => entry.name)
      .sort()
      .slice(0, MAX_WIDGETS)
  } catch (error) {
    reportError('image-list', error)
    return []
  }
}

function isOnScreen(b) {
  return screen.getAllDisplays().some(d => {
    const a = d.workArea
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
  })
}

// 창을 z-order 맨 아래(바탕화면 바로 위, 모든 프로그램 뒤)로 내린다 — 윈도우 전용.
// SetWindowPos(HWND_BOTTOM, NOACTIVATE) 한 번. focusable:false라 클릭해도 다시 안 올라옴.
// (창을 리페어런트하지 않으므로 투명 합성은 그대로 유지된다.)
function nativeHandleValue(win) {
  const handle = win.getNativeWindowHandle()
  return handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0))
}

function runPowerShell(script, label) {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, stdio: 'ignore' },
  )
  child.once('error', error => reportError(label, error))
  child.once('exit', code => {
    if (code !== 0 && code !== null) reportError(label, { code: `EXIT_${code}` })
  })
}

function sinkToDesktop(win) {
  if (process.platform !== 'win32' || win.isDestroyed()) return
  try {
    const hwnd = nativeHandleValue(win)
    const ps = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);'; [W.U]::SetWindowPos([System.IntPtr]([int64]${hwnd}), [System.IntPtr]1, 0,0,0,0, 0x13) | Out-Null`
    runPowerShell(ps, 'desktop-sink')
  } catch (error) { reportError('desktop-sink', error) }
}

// ── 위젯끼리의 겹침 순서(z) ───────────────────────────
// 모든 위젯은 바탕화면 레벨(HWND_BOTTOM, 일반 프로그램 뒤)에 깔린다. 그 "바닥 밴드" 안에서의
// 상대 순서만 config[file].z(정수)로 관리한다 — z가 클수록 다른 위젯보다 위에 보인다.
// 적용법: z 내림차순(위→아래)으로 정렬한 뒤 그 순서대로 하나씩 HWND_BOTTOM로 가라앉힌다.
// 뒤에 가라앉힌 창이 더 아래로 가므로, 먼저 가라앉힌(=z 최대) 창이 위젯 중 최상단이 된다.
// 한 PowerShell 프로세스에서 순차 실행 → 스폰 경쟁 없이 순서가 결정적. 전체 밴드는 여전히
// 일반 프로그램 뒤(HWND_BOTTOM)라 바탕화면에 보이는 다른 프로그램 순서는 건드리지 않는다.
function zOf(file) { const z = config[file] && config[file].z; return Number.isFinite(z) ? z : 0 }
function allZ() { return [...windows.keys()].map(zOf) }

function applyStackOrder() {
  if (process.platform !== 'win32') return
  const stack = [...windows.values()].filter(w => !w.isDestroyed())
  if (!stack.length) return
  stack.sort((a, b) => zOf(b.__file) - zOf(a.__file))   // z 내림차순: 위 → 아래
  try {
    const calls = stack.map(w => {
      const h = nativeHandleValue(w)
      return `[W.U]::SetWindowPos([System.IntPtr]([int64]${h}), [System.IntPtr]1, 0,0,0,0, 0x13) | Out-Null`
    }).join('; ')
    const ps = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);'; ${calls}`
    runPowerShell(ps, 'stack-order')
  } catch (error) { reportError('stack-order', error) }
}

// 여러 창이 거의 동시에 뜰 때(시작 시) 재적용을 한 번으로 합쳐 PowerShell 스폰을 줄인다.
function scheduleApplyStackOrder(delay = 180) {
  clearTimeout(stackTimer)
  stackTimer = setTimeout(applyStackOrder, delay)
}

function setZ(file, z) {
  config[file] = { ...(config[file] || {}), z }
  saveConfig()
  applyStackOrder()   // 사용자 조작은 즉시 반영
}
function bringToFront(win) {   // 다른 위젯들 위로
  const f = win.__file; if (!f) return
  const zs = allZ()
  setZ(f, (zs.length ? Math.max(...zs) : 0) + 1)
}
function sendToBack(win) {     // 다른 위젯들 아래로
  const f = win.__file; if (!f) return
  const zs = allZ()
  setZ(f, (zs.length ? Math.min(...zs) : 0) - 1)
}

// 드롭 폴더가 없거나 비어 있으면 기본 이미지(공룡)를 넣어준다 — 폴더는 런타임에 정확한 UTF-8로 생성.
function ensureDefaultImage() {
  const dir = imagesDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (listImages().length === 0) {
      const def = path.join(__dirname, 'default-dino.png')
      if (fs.existsSync(def)) fs.copyFileSync(def, path.join(dir, 'dino.png'))
    }
  } catch (error) { reportError('default-image', error) }
}

function inspectWidgetImage(file) {
  const imgPath = path.join(imagesDir(), file)
  try {
    const stat = fs.lstatSync(imgPath)
    const quickSignature = `${stat.size}:${Math.trunc(stat.mtimeMs)}:${Math.trunc(stat.ctimeMs)}`
    const cached = imageCache.get(file)
    if (cached && cached.quickSignature === quickSignature) return cached

    const inspected = inspectImageFile(imgPath)
    const result = { ...inspected, imgPath, quickSignature }
    imageCache.set(file, result)
    return result
  } catch (error) {
    const result = { ok: false, reason: error && error.code ? error.code : 'inspect-error', imgPath }
    imageCache.set(file, result)
    return result
  }
}

function hardenWebContents(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-redirect', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
}

function loadWidgetContent(win, imageInfo) {
  const sourceUrl = pathToFileURL(imageInfo.imgPath)
  sourceUrl.searchParams.set('v', imageInfo.signature)
  return win.loadFile(WIDGET_PAGE, { query: { src: sourceUrl.href, rev: imageInfo.signature } })
    .catch(error => reportError('widget-load', error))
}

function createWidget(file, index, imageInfo) {
  if (windows.has(file) || !imageInfo || !imageInfo.ok) return false
  const aspect = normalizeAspect(imageInfo.aspect)
  const def = sizeForAspect(DEFAULT_WINDOW_DIMENSION, aspect)
  const { workArea } = screen.getPrimaryDisplay()
  let bounds = {
    x: workArea.x + 80 + (index % 6) * 46,
    y: workArea.y + 80 + (index % 6) * 46,
    width: def.width, height: def.height,
  }
  const savedBounds = boundsFromSavedState(config[file], aspect)
  if (savedBounds && isOnScreen(savedBounds)) bounds = savedBounds

  let win
  try {
    win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,          // 유저 엣지드래그 대신 스크롤로 크기조절 (투명+resizable 윈도우 렌더버그 회피)
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: false,        // ★ 항상 위 아님 — 바탕화면 레벨(다른 프로그램 뒤)
      focusable: false,          // ★ 클릭해도 활성화·앞으로 안 나옴 (마우스 이벤트는 그대로 받음)
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: !app.isPackaged,
        navigateOnDragDrop: false,
        spellcheck: false,
      },
    })
  } catch (error) {
    reportError('widget-create', error)
    return false
  }

  win.__aspect = aspect
  win.__file = file
  win.__imageSignature = imageInfo.signature
  hardenWebContents(win)
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true)
  loadWidgetContent(win, imageInfo)
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.showInactive()          // 포커스 뺏지 않고 표시
    sinkToDesktop(win)          // 모든 창 뒤(바탕화면 바로 위)로 가라앉힘
    scheduleApplyStackOrder()   // 위젯끼리의 겹침 순서(z) 재적용
  })

  const persist = () => {
    if (win.isDestroyed()) return
    const b = win.getBounds()
    config[file] = { ...(config[file] || {}), x: b.x, y: b.y, width: b.width }   // z(겹침 순서)는 보존
    saveConfig()
  }
  win.on('move', persist)
  win.on('resize', persist)
  win.on('closed', () => { if (windows.get(file) === win) windows.delete(file) })
  windows.set(file, win)
  return true
}

function refreshWidgets() {
  const files = listImages()
  const validFiles = new Set()

  files.forEach((file, index) => {
    const imageInfo = inspectWidgetImage(file)
    if (!imageInfo.ok) return
    validFiles.add(file)

    const existing = windows.get(file)
    if (!existing || existing.isDestroyed()) {
      createWidget(file, index, imageInfo)
      return
    }

    if (existing.__imageSignature !== imageInfo.signature) {
      existing.__imageSignature = imageInfo.signature
      existing.__aspect = normalizeAspect(imageInfo.aspect)
      const previous = existing.getBounds()
      const dimensions = dimensionsForWidth(previous.width, existing.__aspect)
      existing.setBounds({ ...previous, ...dimensions })
      loadWidgetContent(existing, imageInfo)
    }
  })

  for (const [f, win] of [...windows]) {
    if (!validFiles.has(f) && !win.isDestroyed()) win.close()
  }
  for (const file of [...imageCache.keys()]) if (!files.includes(file)) imageCache.delete(file)
  scheduleApplyStackOrder()   // 추가/제거 후 겹침 순서 재적용
}

function resizeWin(win, factor) {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  const aspect = normalizeAspect(win.__aspect || (b.height / b.width))
  const dimensions = dimensionsForWidth(b.width * factor, aspect)
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2   // 중심 고정
  win.setBounds({
    x: Math.round(cx - dimensions.width / 2),
    y: Math.round(cy - dimensions.height / 2),
    ...dimensions,
  })
}

function resetSize(win) {
  if (!win || win.isDestroyed()) return
  const s = sizeForAspect(DEFAULT_WINDOW_DIMENSION, win.__aspect || 1)
  const b = win.getBounds()
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  win.setBounds({ x: Math.round(cx - s.width / 2), y: Math.round(cy - s.height / 2), width: s.width, height: s.height })
}

// ── IPC (preload가 노출) ─────────────────────────────
// 수동 드래그: pointerdown 시 창 안 잡은 지점 offset을 받고, pointermove마다 커서 스크린좌표에서
// offset을 빼 창을 재배치 (절대 위치라 랙 없음, DIP 단위라 HiDPI 안전).
function isWidgetPageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'file:') return false
    url.search = ''
    url.hash = ''
    return path.resolve(fileURLToPath(url)) === path.resolve(WIDGET_PAGE)
  } catch (_) {
    return false
  }
}

function trustedWidgetForEvent(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return null
  if (!isWidgetPageUrl(event.senderFrame.url)) return null
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed() || windows.get(win.__file) !== win) return null
  return win
}

function openLocalPath(target) {
  shell.openPath(target)
    .then(message => { if (message) reportError('open-path', { code: 'OPEN_FAILED' }) })
    .catch(error => reportError('open-path', error))
}

ipcMain.on('drag-start', (event, offX, offY) => {
  const win = trustedWidgetForEvent(event)
  if (!win || typeof offX !== 'number' || !Number.isFinite(offX) || typeof offY !== 'number' || !Number.isFinite(offY)) return
  const bounds = win.getBounds()
  if (offX < 0 || offY < 0 || offX > bounds.width || offY > bounds.height) return
  win.__dragOff = { offX: Math.round(offX), offY: Math.round(offY) }
})
ipcMain.on('drag-move', event => {
  const win = trustedWidgetForEvent(event)
  if (!win || !win.__dragOff) return
  const p = screen.getCursorScreenPoint()
  try { win.setPosition(Math.round(p.x - win.__dragOff.offX), Math.round(p.y - win.__dragOff.offY)) }
  catch (error) { reportError('drag-move', error) }
})
ipcMain.on('drag-end', event => {
  const win = trustedWidgetForEvent(event)
  if (win) win.__dragOff = null
})
ipcMain.on('wheel', (event, deltaY) => {
  const win = trustedWidgetForEvent(event)
  if (!win || typeof deltaY !== 'number' || !Number.isFinite(deltaY) || deltaY === 0) return
  resizeWin(win, deltaY < 0 ? ZOOM : 1 / ZOOM)
})
ipcMain.on('context-menu', event => {
  const win = trustedWidgetForEvent(event)
  if (!win) return
  Menu.buildFromTemplate([
    { label: '크게 (+)', click: () => resizeWin(win, ZOOM) },
    { label: '작게 (−)', click: () => resizeWin(win, 1 / ZOOM) },
    { label: '크기 초기화', click: () => resetSize(win) },
    { type: 'separator' },
    { label: '제일 위로 (위젯끼리)', click: () => bringToFront(win) },
    { label: '맨 뒤로 (위젯끼리)', click: () => sendToBack(win) },
    { type: 'separator' },
    { label: '이 위젯 숨기기', click: () => win.close() },
    { label: '이미지 폴더 열기', click: () => openLocalPath(imagesDir()) },
    { label: '위젯 새로고침', click: () => refreshWidgets() },
    { type: 'separator' },
    { label: `전체 종료  (${QUIT_HOTKEY})`, click: () => app.quit() },
  ]).popup({ window: win })
})

// ── 자동시작(부팅 시): 시작프로그램 폴더에 .lnk 바로가기 (setLoginItemSettings보다 확실).
//    매 실행마다 재등록 → 폴더를 옮겨도 다음 실행 때 경로가 자동 복구된다.
//    선호(on/off)는 파일로 기록하며, 명시적 사용자 동의 전에는 기본 OFF.
function autostartPrefFile() { return path.join(app.getPath('userData'), 'autostart.txt') }
function autostartEnabled() {
  try { return fs.readFileSync(autostartPrefFile(), 'utf8').trim() === 'on' } catch { return false }
}
function saveAutostartPref(on) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(autostartPrefFile(), on ? 'on' : 'off', { encoding: 'utf8', mode: 0o600 })
  } catch (error) { reportError('autostart-pref', error) }
}
function applyAutostart(on) {
  if (process.platform !== 'win32') return
  try {
    runPowerShell(buildAutostartScript(on, process.execPath), 'autostart')
  } catch (error) { reportError('autostart', error) }
}
function startupFolder() { return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') }

function loadTrayIcon() {
  // 별도 출처 불명 아이콘을 배포하지 않고, 저장소 소유자가 CC0로 공개한 기본 공룡을 재사용한다.
  const img = nativeImage.createFromPath(path.join(__dirname, 'default-dino.png'))
  if (!img.isEmpty()) return img.resize({ width: 16, height: 16, quality: 'best' })
  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNgGAWjYBSMglEwCkbBKBgFo4AeAAAFQAABf6r7nQAAAABJRU5ErkJggg==')
}

function createTray() {
  try {
    tray = new Tray(loadTrayIcon())
    tray.setToolTip('DeskWidget — 내 이미지 위젯')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'DeskWidget', enabled: false },
      { type: 'separator' },
      { label: '이미지 폴더 열기', click: () => openLocalPath(imagesDir()) },
      { label: '위젯 새로고침', click: () => refreshWidgets() },
      { label: '부팅 시 시작', type: 'checkbox', checked: autostartEnabled(),
        click: (item) => { saveAutostartPref(item.checked); applyAutostart(item.checked) } },
      { label: '시작프로그램 폴더 열기(확인용)', visible: process.platform === 'win32',
        click: () => openLocalPath(startupFolder()) },
      { type: 'separator' },
      { label: `종료(Quit)  ${QUIT_HOTKEY}`, click: () => app.quit() },
    ]))
    tray.on('double-click', () => openLocalPath(imagesDir()))
  } catch (error) { reportError('tray-create', error) }
}

function watchImages() {
  try {
    imageWatcher = fs.watch(imagesDir(), () => { clearTimeout(watchTimer); watchTimer = setTimeout(refreshWidgets, 500) })
  } catch (error) { reportError('image-watch', error) }
}

function startApplication() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide()
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  )
  loadConfig()
  applyAutostart(autostartEnabled())
  ensureDefaultImage()
  refreshWidgets()
  createTray()
  watchImages()
  if (!globalShortcut.register(QUIT_HOTKEY, () => app.quit())) reportError('quit-hotkey', { code: 'UNAVAILABLE' })
  if (!app.isPackaged) console.log(`[DeskWidget] up — widgets=${windows.size}`)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (app.isReady()) openLocalPath(imagesDir()) })
  app.whenReady().then(startApplication).catch(error => {
    reportError('startup', error)
    app.quit()
  })
}

app.on('will-quit', () => {
  clearTimeout(saveTimer)
  clearTimeout(watchTimer)
  clearTimeout(stackTimer)
  writeConfigNow()
  if (imageWatcher) {
    try { imageWatcher.close() } catch (error) { reportError('image-watch-close', error) }
  }
  globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => { /* 위젯 다 숨겨도 트레이로 살아있음 — 종료는 명시적으로만 */ })
