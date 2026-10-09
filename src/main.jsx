import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Check, ChevronRight, CircleHelp, File, FileArchive, FileSpreadsheet, FileText, Folder, FolderOpen, Info, KeyRound, LoaderCircle, Mail, Search, ShieldCheck, X } from 'lucide-react';
import appMetadata from '../package.json';
import './styles.css';

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toLocaleString('es-MX', { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

function kindForEntry(entry) {
  if (entry.isDirectory) return 'Carpeta';
  const extension = entry.name.split('.').pop()?.toLowerCase();
  const names = { pdf: 'Documento PDF', doc: 'Documento Word', docx: 'Documento Word', xls: 'Hoja de cálculo', xlsx: 'Hoja de cálculo', txt: 'Documento de texto', csv: 'Hoja de cálculo', jpg: 'Imagen', jpeg: 'Imagen', png: 'Imagen', gif: 'Imagen', mp4: 'Vídeo', mov: 'Vídeo' };
  return names[extension] || (extension ? `${extension.toUpperCase()} archivo` : 'Archivo');
}

function iconForEntry(entry) {
  if (entry.isDirectory) return <Folder size={16} />;
  const extension = entry.name.split('.').pop()?.toLowerCase();
  if (['xls', 'xlsx', 'csv'].includes(extension)) return <FileSpreadsheet size={16} />;
  if (['txt', 'md', 'pdf', 'doc', 'docx'].includes(extension)) return <FileText size={16} />;
  return <File size={16} />;
}

function visibleEntries(entries, folderPath, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery) {
    return entries.filter((entry) => entry.path.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.path.localeCompare(right.path));
  }
  const prefix = folderPath ? `${folderPath}/` : '';
  const folders = new Map();
  const files = new Map();
  for (const entry of entries) {
    const entryPath = entry.path.replace(/^\/+|\/+$/g, '');
    if (!entryPath.startsWith(prefix)) continue;
    const remainder = entryPath.slice(prefix.length);
    if (!remainder) continue;
    const [firstSegment, ...rest] = remainder.split('/');
    if (rest.length) {
      const virtualPath = `${prefix}${firstSegment}`;
      if (!folders.has(virtualPath)) folders.set(virtualPath, { path: virtualPath, name: firstSegment, isDirectory: true, size: null, modified: '' });
    } else if (entry.isDirectory) {
      folders.set(entryPath, { ...entry, path: entryPath, name: firstSegment });
    } else files.set(entryPath, { ...entry, path: entryPath, name: firstSegment });
  }
  const rows = new Map([...files, ...folders]);
  return Array.from(rows.values()).sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name));
}

function ProgressBar({ progress, stage }) {
  const labels = { preparing: 'Preparando archivo…', password: 'Esperando contraseña…', checking: 'Comprobando contraseña…', extracting: 'Extrayendo archivos…', testing: 'Comprobando integridad…', compressing: 'Creando archivo comprimido…', listing: 'Leyendo contenido…' };
  return <div className="operation-progress" aria-live="polite"><span>{labels[stage] || 'Procesando…'}</span><div className="operation-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><div className={progress === 0 ? 'operation-fill indeterminate' : 'operation-fill'} style={{ width: progress === 0 ? '28%' : `${progress}%` }} /></div><strong>{progress}%</strong></div>;
}

function ResultNotice({ result, onOpenLocation }) {
  if (!result) return null;
  return <div className={result.ok ? 'result-notice success' : 'result-notice failure'}><div className="result-notice-icon">{result.ok ? <Check size={14} /> : <X size={14} />}</div><div className="result-notice-copy"><strong title={result.label}>{result.label}</strong><span title={result.detail}>{result.detail}</span></div>{result.location && <button className="notice-action" onClick={() => onOpenLocation(result.location)}><FolderOpen size={13} /> Abrir carpeta</button>}</div>;
}

