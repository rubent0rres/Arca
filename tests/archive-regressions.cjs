const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'electron/main.cjs'), 'utf8');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'src/main.jsx'), 'utf8');
const samplePassword = 'myUnrar-regression-password';
const rar = '/Applications/rar/rar';
const sevenZip = path.join(projectRoot, 'vendor/7zip/7zz');

function createBackend() {
  const handlers = new Map();
  const listeners = new Map();
  const appEvents = new Map();
  let prompts = 0;
  let answers = [];
  const electron = {
    app: { isPackaged: false, on: (name, handler) => appEvents.set(name, handler), whenReady: () => ({ then() {} }) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, listener) => listeners.set(name, listener) },
    BrowserWindow: class {},
    dialog: {}, nativeImage: {}, shell: {},
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : require(name),
    __dirname: path.join(projectRoot, 'electron'),
    process, console,
    testWindow: {
      isDestroyed: () => false,
      webContents: {
        send(name, request) {
          if (name !== 'myunrar:password-required') return;
          prompts += 1;
          const password = prompts > 8 ? null : answers.length ? answers.shift() : samplePassword;
          queueMicrotask(() => password === null
            ? listeners.get('myunrar:cancel-password')({}, request.operationId)
            : listeners.get('myunrar:provide-password')({}, { operationId: request.operationId, password }));
        },
      },
    },
  });
  vm.runInContext(mainSource + '\nmainWindow = testWindow; globalThis.parsers = { parseRarEntries, parseSevenZipEntries, normalizeArchiveEntries };', context);
  return {
    open: (archive) => handlers.get('myunrar:open-archive')({}, archive),
    extract: (archive) => handlers.get('myunrar:extract-archive')({}, archive),
    check: (archive) => handlers.get('myunrar:test-archive')({}, archive),
    close: () => listeners.get('myunrar:close-archive')(),
    get prompts() { return prompts; },
    answer: (...passwords) => { answers = passwords; },
    parsers: context.parsers,
  };
}

