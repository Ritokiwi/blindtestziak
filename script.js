/*
  Catalogue : modifiez uniquement songs.json et déposez vos extraits dans assets/audio/.
  Les champs requis sont id, title, project, year et audio.
*/
const ROUND_SECONDS = 25;
const CHALLENGE_SECONDS = 60;
const RANK_TIERS = [
  { name: 'BRONZE', min: 0 },
  { name: 'ARGENT', min: 600 },
  { name: 'OR', min: 1200 },
  { name: 'PLATINE', min: 2000 },
  { name: 'DIAMANT', min: 3000 },
  { name: 'ÉLITE', min: 4200 },
  { name: 'CHAMPION', min: 5500 },
  { name: 'UNREAL', min: 7000 }
];
function getRank(score) {
  const value = Math.max(0, Number(score) || 0);
  let tierIndex = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) { if (value >= RANK_TIERS[i].min) tierIndex = i; else break; }
  const tier = RANK_TIERS[tierIndex];
  const next = RANK_TIERS[tierIndex + 1];
  if (!next) return tier.name;
  const progress = (value - tier.min) / (next.min - tier.min);
  const division = progress < 1 / 3 ? 'III' : progress < 2 / 3 ? 'II' : 'I';
  return `${tier.name} ${division}`;
}
const RANK_PLACEMENT_CAP = 999;
const RANK_CLIMB_RATE = 0.35;
const RANK_MAX_STEP = 450;
function nextRankPoints(previousPoints, gamesPlayed, matchScore) {
  if (gamesPlayed <= 0) return Math.max(0, Math.min(matchScore, RANK_PLACEMENT_CAP));
  const delta = Math.round((matchScore - previousPoints) * RANK_CLIMB_RATE);
  const clampedDelta = Math.max(-RANK_MAX_STEP, Math.min(RANK_MAX_STEP, delta));
  return Math.max(0, previousPoints + clampedDelta);
}
function getPersistentRank(roundType) {
  const stats = readLocalStats();
  return { points: Number(stats[rankPointsField(roundType)]) || 0, games: Number(stats[rankGamesField(roundType)]) || 0 };
}
const HINTS_PER_ROUND = 3;
const OUT_OF_ORDER_PENALTY_RATIO = 0.7;
const SPEED_PRESETS = {
  classic: { key: 'classic', label: 'CLASSIQUE', listen: null, answer: ROUND_SECONDS },
  fast: { key: 'fast', label: 'RAPIDE', listen: 10, answer: 10 },
  intense: { key: 'intense', label: 'INTENSE', listen: 5, answer: 5 },
  expert: { key: 'expert', label: 'EXPERT', listen: 1, answer: null, scoreBudget: 45, allowReplay: true },
  ultra: { key: 'ultra', label: 'ULTRA', listen: 1, answer: 5 }
};
function describeSpeed(preset) {
  const replayPart = preset.allowReplay || !preset.listen ? 'Réécoute autorisée.' : 'Réécoute non autorisée.';
  if (!preset.listen) return `Écoute libre pendant ${preset.answer} s pour répondre. ${replayPart}`;
  const answerPart = preset.answer == null ? 'temps illimité pour trouver' : `${preset.answer} s pour trouver`;
  return `${preset.listen} s d'écoute forcée, puis ${answerPart}. ${replayPart}`;
}
const ROUND_TYPES = {
  title: { key: 'title', label: 'TITRE LIBRE' },
  qcm: { key: 'qcm', label: '4 CHOIX' },
  artist: { key: 'artist', label: "TROUVE L'ARTISTE" }
};
const ARTIST_ROUND_FALLBACK_ID = 'cat-rapfr';
function capitalizeKey(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function soloRecordField(speedKey, roundType) { return `soloRecord${capitalizeKey(speedKey)}${capitalizeKey(roundType)}`; }
function challengeMetricField(metric, roundType) { return `${metric}${capitalizeKey(roundType)}`; }
function rankPointsField(roundType) { return `rankPoints${capitalizeKey(roundType)}`; }
function rankGamesField(roundType) { return `rankGames${capitalizeKey(roundType)}`; }
function bestField(mode, roundType) { return mode === 'solo' ? `bestSolo${capitalizeKey(roundType)}` : `bestChallenge${capitalizeKey(roundType)}`; }
function leaderboardModeLabel(mode) { return mode === 'challenge' ? 'RANKED' : (SPEED_PRESETS[mode]?.label || mode.toUpperCase()); }
const previewCache = new Map();
function fetchJsonWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal })
    .then(response => { if (!response.ok) throw new Error('Requête indisponible'); return response.json(); })
    .finally(() => clearTimeout(timeoutId));
}

const $ = (selector) => document.querySelector(selector);
const ui = {
  setup: $('#setupScreen'), game: $('#gameScreen'), result: $('#resultScreen'),
  start: $('#startButton'), artists: $('#artistGrid'), activeArtist: $('#activeArtistLabel'), best: $('#bestScore'), authMessage: $('#authMessage'),
  artistSearch: $('#artistSearch'), artistEmptyState: $('#artistEmptyState'), artistEmptyQuery: $('#artistEmptyQuery'), artistSortOptions: document.querySelectorAll('.artist-sort-option'), sourceTabs: document.querySelectorAll('.source-tab'), leaderboardButton: $('#leaderboardButton'), leaderboardPanel: $('#leaderboardPanel'), leaderboardClose: $('#leaderboardClose'), leaderboardEyebrow: $('#leaderboardEyebrow'), leaderboardStatus: $('#leaderboardStatus'), leaderboardList: $('#leaderboardList'), leaderboardModeTabs: document.querySelectorAll('#leaderboardModeTabs .leaderboard-tab'), leaderboardMetricGroup: $('#leaderboardMetricTabs'), leaderboardMetricTabs: document.querySelectorAll('#leaderboardMetricTabs .leaderboard-tab'), leaderboardRoundTypeTabs: document.querySelectorAll('#leaderboardRoundTypeTabs .leaderboard-tab'),
  rounds: $('#roundPicker'), speedPicker: $('#speedPicker'), speedDescription: $('#speedDescription'), roundLabel: $('#roundLabel'), score: $('#scoreLabel strong'),
  roundTypeOptions: document.querySelectorAll('.round-type-option'), qcmChoices: $('#qcmChoices'), guessArea: $('.guess-area'),
  rankLabel: $('#rankLabel'), rankLabelValue: $('#rankLabel strong'), rankBadge: $('#rankBadge'), rankValue: $('#rankValue'),
  timer: $('#timerProgress'), timerText: $('#timerText'), audio: $('#audioPlayer'),
  play: $('#playButton'), volume: $('#volumeControl'), volumeValue: $('#volumeValue'), waveform: $('#waveform'), playerControls: $('.player-controls'), answerCountdown: $('#answerCountdown'), answerCountdownValue: $('#answerCountdownValue'), playerState: $('#playerState'), soundcloud: $('#soundcloudPlayer'), soundcloudCredit: $('#soundcloudCredit'), reveal: $('#trackReveal'), revealCover: $('#revealCover'), revealType: $('#revealType'), revealTitle: $('#revealTitle'), revealMeta: $('#revealMeta'), playerPanel: $('.player-panel'),
  input: $('#guessInput'), validate: $('#validateButton'), feedback: $('#feedback'),
  hint: $('#hintButton'), hintCount: $('#hintCount'), hintText: $('#hintText'), skip: $('#skipButton'),
  finalScore: $('#finalScore'), resultMode: $('#resultMode'), bestTime: $('#bestTime'),
  correct: $('#correctCount'), record: $('#recordScore'), played: $('#playedList'), restart: $('#restartButton'), home: $('#homeButton'),
  statsButton: $('#statsButton'), statsOverlay: $('#statsOverlay'), statsClose: $('#statsClose'), statsStatus: $('#statsStatus'), statsList: $('#statsList'),
  loginButton: $('#loginButton'), loginPromptOverlay: $('#loginPromptOverlay'), loginPromptClose: $('#loginPromptClose'), loginPromptGoogle: $('#loginPromptGoogle'), loginPromptGuest: $('#loginPromptGuest')
};