function StatusBar({ busy, progress, stage, result, archive, search, resultCount, onOpenLocation }) {
  return <footer className="statusbar" aria-live="polite">
    {busy
      ? <ProgressBar progress={progress} stage={stage} />
      : result
        ? <ResultNotice result={result} onOpenLocation={onOpenLocation} />
        : archive
          ? <div className="archive-summary"><span>{search.trim() ? `${resultCount} resultados` : `${archive.fileCount} archivos y ${archive.folderCount} carpetas`}</span><span>{formatBytes(archive.size)} · {archive.format.toUpperCase()}</span></div>
          : null}
  </footer>;
}

function ArchiveInfoDialog({ archive, onClose }) {
  if (!archive) return null;
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="info-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-info-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="info-dialog-header">
        <div className="info-dialog-heading"><div className="info-dialog-icon"><Info size={20} /></div><div><h2 id="archive-info-title">Información del archivo</h2><p>{archive.name}</p></div></div>
        <button className="info-close" onClick={onClose} aria-label="Cerrar información"><X size={17} /></button>
      </div>
      <dl className="archive-details">
        <div><dt>Formato</dt><dd>{archive.format.toUpperCase()}</dd></div>
        <div><dt>Tamaño</dt><dd>{formatBytes(archive.size)}</dd></div>
        <div><dt>Contenido</dt><dd>{archive.fileCount} archivos · {archive.folderCount} carpetas</dd></div>
        <div><dt>Ubicación</dt><dd className="archive-location" title={archive.path}>{archive.path}</dd></div>
      </dl>
    </section>
  </div>;
}

