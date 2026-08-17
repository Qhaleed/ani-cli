const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');

const isWindows = process.platform === 'win32';
const projectRoot = __dirname;

let mainWindow;
let apiWindow;

function commandExists(command) {
  if (path.isAbsolute(command)) return fs.existsSync(command);
  try {
    execFileSync(isWindows ? 'where.exe' : 'sh', isWindows ? [command] : ['-lc', `command -v ${JSON.stringify(command)}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function runtimeInfo() {
  const sourceReady = fs.existsSync(path.join(projectRoot, 'ani-cli', 'ani-cli'));
  const downloaders = ['yt-dlp', 'ffmpeg'].filter(commandExists);
  const missing = [];
  if (!sourceReady) missing.push('the bundled ani-cli source');

  return {
    platform: process.platform,
    platformLabel: isWindows ? 'Windows' : process.platform === 'darwin' ? 'macOS' : process.platform,
    sourceReady,
    dependencies: { downloaders },
    missing,
    ready: missing.length === 0,
  };
}

function createApiWindow() {
  if (apiWindow && !apiWindow.isDestroyed()) return apiWindow;
  apiWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  apiWindow.webContents.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  apiWindow.on('closed', () => { apiWindow = null; });
  return apiWindow;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadApiPage(url) {
  const window = createApiWindow();
  await new Promise((resolve, reject) => {
    const onFinish = () => { cleanup(); resolve(); };
    const onFail = (_event, code, description) => { cleanup(); reject(new Error(description || `AniDB page failed with code ${code}.`)); };
    const cleanup = () => {
      window.webContents.removeListener('did-finish-load', onFinish);
      window.webContents.removeListener('did-fail-load', onFail);
    };
    window.webContents.once('did-finish-load', onFinish);
    window.webContents.once('did-fail-load', onFail);
    window.loadURL(url).catch((error) => { cleanup(); reject(error); });
  });
  // Give a browser challenge, if present, time to complete its JavaScript turnstile.
  await wait(1200);
  return window;
}

async function executeApiScript(window, script, label) {
  try {
    return await window.webContents.executeJavaScript(script, true);
  } catch (error) {
    throw new Error(`${label}: ${error?.message || error}`);
  }
}

async function browserFetch(url) {
  const window = await loadApiPage('https://anidb.app/browse');
  const encodedUrl = JSON.stringify(url);
  const text = await executeApiScript(window, `fetch(${encodedUrl}).then((response) => response.text())`, 'AniDB request failed');
  if (!/just a moment|cloudflare/i.test(text)) return text;
  const fallbackPage = await loadApiPage(url);
  return executeApiScript(fallbackPage, 'document.body ? document.body.innerText : document.documentElement.innerText', 'AniDB fallback request failed');
}

function decodeHtml(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function parseSearchHtml(html) {
  const results = [];
  const seen = new Set();
  const linkPattern = /<a\b[^>]*href=["'](?:https?:\/\/anidb\.app)?\/anime\/([^/"'?#]+-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html)) && results.length < 30) {
    const id = match[1];
    const imageAlt = match[2].match(/<img\b[^>]*alt=["']([^"']+)["']/i)?.[1];
    const title = decodeHtml(imageAlt || match[2]);
    if (title && !seen.has(id)) {
      seen.add(id);
      results.push({ id, title });
    }
  }
  return results;
}

function parseTitleDump(xml, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  const seen = new Set();
  for (const animeMatch of xml.matchAll(/<anime\s+aid="(\d+)"[^>]*>([\s\S]*?)<\/anime>/gi)) {
    const titles = [...animeMatch[2].matchAll(/<title\b([^>]*)>([\s\S]*?)<\/title>/gi)].map((match) => ({
      attributes: match[1],
      title: decodeHtml(match[2]),
    }));
    if (!titles.length || !terms.every((term) => titles.some((item) => item.title.toLowerCase().includes(term)))) continue;
    const preferred = titles.find((item) => /type="official"/.test(item.attributes) && /xml:lang="en"/.test(item.attributes))
      || titles.find((item) => /type="main"/.test(item.attributes))
      || titles[0];
    if (!seen.has(animeMatch[1])) {
      seen.add(animeMatch[1]);
      results.push({ id: `anime-${animeMatch[1]}`, title: preferred.title });
    }
    if (results.length >= 30) break;
  }
  return results;
}

async function titleDumpSearch(window, query) {
  const encodedUrl = JSON.stringify('https://anidb.net/api/anime-titles.xml.gz');
  const base64 = await executeApiScript(window, `(async () => {
    const response = await fetch(${encodedUrl});
    if (!response.ok) throw new Error('title dump returned HTTP ' + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  })()`, 'AniDB title fallback failed');
  const compressed = Buffer.from(base64, 'base64');
  let xml;
  try {
    xml = gunzipSync(compressed).toString('utf8');
  } catch (_) {
    xml = compressed.toString('utf8');
  }
  return parseTitleDump(xml, query);
}

async function browserSearch(query) {
  const window = await loadApiPage(`https://anidb.app/browse?q=${encodeURIComponent(query)}`);
  const html = await executeApiScript(window, 'document.documentElement ? document.documentElement.outerHTML : ""', 'AniDB page inspection failed');
  const items = parseSearchHtml(html);
  if (items.length) return items;
  try {
    const fallback = await titleDumpSearch(window, query);
    if (fallback.length) return fallback;
  } catch (error) {
    if (!/just a moment|cloudflare/i.test(html)) throw error;
  }
  throw new Error(/just a moment|cloudflare/i.test(html) ? 'AniDB is still asking for a browser check. Try Search again in a few seconds.' : 'No anime results were found.');
}

function parseEpisodeRows(text) {
  return [...text.matchAll(/"id":(\d+).*?"number":(\d+)/g)].map((match) => ({ id: match[1], number: Number(match[2]) }));
}

function extractStreamLink(text, languageCode) {
  const escapedCode = languageCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`"${escapedCode}"[\\s\\S]*?"embed_url":"([^"]+)"`));
  return match ? match[1].replaceAll('\\/', '/') : null;
}

function selectPlaylistUrl(playlist, quality) {
  const rows = [];
  const lines = playlist.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF')) continue;
    const height = Number(lines[index].match(/RESOLUTION=\d+x(\d+)/)?.[1] || 0);
    const url = lines[index + 1];
    if (url && !url.startsWith('#')) rows.push({ height, url });
  }
  if (!rows.length) return null;
  const exact = /^\d+p$/.test(quality) ? rows.find((row) => row.height === Number.parseInt(quality, 10)) : null;
  return (exact || [...rows].sort((a, b) => b.height - a.height)[0]).url;
}

async function getStreamUrl(options) {
  const episodesText = await browserFetch(`https://anidb.app/api/frontend/anime/${String(options.animeId).split('-').pop()}/episodes`);
  const episode = parseEpisodeRows(episodesText).find((row) => row.number === Number(options.episode));
  if (!episode) throw new Error(`Episode ${options.episode} was not found.`);
  const languageCode = options.dub ? 'eng' : 'jpn';
  const languageText = await browserFetch(`https://anidb.app/api/frontend/episode/${episode.id}/languages`);
  const embed = extractStreamLink(languageText, languageCode);
  if (!embed) throw new Error(`No ${options.dub ? 'dub' : 'sub'} source is available for this episode.`);
  const embedPage = await loadApiPage(embed);
  const embedHtml = await embedPage.webContents.executeJavaScript('document.documentElement.outerHTML', true);
  const masterMatch = embedHtml.match(/file:\s*'([^']+)'/);
  if (!masterMatch) throw new Error('The video source did not return a playlist.');
  const masterUrl = new URL(masterMatch[1], embed).href;
  const playlist = await browserFetch(masterUrl);
  const selected = selectPlaylistUrl(playlist, options.quality || 'best');
  if (!selected) throw new Error('No playable video qualities were returned.');
  return new URL(selected, masterUrl).href;
}

