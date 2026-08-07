/*
  Catalogue : modifiez uniquement songs.json et déposez vos extraits dans assets/audio/.
  Les champs requis sont id, title, project, year et audio.
*/
const ROUND_SECONDS = 25;
const CHALLENGE_SECONDS = 90;
const HINTS_PER_ROUND = 3;

const $ = (selector) => document.querySelector(selector);
const ui = {
  setup: $('#setupScreen'), game: $('#gameScreen'), result: $('#resultScreen'),
  start: $('#startButton'), catalog: $('#catalogStatus'), best: $('#bestScore'), authMessage: $('#authMessage'), leaderboardButton: $('#leaderboardButton'), leaderboardPanel: $('#leaderboardPanel'), leaderboardClose: $('#leaderboardClose'), leaderboardStatus: $('#leaderboardStatus'), leaderboardList: $('#leaderboardList'), leaderboardTabs: document.querySelectorAll('.leaderboard-tab'),
  rounds: $('#roundPicker'), roundLabel: $('#roundLabel'), score: $('#scoreLabel strong'),
  timer: $('#timerProgress'), timerText: $('#timerText'), audio: $('#audioPlayer'),
  play: $('#playButton'), volume: $('#volumeControl'), volumeValue: $('#volumeValue'), waveform: $('#waveform'), playerState: $('#playerState'), soundcloud: $('#soundcloudPlayer'), soundcloudCredit: $('#soundcloudCredit'), reveal: $('#trackReveal'), revealCover: $('#revealCover'), revealType: $('#revealType'), revealTitle: $('#revealTitle'), revealMeta: $('#revealMeta'), playerPanel: $('.player-panel'),
  input: $('#guessInput'), validate: $('#validateButton'), feedback: $('#feedback'),
  hint: $('#hintButton'), hintCount: $('#hintCount'), hintText: $('#hintText'), skip: $('#skipButton'),
  finalScore: $('#finalScore'), resultMode: $('#resultMode'), bestTime: $('#bestTime'),
  correct: $('#correctCount'), record: $('#recordScore'), played: $('#playedList'), restart: $('#restartButton'), home: $('#homeButton')
};

let songs = [];
let state = {};
let soundcloudMessageHandler = null;
let currentUser = null;
let firestoreDb = null;
let accountBest = { solo: 0, challenge: 0 };
let leaderboardField = 'challengeRecord';
let accountBestReady = Promise.resolve();
const DEFAULT_VOLUME = 0.8;

const firebaseConfig = {
  apiKey: "AIzaSyBP0wsYbCndSRTPU7kLQX8SDzYKUL-PFrc",
  authDomain: "blind-test-ziak.firebaseapp.com",
  projectId: "blind-test-ziak",
  storageBucket: "blind-test-ziak.firebasestorage.app",
  messagingSenderId: "573383036931",
  appId: "1:573383036931:web:95dd70609a526ab24d3e36",
  measurementId: "G-M42N5JDPTK"
};

