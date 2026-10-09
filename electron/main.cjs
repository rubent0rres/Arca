const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { author } = require('../package.json');

const isDev = !app.isPackaged;
const rarCandidates = ['/Applications/rar/rar', '/opt/homebrew/bin/rar', '/usr/local/bin/rar'];
const unrarCandidates = ['/Applications/rar/unrar', '/opt/homebrew/bin/unrar', '/usr/local/bin/unrar'];
const sevenZipCandidates = [
  app.isPackaged ? path.join(process.resourcesPath, '7zz') : path.join(__dirname, '../vendor/7zip/7zz'),
  '/opt/homebrew/bin/7zz',
  '/usr/local/bin/7zz',
  '/opt/homebrew/bin/7z',
  '/usr/local/bin/7z',
];
let mainWindow;
let pendingOpenPaths = [];
const pendingPasswordRequests = new Map();
let archiveSession = null;

function clearArchiveSession() {
  archiveSession = null;
}

function getArchiveSession(archive) {
  const archivePath = fs.realpathSync(archive);
  const stats = fs.statSync(archivePath);
  const identity = [archivePath, stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join('\0');
  if (archiveSession?.identity !== identity) archiveSession = { identity, password: null };
  return archiveSession;
}

function findExecutable(candidates) {
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function getArchiveFormat(value) {
  if (typeof value !== 'string') return null;
  const extension = path.extname(value).toLowerCase();
  if (extension === '.rar') return 'rar';
  if (extension === '.7z') return '7z';
  if (extension === '.zip') return 'zip';
  return null;
}

function uniquePath(directory, name, extension) {
  let candidate = path.join(directory, `${name}${extension}`);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${name} (${counter})${extension}`);
    counter += 1;
  }
  return candidate;
}

function dispatchOpenPath(filePath) {
  if (!mainWindow || mainWindow.webContents.isLoadingMainFrame()) {
    pendingOpenPaths.push(filePath);
    return;
  }
  mainWindow.show();
  mainWindow.webContents.send('myunrar:open-rar', filePath);
}

function flushPendingOpenPaths() {
  const queued = pendingOpenPaths;
  pendingOpenPaths = [];
  for (const filePath of queued) mainWindow?.webContents.send('myunrar:open-rar', filePath);
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady() && !mainWindow) createWindow();
  dispatchOpenPath(filePath);
});

function createWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 690,
    minWidth: 700,
    minHeight: 600,
    title: 'Arca',
    backgroundColor: '#111215',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.webContents.once('did-finish-load', flushPendingOpenPaths);
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
      clearArchiveSession();
      for (const [operationId, resolve] of pendingPasswordRequests) {
        pendingPasswordRequests.delete(operationId);
        resolve(null);
      }
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) window.loadURL('http://127.0.0.1:5173');
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
}

function run(executable, args) {
  return new Promise((resolve) => {
    execFile(executable, args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (!error || error.code === 1) {
        resolve({ ok: true, warning: error?.code === 1, output });
      } else {
        resolve({ ok: false, output: output || error.message });
      }
    });
  });
}

function sendProgress(operationId, percent, stage) {
  mainWindow?.webContents.send('myunrar:progress', { operationId, percent, stage });
}

function inspectArchive(executable, archive) {
  return new Promise((resolve) => {
    const child = spawn(executable, ['l', '-p-', archive], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let partialLine = '';
    let encryptedEntry = false;

    const collect = (chunk) => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-128_000);
      const lines = `${partialLine}${text}`.split(/\r?\n/);
      partialLine = lines.pop() || '';
      if (lines.some((line) => /^\s*\*/.test(line))) encryptedEntry = true;
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => resolve({ ok: false, output: error.message }));
    child.on('close', (code) => {
      if (/^\s*\*/.test(partialLine)) encryptedEntry = true;
      const passwordRequired = encryptedEntry || code === 11 || /enter password|wrong password|incorrect password/i.test(output);
      resolve({
        ok: code === 0 || code === 1 || passwordRequired,
        requiresPassword: passwordRequired,
        output: output.trim(),
        code,
      });
    });
  });
}

function inspectSevenZip(executable, archive) {
  return new Promise((resolve) => {
    const child = spawn(executable, ['l', '-slt', '-bsp0', archive], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output = `${output}${chunk.toString()}`.slice(-128_000); });
    child.stderr.on('data', (chunk) => { output = `${output}${chunk.toString()}`.slice(-128_000); });
    child.on('error', (error) => resolve({ ok: false, output: error.message }));
    child.on('close', (code) => {
      const encryptedEntry = /^Encrypted = \+\s*$/m.test(output);
      const passwordRequired = encryptedEntry || /enter password|wrong password|incorrect password/i.test(output);
      resolve({
        ok: code === 0 || code === 1 || passwordRequired,
        requiresPassword: passwordRequired,
        output: output.trim(),
        code,
      });
    });
  });
}

function parseRarEntries(output) {
  const entries = [];
  for (const block of output.split(/\r?\n\s*\r?\n/)) {
    const values = {};
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^\s*(Name|Type|Size|mtime|Attributes|Flags): (.*)$/);
      if (match) values[match[1]] = match[2];
    }
    if (!values.Name || !/^(File|Directory|.*link)$/i.test(values.Type || '')) continue;
    const entryPath = values.Name.replace(/\\/g, '/');
    const isDirectory = values.Type === 'Directory' || /^d/.test(values.Attributes || '');
    entries.push({
      path: entryPath,
      name: path.posix.basename(entryPath),
      isDirectory,
      encrypted: /\bencrypted\b/i.test(values.Flags || ''),
      size: isDirectory || !Object.hasOwn(values, 'Size') ? null : Number(values.Size),
      modified: (values.mtime || '').replace(/,\d+$/, ''),
    });
  }
  return entries;
}

function parseSevenZipEntries(output) {
  const blocks = output.split(/\r?\n\s*\r?\n/);
  const entries = [];

  for (const block of blocks) {
    const values = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(' = ');
      if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 3);
    }
    if (!values.Path || values.Type || (!Object.hasOwn(values, 'Size') && !Object.hasOwn(values, 'Attributes'))) continue;
    const entryPath = values.Path.replace(/\\/g, '/');
    entries.push({
      path: entryPath,
      name: path.basename(entryPath),
      isDirectory: values.Folder === '+' || /^[Dd]/.test(values.Attributes || '') || /\/$/.test(entryPath),
      encrypted: values.Encrypted === '+',
      size: Number.isFinite(Number(values.Size)) ? Number(values.Size) : null,
      modified: values.Modified || '',
    });
  }
  return entries;
}

function normalizeArchiveEntries(entries) {
  const normalized = new Map();
  for (const entry of entries) {
    const entryPath = entry.path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+|\/+$/g, '');
    if (!entryPath) continue;
    const previous = normalized.get(entryPath);
    if (!previous?.isDirectory || entry.isDirectory) {
      normalized.set(entryPath, { ...entry, path: entryPath, name: path.posix.basename(entryPath) });
    }
  }
  for (const entry of normalized.values()) {
    const segments = entry.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const folderPath = segments.slice(0, index).join('/');
      const existing = normalized.get(folderPath);
      if (!existing?.isDirectory) normalized.set(folderPath, {
        path: folderPath,
        name: segments[index - 1],
        isDirectory: true,
        size: null,
        modified: '',
      });
    }
  }
  return Array.from(normalized.values());
}

async function listArchiveContents(executable, format, archive, password, operationId) {
  const args = format === 'rar'
    ? ['lt', password === null ? '-p-' : '-p', archive]
    : ['l', '-slt', '-bsp0', archive];
  const result = await runArchiveToolWithProgress(executable, args, operationId, password, 'listing', { captureFullOutput: true });
  if (!result.ok) return result;
  const entries = format === 'rar' ? parseRarEntries(result.stdout) : parseSevenZipEntries(result.stdout);
  const encryptedEntries = entries.filter((entry) => entry.encrypted && !entry.isDirectory);
  if (encryptedEntries.length && password === null) return { ...result, ok: false, requiresPassword: true };
  if (password !== null && encryptedEntries.length) {
    // Listing visible names does not authenticate a password. Check encrypted data
    // using the smallest entry before accepting and remembering the credential.
    const candidates = encryptedEntries.filter((entry) => entry.size > 0);
    const verificationEntry = (candidates.length ? candidates : encryptedEntries).sort((left, right) => (left.size || 0) - (right.size || 0))[0];
    const verificationArgs = format === 'rar'
      ? ['t', '-p', `-n${verificationEntry.path}`, archive]
      : ['t', '-bsp1', '-spd', `-i!${verificationEntry.path}`, archive];
    sendProgress(operationId, 0, 'checking');
    const verification = await runArchiveToolWithProgress(executable, verificationArgs, operationId, password, 'checking');
    if (!verification.ok) return verification;
  }
  return { ...result, entries: normalizeArchiveEntries(entries) };
}

function countFiles(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countFiles(entryPath);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

async function withArchivePassword({ archive, executable, format, inspection, operationId, runOperation }) {
  const session = getArchiveSession(archive);
  let requiresPassword = inspection.requiresPassword;
  let passwordAttempt = 0;
  let password = session.password;

  while (true) {
    if (requiresPassword && password === null) {
      passwordAttempt += 1;
      sendProgress(operationId, 0, 'password');
      password = await requestPassword(archive, operationId, passwordAttempt);
      if (password === null) return { ok: false, cancelled: true, output: 'Operación cancelada.' };
      sendProgress(operationId, 0, 'checking');
    }

    const result = await runOperation(password);
    if (result.requiresPassword) {
      session.password = null;
      password = null;
      requiresPassword = true;
      continue;
    }
    if (result.ok && password !== null && archiveSession === session) session.password = password;
    return result;
  }
}

function requestPassword(archive, operationId, attempt) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    pendingPasswordRequests.set(operationId, resolve);
    mainWindow.webContents.send('myunrar:password-required', {
      operationId,
      archiveName: path.basename(archive),
      attempt,
    });
  });
}

function runArchiveToolWithProgress(executable, args, operationId, password, stage = 'extracting', options = {}) {
  return new Promise((resolve) => {
    const { captureFullOutput = false, ...spawnOptions } = options;
    const child = spawn(executable, args, { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const scanState = {
      stdout: { offset: 0, tail: '', lastPromptEnd: -1 },
      stderr: { offset: 0, tail: '', lastPromptEnd: -1 },
    };
    let lastPercent = 0;
    let passwordPrompted = false;
    let passwordResponses = 0;
    let passwordRejected = false;

    const collect = (streamName, chunk) => {
      const text = chunk.toString();
      if (streamName === 'stdout') stdout = captureFullOutput ? stdout + text : `${stdout}${text}`.slice(-1_000_000);
      else stderr = `${stderr}${text}`.slice(-1_000_000);

      const scan = scanState[streamName];
      const scanText = scan.tail + text;
      const scanBase = scan.offset - scan.tail.length;
      if (/wrong password|incorrect password|password is incorrect/i.test(scanText)) {
        passwordRejected = true;
        child.kill('SIGTERM');
      }
      for (const match of scanText.matchAll(/(?:^|[\r\n])[^\r\n]{0,220}?(\d{1,3})%/g)) {
        const percent = Number(match[1]);
        if (percent > lastPercent && percent <= 100) {
          lastPercent = percent;
          sendProgress(operationId, Math.min(percent, 99), stage);
        }
      }
      for (const match of scanText.matchAll(/enter password/gi)) {
        const promptStart = scanBase + match.index;
        if (promptStart > scan.lastPromptEnd) {
          scan.lastPromptEnd = promptStart + match[0].length;
          passwordPrompted = true;
          if (password === null) {
            child.kill('SIGTERM');
          } else if (passwordResponses < 128) {
            // Some archives prompt again for later entries. Keep answering
            // through stdin so extraction does not stop after the first one.
            passwordResponses += 1;
            child.stdin.write(`${password}\n`);
          } else {
            passwordRejected = true;
            child.kill('SIGTERM');
          }
        }
      }
      scan.offset += text.length;
      scan.tail = scanText.slice(-64);
    };

    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      resolve({ ok: false, output: error.message });
    });
    child.on('close', (code) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      const needsPassword = passwordRejected || code === 11 || (password === null && passwordPrompted);
      if (needsPassword) {
        resolve({ ok: false, requiresPassword: true, output, stdout, stderr, code });
      } else if (code === 0 || code === 1) {
        resolve({ ok: true, warning: code === 1, output, stdout, stderr });
      } else {
        resolve({ ok: false, output: output || `El descompresor terminó con código ${code}.`, stdout, stderr, code });
      }
    });

    if (password === null) child.stdin.end();
  });
}

ipcMain.on('myunrar:provide-password', (_event, { operationId, password }) => {
  const resolve = pendingPasswordRequests.get(operationId);
  if (!resolve || typeof password !== 'string' || /[\r\n]/.test(password)) return;
  pendingPasswordRequests.delete(operationId);
  resolve(password);
});

ipcMain.on('myunrar:cancel-password', (_event, operationId) => {
  const resolve = pendingPasswordRequests.get(operationId);
  if (!resolve) return;
  pendingPasswordRequests.delete(operationId);
  resolve(null);
});

ipcMain.on('myunrar:close-archive', clearArchiveSession);

ipcMain.handle('myunrar:choose-archive', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir archivo comprimido',
    buttonLabel: 'Abrir',
    properties: ['openFile'],
    filters: [{ name: 'Archivos comprimidos', extensions: ['rar', '7z', 'zip'] }],
  });
  if (selection.canceled || selection.filePaths.length === 0) return { ok: false, cancelled: true };
  return { ok: true, path: selection.filePaths[0] };
});

ipcMain.handle('myunrar:open-archive', async (_event, archive) => {
  const format = getArchiveFormat(archive);
  if (!format) return { ok: false, output: 'Selecciona un archivo con extensión .rar, .7z o .zip.' };
  const executable = findExecutable(format === 'rar' ? unrarCandidates : sevenZipCandidates);
  if (!executable) return { ok: false, output: format === 'rar' ? 'No encuentro UnRAR en /Applications/rar.' : 'No encuentro 7-Zip para abrir este archivo.' };

  try {
    if (!fs.statSync(archive).isFile()) return { ok: false, output: 'El elemento seleccionado no es un archivo.' };
    const operationId = randomUUID();
    sendProgress(operationId, 0, 'preparing');
    const inspection = format === 'rar'
      ? await inspectArchive(executable, archive)
      : await inspectSevenZip(executable, archive);
    if (!inspection.ok) return { ok: false, output: inspection.output || 'No se pudo abrir el archivo comprimido.' };

    const listed = await withArchivePassword({
      archive,
      executable,
      format,
      inspection,
      operationId,
      runOperation: (password) => listArchiveContents(executable, format, archive, password, operationId),
    });
    if (!listed.ok) return listed;

    const stats = fs.statSync(archive);
    const fileCount = listed.entries.filter((entry) => !entry.isDirectory).length;
    const folderCount = listed.entries.filter((entry) => entry.isDirectory).length;
    return {
      ok: true,
      archive: {
        path: archive,
        name: path.basename(archive),
        format,
        size: stats.size,
        entries: listed.entries,
        fileCount,
        folderCount,
      },
    };
  } catch (error) {
    return { ok: false, output: error.message };
  }
});

ipcMain.handle('myunrar:test-archive', async (_event, archive) => {
  const format = getArchiveFormat(archive);
  if (!format) return { ok: false, output: 'Selecciona un archivo con extensión .rar, .7z o .zip.' };
  const executable = findExecutable(format === 'rar' ? unrarCandidates : sevenZipCandidates);
  if (!executable) return { ok: false, output: format === 'rar' ? 'No encuentro UnRAR en /Applications/rar.' : 'No encuentro 7-Zip para comprobar este archivo.' };

  try {
    const operationId = randomUUID();
    sendProgress(operationId, 0, 'preparing');
    const inspection = format === 'rar'
      ? await inspectArchive(executable, archive)
      : await inspectSevenZip(executable, archive);
    if (!inspection.ok) return { ok: false, output: inspection.output || 'No se pudo comprobar el archivo comprimido.' };

    const result = await withArchivePassword({
      archive,
      executable,
      format,
      inspection,
      operationId,
      runOperation: (password) => {
        const args = format === 'rar'
          ? ['t', password === null ? '-p-' : '-p', archive]
          : ['t', '-bsp1', archive];
        return runArchiveToolWithProgress(executable, args, operationId, password, 'testing');
      },
    });
    if (result.ok) sendProgress(operationId, 100, 'complete');
    return result;
  } catch (error) {
    return { ok: false, output: error.message };
  }
});

ipcMain.handle('myunrar:open-developer-email', async () => {
  try {
    await shell.openExternal(`mailto:${author.email}`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('myunrar:open-location', async (_event, location) => {
  if (typeof location !== 'string' || !fs.existsSync(location)) return { ok: false, output: 'No encuentro la carpeta para abrir.' };
  const error = await shell.openPath(location);
  return error ? { ok: false, output: error } : { ok: true };
});

ipcMain.handle('myunrar:compress-dropped', async (_event, files, format = 'rar') => {
  if (!['rar', '7z', 'zip'].includes(format)) return { ok: false, output: 'Elige RAR, 7z o ZIP para comprimir.' };
  const executable = findExecutable(format === 'rar' ? rarCandidates : sevenZipCandidates);
  if (!executable) {
    return {
      ok: false,
      output: format === 'rar' ? 'No encuentro RAR. Comprueba que esté instalado en /Applications/rar.' : `No encuentro 7-Zip para crear archivos ${format.toUpperCase()}.`,
    };
  }
  if (!Array.isArray(files) || files.length === 0 || files.some((file) => typeof file !== 'string')) {
    return { ok: false, output: 'Arrastra uno o varios archivos para comprimir.' };
  }

  try {
    if (files.some((file) => !fs.statSync(file).isFile())) {
      return { ok: false, output: 'Por ahora puedes comprimir archivos individuales, no carpetas.' };
    }
    const directory = path.dirname(files[0]);
    const baseName = files.length === 1 ? path.parse(files[0]).name : 'Archivo';
    const extension = `.${format}`;
    const output = uniquePath(directory, baseName || 'Archivo', extension);
    if (format === 'rar') {
      const operationId = randomUUID();
      sendProgress(operationId, 0, 'compressing');
      const result = await runArchiveToolWithProgress(
        executable,
        ['a', '-ep1', '-r', output, ...files],
        operationId,
        null,
        'compressing',
      );
      if (result.ok) sendProgress(operationId, 100, 'complete');
      return { ...result, format, location: output };
    }

    let workingDirectory = path.dirname(files[0]);
    for (const file of files.slice(1)) {
      const fileDirectory = path.dirname(file);
      while (workingDirectory !== path.dirname(workingDirectory) && fileDirectory !== workingDirectory && !fileDirectory.startsWith(`${workingDirectory}${path.sep}`)) {
        workingDirectory = path.dirname(workingDirectory);
      }
    }
    const inputs = files.map((file) => `./${path.relative(workingDirectory, file)}`);
    const operationId = randomUUID();
    sendProgress(operationId, 0, 'compressing');
    const result = await runArchiveToolWithProgress(
      executable,
      ['a', `-t${format}`, '-mx=5', '-bsp1', output, ...inputs],
      operationId,
      null,
      'compressing',
      { cwd: workingDirectory },
    );
    if (result.ok) sendProgress(operationId, 100, 'complete');
    return { ...result, format, location: output };
  } catch (error) {
    return { ok: false, output: error.message };
  }
});

ipcMain.handle('myunrar:extract-archive', async (_event, archive) => {
  const format = getArchiveFormat(archive);
  if (!format) return { ok: false, output: 'Suelta un archivo con extensión .rar, .7z o .zip.' };
  const executable = findExecutable(format === 'rar' ? unrarCandidates : sevenZipCandidates);
  if (!executable) {
    return {
      ok: false,
      output: format === 'rar' ? 'No encuentro UnRAR. Comprueba que esté instalado en /Applications/rar.' : `No encuentro 7-Zip para extraer este archivo ${format.toUpperCase()}.`,
    };
  }

  let stagingDirectory;
  try {
    if (!fs.statSync(archive).isFile()) return { ok: false, output: 'El elemento soltado no es un archivo.' };
    const parent = path.dirname(archive);
    const name = path.parse(archive).name || 'Contenido';
    const operationId = randomUUID();
    stagingDirectory = path.join(parent, `.${name}.myunrar-${operationId}`);
    fs.mkdirSync(stagingDirectory);
    sendProgress(operationId, 0, 'preparing');
    const inspection = format === 'rar'
      ? await inspectArchive(executable, archive)
      : await inspectSevenZip(executable, archive);
    if (!inspection.ok) return { ok: false, output: inspection.output || 'No se pudo leer el archivo RAR.' };

    const result = await withArchivePassword({
      archive, executable, format, inspection, operationId,
      runOperation: (password) => {
        // Every attempt starts clean so a rejected password cannot leave a partial result.
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
        fs.mkdirSync(stagingDirectory);
        sendProgress(operationId, 0, 'extracting');
        const args = format === 'rar'
          ? ['x', '-o+']
          : ['x', '-y', '-bsp1', `-o${stagingDirectory}`];
        if (format === 'rar') args.push(password === null ? '-p-' : '-p');
        args.push(archive);
        if (format === 'rar') args.push(`${stagingDirectory}${path.sep}`);
        return runArchiveToolWithProgress(executable, args, operationId, password);
      },
    });
    if (!result.ok) return { ...result, archive };

    const filesExtracted = countFiles(stagingDirectory);
    const destination = uniquePath(parent, name, '');
    fs.renameSync(stagingDirectory, destination);
    stagingDirectory = null;
    sendProgress(operationId, 100, 'complete');
    return { ...result, archive, format, location: destination, filesExtracted };
  } catch (error) {
    return { ok: false, output: error.message };
  } finally {
    if (stagingDirectory) fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
});

app.whenReady().then(() => {
  app.setName('Arca');
  if (process.platform === 'darwin') {
    const iconPath = path.join(process.resourcesPath, 'icon.icns');
    const dockIcon = nativeImage.createFromPath(iconPath);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