function createFixture(format, encryptedHeaders = false, includeEmptyFile = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myunrar-regression-'));
  const archive = path.join(directory, `sample.${format}`);
  fs.mkdirSync(path.join(directory, 'idea', 'subcarpeta'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'idea', 'archivo con espacios.txt'), 'Primer archivo: ñ y acentos.');
  fs.writeFileSync(path.join(directory, 'idea', 'subcarpeta', 'dos.txt'), 'Segundo archivo.');
  if (includeEmptyFile) fs.writeFileSync(path.join(directory, 'idea', 'vacio.txt'), '');
  const args = format === 'rar'
    ? ['a', '-idq', '-r', `${encryptedHeaders ? '-hp' : '-p'}${samplePassword}`, archive, 'idea']
    : ['a', `-t${format}`, `-p${samplePassword}`, ...(encryptedHeaders ? ['-mhe=on'] : []), archive, 'idea'];
  const created = spawnSync(format === 'rar' ? rar : sevenZip, args, { cwd: directory, encoding: 'utf8', timeout: 20_000 });
  assert.equal(created.status, 0, 'No se pudo crear el archivo de muestra.');
  return { directory, archive, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

const viewContext = vm.createContext({});
const viewStart = rendererSource.indexOf('function visibleEntries(');
const viewEnd = rendererSource.indexOf('\nfunction ProgressBar(', viewStart);
vm.runInContext(rendererSource.slice(viewStart, viewEnd), viewContext);
const visibleEntries = viewContext.visibleEntries;

function verifyEntries(archive) {
  assert.equal(archive.fileCount, 2);
  assert.equal(archive.folderCount, 2);
  assert.equal(new Set(archive.entries.map((entry) => entry.path)).size, archive.entries.length);
  assert.ok(archive.entries.every((entry) => !/enter password|sample\.(rar|7z|zip)/i.test(entry.path)));
  assert.ok(archive.entries.find((entry) => entry.path === 'idea').isDirectory);
  assert.ok(archive.entries.find((entry) => entry.path.endsWith('dos.txt')).size > 0);
  for (let navigation = 0; navigation < 10; navigation += 1) {
    const rootRows = visibleEntries(archive.entries, '', '');
    assert.equal(rootRows.length, 1);
    assert.equal(rootRows[0].path, 'idea');
    assert.equal(rootRows[0].isDirectory, true);
    const folderRows = visibleEntries(archive.entries, 'idea', '');
    assert.equal(folderRows.length, 2);
    assert.equal(new Set(folderRows.map((entry) => entry.path)).size, 2);
    assert.equal(visibleEntries(archive.entries, 'idea/subcarpeta', '').length, 1);
  }
}

for (const [format, encryptedHeaders] of [['rar', false], ['rar', true], ['7z', false], ['7z', true], ['zip', false]]) {
  test(`${format}: navegación única y una contraseña para abrir, extraer y comprobar${encryptedHeaders ? ' con nombres cifrados' : ''}`, { timeout: 30_000 }, async () => {
    const fixture = createFixture(format, encryptedHeaders);
    try {
      const backend = createBackend();
      const opened = await backend.open(fixture.archive);
      assert.equal(opened.ok, true, opened.output);
      verifyEntries(opened.archive);
      assert.equal(backend.prompts, 1);
      const extracted = await backend.extract(fixture.archive);
      assert.equal(extracted.ok, true, extracted.output);
      assert.equal(extracted.filesExtracted, 2);
      assert.equal(fs.readFileSync(path.join(extracted.location, 'idea/subcarpeta/dos.txt'), 'utf8'), 'Segundo archivo.');
      const checked = await backend.check(fixture.archive);
      assert.equal(checked.ok, true, checked.output);
      assert.equal(backend.prompts, 1, 'Se volvió a solicitar la contraseña del mismo archivo.');
      backend.close();
      const reopened = await backend.open(fixture.archive);
      assert.equal(reopened.ok, true, reopened.output);
      assert.equal(backend.prompts, 2, 'La contraseña se conservó después de cerrar el archivo.');
    } finally { fixture.cleanup(); }
  });
}

test('Una contraseña incorrecta se vuelve a solicitar y no deja una extracción parcial', { timeout: 30_000 }, async () => {
  const fixture = createFixture('rar', true);
  try {
    const backend = createBackend();
    backend.answer('incorrecta', samplePassword);
    const opened = await backend.open(fixture.archive);
    assert.equal(opened.ok, true, opened.output);
    assert.equal(backend.prompts, 2);
    verifyEntries(opened.archive);
    const extracted = await backend.extract(fixture.archive);
    assert.equal(extracted.ok, true, extracted.output);
    assert.equal(extracted.filesExtracted, 2);
    assert.equal(backend.prompts, 2);
    assert.ok(!fs.readdirSync(fixture.directory).some((name) => name.includes('.myunrar-')));
  } finally { fixture.cleanup(); }
});

for (const format of ['rar', '7z', 'zip']) {
  test(`${format}: listar nombres visibles no acepta una contraseña incorrecta`, { timeout: 30_000 }, async () => {
    const fixture = createFixture(format);
    try {
      const backend = createBackend();
      backend.answer('incorrecta', samplePassword);
      const opened = await backend.open(fixture.archive);
      assert.equal(opened.ok, true, opened.output);
      assert.equal(backend.prompts, 2, 'La contraseña incorrecta permitió abrir el archivo.');
      verifyEntries(opened.archive);
      const extracted = await backend.extract(fixture.archive);
      assert.equal(extracted.ok, true, extracted.output);
      assert.equal(extracted.filesExtracted, 2);
      assert.equal(backend.prompts, 2);
    } finally { fixture.cleanup(); }
  });
}

test('Cambiar de archivo o modificarlo descarta la contraseña anterior', { timeout: 30_000 }, async () => {
  const first = createFixture('rar', true);
  const second = createFixture('zip');
  try {
    const backend = createBackend();
    assert.equal((await backend.open(first.archive)).ok, true);
    assert.equal((await backend.open(second.archive)).ok, true);
    assert.equal((await backend.open(first.archive)).ok, true);
    assert.equal(backend.prompts, 3);
    const stats = fs.statSync(first.archive);
    fs.utimesSync(first.archive, stats.atime, new Date(stats.mtimeMs + 2_000));
    assert.equal((await backend.open(first.archive)).ok, true);
    assert.equal(backend.prompts, 4);
  } finally { first.cleanup(); second.cleanup(); }
});

test('Las carpetas implícitas y rutas repetidas producen una sola fila', () => {
  const backend = createBackend();
  const entries = backend.parsers.normalizeArchiveEntries([
    { path: 'idea/archivo.txt', isDirectory: false, size: 10 },
    { path: 'idea\\archivo.txt', isDirectory: false, size: 10 },
    { path: 'idea', isDirectory: false, size: null },
    { path: 'idea/', isDirectory: true, size: null },
  ]);
  assert.equal(entries.length, 2);
  const rows = visibleEntries(entries, '', '');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isDirectory, true);
});

for (const format of ['rar', '7z', 'zip']) {
  test(`${format}: un archivo vacío no evita comprobar la contraseña de los datos`, { timeout: 30_000 }, async () => {
    const fixture = createFixture(format, false, true);
    try {
      const backend = createBackend();
      backend.answer('incorrecta', samplePassword);
      const opened = await backend.open(fixture.archive);
      assert.equal(opened.ok, true, opened.output);
      assert.equal(opened.archive.fileCount, 3);
      assert.equal(backend.prompts, 2);
      const extracted = await backend.extract(fixture.archive);
      assert.equal(extracted.ok, true, extracted.output);
      assert.equal(extracted.filesExtracted, 3);
      assert.equal(backend.prompts, 2);
    } finally { fixture.cleanup(); }
  });
}

test('Cancelar después de una contraseña incorrecta no abre el archivo', { timeout: 30_000 }, async () => {
  const fixture = createFixture('rar');
  try {
    const backend = createBackend();
    backend.answer('incorrecta', null);
    const cancelled = await backend.open(fixture.archive);
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.archive, undefined);
    assert.equal((await backend.open(fixture.archive)).ok, true);
    assert.equal(backend.prompts, 3);
  } finally { fixture.cleanup(); }
});