function normalise(value = '') {
  return value.toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/[^a-z0-9]/gi, '');
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function storageUid() { return currentUser?.uid || localStorage.getItem('ziak-blindtest-last-uid') || 'guest'; }
function bestKey(mode) { return `ziak-blindtest-best-${storageUid()}-${mode}`; }
function statsKey() { return `ziak-blindtest-stats-${storageUid()}`; }
function getBest(mode) { return Math.max(Number(localStorage.getItem(bestKey(mode))) || 0, Number(accountBest[mode]) || 0); }
function refreshBest() { ui.best.textContent = Math.max(getBest('solo'), getBest('challenge')); }
function getVolume() {
  const saved = Number(localStorage.getItem('ziak-blindtest-volume'));
  return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : DEFAULT_VOLUME;
}
function setVolume(value) {
  const volume = Math.min(1, Math.max(0, Number(value) || 0));
  ui.audio.volume = volume;
  if (ui.volume) ui.volume.value = String(Math.round(volume * 100));
  if (ui.volumeValue) ui.volumeValue.textContent = `${Math.round(volume * 100)}%`;
  localStorage.setItem('ziak-blindtest-volume', String(volume));
  if (state.scWidget?.setVolume) state.scWidget.setVolume(volume * 100);
  else if (state.current?.soundcloudUrl) sendSoundcloud('setVolume', volume * 100);
}
function autoplayTrack(track) {
  if (!state.current || state.current !== track || state.roundResolved || state.autoplayAttempted) return;
  state.autoplayAttempted = true;
  if (track.deezerTrackId || track.audio) {
    ui.audio.play().then(() => {
      setPlaying(true);
      clearClipTimer(); state.clipTimer = setTimeout(stopPlayback, 20000);
    }).catch(() => {
      state.autoplayAttempted = false;
      ui.playerState.textContent = 'APPUYE POUR ÉCOUTER';
    });
  } else if (state.scReady) {
    setVolume(getVolume());
    if (state.scWidget) {
      state.scWidget.seekTo(Number(track.clipStart || 0) * 1000); state.scWidget.play();
    } else {
      sendSoundcloud('seekTo', Number(track.clipStart || 0) * 1000); sendSoundcloud('play');
    }
    clearClipTimer(); state.clipTimer = setTimeout(stopPlayback, Number(track.clipDuration || 20) * 1000);
  }
}
function readLocalStats() {
  try { return JSON.parse(localStorage.getItem(statsKey()) || '{}') || {}; } catch { return {}; }
}
function withTimeout(promise, milliseconds = 7000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('timeout')), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
async function loadAccountBest(user) {
  localStorage.setItem('ziak-blindtest-last-uid', user?.uid || '');
  accountBest = {
    solo: Number(localStorage.getItem(`ziak-blindtest-best-${user?.uid || 'guest'}-solo`)) || 0,
    challenge: Number(localStorage.getItem(`ziak-blindtest-best-${user?.uid || 'guest'}-challenge`)) || 0
  };
  refreshBest();
  if (!firestoreDb || !user) { refreshBest(); return; }
  try {
    const snapshot = await withTimeout(firestoreDb.collection('users').doc(user.uid).get());
    if (snapshot.exists) {
      accountBest = {
        solo: Math.max(accountBest.solo, Number(snapshot.data().bestSolo) || 0),
        challenge: Math.max(accountBest.challenge, Number(snapshot.data().bestChallenge) || 0)
      };
      localStorage.setItem(`ziak-blindtest-best-${user.uid}-solo`, String(accountBest.solo));
      localStorage.setItem(`ziak-blindtest-best-${user.uid}-challenge`, String(accountBest.challenge));
    }
  } catch { /* Firestore reste optionnel tant que ses règles ne sont pas activées. */ }
  refreshBest();
}
async function migrateGuestBest(user) {
  if (!firestoreDb || !user) return;
  const guestSolo = Number(localStorage.getItem('ziak-blindtest-best-guest-solo')) || 0;
  const guestChallenge = Number(localStorage.getItem('ziak-blindtest-best-guest-challenge')) || 0;
  if (!guestSolo && !guestChallenge) return;
  const userRef = firestoreDb.collection('users').doc(user.uid);
  try {
    await firestoreDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(userRef);
      const previous = snapshot.exists ? snapshot.data() : {};
      transaction.set(userRef, {
        uid: user.uid,
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        record: Math.max(Number(previous.record) || 0, guestSolo, guestChallenge),
        bestSolo: Math.max(Number(previous.bestSolo) || 0, guestSolo),
        bestChallenge: Math.max(Number(previous.bestChallenge) || 0, guestChallenge),
        challengeRecord: Math.max(Number(previous.challengeRecord) || 0, guestChallenge),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    localStorage.removeItem('ziak-blindtest-best-guest-solo');
    localStorage.removeItem('ziak-blindtest-best-guest-challenge');
    accountBest.solo = Math.max(accountBest.solo, guestSolo);
    accountBest.challenge = Math.max(accountBest.challenge, guestChallenge);
    refreshBest();
  } catch (error) {
    console.error('Impossible de migrer le score local vers Firebase', error);
  }
}
async function saveBest(mode, score, fastest, correctCount) {
  const numericScore = Math.max(0, Number(score) || 0);
  const modeField = mode === 'solo' ? 'bestSolo' : 'bestChallenge';
  const knownBest = Math.max(Number(localStorage.getItem(bestKey(mode))) || 0, Number(accountBest[mode]) || 0);
  const localBest = Math.max(knownBest, numericScore);
  localStorage.setItem(bestKey(mode), String(localBest));
  accountBest[mode] = Math.max(Number(accountBest[mode]) || 0, numericScore);
  const localStats = readLocalStats();
  localStats.record = Math.max(Number(localStats.record) || 0, numericScore);
  if (mode === 'challenge') {
    localStats.challengeRecord = Math.max(Number(localStats.challengeRecord) || 0, numericScore);
    localStats.challengeCorrect = Math.max(Number(localStats.challengeCorrect) || 0, Number(correctCount) || 0);
    if (Number.isFinite(Number(fastest))) localStats.challengeTime = localStats.challengeTime > 0 ? Math.min(Number(localStats.challengeTime), Number(fastest)) : Number(fastest);
  }
  localStorage.setItem(statsKey(), JSON.stringify(localStats));
  refreshBest();

  // A score is always kept locally, but the account record is written atomically
  // to Firestore so two games played close together cannot overwrite each other.
  if (!firestoreDb || !currentUser) return { saved: false, reason: 'not-authenticated' };
  const userAtSave = currentUser;
  const userRef = firestoreDb.collection('users').doc(userAtSave.uid);
  try {
    await firestoreDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(userRef);
      const previous = snapshot.exists ? snapshot.data() : {};
      const previousTime = Number(previous.bestTime);
      const updates = {
        uid: userAtSave.uid,
        displayName: userAtSave.displayName || '',
        email: userAtSave.email || '',
        photoURL: userAtSave.photoURL || '',
        record: Math.max(Number(previous.record) || 0, knownBest, numericScore),
        bestCorrect: Math.max(Number(previous.bestCorrect) || 0, Number(correctCount) || 0),
        [modeField]: Math.max(Number(previous[modeField]) || 0, knownBest, numericScore),
        lastScore: numericScore,
        lastMode: mode,
        totalGames: (Number(previous.totalGames) || 0) + 1,
        totalCorrect: (Number(previous.totalCorrect) || 0) + (Number(correctCount) || 0),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (mode === 'challenge') {
        updates.challengeRecord = Math.max(Number(previous.challengeRecord) || 0, numericScore);
        updates.challengeCorrect = Math.max(Number(previous.challengeCorrect) || 0, Number(correctCount) || 0);
        if (Number.isFinite(Number(fastest))) updates.challengeTime = previousTime > 0 ? Math.min(previousTime, Number(fastest)) : Number(fastest);
      }
      transaction.set(userRef, updates, { merge: true });
    });
    return { saved: true };
  } catch (error) {
    console.error('Impossible de sauvegarder le score Firebase', error);
    return { saved: false, reason: error?.code || 'firestore-error' };
  }
}
function leaderboardLabel(field, value) {
  if (field === 'challengeTime') return `${Number(value).toFixed(1)} S`;
  if (field === 'challengeCorrect') return `${value} BONNES`;
  return `${value} PTS`;
}
function renderLocalLeaderboard(field, status = 'Classement cloud indisponible — score local affiché.') {
  const localStats = readLocalStats();
  const values = { challengeRecord: Number(localStats.challengeRecord) || 0, challengeCorrect: Number(localStats.challengeCorrect) || 0, challengeTime: Number(localStats.challengeTime) || 0 };
  if (!currentUser || !values[field]) { ui.leaderboardStatus.textContent = status; ui.leaderboardList.innerHTML = ''; return; }
  ui.leaderboardStatus.textContent = status;
  ui.leaderboardList.innerHTML = `<li><span class="leader-rank">01</span><span class="leader-user"><img src="${escapeHtml(currentUser.photoURL || '')}" alt="" /><strong>${escapeHtml(currentUser.displayName || currentUser.email || 'Moi')}</strong></span><span class="leader-value">${leaderboardLabel(field, values[field])}</span></li>`;
}
async function loadLeaderboard(field = 'challengeRecord') {
  if (!currentUser || !firestoreDb) { ui.leaderboardStatus.textContent = 'Connecte-toi avec Google pour voir le classement.'; ui.leaderboardList.innerHTML = ''; return; }
  // Affiche tout de suite le meilleur score local pendant que le cloud répond.
  // Ainsi le panneau ne reste jamais vide pendant le démarrage de Firestore.
  renderLocalLeaderboard(field, 'Synchronisation du classement cloud…');
  try {
    const direction = field === 'challengeTime' ? 'asc' : 'desc';
    const snapshot = await withTimeout(firestoreDb.collection('users').orderBy(field, direction).limit(25).get(), 4500);
    const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(user => Number(user[field]) > 0).slice(0, 10);
    if (!rows.length) { renderLocalLeaderboard(field, 'Aucun classement cloud — score local affiché.'); return; }
    ui.leaderboardStatus.textContent = `${rows.length} joueur${rows.length > 1 ? 's' : ''} classé${rows.length > 1 ? 's' : ''}`;
    ui.leaderboardList.innerHTML = rows.map((user, index) => `<li><span class="leader-rank">${String(index + 1).padStart(2, '0')}</span><span class="leader-user"><img src="${escapeHtml(user.photoURL || '')}" alt="" /><strong>${escapeHtml(user.displayName || user.email || 'Joueur')}</strong></span><span class="leader-value">${leaderboardLabel(field, user[field])}</span></li>`).join('');
  } catch { renderLocalLeaderboard(field, 'Firestore indisponible — publie les règles et vérifie la base Firestore.'); }
}
function show(screen) { [ui.setup, ui.game, ui.result].forEach(item => item.classList.toggle('hidden', item !== screen)); }
function shuffled(items) { return [...items].sort(() => Math.random() - .5); }

async function loadSongs() {
  try {
    const response = await fetch('songs.json', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    songs = Array.isArray(data) ? data.filter(song => song && song.title && (song.audio || song.soundcloudUrl || song.deezerTrackId)) : [];
    if (songs.length) {
      if (ui.catalog) ui.catalog.textContent = `${songs.length} extrait${songs.length > 1 ? 's' : ''} chargé${songs.length > 1 ? 's' : ''}. Prêt à jouer.`;
      ui.start.disabled = false;
    } else {
      if (ui.catalog) { ui.catalog.textContent = 'Catalogue vide — ajoutez vos extraits autorisés dans songs.json.'; ui.catalog.classList.add('error'); }
      ui.start.disabled = true;
    }
  } catch {
    if (ui.catalog) { ui.catalog.textContent = 'Impossible de charger songs.json. Vérifiez son format.'; ui.catalog.classList.add('error'); }
    ui.start.disabled = true;
  }
}

function startGame() {
  if (!songs.length) return;
  if (!currentUser) {
    ui.authMessage.textContent = 'Mode invité : connecte-toi avec Google pour synchroniser ton score.';
  }
  const mode = document.querySelector('.mode-card.selected').dataset.mode;
  const rounds = Number(document.querySelector('.round-option.selected').dataset.rounds);
  state = { mode, rounds, score: 0, played: [], deck: shuffled(songs), deckIndex: 0, current: null, hints: 0, revealed: new Set(), active: true, startedAt: 0, timerId: null, challengeEndsAt: 0 };
  show(ui.game);
  nextRound();
}

function nextSong() {
  if (state.deckIndex >= state.deck.length) { state.deck = shuffled(songs); state.deckIndex = 0; }
  return state.deck[state.deckIndex++];
}
function nextRound() {
  if (!state.active) return;
  if (state.mode === 'solo' && state.played.length >= state.rounds) return endGame();
  state.current = nextSong(); state.hints = 0; state.revealed = new Set(); state.roundResolved = false;
  ui.input.value = ''; ui.input.disabled = false; ui.validate.disabled = false; ui.hint.disabled = false; ui.skip.disabled = false;
  ui.feedback.textContent = ''; ui.feedback.className = 'feedback'; ui.hintCount.textContent = `×${HINTS_PER_ROUND}`;
  ui.roundLabel.textContent = state.mode === 'solo' ? `MANCHE ${String(state.played.length + 1).padStart(2, '0')} / ${state.rounds}` : `RANKED · ${state.played.length + 1}`;
  ui.score.textContent = state.score; loadTrack();
  renderHint(); startTimer(); ui.input.focus();
}
function setPlaying(isPlaying) {
  state.isPlaying = isPlaying;
  ui.play.classList.toggle('is-playing', isPlaying); ui.waveform.classList.toggle('playing', isPlaying);
  if (!state.roundResolved) ui.playerState.textContent = isPlaying ? 'LECTURE EN COURS' : 'EXTRAIT EN PAUSE';
}
function clearClipTimer() { clearTimeout(state.clipTimer); state.clipTimer = null; }
function sendSoundcloud(method, value) {
  if (!ui.soundcloud.contentWindow) return;
  ui.soundcloud.contentWindow.postMessage(JSON.stringify({ method, value }), 'https://w.soundcloud.com');
}
function stopPlayback() {
  clearClipTimer();
  ui.audio.pause();
  if (ui.soundcloud.src && ui.soundcloud.src !== 'about:blank') ui.soundcloud.src = 'about:blank';
  if (state.scWidget) state.scWidget.pause();
  else if (state.current?.soundcloudUrl) sendSoundcloud('pause');
  setPlaying(false);
}
function showTrackReveal() {
  const meta = state.trackMeta || {};
  const song = state.current;
  const title = song.title || meta.title;
  const cover = meta.cover || song.cover || '';
  const releaseDate = meta.releaseDate || song.releaseDate || '';
  const year = releaseDate ? releaseDate.slice(0, 4) : (meta.year || song.year || '');
  const albumTitle = meta.albumTitle || song.project || '';
  const isSingle = meta.albumTracks === 1 || albumTitle.toLocaleLowerCase() === title.toLocaleLowerCase() || /single/i.test(song.project || '');
  const dateLabel = releaseDate ? new Date(`${releaseDate}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : (year || 'Date inconnue');
  ui.revealCover.src = cover;
  ui.revealCover.alt = `Cover de ${title}`;
  ui.revealType.textContent = isSingle ? 'SINGLE' : `ALBUM · ${albumTitle || 'PROJET'}`;
  ui.revealTitle.textContent = title;
  ui.revealMeta.textContent = `${dateLabel.toUpperCase()} · ${year || '—'}`;
  ui.reveal.hidden = false; ui.playerPanel.classList.add('revealed'); ui.play.classList.add('hidden'); ui.waveform.classList.add('hidden'); ui.playerState.textContent = 'RÉPONSE';
}
function loadTrack() {
  stopPlayback(); state.scReady = false; state.scWidget = null; state.isPlaying = false;
  state.autoplayAttempted = false; setVolume(getVolume());
  state.trackMeta = null; state.revealVisible = false;
  ui.reveal.hidden = true; ui.playerPanel.classList.remove('revealed'); ui.revealCover.removeAttribute('src');
  if (soundcloudMessageHandler) window.removeEventListener('message', soundcloudMessageHandler);
  soundcloudMessageHandler = null;
  ui.play.classList.remove('is-playing'); ui.waveform.classList.remove('playing');
  ui.playerState.textContent = 'EXTRAIT PRÊT';
  if (state.current.deezerTrackId) {
    const trackId = encodeURIComponent(state.current.deezerTrackId);
    const track = state.current;
    ui.audio.removeAttribute('src'); ui.audio.load(); state.deezerPreviewUrl = '';
    ui.soundcloud.hidden = true; ui.soundcloud.classList.remove('visible');
    ui.play.classList.remove('hidden'); ui.waveform.classList.remove('hidden');
    ui.soundcloudCredit.href = `https://www.deezer.com/track/${trackId}`;
    ui.soundcloudCredit.textContent = 'SOURCE : DEEZER ↗'; ui.soundcloudCredit.classList.remove('hidden');
    ui.playerState.textContent = 'CHARGEMENT DE L’EXTRAIT';
    fetch(`/api/deezer-track?id=${trackId}`)
      .then(response => { if (!response.ok) throw new Error('Deezer indisponible'); return response.json(); })
      .then(data => {
        if (state.current !== track || !data.preview) throw new Error('Aucun aperçu disponible');
        state.deezerPreviewUrl = data.preview; state.trackMeta = data;
        ui.audio.src = data.preview; ui.audio.load(); ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track);
        if (state.revealVisible) showTrackReveal();
      })
      .catch(() => { if (state.current === track) ui.playerState.textContent = 'APERÇU INDISPONIBLE'; });
  } else if (state.current.soundcloudUrl) {
    ui.audio.removeAttribute('src'); ui.audio.load(); ui.soundcloud.hidden = false; ui.soundcloud.classList.add('visible');
    ui.play.classList.add('hidden'); ui.waveform.classList.add('hidden');
    ui.soundcloudCredit.href = state.current.soundcloudUrl; ui.soundcloudCredit.classList.remove('hidden');
    const track = state.current;
    soundcloudMessageHandler = (event) => {
      if (event.origin !== 'https://w.soundcloud.com' || state.current !== track) return;
      let message;
      try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!message?.method) return;
      if (message.method === 'ready') {
        state.scReady = true; ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track);
        ['play', 'pause', 'finish'].forEach(name => sendSoundcloud('addEventListener', name));
      }
      if (message.method === 'play') setPlaying(true);
      if (message.method === 'pause' || message.method === 'finish') setPlaying(false);
    };
    window.addEventListener('message', soundcloudMessageHandler);
    ui.soundcloud.onload = () => {
      if (state.current !== track) return;
      // Le widget n'émet pas toujours l'événement READY dans certains navigateurs.
      // Son iframe est toutefois prêt à recevoir les commandes une fois chargée.
      setTimeout(() => {
        if (state.current !== track) return;
        state.scReady = true;
        if (!state.isPlaying) ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track);
        ['play', 'pause', 'finish'].forEach(name => sendSoundcloud('addEventListener', name));
      }, 500);
    };
    ui.soundcloud.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(state.current.soundcloudUrl)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=true`;
    if (window.SC?.Widget) {
      const widget = window.SC.Widget(ui.soundcloud);
      state.scWidget = widget;
      widget.bind(window.SC.Widget.Events.READY, () => {
        if (state.current !== track || state.scWidget !== widget) return;
        state.scReady = true; ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track);
      });
      widget.bind(window.SC.Widget.Events.PLAY, () => { if (state.scWidget === widget) setPlaying(true); });
      widget.bind(window.SC.Widget.Events.PAUSE, () => { if (state.scWidget === widget) setPlaying(false); });
      widget.bind(window.SC.Widget.Events.FINISH, () => { if (state.scWidget === widget) setPlaying(false); });
    }
  } else {
    ui.soundcloud.hidden = true; ui.soundcloud.classList.remove('visible'); ui.soundcloudCredit.classList.add('hidden');
    ui.play.classList.remove('hidden'); ui.waveform.classList.remove('hidden');
    ui.audio.src = state.current.audio; ui.audio.load(); autoplayTrack(state.current);
  }
}
function startTimer() {
  clearInterval(state.timerId);
  state.startedAt = performance.now();
  if (state.mode === 'challenge' && !state.challengeEndsAt) state.challengeEndsAt = state.startedAt + CHALLENGE_SECONDS * 1000;
  state.timerId = setInterval(updateTimer, 50); updateTimer();
}
function updateTimer() {
  const now = performance.now();
  const max = state.mode === 'challenge' ? CHALLENGE_SECONDS * 1000 : ROUND_SECONDS * 1000;
  const left = state.mode === 'challenge' ? Math.max(0, state.challengeEndsAt - now) : Math.max(0, max - (now - state.startedAt));
  ui.timer.style.transform = `scaleX(${left / max})`; ui.timerText.textContent = `${(left / 1000).toFixed(1)} S`;
  if (left <= 0) { clearInterval(state.timerId); state.mode === 'challenge' ? endGame() : resolveRound(false, 'Temps écoulé'); }
}
function renderHint() {
  const title = state.current.title;
  const display = [...title].map((char, index) => {
    if (char === ' ') return ' / ';
    return state.revealed.has(index) ? char.toUpperCase() : '_';
  }).join(' ');
  ui.hintText.textContent = state.hints === 3 ? `ANNÉE : ${state.current.year}` : display;
}
function useHint() {
  if (state.hints >= HINTS_PER_ROUND || state.roundResolved) return;
  state.hints++;
  if (state.hints < 3) {
    const candidates = [...state.current.title].map((char, index) => ({ char, index })).filter(({ char, index }) => char !== ' ' && !state.revealed.has(index));
    if (candidates.length) state.revealed.add(candidates[Math.floor(Math.random() * candidates.length)].index);
  }
  ui.hintCount.textContent = `×${HINTS_PER_ROUND - state.hints}`; ui.hint.disabled = state.hints >= HINTS_PER_ROUND; renderHint();
}
function toggleAudio() {
  if (!state.current || state.roundResolved) return;
  if (state.current.deezerTrackId) {
    if (!state.deezerPreviewUrl) { ui.playerState.textContent = 'EXTRAIT EN CHARGEMENT'; return; }
    if (ui.audio.paused) {
      ui.audio.play().catch(() => { ui.playerState.textContent = 'LECTURE BLOQUÉE'; });
      clearClipTimer(); state.clipTimer = setTimeout(stopPlayback, 20000);
    } else stopPlayback();
    return;
  }
  if (state.current.soundcloudUrl) {
    if (!state.scReady) { ui.playerState.textContent = 'CHARGEMENT SOUNDCLOUD…'; return; }
    if (state.isPlaying) { stopPlayback(); return; }
    if (state.scWidget) {
      state.scWidget.seekTo(Number(state.current.clipStart || 0) * 1000); state.scWidget.play();
    } else {
      sendSoundcloud('seekTo', Number(state.current.clipStart || 0) * 1000); sendSoundcloud('play');
    }
    clearClipTimer(); state.clipTimer = setTimeout(stopPlayback, Number(state.current.clipDuration || 20) * 1000);
  } else if (ui.audio.paused) ui.audio.play().catch(() => { ui.playerState.textContent = 'EXTRAIT INTROUVABLE'; }); else ui.audio.pause();
}
function validateGuess() {
  if (state.roundResolved) return;
  const guess = normalise(ui.input.value);
  if (!guess) return;
  if (guess === normalise(state.current.title)) resolveRound(true); else {
    ui.feedback.textContent = 'Pas encore. Essaie à nouveau.'; ui.feedback.className = 'feedback wrong'; ui.input.select();
  }
}
function resolveRound(correct, message = '') {
  if (state.roundResolved) return;
  state.roundResolved = true; clearInterval(state.timerId);
  if (!correct) stopPlayback();
  const seconds = (performance.now() - state.startedAt) / 1000;
  const points = correct ? Math.max(100, Math.round((ROUND_SECONDS - Math.min(seconds, ROUND_SECONDS)) * 20) - state.hints * 35) : 0;
  if (correct) state.score += points;
  state.played.push({ ...state.current, correct, seconds, points }); ui.score.textContent = state.score;
  ui.feedback.textContent = correct
    ? `BIEN JOUÉ +${points} PTS · ${state.current.project || 'Projet inconnu'} (${state.current.year || '—'})`
    : `${message} : ${state.current.title}`;
  ui.feedback.className = `feedback ${correct ? 'correct' : 'wrong'}`; ui.input.disabled = true; ui.validate.disabled = true; ui.hint.disabled = true; ui.skip.disabled = true;
  ui.hintText.textContent = `${correct ? '✓' : '✕'} ${state.current.title.toUpperCase()}`;
  state.revealVisible = true; showTrackReveal();
  setTimeout(nextRound, 1700);
}
async function endGame() {
  if (!state.active) return;
  state.active = false; clearInterval(state.timerId); stopPlayback();
  const previousBest = getBest(state.mode); const record = Math.max(previousBest, state.score);
  const correct = state.played.filter(song => song.correct); const fastest = correct.length ? Math.min(...correct.map(song => song.seconds)) : null;
  const saveResult = await saveBest(state.mode, state.score, fastest, correct.length);
  if (saveResult.saved) ui.authMessage.textContent = 'Score sauvegardé sur ton compte Google.';
  else if (saveResult.reason === 'not-authenticated') ui.authMessage.textContent = 'Connecte-toi avec Google pour sauvegarder tes scores.';
  else ui.authMessage.textContent = 'Score gardé localement. Publie les règles Firestore pour le synchroniser.';
  ui.resultMode.textContent = state.mode === 'solo' ? 'SOLO' : 'RANKED'; ui.finalScore.textContent = state.score; ui.bestTime.textContent = fastest ? `${fastest.toFixed(1)} S` : '—'; ui.correct.textContent = correct.length; ui.record.textContent = record;
  ui.played.innerHTML = state.played.map(song => `<li class="${song.correct ? '' : 'missed'}"><span>${song.correct ? '✓' : '×'} ${escapeHtml(song.title)}</span><span>${song.correct ? `+${song.points}` : 'MANQUÉ'}</span></li>`).join('') || '<li><span>Aucun morceau joué.</span></li>';
  show(ui.result);
}

document.querySelectorAll('.mode-card').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.mode-card').forEach(item => item.classList.toggle('selected', item === button));
  ui.rounds.classList.toggle('hidden', button.dataset.mode === 'challenge');
}));
document.querySelectorAll('.round-option').forEach(button => button.addEventListener('click', () => document.querySelectorAll('.round-option').forEach(item => item.classList.toggle('selected', item === button))));
ui.start.addEventListener('click', startGame); ui.play.addEventListener('click', toggleAudio); ui.volume.addEventListener('input', event => setVolume(Number(event.target.value) / 100)); ui.validate.addEventListener('click', validateGuess); ui.hint.addEventListener('click', useHint); ui.skip.addEventListener('click', () => resolveRound(false, 'Réponse')); ui.input.addEventListener('keydown', event => { if (event.key === 'Enter') validateGuess(); });
ui.audio.addEventListener('play', () => setPlaying(true));
ui.audio.addEventListener('pause', () => { if (!state.roundResolved) setPlaying(false); });
ui.audio.addEventListener('ended', () => { setPlaying(false); ui.playerState.textContent = 'EXTRAIT TERMINÉ'; });
ui.restart.addEventListener('click', startGame);
ui.home.addEventListener('click', async () => {
  // Si l'utilisateur quitte une manche avant l'écran de résultat, on clôture
  // d'abord la partie pour ne jamais perdre son score.
  if (state.active && state.played?.length) await endGame();
  stopPlayback(); show(ui.setup);
  if (currentUser && !ui.leaderboardPanel.hidden) loadLeaderboard(leaderboardField);
});
ui.leaderboardButton.addEventListener('click', () => { ui.leaderboardPanel.hidden = !ui.leaderboardPanel.hidden; if (!ui.leaderboardPanel.hidden) loadLeaderboard(leaderboardField); });
ui.leaderboardClose.addEventListener('click', () => { ui.leaderboardPanel.hidden = true; });
ui.leaderboardTabs.forEach(tab => tab.addEventListener('click', () => { leaderboardField = tab.dataset.leaderboard; ui.leaderboardTabs.forEach(item => item.classList.toggle('selected', item === tab)); loadLeaderboard(leaderboardField); }));

setVolume(getVolume()); refreshBest(); loadSongs();

function setupGoogleAuth() {
  const loginButton = $('#loginButton'); const logoutButton = $('#logoutButton'); const profileArea = $('#profileArea'); const profilePhoto = $('#profilePhoto'); const profileName = $('#profileName'); const authMessage = $('#authMessage');
  if (!window.firebase) { authMessage.textContent = 'Connexion indisponible'; return; }
  try {
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth(); const provider = new firebase.auth.GoogleAuthProvider();
    firestoreDb = firebase.firestore();
    const setMessage = (message = '') => { authMessage.textContent = message; };
    auth.onAuthStateChanged(user => {
      currentUser = user || null; loginButton.hidden = Boolean(user); profileArea.hidden = !user;
      if (user) { profileName.textContent = user.displayName || user.email || 'Compte Google'; profilePhoto.src = user.photoURL || ''; accountBestReady = loadAccountBest(user).then(() => migrateGuestBest(user)); if (!ui.leaderboardPanel.hidden) loadLeaderboard(leaderboardField); setMessage(''); }
      else { accountBestReady = Promise.resolve(); localStorage.removeItem('ziak-blindtest-last-uid'); accountBest = { solo: 0, challenge: 0 }; profilePhoto.removeAttribute('src'); refreshBest(); }
    });
    loginButton.addEventListener('click', async () => {
      loginButton.disabled = true; setMessage('Connexion…');
      try { await auth.signInWithPopup(provider); }
      catch (error) {
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') setMessage('Autorise la fenêtre Google puis réessaie.');
        else if (error.code === 'auth/unauthorized-domain') setMessage('Ajoute blindtestziak.vercel.app dans Firebase.');
        else setMessage('Connexion Google impossible.');
      } finally { loginButton.disabled = false; }
    });
    logoutButton.addEventListener('click', () => auth.signOut().catch(() => setMessage('Déconnexion impossible.')));
  } catch { authMessage.textContent = 'Configuration Firebase invalide'; }
}
setupGoogleAuth();
