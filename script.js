/*
  Catalogue : modifiez uniquement songs.json et déposez vos extraits dans assets/audio/.
  Les champs requis sont id, title, project, year et audio.
*/
const ROUND_SECONDS = 25;
const CHALLENGE_SECONDS = 90;
const HINTS_PER_ROUND = 3;
const OUT_OF_ORDER_PENALTY_RATIO = 0.7;
const SPEED_PRESETS = {
  classic: { key: 'classic', label: 'CLASSIQUE', listen: null, answer: ROUND_SECONDS },
  fast: { key: 'fast', label: 'RAPIDE', listen: 5, answer: 10 },
  intense: { key: 'intense', label: 'INTENSE', listen: 10, answer: 10 },
  expert: { key: 'expert', label: 'EXPERT', listen: 1, answer: null, scoreBudget: 5, allowReplay: true },
  ultra: { key: 'ultra', label: 'ULTRA', listen: 1, answer: 5 }
};
const previewCache = new Map();

const $ = (selector) => document.querySelector(selector);
const ui = {
  setup: $('#setupScreen'), game: $('#gameScreen'), result: $('#resultScreen'),
  start: $('#startButton'), catalog: $('#catalogStatus'), artists: $('#artistGrid'), activeArtist: $('#activeArtistLabel'), recordMark: $('#recordMark'), best: $('#bestScore'), authMessage: $('#authMessage'), leaderboardButton: $('#leaderboardButton'), leaderboardPanel: $('#leaderboardPanel'), leaderboardClose: $('#leaderboardClose'), leaderboardEyebrow: $('#leaderboardEyebrow'), leaderboardStatus: $('#leaderboardStatus'), leaderboardList: $('#leaderboardList'), leaderboardTabs: document.querySelectorAll('.leaderboard-tab'),
  rounds: $('#roundPicker'), speedPicker: $('#speedPicker'), roundLabel: $('#roundLabel'), score: $('#scoreLabel strong'),
  timer: $('#timerProgress'), timerText: $('#timerText'), audio: $('#audioPlayer'),
  play: $('#playButton'), volume: $('#volumeControl'), volumeValue: $('#volumeValue'), waveform: $('#waveform'), playerState: $('#playerState'), soundcloud: $('#soundcloudPlayer'), soundcloudCredit: $('#soundcloudCredit'), reveal: $('#trackReveal'), revealCover: $('#revealCover'), revealType: $('#revealType'), revealTitle: $('#revealTitle'), revealMeta: $('#revealMeta'), playerPanel: $('.player-panel'),
  input: $('#guessInput'), validate: $('#validateButton'), feedback: $('#feedback'),
  hint: $('#hintButton'), hintCount: $('#hintCount'), hintText: $('#hintText'), skip: $('#skipButton'),
  finalScore: $('#finalScore'), resultMode: $('#resultMode'), bestTime: $('#bestTime'),
  correct: $('#correctCount'), record: $('#recordScore'), played: $('#playedList'), restart: $('#restartButton'), home: $('#homeButton')
};