let songs = [];
let artists = [];
let selectedArtist = null;
let state = {};
let soundcloudMessageHandler = null;
let currentUser = null;
let firestoreDb = null;
let accountBest = { solo: {}, challenge: {} };
let leaderboardMode = 'classic';
let leaderboardMetric = 'challengeRecord';
let leaderboardRoundType = 'title';
let statsRoundType = 'title';
function currentLeaderboardField() { return leaderboardMode === 'challenge' ? challengeMetricField(leaderboardMetric, leaderboardRoundType) : soloRecordField(leaderboardMode, leaderboardRoundType); }
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
function isComplexTitle(titleRaw) {
  return normalise(titleRaw).length >= 10 || /['’\/]/.test(titleRaw);
}
function sameWordsAnyOrder(guessRaw, titleRaw) {
  if (!isComplexTitle(titleRaw)) return false;
  const guessWords = wordsOf(guessRaw).sort();
  const titleWords = wordsOf(titleRaw).sort();
  if (!guessWords.length || guessWords.length !== titleWords.length) return false;
  return guessWords.every((word, index) => word === titleWords[index]);
}
function freestyleNumberMatch(guessRaw, titleRaw) {
  if (!/freestyle/i.test(titleRaw)) return false;
  const guessDigits = normalise(guessRaw);
  if (!/^\d+$/.test(guessDigits)) return false;
  const titleTrailing = normalise(titleRaw).match(/(\d+)$/);
  return !!titleTrailing && guessDigits === titleTrailing[1];
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function storageUid() { return currentUser?.uid || localStorage.getItem('ziak-blindtest-last-uid') || 'guest'; }
function activeArtistId() { return selectedArtist?.id || state.artist?.id || 'ziak'; }
function scorePrefix(artistId = activeArtistId()) { return artistId === 'ziak' ? 'ziak-blindtest' : `blindtest-${artistId}`; }
function bestKey(mode, roundType, artistId = activeArtistId()) { return `${scorePrefix(artistId)}-best-${storageUid()}-${mode}-${roundType}`; }
function guestBestKey(mode, roundType, artistId = activeArtistId()) { return `${scorePrefix(artistId)}-best-guest-${mode}-${roundType}`; }
function statsKey(artistId = activeArtistId()) { return `${scorePrefix(artistId)}-stats-${storageUid()}`; }
function getBest(mode, roundType) { return Math.max(Number(localStorage.getItem(bestKey(mode, roundType))) || 0, Number(accountBest[mode]?.[roundType]) || 0); }
function refreshBest() {
  const values = Object.keys(ROUND_TYPES).flatMap(rt => [getBest('solo', rt), getBest('challenge', rt)]);
  ui.best.textContent = Math.max(0, ...values);
}
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
  const types = Object.keys(ROUND_TYPES);
  localStorage.setItem('ziak-blindtest-last-uid', user?.uid || '');
  accountBest = { solo: {}, challenge: {} };
  types.forEach(rt => {
    accountBest.solo[rt] = Number(localStorage.getItem(bestKey('solo', rt, artistId))) || 0;
    accountBest.challenge[rt] = Number(localStorage.getItem(bestKey('challenge', rt, artistId))) || 0;
  });
  refreshBest();
  if (!firestoreDb || !user) { refreshBest(); return; }
  try {
    const snapshot = await withTimeout(firestoreDb.collection('users').doc(user.uid).get());
    if (snapshot.exists) {
      const profile = snapshot.data();
      const artistStats = profile.artistStats?.[artistId] || (artistId === 'ziak' ? profile : {});
      const localStatsNow = readLocalStats();
      let statsChanged = false;
      types.forEach(rt => {
        accountBest.solo[rt] = Math.max(accountBest.solo[rt], Number(artistStats[bestField('solo', rt)]) || 0);
        accountBest.challenge[rt] = Math.max(accountBest.challenge[rt], Number(artistStats[bestField('challenge', rt)]) || 0);
        localStorage.setItem(bestKey('solo', rt, artistId), String(accountBest.solo[rt]));
        localStorage.setItem(bestKey('challenge', rt, artistId), String(accountBest.challenge[rt]));
        const cloudRankGames = Number(artistStats[rankGamesField(rt)]) || 0;
        if (cloudRankGames > (Number(localStatsNow[rankGamesField(rt)]) || 0)) {
          localStatsNow[rankPointsField(rt)] = Number(artistStats[rankPointsField(rt)]) || 0;
          localStatsNow[rankGamesField(rt)] = cloudRankGames;
          statsChanged = true;
        }
      });
      if (statsChanged) localStorage.setItem(statsKey(), JSON.stringify(localStatsNow));
    }
  } catch { /* Firestore reste optionnel tant que ses règles ne sont pas activées. */ }
  refreshBest();
}
async function migrateGuestBest(user) {
  if (!firestoreDb || !user) return;
  const artistId = activeArtistId();
  const prefix = scorePrefix(artistId);
  const types = Object.keys(ROUND_TYPES);
  const guestValues = {};
  let hasAny = false;
  types.forEach(rt => {
    guestValues[rt] = {
      solo: Number(localStorage.getItem(guestBestKey('solo', rt, artistId))) || 0,
      challenge: Number(localStorage.getItem(guestBestKey('challenge', rt, artistId))) || 0
    };
    if (guestValues[rt].solo || guestValues[rt].challenge) hasAny = true;
  });
  if (!hasAny) return;
  const userRef = firestoreDb.collection('users').doc(user.uid);
  try {
    await firestoreDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(userRef);
      const previous = snapshot.exists ? snapshot.data() : {};
      const previousArtist = previous.artistStats?.[artistId] || (artistId === 'ziak' ? previous : {});
      const artistUpdate = { artistId, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      let overallRecord = Number(previousArtist.record) || 0;
      types.forEach(rt => {
        const soloField = bestField('solo', rt); const challengeField = bestField('challenge', rt);
        const recordField = challengeMetricField('challengeRecord', rt);
        artistUpdate[soloField] = Math.max(Number(previousArtist[soloField]) || 0, guestValues[rt].solo);
        artistUpdate[challengeField] = Math.max(Number(previousArtist[challengeField]) || 0, guestValues[rt].challenge);
        artistUpdate[recordField] = Math.max(Number(previousArtist[recordField]) || 0, guestValues[rt].challenge);
        overallRecord = Math.max(overallRecord, guestValues[rt].solo, guestValues[rt].challenge);
      });
      artistUpdate.record = overallRecord;
      transaction.set(userRef, {
        uid: user.uid,
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        artistStats: { [artistId]: artistUpdate },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    types.forEach(rt => {
      localStorage.removeItem(guestBestKey('solo', rt, artistId));
      localStorage.removeItem(guestBestKey('challenge', rt, artistId));
      accountBest.solo[rt] = Math.max(Number(accountBest.solo[rt]) || 0, guestValues[rt].solo);
      accountBest.challenge[rt] = Math.max(Number(accountBest.challenge[rt]) || 0, guestValues[rt].challenge);
    });
    refreshBest();
  } catch (error) {
    console.error('Impossible de migrer le score local vers Firebase', error);
  }
}
async function saveBest(mode, score, fastest, correctCount, rankResult = null, speedKey = 'classic', roundType = 'title') {
  const numericScore = Math.max(0, Number(score) || 0);
  const modeField = bestField(mode, roundType);
  const knownBest = Math.max(Number(localStorage.getItem(bestKey(mode, roundType))) || 0, Number(accountBest[mode]?.[roundType]) || 0);
  const localBest = Math.max(knownBest, numericScore);
  localStorage.setItem(bestKey(mode, roundType), String(localBest));
  accountBest[mode] = accountBest[mode] || {};
  accountBest[mode][roundType] = Math.max(Number(accountBest[mode][roundType]) || 0, numericScore);
  const localStats = readLocalStats();
  localStats.record = Math.max(Number(localStats.record) || 0, numericScore);
  if (mode === 'challenge') {
    const recordField = challengeMetricField('challengeRecord', roundType);
    const correctField = challengeMetricField('challengeCorrect', roundType);
    const timeField = challengeMetricField('challengeTime', roundType);
    localStats[recordField] = Math.max(Number(localStats[recordField]) || 0, numericScore);
    localStats[correctField] = Math.max(Number(localStats[correctField]) || 0, Number(correctCount) || 0);
    if (Number.isFinite(Number(fastest))) localStats[timeField] = localStats[timeField] > 0 ? Math.min(Number(localStats[timeField]), Number(fastest)) : Number(fastest);
    if (rankResult) { localStats[rankPointsField(roundType)] = rankResult.points; localStats[rankGamesField(roundType)] = rankResult.games; }
  } else if (mode === 'solo') {
    const soloField = soloRecordField(speedKey, roundType);
    localStats[soloField] = Math.max(Number(localStats[soloField]) || 0, numericScore);
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
      const timeField = challengeMetricField('challengeTime', roundType);
      const previousTime = Number(previousArtist[timeField]);
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
        lastRoundType: roundType,
        totalGames: (Number(previousArtist.totalGames) || 0) + 1,
        totalCorrect: (Number(previousArtist.totalCorrect) || 0) + (Number(correctCount) || 0),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (mode === 'challenge') {
        const recordField = challengeMetricField('challengeRecord', roundType);
        const correctField = challengeMetricField('challengeCorrect', roundType);
        updates[recordField] = Math.max(Number(previousArtist[recordField]) || 0, numericScore);
        updates[correctField] = Math.max(Number(previousArtist[correctField]) || 0, Number(correctCount) || 0);
        if (Number.isFinite(Number(fastest))) updates[timeField] = previousTime > 0 ? Math.min(previousTime, Number(fastest)) : Number(fastest);
        if (rankResult) { updates[rankPointsField(roundType)] = rankResult.points; updates[rankGamesField(roundType)] = rankResult.games; }
      } else if (mode === 'solo') {
        const soloField = soloRecordField(speedKey, roundType);
        updates[soloField] = Math.max(Number(previousArtist[soloField]) || 0, numericScore);
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
  if (field.startsWith('challengeTime')) return `${Number(value).toFixed(1)} S`;
  if (field.startsWith('challengeCorrect')) return `${value} BONNES`;
  return `${value} PTS`;
}
function renderLocalLeaderboard(field, status = 'Classement cloud indisponible — score local affiché.') {
  const localStats = readLocalStats();
  const value = Number(localStats[field]) || 0;
  if (!currentUser || !value) { ui.leaderboardStatus.textContent = status; ui.leaderboardList.innerHTML = ''; return; }
  ui.leaderboardStatus.textContent = status;
  ui.leaderboardList.innerHTML = `<li><span class="leader-rank">01</span><span class="leader-user"><img src="${escapeHtml(currentUser.photoURL || '')}" alt="" /><strong>${escapeHtml(currentUser.displayName || currentUser.email || 'Moi')}</strong></span><span class="leader-value">${leaderboardLabel(field, value)}</span></li>`;
}
async function loadLeaderboard(field = 'challengeRecord') {
  if (!currentUser || !firestoreDb) { ui.leaderboardStatus.textContent = 'Connecte-toi avec Google pour voir le classement.'; ui.leaderboardList.innerHTML = ''; return; }
  // Affiche tout de suite le meilleur score local pendant que le cloud répond.
  // Ainsi le panneau ne reste jamais vide pendant le démarrage de Firestore.
  renderLocalLeaderboard(field, 'Synchronisation du classement cloud…');
  try {
    const direction = field.startsWith('challengeTime') ? 'asc' : 'desc';
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
let statsProfile = null;
async function loadUserStats() {
  if (!ui.statsList) return;
  statsProfile = null;
  if (!currentUser) { ui.statsStatus.textContent = 'Connecte-toi avec Google pour voir tes stats.'; ui.statsList.innerHTML = ''; return; }
  statsRoundType = 'title';
  ui.statsStatus.textContent = 'Chargement…'; ui.statsList.innerHTML = '';
  try {
    const snapshot = await withTimeout(firestoreDb.collection('users').doc(currentUser.uid).get());
    statsProfile = snapshot.exists ? snapshot.data() : {};
    ui.statsStatus.textContent = '';
    renderStatsMenu();
  } catch {
    ui.statsStatus.textContent = 'Impossible de charger tes stats — vérifie ta connexion.';
  }
}
function statsRoster() { return artists.length ? artists : [{ id: 'ziak', name: 'Ziak' }]; }
function renderStatsMenu() {
  ui.statsList.className = 'stats-list stats-menu';
  ui.statsList.innerHTML = statsRoster().map(artist => `<li><button class="stats-menu-item" type="button" data-artist-id="${escapeHtml(artist.id)}"><strong>${escapeHtml(artist.name)}</strong><span class="stats-menu-arrow">→</span></button></li>`).join('');
  ui.statsList.querySelectorAll('.stats-menu-item').forEach(button => button.addEventListener('click', () => renderStatsDetail(button.dataset.artistId)));
}
function renderStatsDetail(artistId) {
  const artist = statsRoster().find(item => item.id === artistId) || { id: artistId, name: artistId };
  const stats = statsProfile?.artistStats?.[artist.id] || (artist.id === 'ziak' ? statsProfile : {}) || {};
  const availableTypes = Object.keys(ROUND_TYPES).filter(rt => rt !== 'artist' || Boolean(artist.category));
  if (!availableTypes.includes(statsRoundType)) statsRoundType = 'title';
  const bestSolo = Number(stats[bestField('solo', statsRoundType)]) || 0;
  const bestChallenge = Number(stats[bestField('challenge', statsRoundType)]) || 0;
  const totalGames = Number(stats.totalGames) || 0;
  const totalCorrect = Number(stats.totalCorrect) || 0;
  const challengeTime = Number(stats[challengeMetricField('challengeTime', statsRoundType)]) || 0;
  const rank = bestChallenge > 0 ? getRank(bestChallenge) : '—';
  const roundTypeTabs = availableTypes.map(rt => `<button class="leaderboard-tab ${rt === statsRoundType ? 'selected' : ''}" type="button" data-round-type="${rt}">${escapeHtml(ROUND_TYPES[rt].label)}</button>`).join('');
  ui.statsList.className = 'stats-list stats-detail-wrap';
  ui.statsList.innerHTML = `<li>
    <button class="stats-back" type="button">← ARTISTES</button>
    <div class="stats-row">
      <div class="stats-artist"><strong>${escapeHtml(artist.name)}</strong></div>
      <div class="leaderboard-tabs leaderboard-subtabs">${roundTypeTabs}</div>
      <div class="stats-grid-mini">
        <div><span>MEILLEUR SOLO</span><strong>${bestSolo}</strong></div>
        <div><span>MEILLEUR RANKED</span><strong>${bestChallenge}</strong></div>
        <div><span>RANG</span><strong>${rank}</strong></div>
        <div><span>PARTIES JOUÉES</span><strong>${totalGames}</strong></div>
        <div><span>BONNES RÉPONSES</span><strong>${totalCorrect}</strong></div>
        <div><span>MEILLEUR TEMPS</span><strong>${challengeTime ? challengeTime.toFixed(1) + ' S' : '—'}</strong></div>
      </div>
    </div>
  </li>`;
  ui.statsList.querySelector('.stats-back').addEventListener('click', renderStatsMenu);
  ui.statsList.querySelectorAll('.leaderboard-tab').forEach(button => button.addEventListener('click', () => { statsRoundType = button.dataset.roundType; renderStatsDetail(artistId); }));
}
function show(screen) { [ui.setup, ui.game, ui.result].forEach(item => item.classList.toggle('hidden', item !== screen)); }
function shuffled(items) { return [...items].sort(() => Math.random() - .5); }

function updateArtistBrand(artist) {
  const name = artist?.name || 'Blind Test';
  document.title = `${name.toUpperCase()} // RAP KULTUUR`;
  if (ui.activeArtist) ui.activeArtist.textContent = name.toUpperCase();
  updateLeaderboardEyebrow();
}
function updateLeaderboardEyebrow() {
  if (!ui.leaderboardEyebrow) return;
  const name = (selectedArtist?.name || 'Blind Test').toUpperCase();
  const roundTypeLabel = ROUND_TYPES[leaderboardRoundType]?.label || '';
  ui.leaderboardEyebrow.textContent = `CLASSEMENT · ${name} · ${roundTypeLabel} · ${leaderboardModeLabel(leaderboardMode)}`;
}
function updateLeaderboardRoundTypeAvailability() {
  const tab = document.querySelector('#leaderboardRoundTypeTabs .leaderboard-tab[data-round-type="artist"]');
  if (!tab) return;
  const available = Boolean(selectedArtist?.category);
  tab.hidden = !available;
  if (!available && tab.classList.contains('selected')) {
    tab.classList.remove('selected');
    leaderboardRoundType = 'title';
    document.querySelector('#leaderboardRoundTypeTabs .leaderboard-tab[data-round-type="title"]')?.classList.add('selected');
    updateLeaderboardEyebrow();
  }
}
let artistSearchQuery = '';
let artistSortMode = 'default';
let sourceTab = 'artists';
function visibleArtists() {
  const query = normalise(artistSearchQuery);
  const pool = artists.filter(artist => Boolean(artist.category) === (sourceTab === 'categories'));
  let list = query ? pool.filter(artist => normalise(artist.name).includes(query)) : pool.slice();
  if (artistSortMode === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return list;
}
function renderArtists() {
  if (!ui.artists) return;
  const list = visibleArtists();
  ui.artists.innerHTML = list.map(artist => {
    const description = artist.category && artist.description ? `<small>${escapeHtml(artist.description)}</small>` : '';
    if (artist.category) {
      let art = '';
      if (artist.heroArt) {
        art = `<span class="category-card-figures">
          <img class="category-card-figure figure-left" src="${escapeHtml(artist.heroArt.left)}" alt="" />
          <img class="category-card-figure figure-right" src="${escapeHtml(artist.heroArt.right)}" alt="" />
          <img class="category-card-figure figure-center" src="${escapeHtml(artist.heroArt.center)}" alt="" />
        </span>`;
      } else if (artist.image) {
        art = `<img class="category-card-art" src="${escapeHtml(artist.image)}" alt="" loading="lazy" />`;
      }
      return `<button class="artist-card category-card ${artist.image || artist.heroArt ? '' : 'no-photo'} ${artist.id === selectedArtist?.id ? 'selected' : ''}" type="button" data-artist-id="${escapeHtml(artist.id)}"><strong>${escapeHtml(artist.name)}</strong>${description}${art}</button>`;
    }
    const photo = artist.image ? `<span class="artist-card-art"><img src="${escapeHtml(artist.image)}" alt="" loading="lazy" /></span>` : '';
    return `<button class="artist-card ${artist.image ? '' : 'no-photo'} ${artist.id === selectedArtist?.id ? 'selected' : ''}" type="button" data-artist-id="${escapeHtml(artist.id)}">${photo}<strong>${escapeHtml(artist.name)}</strong></button>`;
  }).join('');
  ui.artists.querySelectorAll('.artist-card').forEach(button => button.addEventListener('click', () => selectArtist(button.dataset.artistId)));
  if (ui.artistEmptyState) {
    ui.artistEmptyState.hidden = list.length > 0 || !artistSearchQuery;
    ui.artists.hidden = list.length === 0 && Boolean(artistSearchQuery);
    if (ui.artistEmptyQuery) ui.artistEmptyQuery.textContent = artistSearchQuery;
  }
}
function updateSelectedCardHighlight() {
  if (!ui.artists) return;
  ui.artists.querySelectorAll('.artist-card').forEach(button => {
    button.classList.toggle('selected', button.dataset.artistId === selectedArtist?.id);
  });
}
async function selectArtist(artistId) {
  const artist = artists.find(item => item.id === artistId);
  if (!artist || (artist.id === selectedArtist?.id && songs.length)) return;
  selectedArtist = artist;
  localStorage.setItem('blindtest-selected-artist', artist.id);
  updateArtistBrand(artist); updateSelectedCardHighlight(); updateLeaderboardRoundTypeAvailability();
  songs = []; ui.start.disabled = true;
  await loadSongs();
  if (currentUser) {
    accountBestReady = loadAccountBest(currentUser).then(() => migrateGuestBest(currentUser));
    if (!ui.leaderboardPanel.hidden) loadLeaderboard(currentLeaderboardField());
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
  renderArtists();
  const savedArtistId = localStorage.getItem('blindtest-selected-artist');
  await selectArtist(artists.some(artist => artist.id === savedArtistId) ? savedArtistId : artists[0].id);
}
async function loadSongs() {
  const artist = selectedArtist || { id: 'ziak', name: 'Ziak', catalog: 'songs.json', mark: 'Z' };
  const loadingArtistId = artist.id;
  try {
    const response = await fetch(artist.catalog, { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (selectedArtist?.id !== loadingArtistId) return;
    songs = Array.isArray(data) ? data.filter(song => song && song.title && normalise(song.title) && (song.audio || song.soundcloudUrl || song.deezerTrackId)) : [];
    ui.start.disabled = !songs.length;
  } catch {
    if (selectedArtist?.id !== loadingArtistId) return;
    ui.start.disabled = true;
  }
}

function handleStartClick() {
  if (!songs.length) return;
  if (!currentUser) { ui.loginPromptOverlay.hidden = false; return; }
  startGame();
}
async function startGame() {
  if (!songs.length) return;
  const roundType = document.querySelector('.round-type-option.selected')?.dataset.roundType || 'title';
  if (roundType === 'artist' && !selectedArtist?.category) {
    const fallback = artists.find(item => item.id === ARTIST_ROUND_FALLBACK_ID) || artists.find(item => item.category);
    if (fallback) await selectArtist(fallback.id);
    if (!songs.length) return;
  }
  if (!currentUser) {
    ui.authMessage.textContent = 'Mode invité : connecte-toi avec Google pour synchroniser ton score.';
  }
  const mode = document.querySelector('.mode-card.selected').dataset.mode;
  const rounds = Number(document.querySelector('.round-option.selected').dataset.rounds);
  const speedKey = mode === 'solo' ? (document.querySelector('#speedPicker .round-option.selected')?.dataset.speed || 'classic') : 'classic';
  const speed = SPEED_PRESETS[speedKey] || SPEED_PRESETS.classic;
  state = { artist: selectedArtist, mode, rounds, speed, roundType, score: 0, played: [], deck: shuffled(songs), deckIndex: 0, current: null, hints: 0, revealed: new Set(), active: true, startedAt: 0, timerId: null, challengeRemainingMs: CHALLENGE_SECONDS * 1000, rankBefore: mode === 'challenge' ? getPersistentRank(roundType) : null };
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
  const isQcm = state.roundType === 'qcm';
  const freestylePrefix = state.roundType === 'title' ? freestylePrefixEnd(state.current.title) : null;
  ui.input.value = freestylePrefix !== null ? state.current.title.slice(0, freestylePrefix) : '';
  ui.input.placeholder = state.roundType === 'artist' ? "NOM DE L'ARTISTE" : 'NOM DU MORCEAU';
  ui.input.disabled = isQcm; ui.validate.disabled = isQcm; ui.hint.disabled = isQcm; ui.skip.disabled = false;
  ui.input.hidden = isQcm; ui.validate.hidden = isQcm; ui.hint.hidden = isQcm;
  ui.qcmChoices.hidden = !isQcm;
  if (isQcm) renderQcmChoices();
  ui.play.disabled = Boolean(state.speed?.listen) && !state.speed?.allowReplay;
  ui.answerCountdown.hidden = true; ui.waveform.classList.remove('hidden'); ui.playerControls.classList.remove('hidden');
  ui.feedback.textContent = ''; ui.feedback.className = 'feedback'; ui.hintCount.textContent = `×${HINTS_PER_ROUND}`;
  const artistLabel = state.artist?.name ? `${state.artist.name.toUpperCase()} · ` : '';
  const roundTypeLabel = ROUND_TYPES[state.roundType] ? `${ROUND_TYPES[state.roundType].label} · ` : '';
  ui.roundLabel.textContent = state.mode === 'solo' ? `${artistLabel}${roundTypeLabel}MANCHE ${String(state.played.length + 1).padStart(2, '0')} / ${state.rounds}` : `${artistLabel}${roundTypeLabel}RANKED · ${state.played.length + 1}`;
  ui.score.textContent = state.score;
  if (ui.rankLabel) {
    ui.rankLabel.hidden = state.mode !== 'challenge';
    if (state.mode === 'challenge' && ui.rankLabelValue) ui.rankLabelValue.textContent = state.rankBefore?.games ? getRank(state.rankBefore.points) : 'NON CLASSÉ';
  }
  ui.timer.style.transform = 'scaleX(1)'; ui.timerText.textContent = 'CHARGEMENT…';
  loadTrack(); prefetchUpcoming();
  renderHint();
  if (!isQcm) { ui.input.focus(); ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length); }
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
  if (!state.speed.allowReplay) {
    ui.playerState.textContent = 'RÉÉCOUTE INDISPONIBLE';
    ui.waveform.classList.add('hidden'); ui.playerControls.classList.add('hidden');
    ui.answerCountdown.hidden = false;
  }
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
  const secondsLabel = `${(left / 1000).toFixed(1)} S`;
  ui.timerText.textContent = phase === 'listen' ? `ÉCOUTE ${secondsLabel}` : secondsLabel;
  if (phase === 'answer' && ui.answerCountdownValue) ui.answerCountdownValue.textContent = secondsLabel;
  if (left <= 0) {
    clearInterval(state.timerId);
    if (phase === 'listen') { stopPlayback(); beginAnswerPhase(); }
    else resolveRound(false, 'Temps écoulé');
  }
}
function setPlaying(isPlaying) {
  state.isPlaying = isPlaying;
  ui.play.classList.toggle('is-playing', isPlaying); ui.waveform.classList.toggle('playing', isPlaying);
  if (state.roundResolved) return;
  if (!isPlaying && state.phase === 'answer' && state.speed?.listen && !state.speed?.allowReplay) { ui.playerState.textContent = 'RÉÉCOUTE INDISPONIBLE'; return; }
  ui.playerState.textContent = isPlaying ? 'LECTURE EN COURS' : 'EXTRAIT EN PAUSE';
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
  const performerLabel = song.artist ? `${song.artist.toUpperCase()} · ` : '';
  ui.revealCover.src = cover;
  ui.revealCover.alt = `Cover de ${title}`;
  ui.revealType.textContent = `${performerLabel}${isSingle ? 'SINGLE' : `ALBUM · ${albumTitle || 'PROJET'}`}`;
  ui.revealTitle.textContent = title;
  ui.revealMeta.textContent = `${dateLabel.toUpperCase()} · ${year || '—'}`;
  ui.reveal.hidden = false; ui.playerPanel.classList.add('revealed'); ui.play.classList.add('hidden'); ui.waveform.classList.add('hidden'); ui.answerCountdown.hidden = true; ui.playerState.textContent = 'RÉPONSE';
}
function prefetchDeezerTrack(id) {
  const key = String(id);
  if (!key || previewCache.has(key)) return;
  previewCache.set(key, null);
  fetchJsonWithTimeout(`/api/deezer-track?id=${encodeURIComponent(key)}`)
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
      ui.audio.src = data.preview; ui.audio.load(); ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track); onTrackReady();
      if (state.revealVisible) showTrackReveal();
      return true;
    };
    const cached = previewCache.get(trackId);
    if (cached) { applyTrack(cached); }
    else {
      ui.playerState.textContent = 'CHARGEMENT DE L’EXTRAIT';
      fetchJsonWithTimeout(`/api/deezer-track?id=${encodeURIComponent(trackId)}`)
        .then(data => {
          if (!data.preview) throw new Error('Aucun aperçu disponible');
          previewCache.set(trackId, data);
          if (!applyTrack(data)) throw new Error('Manche déjà changée');
        })
        .catch(() => { if (state.current === track) { ui.playerState.textContent = 'APERÇU INDISPONIBLE'; onTrackReady(); } });
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
  state.timerId = setInterval(updateTimer, 50); updateTimer();
}
function updateTimer() {
  const now = performance.now();
  if (state.mode === 'challenge') {
    const max = CHALLENGE_SECONDS * 1000;
    const left = Math.max(0, state.challengeRemainingMs - (now - state.startedAt));
    ui.timer.style.transform = `scaleX(${left / max})`; ui.timerText.textContent = `${(left / 1000).toFixed(1)} S`;
    if (left <= 0) {
      clearInterval(state.timerId); state.challengeRemainingMs = 0;
      if (state.current && !state.roundResolved) {
        state.roundResolved = true;
        state.played.push({ ...state.current, correct: false, seconds: (now - state.startedAt) / 1000, points: 0 });
      }
      endGame();
    }
    return;
  }
  const max = ROUND_SECONDS * 1000;
  const left = Math.max(0, max - (now - state.startedAt));
  ui.timer.style.transform = `scaleX(${left / max})`; ui.timerText.textContent = `${(left / 1000).toFixed(1)} S`;
  if (left <= 0) { clearInterval(state.timerId); resolveRound(false, 'Temps écoulé'); }
}
function freestylePrefixEnd(titleRaw) {
  if (!/freestyle/i.test(titleRaw)) return null;
  const match = titleRaw.match(/(\d+)\s*$/);
  return match ? match.index : null;
}
function roundTargetText() {
  if (state.roundType === 'artist') return state.current.artist || state.artist?.name || '';
  return state.current.title;
}
function qcmDistractorSongs(song) {
  const usedKeys = new Set([normalise(song.title)]);
  const distractors = [];
  const collect = (pool) => {
    for (const candidate of pool) {
      const key = normalise(candidate.title);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key); distractors.push(candidate);
      if (distractors.length === 3) break;
    }
  };
  collect(shuffled(songs.filter(item => item !== song && (!item.artist || !song.artist || item.artist === song.artist))));
  if (distractors.length < 3) collect(shuffled(songs.filter(item => item !== song)));
  return distractors;
}
function qcmCoverUrl(song) { return song.deezerTrackId ? `/api/deezer-cover?id=${encodeURIComponent(song.deezerTrackId)}` : ''; }
function renderQcmChoices() {
  const song = state.current;
  const options = shuffled([song, ...qcmDistractorSongs(song)]);
  ui.qcmChoices.innerHTML = options.map(item => {
    const coverUrl = qcmCoverUrl(item);
    const cover = coverUrl ? `<img class="qcm-choice-cover" src="${escapeHtml(coverUrl)}" alt="" loading="lazy" />` : '<span class="qcm-choice-cover"></span>';
    return `<button class="qcm-choice" type="button" data-title="${escapeHtml(item.title)}">${cover}<span class="qcm-choice-title">${escapeHtml(item.title)}</span></button>`;
  }).join('');
}
function disableQcmChoices(correctTitle, clickedButton = null) {
  ui.qcmChoices.querySelectorAll('.qcm-choice').forEach(button => {
    button.disabled = true;
    if (normalise(button.dataset.title) === normalise(correctTitle)) button.classList.add('correct');
    else if (button === clickedButton) button.classList.add('wrong');
  });
}
function handleQcmChoiceClick(event) {
  const button = event.target.closest('.qcm-choice');
  if (!button || state.roundResolved) return;
  const correct = normalise(button.dataset.title) === normalise(state.current.title);
  disableQcmChoices(state.current.title, button);
  resolveRound(correct);
}
function renderHint() {
  if (state.roundType === 'qcm') { ui.hintText.hidden = true; ui.hintText.textContent = ''; return; }
  const title = roundTargetText();
  if (state.roundType !== 'artist' && freestylePrefixEnd(title) !== null && state.hints < 3) { ui.hintText.hidden = true; ui.hintText.textContent = ''; return; }
  ui.hintText.hidden = false;
  const display = [...title].map((char, index) => {
    if (char === ' ') return ' / ';
    return state.revealed.has(index) ? char.toUpperCase() : '_';
  }).join(' ');
  ui.hintText.textContent = state.hints === 3 ? `ANNÉE : ${state.current.year}` : display;
}
function useHint() {
  if (state.hints >= HINTS_PER_ROUND || state.roundResolved || state.roundType === 'qcm') return;
  state.hints++;
  if (state.hints < 3) {
    const target = roundTargetText();
    const candidates = [...target].map((char, index) => ({ char, index })).filter(({ char, index }) => char !== ' ' && !state.revealed.has(index));
    if (candidates.length) state.revealed.add(candidates[Math.floor(Math.random() * candidates.length)].index);
  }
  ui.hintCount.textContent = `×${HINTS_PER_ROUND - state.hints}`; ui.hint.disabled = state.hints >= HINTS_PER_ROUND; renderHint();
}
function toggleAudio() {
  if (!state.current || state.roundResolved) return;
  if (state.current.deezerTrackId) {
    if (!state.deezerPreviewUrl) { ui.playerState.textContent = 'EXTRAIT EN CHARGEMENT'; return; }
    if (ui.audio.paused) {
      ui.audio.currentTime = 0;
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
  } else if (ui.audio.paused) { ui.audio.currentTime = 0; ui.audio.play().catch(() => { ui.playerState.textContent = 'EXTRAIT INTROUVABLE'; }); } else ui.audio.pause();
}
function checkGuess() {
  if (state.roundResolved || state.roundType === 'qcm') return false;
  const rawGuess = ui.input.value;
  const guess = normalise(rawGuess);
  if (!guess) return false;
  const title = roundTargetText();
  if (guess === normalise(title)) { resolveRound(true); return true; }
  if (state.roundType === 'title' && freestyleNumberMatch(rawGuess, title)) { resolveRound(true); return true; }
  if (sameWordsAnyOrder(rawGuess, title)) { resolveRound(true, '', { outOfOrder: true }); return true; }
  ui.feedback.textContent = 'Pas encore. Essaie à nouveau.'; ui.feedback.className = 'feedback wrong'; ui.input.select();
  return false;
}
function handleGuessInput() {
  if (state.roundResolved || !state.current || state.roundType === 'qcm') return;
  const rawGuess = ui.input.value;
  const guess = normalise(rawGuess);
  if (!guess) { ui.feedback.textContent = ''; ui.feedback.className = 'feedback'; return; }
  const title = roundTargetText();
  const normalisedTitle = normalise(title);
  if (guess === normalisedTitle) { resolveRound(true); return; }
  if (state.roundType === 'title' && freestyleNumberMatch(rawGuess, title)) { resolveRound(true); return; }
  if (sameWordsAnyOrder(rawGuess, title)) { resolveRound(true, '', { outOfOrder: true }); return; }
  if (guess.length >= normalisedTitle.length) {
    ui.feedback.textContent = 'Pas encore. Essaie à nouveau.'; ui.feedback.className = 'feedback wrong';
    const prefixEnd = state.roundType === 'title' ? freestylePrefixEnd(title) : null;
    ui.input.value = prefixEnd !== null ? title.slice(0, prefixEnd) : '';
    ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length);
  }
}
function resolveRound(correct, message = '', options = {}) {
  if (state.roundResolved) return;
  state.roundResolved = true; clearInterval(state.timerId);
  if (state.mode === 'challenge') state.challengeRemainingMs = Math.max(0, state.challengeRemainingMs - (performance.now() - state.startedAt));
  if (!correct) stopPlayback();
  const seconds = (performance.now() - state.startedAt) / 1000;
  const budget = state.scoreBudgetSeconds || ROUND_SECONDS;
  let points = correct ? Math.max(100, Math.round((budget - Math.min(seconds, budget)) * 20) - state.hints * 35) : 0;
  if (correct && options.outOfOrder) points = Math.round(points * OUT_OF_ORDER_PENALTY_RATIO);
  if (correct) state.score += points;
  state.played.push({ ...state.current, correct, seconds, points }); ui.score.textContent = state.score;
  const qualifier = options.outOfOrder ? ' (ORDRE MÉLANGÉ)' : '';
  ui.feedback.textContent = correct
    ? `BIEN JOUÉ${qualifier} +${points} PTS · ${state.current.project || 'Projet inconnu'} (${state.current.year || '—'})`
    : `${message} : ${roundTargetText()}`;
  ui.feedback.className = `feedback ${correct ? 'correct' : 'wrong'}`; ui.input.disabled = true; ui.validate.disabled = true; ui.hint.disabled = true; ui.skip.disabled = true; ui.play.disabled = true;
  if (state.roundType === 'qcm') disableQcmChoices(state.current.title);
  else ui.hintText.textContent = `${correct ? '✓' : '✕'} ${roundTargetText().toUpperCase()}`;
  state.revealVisible = true; showTrackReveal();
  setTimeout(nextRound, 1700);
}
async function endGame() {
  if (!state.active) return;
  state.active = false; clearInterval(state.timerId); stopPlayback();
  const previousBest = getBest(state.mode, state.roundType); const record = Math.max(previousBest, state.score);
  const correct = state.played.filter(song => song.correct); const fastest = correct.length ? Math.min(...correct.map(song => song.seconds)) : null;
  let rankResult = null;
  if (state.mode === 'challenge') {
    const before = state.rankBefore || { points: 0, games: 0 };
    rankResult = { points: nextRankPoints(before.points, before.games, state.score), games: before.games + 1, isPlacement: before.games === 0 };
  }
  const saveResult = await saveBest(state.mode, state.score, fastest, correct.length, rankResult, state.speed?.key, state.roundType);
  if (saveResult.saved) ui.authMessage.textContent = 'Score sauvegardé sur ton compte Google.';
  else if (saveResult.reason === 'not-authenticated') ui.authMessage.textContent = 'Connecte-toi avec Google pour sauvegarder tes scores.';
  else ui.authMessage.textContent = 'Score gardé localement. Publie les règles Firestore pour le synchroniser.';
  const roundTypeLabel = ROUND_TYPES[state.roundType]?.label || '';
  ui.resultMode.textContent = `${state.artist?.name || 'ARTISTE'} · ${roundTypeLabel} · ${state.mode === 'solo' ? 'SOLO' : 'RANKED'}`; ui.finalScore.textContent = state.score; ui.bestTime.textContent = fastest ? `${fastest.toFixed(1)} S` : '—'; ui.correct.textContent = correct.length; ui.record.textContent = record;
  if (ui.rankBadge) {
    ui.rankBadge.hidden = state.mode !== 'challenge';
    if (state.mode === 'challenge' && ui.rankValue) ui.rankValue.textContent = rankResult.isPlacement ? `${getRank(rankResult.points)} (PLACEMENT)` : getRank(rankResult.points);
  }
  ui.played.innerHTML = state.played.map(song => `<li class="${song.correct ? '' : 'missed'}"><span>${song.correct ? '✓' : '×'} ${escapeHtml(song.title)}</span><span>${song.correct ? `+${song.points}` : 'MANQUÉ'}</span></li>`).join('') || '<li><span>Aucun morceau joué.</span></li>';
  show(ui.result);
}

function updateArtistRoundTypeAvailability() {
  const option = document.querySelector('.round-type-option[data-round-type="artist"]');
  if (!option) return;
  const available = sourceTab === 'categories';
  option.hidden = !available;
  if (!available && option.classList.contains('selected')) {
    option.classList.remove('selected');
    document.querySelector('.round-type-option[data-round-type="title"]')?.classList.add('selected');
  }
}
if (ui.sourceTabs) ui.sourceTabs.forEach(button => button.addEventListener('click', () => {
  sourceTab = button.dataset.source;
  ui.sourceTabs.forEach(item => item.classList.toggle('selected', item === button));
  artistSearchQuery = '';
  if (ui.artistSearch) ui.artistSearch.value = '';
  renderArtists();
  updateArtistRoundTypeAvailability();
}));
if (ui.artistSearch) ui.artistSearch.addEventListener('input', event => { artistSearchQuery = event.target.value; renderArtists(); });
ui.artistSortOptions.forEach(button => button.addEventListener('click', () => {
  artistSortMode = button.dataset.sort;
  ui.artistSortOptions.forEach(item => item.classList.toggle('selected', item === button));
  renderArtists();
}));
document.querySelectorAll('.mode-card').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.mode-card').forEach(item => item.classList.toggle('selected', item === button));
  const isChallenge = button.dataset.mode === 'challenge';
  ui.rounds.classList.toggle('hidden', isChallenge);
  if (ui.speedPicker) ui.speedPicker.classList.toggle('hidden', isChallenge);
  if (ui.speedDescription) ui.speedDescription.classList.toggle('hidden', isChallenge);
  ui.setup.classList.toggle('ranked-selected', isChallenge);
}));
ui.roundTypeOptions.forEach(button => button.addEventListener('click', () => {
  ui.roundTypeOptions.forEach(item => item.classList.toggle('selected', item === button));
}));
function updateSpeedDescription() {
  if (!ui.speedDescription) return;
  const key = document.querySelector('#speedPicker .round-option.selected')?.dataset.speed || 'classic';
  ui.speedDescription.textContent = describeSpeed(SPEED_PRESETS[key] || SPEED_PRESETS.classic);
}
document.querySelectorAll('.round-option').forEach(button => button.addEventListener('click', () => {
  const group = button.closest('.round-picker');
  (group ? group.querySelectorAll('.round-option') : document.querySelectorAll('.round-option')).forEach(item => item.classList.toggle('selected', item === button));
  if (group && group.id === 'speedPicker') updateSpeedDescription();
}));
ui.start.addEventListener('click', handleStartClick); ui.play.addEventListener('click', toggleAudio); ui.volume.addEventListener('input', event => setVolume(Number(event.target.value) / 100)); ui.validate.addEventListener('click', () => checkGuess()); ui.hint.addEventListener('click', useHint); ui.skip.addEventListener('click', () => resolveRound(false, 'Réponse')); ui.input.addEventListener('keydown', event => { if (event.key === 'Enter') checkGuess(); }); ui.input.addEventListener('input', handleGuessInput); ui.qcmChoices.addEventListener('click', handleQcmChoiceClick);
ui.audio.addEventListener('canplay', onTrackReady);
ui.audio.addEventListener('play', () => setPlaying(true));
ui.audio.addEventListener('pause', () => { if (!state.roundResolved) setPlaying(false); });
ui.audio.addEventListener('ended', () => { setPlaying(false); ui.playerState.textContent = 'EXTRAIT TERMINÉ'; });
ui.restart.addEventListener('click', handleStartClick);
if (ui.loginPromptClose) ui.loginPromptClose.addEventListener('click', () => { ui.loginPromptOverlay.hidden = true; });
if (ui.loginPromptOverlay) ui.loginPromptOverlay.addEventListener('click', event => { if (event.target === ui.loginPromptOverlay) ui.loginPromptOverlay.hidden = true; });
if (ui.loginPromptGuest) ui.loginPromptGuest.addEventListener('click', () => { ui.loginPromptOverlay.hidden = true; startGame(); });
if (ui.loginPromptGoogle) ui.loginPromptGoogle.addEventListener('click', () => { ui.loginPromptOverlay.hidden = true; ui.loginButton?.click(); });
ui.home.addEventListener('click', async () => {
  // Si l'utilisateur quitte une manche avant l'écran de résultat, on clôture
  // d'abord la partie pour ne jamais perdre son score.
  if (state.active && state.played?.length) await endGame();
  stopPlayback(); show(ui.setup);
  if (currentUser && !ui.leaderboardPanel.hidden) loadLeaderboard(currentLeaderboardField());
});
ui.leaderboardButton.addEventListener('click', () => { ui.leaderboardPanel.hidden = !ui.leaderboardPanel.hidden; if (!ui.leaderboardPanel.hidden) { updateLeaderboardRoundTypeAvailability(); loadLeaderboard(currentLeaderboardField()); } });
ui.leaderboardClose.addEventListener('click', () => { ui.leaderboardPanel.hidden = true; });
ui.leaderboardRoundTypeTabs.forEach(tab => tab.addEventListener('click', () => {
  leaderboardRoundType = tab.dataset.roundType;
  ui.leaderboardRoundTypeTabs.forEach(item => item.classList.toggle('selected', item === tab));
  updateLeaderboardEyebrow();
  loadLeaderboard(currentLeaderboardField());
}));
ui.leaderboardModeTabs.forEach(tab => tab.addEventListener('click', () => {
  leaderboardMode = tab.dataset.mode;
  ui.leaderboardModeTabs.forEach(item => item.classList.toggle('selected', item === tab));
  if (ui.leaderboardMetricGroup) ui.leaderboardMetricGroup.hidden = leaderboardMode !== 'challenge';
  updateLeaderboardEyebrow();
  loadLeaderboard(currentLeaderboardField());
}));
ui.leaderboardMetricTabs.forEach(tab => tab.addEventListener('click', () => {
  leaderboardMetric = tab.dataset.leaderboard;
  ui.leaderboardMetricTabs.forEach(item => item.classList.toggle('selected', item === tab));
  loadLeaderboard(currentLeaderboardField());
}));
if (ui.statsButton) ui.statsButton.addEventListener('click', () => { ui.statsOverlay.hidden = false; loadUserStats(); });
if (ui.statsClose) ui.statsClose.addEventListener('click', () => { ui.statsOverlay.hidden = true; });
if (ui.statsOverlay) ui.statsOverlay.addEventListener('click', event => { if (event.target === ui.statsOverlay) ui.statsOverlay.hidden = true; });

setVolume(getVolume()); refreshBest(); loadArtists(); updateSpeedDescription(); updateArtistRoundTypeAvailability();

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
      if (user) { profileName.textContent = user.displayName || user.email || 'Compte Google'; profilePhoto.src = user.photoURL || ''; accountBestReady = loadAccountBest(user).then(() => migrateGuestBest(user)); if (!ui.leaderboardPanel.hidden) loadLeaderboard(currentLeaderboardField()); setMessage(''); }
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