function safeFilename(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'ani-cli-video';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 820,
    minWidth: 900,
    minHeight: 680,
    title: 'ani-cli desktop',
    backgroundColor: '#0b0e14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // HLS manifests are fetched from the provider directly by hls.js.
      webSecurity: false,
      preload: path.join(projectRoot, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(projectRoot, 'renderer', 'index.html'));
}

ipcMain.handle('runtime-info', () => runtimeInfo());
ipcMain.handle('search-anime', async (_event, query) => browserSearch(String(query || '')));
ipcMain.handle('get-episodes', async (_event, animeId) => parseEpisodeRows(await browserFetch(`https://anidb.app/api/frontend/anime/${String(animeId || '').split('-').pop()}/episodes`)));
ipcMain.handle('get-stream', async (_event, options) => getStreamUrl(options));
ipcMain.handle('download-episode', async (_event, options) => {
  const info = runtimeInfo();
  if (!info.dependencies.downloaders.length) throw new Error('Install ffmpeg or yt-dlp to download episodes.');
  const defaultPath = path.join(app.getPath('downloads'), `${safeFilename(options.title)} - episode ${options.episode}.mp4`);
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Save episode',
    defaultPath,
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) return { cancelled: true };
  const streamUrl = await getStreamUrl(options);
  const downloader = info.dependencies.downloaders.includes('yt-dlp') ? 'yt-dlp' : 'ffmpeg';
  const args = downloader === 'yt-dlp'
    ? ['--no-part', '--no-mtime', '-o', saveResult.filePath, streamUrl]
    : ['-y', '-loglevel', 'error', '-i', streamUrl, '-c', 'copy', saveResult.filePath];
  await new Promise((resolve, reject) => {
    const child = spawn(downloader, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${downloader} could not download this episode.`)));
  });
  return { cancelled: false, filePath: saveResult.filePath };
});
ipcMain.handle('open-setup', () => shell.openExternal('https://github.com/pystardust/ani-cli#install'));
ipcMain.handle('open-source', () => shell.openExternal('https://github.com/pystardust/ani-cli'));
ipcMain.handle('open-license', () => shell.openPath(path.join(projectRoot, 'LICENSE')));
ipcMain.handle('open-notices', () => shell.openPath(path.join(projectRoot, 'THIRD-PARTY-NOTICES.md')));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (apiWindow && !apiWindow.isDestroyed()) apiWindow.destroy();
  if (process.platform !== 'darwin') app.quit();
});
