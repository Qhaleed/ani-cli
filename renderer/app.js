const $ = (selector) => document.querySelector(selector);

const form = $('#launchForm');
const searchButton = $('#launchButton');
const message = $('#formMessage');
const welcomeSection = $('#welcomeSection');
const resultsSection = $('#resultsSection');
const episodesSection = $('#episodesSection');
const playerSection = $('#playerSection');
const contentColumn = $('#contentColumn');
const video = $('#videoPlayer');
const videoLoading = $('#videoLoading');

let currentAnime = null;
let hlsInstance = null;

function setMessage(text, type = '') {
  message.textContent = text;
  message.className = `form-message ${type}`.trim();
}

function setBusy(busy, label = 'Search ani-cli') {
  searchButton.disabled = busy;
  searchButton.querySelector('span').textContent = label;
}

function selectedOptions() {
  return {
    quality: $('#quality').value || 'best',
    dub: $('#dub').checked,
    download: $('#download').checked,
  };
}

function showSection(section) {
  [welcomeSection, resultsSection, episodesSection, playerSection].forEach((item) => item.classList.add('hidden'));
  if (!section) return;
  section.classList.remove('hidden');
  contentColumn.scrollTop = 0;
  if (window.innerWidth <= 900) {
    requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

function stopPlayback() {
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
}

function renderSearchResults(results) {
  const container = $('#animeResults');
  container.innerHTML = '';
  $('#resultCount').textContent = `${results.length} result${results.length === 1 ? '' : 's'}`;
  if (!results.length) {
    container.innerHTML = '<div class="empty-state">No anime found. Try a different title.</div>';
    return;
  }
  results.forEach((anime, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'anime-card';
    button.innerHTML = `<span class="anime-index">${String(index + 1).padStart(2, '0')}</span><span class="anime-title"></span>`;
    button.querySelector('.anime-title').textContent = anime.title;
    button.addEventListener('click', () => loadEpisodes(anime));
    container.appendChild(button);
  });
}

async function loadEpisodes(anime) {
  currentAnime = anime;
  showSection(episodesSection);
  $('#selectedTitle').textContent = anime.title;
  $('#episodeResults').innerHTML = '<div class="empty-state">Loading episodes…</div>';
  setMessage(`Loading episodes for ${anime.title}…`);
  try {
    const episodes = await window.aniCli.getEpisodes(anime.id);
    const container = $('#episodeResults');
    container.innerHTML = '';
    if (!episodes.length) {
      container.innerHTML = '<div class="empty-state">No episodes were returned for this title.</div>';
      return;
    }
    episodes.forEach((episode) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'episode-button';
      button.textContent = `Episode ${episode.number}`;
      button.addEventListener('click', () => startEpisode(episode));
      container.appendChild(button);
    });
    setMessage('Choose an episode to watch.');
  } catch (error) {
    $('#episodeResults').innerHTML = '';
    setMessage(error.message || 'Could not load episodes.', 'error');
  }
}

async function startEpisode(episode) {
  if (!currentAnime) return;
  const options = selectedOptions();
  const buttons = [...document.querySelectorAll('.episode-button')];
  buttons.forEach((button) => { button.disabled = true; });
  setMessage(options.download ? 'Preparing download…' : 'Loading stream…');
  try {
    if (options.download) {
      const result = await window.aniCli.downloadEpisode({ ...options, animeId: currentAnime.id, episode: episode.number, title: currentAnime.title });
      if (!result.cancelled) setMessage(`Saved episode ${episode.number}.`, 'success');
      else setMessage('Download cancelled.');
      return;
    }
    const streamUrl = await window.aniCli.getStream({ ...options, animeId: currentAnime.id, episode: episode.number });
    await playStream(streamUrl, `${currentAnime.title} · Episode ${episode.number}`);
  } catch (error) {
    setMessage(error.message || 'Could not load this episode.', 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function playStream(url, title) {
  showSection(playerSection);
  $('#playerHeading').textContent = title;
  videoLoading.textContent = 'Loading stream…';
  videoLoading.classList.remove('hidden');
  stopPlayback();

  if (window.Hls && window.Hls.isSupported()) {
    hlsInstance = new window.Hls({ enableWorker: true });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(video);
    hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
      videoLoading.classList.add('hidden');
      video.play().catch(() => {});
    });
    hlsInstance.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        videoLoading.textContent = 'This stream could not be played in the embedded player.';
        setMessage('The stream was found, but playback failed in the embedded player.', 'error');
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
      videoLoading.classList.add('hidden');
      video.play().catch(() => {});
    }, { once: true });
  } else {
    videoLoading.textContent = 'Embedded HLS playback is unavailable.';
    throw new Error('Embedded HLS playback is unavailable in this app build.');
  }
}

async function refreshRuntime() {
  const info = await window.aniCli.getRuntimeInfo();
  $('#platformPill').textContent = `● ${info.platformLabel}`;
  $('#platformPill').classList.toggle('ready', info.ready);
  $('#statusDot').className = `status-dot ${info.ready ? 'ready' : 'error'}`;
  $('#statusText').textContent = info.ready ? 'Ready to browse' : 'Setup needed';
  $('#statusDetail').textContent = info.ready ? 'Search and playback stay in this window' : `Missing: ${info.missing.join(', ')}`;
  searchButton.disabled = !info.ready;
  if (!info.ready) setMessage(`Install ${info.missing.join(' and ')} to enable search.`, 'error');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = $('#query').value.trim();
  if (!query) {
    $('#query').focus();
    setMessage('Enter an anime title first.', 'error');
    return;
  }
  setBusy(true, 'Searching…');
  stopPlayback();
  showSection(resultsSection);
  $('#animeResults').innerHTML = '<div class="empty-state">Searching AniDB…</div>';
  try {
    const results = await window.aniCli.searchAnime(query);
    renderSearchResults(results);
    setMessage(results.length ? 'Choose a title to see its episodes.' : 'No results found.');
  } catch (error) {
    $('#animeResults').innerHTML = '';
    setMessage(error.message || 'Search failed.', 'error');
  } finally {
    setBusy(false);
  }
});

$('#backToResults').addEventListener('click', () => showSection(resultsSection));
$('#closePlayer').addEventListener('click', () => {
  stopPlayback();
  showSection(episodesSection);
});
$('#browseButton').addEventListener('click', () => {
  stopPlayback();
  showSection(welcomeSection);
  $('#query').focus();
});
const legalDialog = $('#legalDialog');
function closeLegalDialog() {
  if (legalDialog.open) legalDialog.close();
}
$('#legalButton').addEventListener('click', () => legalDialog.showModal());
$('#closeLegal').addEventListener('click', closeLegalDialog);
$('#doneLegal').addEventListener('click', closeLegalDialog);
$('#openLicense').addEventListener('click', () => window.aniCli.openLicense());
$('#openNotices').addEventListener('click', () => window.aniCli.openNotices());
legalDialog.addEventListener('click', (event) => {
  if (event.target === legalDialog) closeLegalDialog();
});
$('#setupButton').addEventListener('click', () => window.aniCli.openSetup());
$('#sourceButton').addEventListener('click', () => window.aniCli.openSource());
$('#footerSource').addEventListener('click', () => window.aniCli.openSource());

refreshRuntime().catch(() => setMessage('Unable to inspect the local ani-cli setup.', 'error'));