function AboutDialog({ onClose }) {
  const dialogRef = useRef(null);
  const [contactError, setContactError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function openContact() {
    setContactError('');
    try {
      const response = await window.myUnrar.openDeveloperEmail();
      if (!response.ok) setContactError('No se pudo abrir tu aplicación de correo.');
    } catch {
      setContactError('No se pudo abrir tu aplicación de correo.');
    }
  }

  return <dialog ref={dialogRef} className="about-dialog" aria-labelledby="about-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="about-card">
      <button type="button" className="info-close about-close" onClick={onClose} aria-label="Cerrar acerca de Arca" autoFocus><X size={17} /></button>
      <img className="about-icon" src="./arca-icon.png" alt="" />
      <h2 id="about-title">Arca</h2>
      <span className="about-version">Versión {appMetadata.version}</span>
      <p className="about-description">Tus archivos, en un solo lugar.<br />Explora, crea y extrae archivos RAR, 7z y ZIP.</p>
      <div className="developer-card">
        <span className="developer-label">Desarrollador</span>
        <strong>{appMetadata.author.name}</strong>
        <button type="button" className="developer-email" onClick={openContact} aria-label={`Contactar al desarrollador: ${appMetadata.author.email}`}><Mail size={14} />{appMetadata.author.email}</button>
        {contactError && <p className="contact-error" role="alert">{contactError}</p>}
      </div>
    </section>
  </dialog>;
}

function App() {
  const [screen, setScreen] = useState('archive');
  const [archive, setArchive] = useState(null);
  const [compressFormat, setCompressFormat] = useState('rar');
  const [folderPath, setFolderPath] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('idle');
  const [result, setResult] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [passwordRequest, setPasswordRequest] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const rows = useMemo(() => archive ? visibleEntries(archive.entries, folderPath, search) : [], [archive, folderPath, search]);
  const crumbs = folderPath ? folderPath.split('/') : [];

  async function loadArchive(archivePath) {
    if (busy) return;
    if (!/\.(rar|7z|zip)$/i.test(archivePath || '')) { setResult({ ok: false, label: 'Formato no compatible', detail: 'Abre un archivo con extensión .rar, .7z o .zip.' }); return; }
    setBusy(true); setProgress(0); setProgressStage('listing'); setResult(null);
    try {
      const response = await window.myUnrar.openArchive(archivePath);
      if (!response.ok) { setResult({ ok: false, label: response.cancelled ? 'Apertura cancelada' : 'No se pudo abrir el archivo', detail: response.output || '' }); return; }
      setArchive(response.archive); setFolderPath(''); setSearch(''); setSearchOpen(false); setInfoOpen(false); setScreen('archive');
    } catch (error) { setResult({ ok: false, label: 'No se pudo abrir el archivo', detail: error.message }); }
    finally { setPasswordRequest(null); setPassword(''); setPasswordSubmitting(false); setBusy(false); }
  }

  async function chooseArchive() {
    if (busy) return;
    const selection = await window.myUnrar.chooseArchive();
    if (selection.ok) loadArchive(selection.path);
  }

  function showArchiveWorkspace() {
    if (busy) return;
    window.myUnrar.closeArchive();
    setArchive(null); setFolderPath(''); setSearch(''); setSearchOpen(false); setInfoOpen(false); setResult(null); setScreen('archive');
  }

  function showCompressionWorkspace() {
    if (busy) return;
    window.myUnrar.closeArchive();
    setArchive(null); setFolderPath(''); setSearch(''); setSearchOpen(false); setInfoOpen(false); setResult(null); setScreen('compress');
  }

  async function extractArchive() {
    if (!archive || busy) return;
    setBusy(true); setProgress(0); setProgressStage('preparing'); setResult(null);
    try {
      const response = await window.myUnrar.extractArchive(archive.path);
      if (!response.ok) { setResult({ ok: false, label: response.cancelled ? 'Extracción cancelada' : 'No se pudo extraer', detail: response.output || '' }); return; }
      const expected = archive.fileCount;
      const complete = expected === response.filesExtracted;
      setResult({ ok: complete, label: complete ? 'Extracción completa' : 'Extracción terminada con diferencias', detail: complete ? `${response.filesExtracted} de ${expected} archivos extraídos correctamente.` : `${response.filesExtracted} de ${expected} archivos aparecen en la carpeta final.`, location: response.location });
    } catch (error) { setResult({ ok: false, label: 'No se pudo extraer', detail: error.message }); }
    finally { setPasswordRequest(null); setPassword(''); setPasswordSubmitting(false); setBusy(false); }
  }

  async function testArchive() {
    if (!archive || busy) return;
    setBusy(true); setProgress(0); setProgressStage('testing'); setResult(null);
    try {
      const response = await window.myUnrar.testArchive(archive.path);
      setResult(response.ok ? { ok: true, label: 'Archivo comprobado', detail: `${archive.fileCount} archivos sin errores de integridad.` } : { ok: false, label: response.cancelled ? 'Comprobación cancelada' : 'El archivo no superó la comprobación', detail: response.output || '' });
    } catch (error) { setResult({ ok: false, label: 'No se pudo comprobar el archivo', detail: error.message }); }
    finally { setPasswordRequest(null); setPassword(''); setPasswordSubmitting(false); setBusy(false); }
  }

  async function compress(paths) {
    if (busy || paths.length === 0) return;
    setBusy(true); setProgress(0); setProgressStage('compressing'); setResult(null);
    try {
      const response = await window.myUnrar.compressDropped(paths, compressFormat);
      setResult(response.ok ? { ok: true, label: `Archivo ${compressFormat.toUpperCase()} creado`, detail: response.location, location: response.location } : { ok: false, label: 'No se pudo crear el archivo', detail: response.output || '' });
    } catch (error) { setResult({ ok: false, label: 'No se pudo crear el archivo', detail: error.message }); }
    finally { setBusy(false); }
  }

  function handleDrop(event) {
    event.preventDefault(); event.stopPropagation(); setDragging(false);
    const paths = window.myUnrar.getDroppedPaths(Array.from(event.dataTransfer.files));
    if (screen === 'compress') compress(paths);
    else if (paths.length === 1) loadArchive(paths[0]);
    else setResult({ ok: false, label: 'Suelta un solo archivo', detail: 'Para abrirlo en el gestor.' });
  }
  function submitPassword(event) { event.preventDefault(); if (!passwordRequest || !password || passwordSubmitting) return; window.myUnrar.providePassword(passwordRequest.operationId, password); setPassword(''); setPasswordSubmitting(true); }
  function cancelPassword() { if (passwordRequest) window.myUnrar.cancelPassword(passwordRequest.operationId); setPasswordRequest(null); setPassword(''); setPasswordSubmitting(false); }
  function setCrumb(index) { setFolderPath(index < 0 ? '' : crumbs.slice(0, index + 1).join('/')); setSearch(''); }

  useEffect(() => {
    const stopOpenArchive = window.myUnrar.onOpenRar((archivePath) => loadArchive(archivePath));
    const stopPasswordRequest = window.myUnrar.onPasswordRequired((request) => { setPasswordRequest(request); setPassword(''); setPasswordSubmitting(false); });
    const stopProgress = window.myUnrar.onProgress(({ percent, stage }) => { setProgress(Math.max(0, Math.min(100, percent))); setProgressStage(stage); if (stage === 'extracting' || stage === 'testing' || stage === 'compressing' || stage === 'complete') { setPasswordRequest(null); setPassword(''); setPasswordSubmitting(false); } });
    return () => { stopOpenArchive(); stopPasswordRequest(); stopProgress(); };
  }, []);

  useEffect(() => {
    if (!result || busy) return undefined;
    const duration = result.location || !result.ok ? 9_000 : 5_000;
    const timeout = window.setTimeout(() => setResult(null), duration);
    return () => window.clearTimeout(timeout);
  }, [busy, result]);

  const dropHandlers = { onDragEnter: (event) => { event.preventDefault(); setDragging(true); }, onDragOver: (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }, onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }, onDrop: handleDrop };

  return <div className="app" {...dropHandlers}>
    <header className="titlebar"><div /><div className="archive-title"><img src="./arca-icon.png" alt="" /><strong>Arca</strong></div><div /></header>
    <div className="toolbar">
      <button className={screen === 'archive' ? 'tool-button active' : 'tool-button'} onClick={showArchiveWorkspace} disabled={busy}><Archive size={19} /><span>Abrir</span></button>
      <button className="tool-button" onClick={extractArchive} disabled={!archive || busy}><ArrowDownToLine size={19} /><span>Extraer</span></button>
      <button className="tool-button" onClick={testArchive} disabled={!archive || busy}><ShieldCheck size={19} /><span>Comprobar</span></button>
      <span className="tool-divider" />
      <button className={searchOpen ? 'tool-button active' : 'tool-button'} onClick={() => { setSearchOpen((open) => !open); setSearch(''); }} disabled={!archive || busy}><Search size={19} /><span>Buscar</span></button>
      <button className={screen === 'compress' ? 'tool-button active' : 'tool-button'} onClick={showCompressionWorkspace} disabled={busy}><ArrowUpFromLine size={19} /><span>Crear</span></button>
      <span className="tool-divider" />
      <button className="tool-button" onClick={() => setInfoOpen(true)} disabled={!archive || busy}><Info size={19} /><span>Info</span></button>
      <button className={aboutOpen ? 'tool-button about-button active' : 'tool-button about-button'} onClick={() => { setInfoOpen(false); setAboutOpen(true); }} disabled={busy} aria-label="Acerca de Arca"><CircleHelp size={19} /><span>Acerca de</span></button>
    </div>
    <main className="workspace">
      {screen === 'compress' ? <section className="empty-workspace"><div className="empty-icon"><Archive size={30} /></div><h1>Crear archivo comprimido</h1><p>Selecciona el formato y arrastra los archivos que quieres guardar.</p><div className="format-switch" role="group" aria-label="Formato de compresión"><button className={compressFormat === 'rar' ? 'selected' : ''} onClick={() => setCompressFormat('rar')}>RAR</button><button className={compressFormat === '7z' ? 'selected' : ''} onClick={() => setCompressFormat('7z')}>7z</button><button className={compressFormat === 'zip' ? 'selected' : ''} onClick={() => setCompressFormat('zip')}>ZIP</button></div><div className={dragging ? 'drop-card dragging' : 'drop-card'}><ArrowUpFromLine size={25} /><strong>Arrastra aquí los archivos</strong><span>Se creará un archivo .{compressFormat} junto al primero.</span></div></section>
        : !archive ? <section className="empty-workspace"><div className="empty-icon"><FileArchive size={30} /></div><h1>Abre un archivo comprimido</h1><p>Consulta su contenido antes de extraerlo.</p><button type="button" className={dragging ? 'drop-card open-archive dragging' : 'drop-card open-archive'} onClick={chooseArchive}><ArrowDownToLine size={25} /><strong>Arrastra aquí un archivo .rar, .7z o .zip</strong><span>El contenido se mostrará en este gestor.</span></button></section>
        : <section className="manager">
          <div className="navigation-row">
            <button className="nav-icon" onClick={() => setCrumb(crumbs.length - 2)} disabled={!folderPath || busy} aria-label="Subir una carpeta"><ArrowLeft size={16} /></button>
            <div className="breadcrumbs">
              <button onClick={() => setCrumb(-1)}>Archivo</button>
              {crumbs.map((crumb, index) => <React.Fragment key={`${crumb}-${index}`}><ChevronRight size={14} /><button onClick={() => setCrumb(index)}>{crumb}</button></React.Fragment>)}
            </div>
            {searchOpen && <label className="search-box"><Search size={15} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en el archivo" /><button onClick={() => { setSearch(''); setSearchOpen(false); }} aria-label="Cerrar búsqueda"><X size={14} /></button></label>}
          </div>
          <section className="file-table-wrap">
            <table className="file-table">
              <thead><tr><th>Nombre</th><th>Fecha de modificación</th><th>Tipo</th><th>Tamaño</th></tr></thead>
              <tbody>
                {rows.map((entry) => <tr key={`${entry.isDirectory ? 'folder' : 'file'}:${entry.path}`} className={entry.isDirectory ? 'folder-row' : ''} onDoubleClick={() => entry.isDirectory && !search && setFolderPath(entry.path)}>
                  <td><span className={entry.isDirectory ? 'entry-icon folder' : 'entry-icon'}>{iconForEntry(entry)}</span><span className="entry-name">{search ? entry.path : entry.name}</span></td>
                  <td>{entry.modified || '—'}</td><td>{kindForEntry(entry)}</td><td>{formatBytes(entry.size)}</td>
                </tr>)}
                {rows.length === 0 && <tr><td className="empty-table" colSpan="4">{search ? 'No hay resultados para esta búsqueda.' : 'Esta carpeta está vacía.'}</td></tr>}
              </tbody>
            </table>
          </section>
        </section>}
    </main>
    <StatusBar busy={busy} progress={progress} stage={progressStage} result={result} archive={archive} search={search} resultCount={rows.length} onOpenLocation={(location) => window.myUnrar.openLocation(location)} />
    {infoOpen && <ArchiveInfoDialog archive={archive} onClose={() => setInfoOpen(false)} />}
    {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    {passwordRequest && <div className="modal-backdrop"><form className="password-dialog" onSubmit={submitPassword}><div className="password-icon"><KeyRound size={20} /></div><h2>Archivo protegido</h2><p className="password-file">{passwordRequest.archiveName}</p><label className="password-label" htmlFor="archive-password">Contraseña</label><input id="archive-password" className="password-input" type="password" autoFocus autoComplete="current-password" maxLength={127} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Escribe la contraseña" disabled={passwordSubmitting} /><p className="password-privacy">{passwordRequest.attempt > 1 ? 'Esa contraseña no funcionó. Inténtalo de nuevo.' : 'Se recuerda solo mientras este archivo esté abierto.'}</p><div className="password-actions"><button className="secondary-button" type="button" onClick={cancelPassword}>Cancelar</button><button className="primary-button" type="submit" disabled={!password || passwordSubmitting}>{passwordSubmitting ? <LoaderCircle className="spinner" size={16} /> : <KeyRound size={16} />}{passwordSubmitting ? 'Comprobando…' : 'Continuar'}</button></div></form></div>}
    {dragging && <div className="drop-overlay" aria-hidden="true"><div className="overlay-card"><FileArchive size={30} /><strong>{screen === 'compress' ? 'Suelta para crear el archivo' : 'Suelta para abrir el archivo'}</strong></div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