let songs = [];
let artists = [];
let selectedArtist = null;
let state = {};
let soundcloudMessageHandler = null;
let currentUser = null;
let firestoreDb = null;
let accountBest = { solo: 0, challenge: 0 };
let leaderboardField = 'challengeRecord';
let accountBestReady = Promise.resolve();
const DEFAULT_VOLUME = 1;

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
function wordsOf(value = '') {
  return value.split(/\s+/).map(normalise).filter(Boolean);
}
function sameWordsAnyOrder(guessRaw, titleRaw) {
  const guessWords = wordsOf(guessRaw).sort();
  const titleWords = wordsOf(titleRaw).sort();
  if (!guessWords.length || guessWords.length !== titleWords.length) return false;
  return guessWords.every((word, index) => word === titleWords[index]);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function storageUid() { return currentUser?.uid || localStorage.getItem('ziak-blindtest-last-uid') || 'guest'; }
function activeArtistId() { return selectedArtist?.id || state.artist?.id || 'ziak'; }
function scorePrefix(artistId = activeArtistId()) { return artistId === 'ziak' ? 'ziak-blindtest' : `blindtest-${artistId}`; }
function bestKey(mode, artistId = activeArtistId()) { return `${scorePrefix(artistId)}-best-${storageUid()}-${mode}`; }
function statsKey(artistId = activeArtistId()) { return `${scorePrefix(artistId)}-stats-${storageUid()}`; }
function getBest(mode) { return Math.max(Number(localStorage.getItem(bestKey(mode))) || 0, Number(accountBest[mode]) || 0); }
function refreshBest() { ui.best.textContent = Math.max(getBest('solo'), getBest('challenge')); }
function getVolume() {
  const raw = localStorage.getItem('ziak-blindtest-volume');
  if (raw === null || raw === '') return DEFAULT_VOLUME;
  const saved = Number(raw);
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
  if (!state.current || state.current !== track || state.roundResolved || state.autoplayAttempted || state.speed?.listen) return;
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
  const artistId = activeArtistId();
  localStorage.setItem('ziak-blindtest-last-uid', user?.uid || '');
  accountBest = {
    solo: Number(localStorage.getItem(bestKey('solo', artistId))) || 0,
    challenge: Number(localStorage.getItem(bestKey('challenge', artistId))) || 0
  };
  refreshBest();
  if (!firestoreDb || !user) { refreshBest(); return; }
  try {
    const snapshot = await withTimeout(firestoreDb.collection('users').doc(user.uid).get());
    if (snapshot.exists) {
      const profile = snapshot.data();
      const artistStats = profile.artistStats?.[artistId] || (artistId === 'ziak' ? profile : {});
      accountBest = {
        solo: Math.max(accountBest.solo, Number(artistStats.bestSolo) || 0),
        challenge: Math.max(accountBest.challenge, Number(artistStats.bestChallenge) || 0)
      };
      localStorage.setItem(bestKey('solo', artistId), String(accountBest.solo));
      localStorage.setItem(bestKey('challenge', artistId), String(accountBest.challenge));
    }
  } catch { /* Firestore reste optionnel tant que ses règles ne sont pas activées. */ }
  refreshBest();
}
async function migrateGuestBest(user) {
  if (!firestoreDb || !user) return;
  const artistId = activeArtistId();
  const prefix = scorePrefix(artistId);
  const guestSolo = Number(localStorage.getItem(`${prefix}-best-guest-solo`)) || 0;
  const guestChallenge = Number(localStorage.getItem(`${prefix}-best-guest-challenge`)) || 0;
  if (!guestSolo && !guestChallenge) return;
  const userRef = firestoreDb.collection('users').doc(user.uid);
  try {
    await firestoreDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(userRef);
      const previous = snapshot.exists ? snapshot.data() : {};
      const previousArtist = previous.artistStats?.[artistId] || (artistId === 'ziak' ? previous : {});
      transaction.set(userRef, {
        uid: user.uid,
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        artistStats: {
          [artistId]: {
            record: Math.max(Number(previousArtist.record) || 0, guestSolo, guestChallenge),
            bestSolo: Math.max(Number(previousArtist.bestSolo) || 0, guestSolo),
            bestChallenge: Math.max(Number(previousArtist.bestChallenge) || 0, guestChallenge),
            challengeRecord: Math.max(Number(previousArtist.challengeRecord) || 0, guestChallenge),
            artistId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }
        },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    localStorage.removeItem(`${prefix}-best-guest-solo`);
    localStorage.removeItem(`${prefix}-best-guest-challenge`);
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
  const artistId = state.artist?.id || activeArtistId();
  const userRef = firestoreDb.collection('users').doc(userAtSave.uid);
  try {
    await firestoreDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(userRef);
      const previous = snapshot.exists ? snapshot.data() : {};
      const previousArtist = previous.artistStats?.[artistId] || (artistId === 'ziak' ? previous : {});
      const previousTime = Number(previousArtist.bestTime);
      const updates = {
        uid: userAtSave.uid,
        artistId,
        displayName: userAtSave.displayName || '',
        email: userAtSave.email || '',
        photoURL: userAtSave.photoURL || '',
        record: Math.max(Number(previousArtist.record) || 0, knownBest, numericScore),
        bestCorrect: Math.max(Number(previousArtist.bestCorrect) || 0, Number(correctCount) || 0),
        [modeField]: Math.max(Number(previousArtist[modeField]) || 0, knownBest, numericScore),
        lastScore: numericScore,
        lastMode: mode,
        totalGames: (Number(previousArtist.totalGames) || 0) + 1,
        totalCorrect: (Number(previousArtist.totalCorrect) || 0) + (Number(correctCount) || 0),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (mode === 'challenge') {
        updates.challengeRecord = Math.max(Number(previousArtist.challengeRecord) || 0, numericScore);
        updates.challengeCorrect = Math.max(Number(previousArtist.challengeCorrect) || 0, Number(correctCount) || 0);
        if (Number.isFinite(Number(fastest))) updates.challengeTime = previousTime > 0 ? Math.min(previousTime, Number(fastest)) : Number(fastest);
      }
      transaction.set(userRef, {
        uid: userAtSave.uid,
        displayName: userAtSave.displayName || '',
        email: userAtSave.email || '',
        photoURL: userAtSave.photoURL || '',
        artistStats: { [artistId]: updates },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
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
    const artistId = selectedArtist?.id || 'ziak';
    const artistField = `artistStats.${artistId}.${field}`;
    let snapshot = await withTimeout(firestoreDb.collection('users').orderBy(artistField, direction).limit(25).get(), 4500);
    let rows = snapshot.docs.map(doc => {
      const profile = doc.data(); const stats = profile.artistStats?.[artistId] || {};
      return { id: doc.id, ...profile, ...stats };
    }).filter(user => Number(user[field]) > 0).slice(0, 10);
    if (!rows.length && artistId === 'ziak') {
      snapshot = await withTimeout(firestoreDb.collection('users').orderBy(field, direction).limit(25).get(), 4500);
      rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(user => Number(user[field]) > 0).slice(0, 10);
    }
    if (!rows.length) { renderLocalLeaderboard(field, 'Aucun classement cloud — score local affiché.'); return; }
    ui.leaderboardStatus.textContent = `${rows.length} joueur${rows.length > 1 ? 's' : ''} classé${rows.length > 1 ? 's' : ''}`;
    ui.leaderboardList.innerHTML = rows.map((user, index) => `<li><span class="leader-rank">${String(index + 1).padStart(2, '0')}</span><span class="leader-user"><img src="${escapeHtml(user.photoURL || '')}" alt="" /><strong>${escapeHtml(user.displayName || user.email || 'Joueur')}</strong></span><span class="leader-value">${leaderboardLabel(field, user[field])}</span></li>`).join('');
  } catch { renderLocalLeaderboard(field, 'Firestore indisponible — publie les règles et vérifie la base Firestore.'); }
}
function show(screen) { [ui.setup, ui.game, ui.result].forEach(item => item.classList.toggle('hidden', item !== screen)); }
function shuffled(items) { return [...items].sort(() => Math.random() - .5); }

function updateArtistBrand(artist) {
  const name = artist?.name || 'Blind Test';
  document.title = `${name.toUpperCase()} // BLIND TEST`;
  if (ui.activeArtist) ui.activeArtist.textContent = name.toUpperCase();
  if (ui.recordMark) ui.recordMark.textContent = artist?.mark || name.charAt(0).toUpperCase();
  if (ui.leaderboardEyebrow) ui.leaderboardEyebrow.textContent = `CLASSEMENT · ${name.toUpperCase()} RANKED`;
}
function renderArtists() {
  if (!ui.artists) return;
  ui.artists.innerHTML = artists.map((artist, index) => {
    const photo = artist.image ? `<span class="artist-card-art"><img src="${escapeHtml(artist.image)}" alt="" /></span>` : '';
    return `<button class="artist-card ${artist.id === selectedArtist?.id ? 'selected' : ''}" type="button" data-artist-id="${escapeHtml(artist.id)}"><span class="mode-number">CAT. ${String(index + 1).padStart(2, '0')}</span>${photo}<span class="artist-card-mark">${escapeHtml(artist.mark || artist.name.charAt(0).toUpperCase())}</span><strong>${escapeHtml(artist.name)}</strong><small>${escapeHtml(artist.description || 'Catalogue musical')}</small></button>`;
  }).join('');
  ui.artists.querySelectorAll('.artist-card').forEach(button => button.addEventListener('click', () => selectArtist(button.dataset.artistId)));
}
async function selectArtist(artistId) {
  const artist = artists.find(item => item.id === artistId);
  if (!artist || (artist.id === selectedArtist?.id && songs.length)) return;
  selectedArtist = artist;
  localStorage.setItem('blindtest-selected-artist', artist.id);
  updateArtistBrand(artist); renderArtists();
  songs = []; ui.start.disabled = true;
  await loadSongs();
  if (currentUser) {
    accountBestReady = loadAccountBest(currentUser).then(() => migrateGuestBest(currentUser));
    if (!ui.leaderboardPanel.hidden) loadLeaderboard(leaderboardField);
  } else refreshBest();
}
async function loadArtists() {
  try {
    const response = await fetch('artists.json', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    artists = Array.isArray(data) ? data.filter(artist => artist && artist.id && artist.name && artist.catalog) : [];
  } catch { artists = []; }
  if (!artists.length) artists = [{ id: 'ziak', name: 'Ziak', catalog: 'songs.json', mark: 'Z', description: 'Discographie complète' }];
  const savedArtistId = localStorage.getItem('blindtest-selected-artist');
  await selectArtist(artists.some(artist => artist.id === savedArtistId) ? savedArtistId : artists[0].id);
}
async function loadSongs() {
  const artist = selectedArtist || { id: 'ziak', name: 'Ziak', catalog: 'songs.json', mark: 'Z' };
  const loadingArtistId = artist.id;
  try {
    if (ui.catalog) ui.catalog.classList.remove('error');
    const response = await fetch(artist.catalog, { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (selectedArtist?.id !== loadingArtistId) return;
    songs = Array.isArray(data) ? data.filter(song => song && song.title && normalise(song.title) && (song.audio || song.soundcloudUrl || song.deezerTrackId)) : [];
    if (songs.length) {
      if (ui.catalog) ui.catalog.textContent = `${songs.length} extrait${songs.length > 1 ? 's' : ''} ${artist.name} chargé${songs.length > 1 ? 's' : ''}. Prêt à jouer.`;
      ui.start.disabled = false;
    } else {
      if (ui.catalog) { ui.catalog.textContent = `Catalogue ${artist.name} vide — ajoute tes extraits dans ${artist.catalog}.`; ui.catalog.classList.add('error'); }
      ui.start.disabled = true;
    }
  } catch {
    if (selectedArtist?.id !== loadingArtistId) return;
    if (ui.catalog) { ui.catalog.textContent = `Impossible de charger ${artist.catalog}. Vérifie son format.`; ui.catalog.classList.add('error'); }
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
  const speedKey = mode === 'solo' ? (document.querySelector('#speedPicker .round-option.selected')?.dataset.speed || 'classic') : 'classic';
  const speed = SPEED_PRESETS[speedKey] || SPEED_PRESETS.classic;
  state = { artist: selectedArtist, mode, rounds, speed, score: 0, played: [], deck: shuffled(songs), deckIndex: 0, current: null, hints: 0, revealed: new Set(), active: true, startedAt: 0, timerId: null, challengeEndsAt: 0 };
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
  state.timerStarted = false; state.trackReady = false; state.phase = 'listen'; state.scoreBudgetSeconds = 0;
  ui.input.value = ''; ui.input.disabled = false; ui.validate.disabled = false; ui.hint.disabled = false; ui.skip.disabled = false;
  ui.play.disabled = Boolean(state.speed?.listen) && !state.speed?.allowReplay;
  ui.feedback.textContent = ''; ui.feedback.className = 'feedback'; ui.hintCount.textContent = `×${HINTS_PER_ROUND}`;
  const artistLabel = state.artist?.name ? `${state.artist.name.toUpperCase()} · ` : '';
  ui.roundLabel.textContent = state.mode === 'solo' ? `${artistLabel}MANCHE ${String(state.played.length + 1).padStart(2, '0')} / ${state.rounds}` : `${artistLabel}RANKED · ${state.played.length + 1}`;
  ui.score.textContent = state.score;
  ui.timer.style.transform = 'scaleX(1)'; ui.timerText.textContent = 'CHARGEMENT…';
  loadTrack(); prefetchUpcoming();
  renderHint(); ui.input.focus();
}
function prefetchUpcoming() {
  const upcoming = state.deck[state.deckIndex];
  if (upcoming?.deezerTrackId) prefetchDeezerTrack(upcoming.deezerTrackId);
}
function onTrackReady() {
  if (!state.current || state.timerStarted || state.roundResolved) return;
  state.timerStarted = true; state.trackReady = true;
  if (state.speed?.listen) beginListenPhase(); else startTimer();
}
function beginListenPhase() {
  state.phase = 'listen';
  if (state.current.deezerTrackId || state.current.audio) ui.audio.play().catch(() => {});
  state.startedAt = performance.now();
  clearInterval(state.timerId);
  state.timerId = setInterval(() => updatePhaseTimer('listen'), 50);
  updatePhaseTimer('listen');
}
function beginAnswerPhase() {
  state.phase = 'answer';
  state.scoreBudgetSeconds = state.speed.answer ?? state.speed.scoreBudget ?? ROUND_SECONDS;
  state.startedAt = performance.now();
  clearInterval(state.timerId);
  if (state.speed.answer == null) {
    state.timerId = setInterval(updateUnlimitedTimer, 100);
    updateUnlimitedTimer();
  } else {
    state.timerId = setInterval(() => updatePhaseTimer('answer'), 50);
    updatePhaseTimer('answer');
  }
}
function updateUnlimitedTimer() {
  const elapsed = (performance.now() - state.startedAt) / 1000;
  ui.timer.style.transform = 'scaleX(1)';
  ui.timerText.textContent = `${elapsed.toFixed(1)} S`;
}
function updatePhaseTimer(phase) {
  const now = performance.now();
  const durationMs = (phase === 'listen' ? state.speed.listen : state.speed.answer) * 1000;
  const left = Math.max(0, durationMs - (now - state.startedAt));
  ui.timer.style.transform = `scaleX(${left / durationMs})`;
  ui.timerText.textContent = `${phase === 'listen' ? 'ÉCOUTE ' : ''}${(left / 1000).toFixed(1)} S`;
  if (left <= 0) {
    clearInterval(state.timerId);
    if (phase === 'listen') { stopPlayback(); beginAnswerPhase(); }
    else resolveRound(false, 'Temps écoulé');
  }
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
function prefetchDeezerTrack(id) {
  const key = String(id);
  if (!key || previewCache.has(key)) return;
  previewCache.set(key, null);
  fetch(`/api/deezer-track?id=${encodeURIComponent(key)}`)
    .then(response => { if (!response.ok) throw new Error('Deezer indisponible'); return response.json(); })
    .then(data => {
      if (!data.preview) throw new Error('Aucun aperçu disponible');
      previewCache.set(key, data);
      const warm = new Audio(); warm.preload = 'auto'; warm.src = data.preview;
    })
    .catch(() => { previewCache.delete(key); });
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
    const trackId = String(state.current.deezerTrackId);
    const track = state.current;
    ui.audio.removeAttribute('src'); ui.audio.load(); state.deezerPreviewUrl = '';
    ui.soundcloud.hidden = true; ui.soundcloud.classList.remove('visible');
    ui.play.classList.remove('hidden'); ui.waveform.classList.remove('hidden');
    ui.soundcloudCredit.href = `https://www.deezer.com/track/${trackId}`;
    ui.soundcloudCredit.textContent = 'SOURCE : DEEZER ↗'; ui.soundcloudCredit.classList.remove('hidden');
    const applyTrack = (data) => {
      if (state.current !== track || !data?.preview) return false;
      state.deezerPreviewUrl = data.preview; state.trackMeta = data;
      ui.audio.src = data.preview; ui.audio.load(); ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track);
      if (state.revealVisible) showTrackReveal();
      return true;
    };
    const cached = previewCache.get(trackId);
    if (cached) { applyTrack(cached); }
    else {
      ui.playerState.textContent = 'CHARGEMENT DE L’EXTRAIT';
      fetch(`/api/deezer-track?id=${encodeURIComponent(trackId)}`)
        .then(response => { if (!response.ok) throw new Error('Deezer indisponible'); return response.json(); })
        .then(data => {
          if (!data.preview) throw new Error('Aucun aperçu disponible');
          previewCache.set(trackId, data);
          if (!applyTrack(data)) throw new Error('Manche déjà changée');
        })
        .catch(() => { if (state.current === track) ui.playerState.textContent = 'APERÇU INDISPONIBLE'; });
    }
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
        state.scReady = true; ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track); onTrackReady();
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
        if (!state.isPlaying) ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track); onTrackReady();
        ['play', 'pause', 'finish'].forEach(name => sendSoundcloud('addEventListener', name));
      }, 500);
    };
    ui.soundcloud.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(state.current.soundcloudUrl)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=true`;
    if (window.SC?.Widget) {
      const widget = window.SC.Widget(ui.soundcloud);
      state.scWidget = widget;
      widget.bind(window.SC.Widget.Events.READY, () => {
        if (state.current !== track || state.scWidget !== widget) return;
        state.scReady = true; ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track); onTrackReady();
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
  state.scoreBudgetSeconds = ROUND_SECONDS;
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
      clearClipTimer(); state.clipTimer = setTimeout(stopPlayback, (state.speed?.allowReplay ? state.speed.listen * 1000 : 20000));
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
function checkGuess() {
  if (state.roundResolved) return false;
  const rawGuess = ui.input.value;
  const guess = normalise(rawGuess);
  if (!guess) return false;
  const title = state.current.title;
  if (guess === normalise(title)) { resolveRound(true); return true; }
  if (sameWordsAnyOrder(rawGuess, title)) { resolveRound(true, '', { outOfOrder: true }); return true; }
  ui.feedback.textContent = 'Pas encore. Essaie à nouveau.'; ui.feedback.className = 'feedback wrong'; ui.input.select();
  return false;
}
function handleGuessInput() {
  if (state.roundResolved || !state.current) return;
  const rawGuess = ui.input.value;
  const guess = normalise(rawGuess);
  if (!guess) { ui.feedback.textContent = ''; ui.feedback.className = 'feedback'; return; }
  const title = state.current.title;
  const normalisedTitle = normalise(title);
  if (guess === normalisedTitle) { resolveRound(true); return; }
  if (sameWordsAnyOrder(rawGuess, title)) { resolveRound(true, '', { outOfOrder: true }); return; }
  if (guess.length >= normalisedTitle.length) {
    ui.feedback.textContent = 'Pas encore. Essaie à nouveau.'; ui.feedback.className = 'feedback wrong';
    ui.input.value = '';
  }
}
function resolveRound(correct, message = '', options = {}) {
  if (state.roundResolved) return;
  state.roundResolved = true; clearInterval(state.timerId);
  if (!correct) stopPlayback();
  const seconds = (performance.now() - state.startedAt) / 1000;
  const budget = state.scoreBudgetSeconds || ROUND_SECONDS;
  let points = correct ? Math.max(100, Math.round((budget - Math.min(seconds, budget)) * 20) - state.hints * 35) : 0;
  if (correct && options.outOfOrder) points = Math.round(points * OUT_OF_ORDER_PENALTY_RATIO);
  if (correct) state.score += points;
  state.played.push({ ...state.current, correct, seconds, points }); ui.score.textContent = state.score;
  ui.feedback.textContent = correct
    ? `BIEN JOUÉ${options.outOfOrder ? ' (ORDRE MÉLANGÉ)' : ''} +${points} PTS · ${state.current.project || 'Projet inconnu'} (${state.current.year || '—'})`
    : `${message} : ${state.current.title}`;
  ui.feedback.className = `feedback ${correct ? 'correct' : 'wrong'}`; ui.input.disabled = true; ui.validate.disabled = true; ui.hint.disabled = true; ui.skip.disabled = true; ui.play.disabled = true;
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
  ui.resultMode.textContent = `${state.artist?.name || 'ARTISTE'} · ${state.mode === 'solo' ? 'SOLO' : 'RANKED'}`; ui.finalScore.textContent = state.score; ui.bestTime.textContent = fastest ? `${fastest.toFixed(1)} S` : '—'; ui.correct.textContent = correct.length; ui.record.textContent = record;
  ui.played.innerHTML = state.played.map(song => `<li class="${song.correct ? '' : 'missed'}"><span>${song.correct ? '✓' : '×'} ${escapeHtml(song.title)}</span><span>${song.correct ? `+${song.points}` : 'MANQUÉ'}</span></li>`).join('') || '<li><span>Aucun morceau joué.</span></li>';
  show(ui.result);
}

document.querySelectorAll('.mode-card').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.mode-card').forEach(item => item.classList.toggle('selected', item === button));
  const isChallenge = button.dataset.mode === 'challenge';
  ui.rounds.classList.toggle('hidden', isChallenge);
  if (ui.speedPicker) ui.speedPicker.classList.toggle('hidden', isChallenge);
  ui.setup.classList.toggle('ranked-selected', isChallenge);
}));
document.querySelectorAll('.round-option').forEach(button => button.addEventListener('click', () => {
  const group = button.closest('.round-picker');
  (group ? group.querySelectorAll('.round-option') : document.querySelectorAll('.round-option')).forEach(item => item.classList.toggle('selected', item === button));
}));
ui.start.addEventListener('click', startGame); ui.play.addEventListener('click', toggleAudio); ui.volume.addEventListener('input', event => setVolume(Number(event.target.value) / 100)); ui.validate.addEventListener('click', () => checkGuess()); ui.hint.addEventListener('click', useHint); ui.skip.addEventListener('click', () => resolveRound(false, 'Réponse')); ui.input.addEventListener('keydown', event => { if (event.key === 'Enter') checkGuess(); }); ui.input.addEventListener('input', handleGuessInput);
ui.audio.addEventListener('canplay', onTrackReady);
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

setVolume(getVolume()); refreshBest(); loadArtists();

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
