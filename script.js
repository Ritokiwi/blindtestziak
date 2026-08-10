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
  loginButton: $('#loginButton'), loginPromptOverlay: $('#loginPromptOverlay'), loginPromptClose: $('#loginPromptClose'), loginPromptGoogle: $('#loginPromptGoogle'), loginPromptGuest: $('#loginPromptGuest'), loginPromptText: $('#loginPromptText')
};

let songs = [];
let artists = [];
let selectedArtist = null;
let state = {};
// Pointeur partagé par le moteur de lecture (loadTrack/autoplayTrack/setPlaying/
// stopPlayback/showTrackReveal/toggleAudio) : pointe vers `state` en Solo/Ranked
// et vers `vState` pendant un match VERSUS, pour réutiliser exactement la même
// logique de lecture Deezer/SoundCloud sans dupliquer ce code sensible.
let activeState = null;
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
  if (!activeState.current || activeState.current !== track || activeState.roundResolved || activeState.autoplayAttempted || activeState.speed?.listen) return;
  activeState.autoplayAttempted = true;
  if (track.deezerTrackId || track.audio) {
    ui.audio.play().then(() => {
      setPlaying(true);
      clearClipTimer(); activeState.clipTimer = setTimeout(stopPlayback, 20000);
    }).catch(() => {
      activeState.autoplayAttempted = false;
      ui.playerState.textContent = 'APPUYE POUR ÉCOUTER';
    });
  } else if (activeState.scReady) {
    setVolume(getVolume());
    if (activeState.scWidget) {
      activeState.scWidget.seekTo(Number(track.clipStart || 0) * 1000); activeState.scWidget.play();
    } else {
      sendSoundcloud('seekTo', Number(track.clipStart || 0) * 1000); sendSoundcloud('play');
    }
    clearClipTimer(); activeState.clipTimer = setTimeout(stopPlayback, Number(track.clipDuration || 20) * 1000);
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
  document.title = `${name.toUpperCase()} // RAP INSTINCT`;
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
let artistSortMode = 'alpha';
let sourceTab = 'artists';
function visibleArtists() {
  const query = normalise(artistSearchQuery);
  const pool = artists.filter(artist => Boolean(artist.category) === (sourceTab === 'categories'));
  let list = query ? pool.filter(artist => normalise(artist.name).includes(query)) : pool.slice();
  if (artistSortMode === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return list;
}
function artistGroupKey(artist) {
  const first = normalise(artist.name).charAt(0);
  if (!first) return '#';
  return /[0-9]/.test(first) ? '#' : first.toUpperCase();
}
function renderArtists() {
  if (!ui.artists) return;
  const list = visibleArtists();
  const groupByLetter = artistSortMode === 'alpha' && sourceTab === 'artists';
  let lastGroupKey = null;
  ui.artists.innerHTML = list.map(artist => {
    let header = '';
    if (groupByLetter) {
      const key = artistGroupKey(artist);
      if (key !== lastGroupKey) { header = `<div class="artist-group-header">${escapeHtml(key)}</div>`; lastGroupKey = key; }
    }
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
      return `${header}<button class="artist-card category-card ${artist.image || artist.heroArt ? '' : 'no-photo'} ${artist.id === selectedArtist?.id ? 'selected' : ''}" type="button" data-artist-id="${escapeHtml(artist.id)}"><strong>${escapeHtml(artist.name)}</strong>${description}${art}</button>`;
    }
    const photo = artist.image ? `<span class="artist-card-art"><img src="${escapeHtml(artist.image)}" alt="" loading="lazy" /></span>` : '';
    return `${header}<button class="artist-card ${artist.image ? '' : 'no-photo'} ${artist.id === selectedArtist?.id ? 'selected' : ''}" type="button" data-artist-id="${escapeHtml(artist.id)}">${photo}<strong>${escapeHtml(artist.name)}</strong></button>`;
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
  if (!currentUser) {
    ui.loginPromptGuest.hidden = false;
    ui.loginPromptText.textContent = 'Connecte-toi avec Google pour sauvegarder ton score, ton rang Ranked et débloquer le classement. Tu peux aussi continuer en invité.';
    ui.loginPromptOverlay.hidden = false;
    return;
  }
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
  state = { artist: selectedArtist, mode, rounds, speed, roundType, score: 0, played: [], deck: shuffled(songs), deckIndex: 0, current: null, hints: 0, revealed: new Set(), active: true, startedAt: 0, timerId: null, challengeRemainingMs: CHALLENGE_SECONDS * 1000, rankBefore: mode === 'challenge' ? getPersistentRank(roundType) : null, onTrackReady };
  state.onAnswerTimeout = () => resolveRound(false, 'Temps écoulé');
  state.onCorrectGuess = (options) => resolveRound(true, '', options);
  state.onWrongGuess = (button) => { if (state.roundType === 'qcm') disableQcmChoices(state.current.title, button); resolveRound(false, 'Réponse'); };
  activeState = state;
  ui.versusHeader.hidden = true; ui.versusInGameAbandon.hidden = true;
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
  ui.input.disabled = isQcm; ui.validate.disabled = isQcm; ui.hint.disabled = isQcm; ui.skip.disabled = false; ui.skip.hidden = false;
  ui.input.hidden = isQcm; ui.validate.hidden = isQcm; ui.hint.hidden = isQcm;
  ui.qcmChoices.hidden = !isQcm;
  if (isQcm) { state.qcmOptions = buildQcmOptions(state.current, songs); renderQcmChoices(); }
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
  if (!activeState.current || activeState.timerStarted || activeState.roundResolved) return;
  activeState.timerStarted = true; activeState.trackReady = true;
  if (activeState.speed?.listen) beginListenPhase(); else startTimer();
}
function beginListenPhase() {
  activeState.phase = 'listen';
  if (activeState.current.deezerTrackId || activeState.current.audio) ui.audio.play().catch(() => {});
  activeState.startedAt = performance.now();
  clearInterval(activeState.timerId);
  activeState.timerId = setInterval(() => updatePhaseTimer('listen'), 50);
  updatePhaseTimer('listen');
}
function beginAnswerPhase() {
  activeState.phase = 'answer';
  activeState.scoreBudgetSeconds = activeState.speed.answer ?? activeState.speed.scoreBudget ?? ROUND_SECONDS;
  activeState.startedAt = performance.now();
  if (!activeState.speed.allowReplay) {
    ui.playerState.textContent = 'RÉÉCOUTE INDISPONIBLE';
    ui.waveform.classList.add('hidden'); ui.playerControls.classList.add('hidden');
    ui.answerCountdown.hidden = false;
  }
  clearInterval(activeState.timerId);
  if (activeState.speed.answer == null) {
    activeState.timerId = setInterval(updateUnlimitedTimer, 100);
    updateUnlimitedTimer();
  } else {
    activeState.timerId = setInterval(() => updatePhaseTimer('answer'), 50);
    updatePhaseTimer('answer');
  }
}
function updateUnlimitedTimer() {
  const elapsed = (performance.now() - activeState.startedAt) / 1000;
  ui.timer.style.transform = 'scaleX(1)';
  ui.timerText.textContent = `${elapsed.toFixed(1)} S`;
}
function updatePhaseTimer(phase) {
  const now = performance.now();
  const durationMs = (phase === 'listen' ? activeState.speed.listen : activeState.speed.answer) * 1000;
  const left = Math.max(0, durationMs - (now - activeState.startedAt));
  ui.timer.style.transform = `scaleX(${left / durationMs})`;
  const secondsLabel = `${(left / 1000).toFixed(1)} S`;
  ui.timerText.textContent = phase === 'listen' ? `ÉCOUTE ${secondsLabel}` : secondsLabel;
  if (phase === 'answer' && ui.answerCountdownValue) ui.answerCountdownValue.textContent = secondsLabel;
  if (left <= 0) {
    clearInterval(activeState.timerId);
    if (phase === 'listen') { stopPlayback(); beginAnswerPhase(); }
    else activeState.onAnswerTimeout();
  }
}
function setPlaying(isPlaying) {
  activeState.isPlaying = isPlaying;
  ui.play.classList.toggle('is-playing', isPlaying); ui.waveform.classList.toggle('playing', isPlaying);
  if (activeState.roundResolved) return;
  if (!isPlaying && activeState.phase === 'answer' && activeState.speed?.listen && !activeState.speed?.allowReplay) { ui.playerState.textContent = 'RÉÉCOUTE INDISPONIBLE'; return; }
  ui.playerState.textContent = isPlaying ? 'LECTURE EN COURS' : 'EXTRAIT EN PAUSE';
}
function clearClipTimer() { clearTimeout(activeState.clipTimer); activeState.clipTimer = null; }
function sendSoundcloud(method, value) {
  if (!ui.soundcloud.contentWindow) return;
  ui.soundcloud.contentWindow.postMessage(JSON.stringify({ method, value }), 'https://w.soundcloud.com');
}
function stopPlayback() {
  clearClipTimer();
  ui.audio.pause();
  if (ui.soundcloud.src && ui.soundcloud.src !== 'about:blank') ui.soundcloud.src = 'about:blank';
  if (activeState.scWidget) activeState.scWidget.pause();
  else if (activeState.current?.soundcloudUrl) sendSoundcloud('pause');
  setPlaying(false);
}
function showTrackReveal() {
  const meta = activeState.trackMeta || {};
  const song = activeState.current;
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
  stopPlayback(); activeState.scReady = false; activeState.scWidget = null; activeState.isPlaying = false;
  activeState.autoplayAttempted = false; setVolume(getVolume());
  activeState.trackMeta = null; activeState.revealVisible = false;
  ui.reveal.hidden = true; ui.playerPanel.classList.remove('revealed'); ui.revealCover.removeAttribute('src');
  if (soundcloudMessageHandler) window.removeEventListener('message', soundcloudMessageHandler);
  soundcloudMessageHandler = null;
  ui.play.classList.remove('is-playing'); ui.waveform.classList.remove('playing');
  ui.playerState.textContent = 'EXTRAIT PRÊT';
  if (activeState.current.deezerTrackId) {
    const trackId = String(activeState.current.deezerTrackId);
    const track = activeState.current;
    ui.audio.removeAttribute('src'); ui.audio.load(); activeState.deezerPreviewUrl = '';
    ui.soundcloud.hidden = true; ui.soundcloud.classList.remove('visible');
    ui.play.classList.remove('hidden'); ui.waveform.classList.remove('hidden');
    ui.soundcloudCredit.href = `https://www.deezer.com/track/${trackId}`;
    ui.soundcloudCredit.textContent = 'SOURCE : DEEZER ↗'; ui.soundcloudCredit.classList.remove('hidden');
    const applyTrack = (data) => {
      if (activeState.current !== track || !data?.preview) return false;
      activeState.deezerPreviewUrl = data.preview; activeState.trackMeta = data;
      ui.audio.src = data.preview; ui.audio.load(); ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track); activeState.onTrackReady();
      if (activeState.revealVisible) showTrackReveal();
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
        .catch(() => { if (activeState.current === track) { ui.playerState.textContent = 'APERÇU INDISPONIBLE'; activeState.onTrackReady(); } });
    }
  } else if (activeState.current.soundcloudUrl) {
    ui.audio.removeAttribute('src'); ui.audio.load(); ui.soundcloud.hidden = false; ui.soundcloud.classList.add('visible');
    ui.play.classList.add('hidden'); ui.waveform.classList.add('hidden');
    ui.soundcloudCredit.href = activeState.current.soundcloudUrl; ui.soundcloudCredit.classList.remove('hidden');
    const track = activeState.current;
    soundcloudMessageHandler = (event) => {
      if (event.origin !== 'https://w.soundcloud.com' || activeState.current !== track) return;
      let message;
      try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!message?.method) return;
      if (message.method === 'ready') {
        activeState.scReady = true; ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track); activeState.onTrackReady();
        ['play', 'pause', 'finish'].forEach(name => sendSoundcloud('addEventListener', name));
      }
      if (message.method === 'play') setPlaying(true);
      if (message.method === 'pause' || message.method === 'finish') setPlaying(false);
    };
    window.addEventListener('message', soundcloudMessageHandler);
    ui.soundcloud.onload = () => {
      if (activeState.current !== track) return;
      // Le widget n'émet pas toujours l'événement READY dans certains navigateurs.
      // Son iframe est toutefois prêt à recevoir les commandes une fois chargée.
      setTimeout(() => {
        if (activeState.current !== track) return;
        activeState.scReady = true;
        if (!activeState.isPlaying) ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track); activeState.onTrackReady();
        ['play', 'pause', 'finish'].forEach(name => sendSoundcloud('addEventListener', name));
      }, 500);
    };
    ui.soundcloud.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(activeState.current.soundcloudUrl)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=true`;
    if (window.SC?.Widget) {
      const widget = window.SC.Widget(ui.soundcloud);
      activeState.scWidget = widget;
      widget.bind(window.SC.Widget.Events.READY, () => {
        if (activeState.current !== track || activeState.scWidget !== widget) return;
        activeState.scReady = true; ui.playerState.textContent = 'EXTRAIT PRÊT'; setVolume(getVolume()); autoplayTrack(track); activeState.onTrackReady();
      });
      widget.bind(window.SC.Widget.Events.PLAY, () => { if (activeState.scWidget === widget) setPlaying(true); });
      widget.bind(window.SC.Widget.Events.PAUSE, () => { if (activeState.scWidget === widget) setPlaying(false); });
      widget.bind(window.SC.Widget.Events.FINISH, () => { if (activeState.scWidget === widget) setPlaying(false); });
    }
  } else {
    ui.soundcloud.hidden = true; ui.soundcloud.classList.remove('visible'); ui.soundcloudCredit.classList.add('hidden');
    ui.play.classList.remove('hidden'); ui.waveform.classList.remove('hidden');
    ui.audio.src = activeState.current.audio; ui.audio.load(); autoplayTrack(activeState.current);
  }
}
function startTimer() {
  clearInterval(activeState.timerId);
  activeState.scoreBudgetSeconds = ROUND_SECONDS;
  activeState.startedAt = performance.now();
  activeState.timerId = setInterval(updateTimer, 50); updateTimer();
}
function updateTimer() {
  const now = performance.now();
  if (activeState.mode === 'challenge') {
    const max = CHALLENGE_SECONDS * 1000;
    const left = Math.max(0, activeState.challengeRemainingMs - (now - activeState.startedAt));
    ui.timer.style.transform = `scaleX(${left / max})`; ui.timerText.textContent = `${(left / 1000).toFixed(1)} S`;
    if (left <= 0) {
      clearInterval(activeState.timerId); activeState.challengeRemainingMs = 0;
      if (activeState.current && !activeState.roundResolved) {
        activeState.roundResolved = true;
        activeState.played.push({ ...activeState.current, correct: false, seconds: (now - activeState.startedAt) / 1000, points: 0 });
      }
      endGame();
    }
    return;
  }
  const max = ROUND_SECONDS * 1000;
  const left = Math.max(0, max - (now - activeState.startedAt));
  ui.timer.style.transform = `scaleX(${left / max})`; ui.timerText.textContent = `${(left / 1000).toFixed(1)} S`;
  if (left <= 0) { clearInterval(activeState.timerId); activeState.onAnswerTimeout(); }
}
function freestylePrefixEnd(titleRaw) {
  if (!/freestyle/i.test(titleRaw)) return null;
  const match = titleRaw.match(/(\d+)\s*$/);
  return match ? match.index : null;
}
function roundTargetText() {
  if (activeState.roundType === 'artist') return activeState.current.artist || activeState.artist?.name || '';
  return activeState.current.title;
}
function buildQcmOptions(song, catalog) {
  const usedKeys = new Set([normalise(song.title)]);
  const distractors = [];
  const collect = (pool) => {
    for (const candidate of pool) {
      const key = normalise(candidate.title);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key); distractors.push({ title: candidate.title, deezerTrackId: candidate.deezerTrackId || null });
      if (distractors.length === 3) break;
    }
  };
  collect(shuffled(catalog.filter(item => item !== song && item.title !== song.title && (!item.artist || !song.artist || item.artist === song.artist))));
  if (distractors.length < 3) collect(shuffled(catalog.filter(item => item !== song && item.title !== song.title)));
  return shuffled([{ title: song.title, deezerTrackId: song.deezerTrackId || null }, ...distractors]);
}
function qcmCoverUrl(option) { return option.deezerTrackId ? `/api/deezer-cover?id=${encodeURIComponent(option.deezerTrackId)}` : ''; }
function renderQcmChoices() {
  const options = activeState.qcmOptions || [];
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
  if (!button || activeState.roundResolved) return;
  const correct = normalise(button.dataset.title) === normalise(activeState.current.title);
  if (correct) activeState.onCorrectGuess({});
  else activeState.onWrongGuess(button);
}
function renderHint() {
  if (activeState.roundType === 'qcm') { ui.hintText.hidden = true; ui.hintText.textContent = ''; return; }
  const title = roundTargetText();
  if (activeState.roundType !== 'artist' && freestylePrefixEnd(title) !== null && activeState.hints < 3) { ui.hintText.hidden = true; ui.hintText.textContent = ''; return; }
  ui.hintText.hidden = false;
  const display = [...title].map((char, index) => {
    if (char === ' ') return ' / ';
    return activeState.revealed.has(index) ? char.toUpperCase() : '_';
  }).join(' ');
  ui.hintText.textContent = activeState.hints === 3 ? `ANNÉE : ${activeState.current.year}` : display;
}
function useHint() {
  if (activeState.hints >= HINTS_PER_ROUND || activeState.roundResolved || activeState.roundType === 'qcm') return;
  activeState.hints++;
  if (activeState.hints < 3) {
    const target = roundTargetText();
    const candidates = [...target].map((char, index) => ({ char, index })).filter(({ char, index }) => char !== ' ' && !activeState.revealed.has(index));
    if (candidates.length) activeState.revealed.add(candidates[Math.floor(Math.random() * candidates.length)].index);
  }
  ui.hintCount.textContent = `×${HINTS_PER_ROUND - activeState.hints}`; ui.hint.disabled = activeState.hints >= HINTS_PER_ROUND; renderHint();
}
function toggleAudio() {
  if (!activeState.current || activeState.roundResolved) return;
  if (activeState.current.deezerTrackId) {
    if (!activeState.deezerPreviewUrl) { ui.playerState.textContent = 'EXTRAIT EN CHARGEMENT'; return; }
    if (ui.audio.paused) {
      ui.audio.currentTime = 0;
      ui.audio.play().catch(() => { ui.playerState.textContent = 'LECTURE BLOQUÉE'; });
      clearClipTimer(); activeState.clipTimer = setTimeout(stopPlayback, (activeState.speed?.allowReplay ? activeState.speed.listen * 1000 : 20000));
    } else stopPlayback();
    return;
  }
  if (activeState.current.soundcloudUrl) {
    if (!activeState.scReady) { ui.playerState.textContent = 'CHARGEMENT SOUNDCLOUD…'; return; }
    if (activeState.isPlaying) { stopPlayback(); return; }
    if (activeState.scWidget) {
      activeState.scWidget.seekTo(Number(activeState.current.clipStart || 0) * 1000); activeState.scWidget.play();
    } else {
      sendSoundcloud('seekTo', Number(activeState.current.clipStart || 0) * 1000); sendSoundcloud('play');
    }
    clearClipTimer(); activeState.clipTimer = setTimeout(stopPlayback, Number(activeState.current.clipDuration || 20) * 1000);
  } else if (ui.audio.paused) { ui.audio.currentTime = 0; ui.audio.play().catch(() => { ui.playerState.textContent = 'EXTRAIT INTROUVABLE'; }); } else ui.audio.pause();
}
function checkGuess() {
  if (activeState.roundResolved || activeState.roundType === 'qcm') return false;
  const rawGuess = ui.input.value;
  const guess = normalise(rawGuess);
  if (!guess) return false;
  const title = roundTargetText();
  if (guess === normalise(title)) { activeState.onCorrectGuess({}); return true; }
  if (activeState.roundType === 'title' && freestyleNumberMatch(rawGuess, title)) { activeState.onCorrectGuess({}); return true; }
  if (sameWordsAnyOrder(rawGuess, title)) { activeState.onCorrectGuess({ outOfOrder: true }); return true; }
  ui.feedback.textContent = 'Pas encore. Essaie à nouveau.'; ui.feedback.className = 'feedback wrong'; ui.input.select();
  return false;
}
function handleGuessInput() {
  if (activeState.roundResolved || !activeState.current || activeState.roundType === 'qcm') return;
  const rawGuess = ui.input.value;
  const guess = normalise(rawGuess);
  if (!guess) { ui.feedback.textContent = ''; ui.feedback.className = 'feedback'; return; }
  const title = roundTargetText();
  const normalisedTitle = normalise(title);
  if (guess === normalisedTitle) { activeState.onCorrectGuess({}); return; }
  if (activeState.roundType === 'title' && freestyleNumberMatch(rawGuess, title)) { activeState.onCorrectGuess({}); return; }
  if (sameWordsAnyOrder(rawGuess, title)) { activeState.onCorrectGuess({ outOfOrder: true }); return; }
  if (guess.length >= normalisedTitle.length) {
    ui.feedback.textContent = 'Pas encore. Essaie à nouveau.'; ui.feedback.className = 'feedback wrong';
    const prefixEnd = activeState.roundType === 'title' ? freestylePrefixEnd(title) : null;
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
      if (user) {
        profileName.textContent = user.displayName || user.email || 'Compte Google'; profilePhoto.src = user.photoURL || ''; accountBestReady = loadAccountBest(user).then(() => migrateGuestBest(user)); if (!ui.leaderboardPanel.hidden) loadLeaderboard(currentLeaderboardField()); setMessage('');
        if (pendingVersusAction) { const action = pendingVersusAction; pendingVersusAction = null; action(); }
      }
      else { accountBestReady = Promise.resolve(); localStorage.removeItem('ziak-blindtest-last-uid'); accountBest = { solo: {}, challenge: {} }; profilePhoto.removeAttribute('src'); refreshBest(); }
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

/* ===================== VERSUS 1V1 =====================
   Salons multijoueurs synchronisés via Firestore (onSnapshot + transactions,
   pas de backend dédié). Réutilise le moteur de lecture/minuteur partagé
   (activeState) : versusStartRound joue le rôle de nextRound(), et
   vState.onCorrectGuess/onWrongGuess/onAnswerTimeout branchent la fin de
   manche sur des transactions Firestore au lieu du score local solo.
   L'hôte du salon est la seule source d'autorité pour faire avancer les
   manches (évite toute double-avance) ; n'importe quel joueur peut gagner
   une manche via une transaction Firestore (le premier à committer gagne).
*/
const VERSUS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I/L, ambigus
Object.assign(ui, {
  versusButton: $('#versusButton'), versusPanel: $('#versusPanel'), versusPanelClose: $('#versusPanelClose'),
  versusTabs: document.querySelectorAll('#versusTabs .leaderboard-tab'),
  versusCreateTab: $('#versusCreateTab'), versusJoinTab: $('#versusJoinTab'), versusBrowseTab: $('#versusBrowseTab'),
  versusVisibilityOptions: document.querySelectorAll('.versus-visibility .round-option'),
  versusCreateButton: $('#versusCreateButton'), versusCreateStatus: $('#versusCreateStatus'),
  versusCodeInput: $('#versusCodeInput'), versusJoinButton: $('#versusJoinButton'), versusJoinStatus: $('#versusJoinStatus'),
  versusBrowseStatus: $('#versusBrowseStatus'), versusRoomList: $('#versusRoomList'),
  versusRoomOverlay: $('#versusRoomOverlay'), versusRoomClose: $('#versusRoomClose'), versusRoomHeading: $('#versusRoomHeading'),
  versusRoomCode: $('#versusRoomCode'), versusRoomVisibility: $('#versusRoomVisibility'),
  versusRoomHostPhoto: $('#versusRoomHostPhoto'), versusRoomHostName: $('#versusRoomHostName'),
  versusRoomGuestPhoto: $('#versusRoomGuestPhoto'), versusRoomGuestName: $('#versusRoomGuestName'),
  versusRoomSettings: $('#versusRoomSettings'), versusStartButton: $('#versusStartButton'), versusAbandonButton: $('#versusAbandonButton'),
  versusRoomStatus: $('#versusRoomStatus'),
  versusResultOverlay: $('#versusResultOverlay'), versusResultClose: $('#versusResultClose'), versusResultBanner: $('#versusResultBanner'),
  versusResultMePhoto: $('#versusResultMePhoto'), versusResultMeName: $('#versusResultMeName'), versusResultMeScore: $('#versusResultMeScore'),
  versusResultOpponentPhoto: $('#versusResultOpponentPhoto'), versusResultOpponentName: $('#versusResultOpponentName'), versusResultOpponentScore: $('#versusResultOpponentScore'),
  versusHeader: $('#versusHeader'), versusInGameAbandon: $('#versusInGameAbandon'),
  versusMePhoto: $('#versusMePhoto'), versusMeName: $('#versusMeName'), versusMeScoreLive: $('#versusMeScoreLive'),
  versusOpponentPhoto: $('#versusOpponentPhoto'), versusOpponentName: $('#versusOpponentName'), versusOpponentScoreLive: $('#versusOpponentScoreLive')
});

let pendingVersusAction = null;
let vState = null;
let versusActive = false;
let versusRoomUnsub = null;
let versusListUnsub = null;
let versusRoomDoc = null;
let versusMyRole = null;
let activeVersusCatalog = null;
let activeVersusCatalogRoomCode = null;

function versusRoomRef(code) { return firestoreDb.collection('versusRooms').doc(code); }
function randomRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += VERSUS_CODE_ALPHABET[Math.floor(Math.random() * VERSUS_CODE_ALPHABET.length)];
  return code;
}
async function generateUniqueRoomCode() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomRoomCode();
    const snap = await versusRoomRef(code).get();
    if (!snap.exists) return code;
  }
  throw new Error('Impossible de générer un code de salon unique');
}
async function getVersusCatalog(roomDoc) {
  if (activeVersusCatalog && activeVersusCatalogRoomCode === roomDoc.code) return activeVersusCatalog;
  const artistMeta = artists.find(item => item.id === roomDoc.artistId);
  const response = await fetch(artistMeta?.catalog || 'songs.json', { cache: 'no-store' });
  const data = await response.json();
  activeVersusCatalog = Array.isArray(data) ? data : [];
  activeVersusCatalogRoomCode = roomDoc.code;
  return activeVersusCatalog;
}
async function buildVersusRoundQcmOptions(roomDoc, roundIndex) {
  if (roomDoc.roundType !== 'qcm') return null;
  const song = roomDoc.deck[roundIndex];
  const catalog = await getVersusCatalog(roomDoc);
  return buildQcmOptions(song, catalog);
}
function showVersusLoginPrompt() {
  ui.loginPromptGuest.hidden = true;
  ui.loginPromptText.textContent = "Le mode VERSUS 1V1 nécessite une connexion Google : c'est ce qui identifie chaque joueur dans le salon et permet de synchroniser le match.";
  ui.loginPromptOverlay.hidden = false;
}

/* ---- Panneau CRÉER / REJOINDRE / SALONS PUBLICS ---- */
function openVersusPanel() {
  ui.versusPanel.hidden = false;
  if (document.querySelector('#versusTabs .leaderboard-tab.selected')?.dataset.versusTab === 'browse') startVersusBrowseList();
}
function closeVersusPanel() { ui.versusPanel.hidden = true; stopVersusBrowseList(); }
function switchVersusTab(tab) {
  ui.versusTabs.forEach(button => button.classList.toggle('selected', button.dataset.versusTab === tab));
  ui.versusCreateTab.hidden = tab !== 'create';
  ui.versusJoinTab.hidden = tab !== 'join';
  ui.versusBrowseTab.hidden = tab !== 'browse';
  if (tab === 'browse') startVersusBrowseList(); else stopVersusBrowseList();
}
function stopVersusBrowseList() { if (versusListUnsub) { versusListUnsub(); versusListUnsub = null; } }
function startVersusBrowseList() {
  stopVersusBrowseList();
  if (!currentUser || !firestoreDb) { ui.versusBrowseStatus.textContent = 'Connecte-toi avec Google pour voir les salons.'; ui.versusRoomList.innerHTML = ''; return; }
  ui.versusBrowseStatus.textContent = 'Chargement…';
  versusListUnsub = firestoreDb.collection('versusRooms')
    .where('visibility', '==', 'public').where('status', '==', 'lobby').limit(20)
    .onSnapshot(snapshot => {
      const rooms = snapshot.docs.map(doc => doc.data()).filter(room => room.hostUid !== currentUser?.uid);
      rooms.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      renderVersusRoomList(rooms);
    }, error => { console.error('Versus room list error', error); ui.versusBrowseStatus.textContent = 'Impossible de charger les salons publics.'; });
}
function renderVersusRoomList(rooms) {
  if (!rooms.length) { ui.versusBrowseStatus.textContent = 'Aucun salon public ouvert pour le moment.'; ui.versusRoomList.innerHTML = ''; return; }
  ui.versusBrowseStatus.textContent = `${rooms.length} salon${rooms.length > 1 ? 's' : ''} ouvert${rooms.length > 1 ? 's' : ''}`;
  ui.versusRoomList.innerHTML = rooms.map(room => {
    const roundTypeLabel = ROUND_TYPES[room.roundType]?.label || room.roundType;
    const speedLabel = SPEED_PRESETS[room.speedKey]?.label || room.speedKey;
    return `<li>
      <span class="versus-room-list-info">
        <img src="${escapeHtml(room.hostPhoto || '')}" alt="" />
        <span class="versus-room-list-copy"><strong>${escapeHtml(room.hostName || 'Hôte')}</strong><small>${escapeHtml((room.artistName || '').toUpperCase())} · ${escapeHtml(roundTypeLabel)} · ${escapeHtml(speedLabel)} · ${room.rounds} MANCHES</small></span>
      </span>
      <button class="versus-room-join" type="button" data-code="${escapeHtml(room.code)}">REJOINDRE</button>
    </li>`;
  }).join('');
  ui.versusRoomList.querySelectorAll('.versus-room-join').forEach(button => button.addEventListener('click', () => joinVersusRoom(button.dataset.code)));
}

/* ---- Créer / rejoindre un salon ---- */
async function createVersusRoom() {
  if (!currentUser) { pendingVersusAction = createVersusRoom; showVersusLoginPrompt(); return; }
  if (!songs.length) { ui.versusCreateStatus.textContent = 'Choisis un artiste avec au moins un morceau.'; return; }
  ui.versusCreateButton.disabled = true; ui.versusCreateStatus.textContent = 'Création du salon…';
  try {
    let roundType = document.querySelector('.round-type-option.selected')?.dataset.roundType || 'title';
    if (roundType === 'artist' && !selectedArtist?.category) {
      const fallback = artists.find(item => item.id === ARTIST_ROUND_FALLBACK_ID) || artists.find(item => item.category);
      if (fallback) await selectArtist(fallback.id);
    }
    if (!songs.length) { ui.versusCreateStatus.textContent = 'Catalogue indisponible.'; return; }
    const speedKey = document.querySelector('#speedPicker .round-option.selected')?.dataset.speed || 'classic';
    const roundsWanted = Number(document.querySelector('#roundPicker .round-option.selected')?.dataset.rounds) || 10;
    const visibility = document.querySelector('.versus-visibility .round-option.selected')?.dataset.visibility || 'public';
    const catalog = songs.slice();
    const rounds = Math.max(1, Math.min(roundsWanted, catalog.length));
    const deck = shuffled(catalog).slice(0, rounds).map(song => ({
      title: song.title, artist: song.artist || selectedArtist?.name || '', project: song.project || '', year: song.year || null,
      releaseDate: song.releaseDate || '', deezerTrackId: song.deezerTrackId || null, audio: song.audio || null,
      soundcloudUrl: song.soundcloudUrl || null, clipStart: song.clipStart || null, clipDuration: song.clipDuration || null
    }));
    const code = await generateUniqueRoomCode();
    const roomData = {
      code, visibility, status: 'lobby',
      hostUid: currentUser.uid, hostName: currentUser.displayName || currentUser.email || 'Hôte', hostPhoto: currentUser.photoURL || '',
      guestUid: null, guestName: null, guestPhoto: null,
      artistId: selectedArtist?.id || 'ziak', artistName: selectedArtist?.name || 'Ziak',
      roundType, speedKey, rounds, deck,
      roundIndex: 0, roundStartedAt: null, roundResolved: false, roundWinnerUid: null, roundQcmOptions: null,
      scores: { [currentUser.uid]: 0 },
      createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await versusRoomRef(code).set(roomData);
    activeVersusCatalog = catalog; activeVersusCatalogRoomCode = code;
    subscribeVersusRoom(code);
    ui.versusCreateStatus.textContent = '';
    closeVersusPanel();
  } catch (error) {
    console.error(error);
    ui.versusCreateStatus.textContent = 'Impossible de créer le salon.';
  } finally {
    ui.versusCreateButton.disabled = false;
  }
}
async function joinVersusRoom(codeRaw) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!currentUser) { pendingVersusAction = () => joinVersusRoom(code); showVersusLoginPrompt(); return; }
  if (!code) { ui.versusJoinStatus.textContent = 'Entre un code de salon.'; return; }
  ui.versusJoinButton.disabled = true; ui.versusJoinStatus.textContent = 'Connexion au salon…';
  const ref = versusRoomRef(code);
  try {
    await firestoreDb.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error('not-found');
      const data = snap.data();
      if (data.status !== 'lobby') throw new Error('not-joinable');
      if (data.hostUid === currentUser.uid) throw new Error('own-room');
      if (data.guestUid && data.guestUid !== currentUser.uid) throw new Error('full');
      transaction.update(ref, {
        guestUid: currentUser.uid, guestName: currentUser.displayName || currentUser.email || 'Joueur', guestPhoto: currentUser.photoURL || '',
        [`scores.${currentUser.uid}`]: data.scores?.[currentUser.uid] ?? 0,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    subscribeVersusRoom(code);
    ui.versusJoinStatus.textContent = ''; ui.versusCodeInput.value = '';
    closeVersusPanel();
  } catch (error) {
    const messages = { 'not-found': 'Salon introuvable.', 'not-joinable': 'Ce salon n’est plus disponible.', 'own-room': 'C’est ton propre salon — attends un adversaire.', full: 'Ce salon est déjà complet.' };
    ui.versusJoinStatus.textContent = messages[error.message] || 'Impossible de rejoindre ce salon.';
  } finally {
    ui.versusJoinButton.disabled = false;
  }
}

/* ---- Abonnement temps réel + réacteur central ---- */
function subscribeVersusRoom(code) {
  unsubscribeVersusRoom();
  localStorage.setItem('blindtest-versus-room', code);
  versusRoomUnsub = versusRoomRef(code).onSnapshot(snap => {
    if (!snap.exists) { handleVersusRoomTerminated('Ce salon n’existe plus.'); return; }
    handleVersusRoomUpdate({ code, ...snap.data() });
  }, error => console.error('Versus room listener error', error));
}
function unsubscribeVersusRoom() { if (versusRoomUnsub) { versusRoomUnsub(); versusRoomUnsub = null; } }
function handleVersusRoomUpdate(roomDoc) {
  versusRoomDoc = roomDoc;
  versusMyRole = currentUser && roomDoc.hostUid === currentUser.uid ? 'host' : (currentUser && roomDoc.guestUid === currentUser.uid ? 'guest' : null);
  if (!versusMyRole) return;
  if (roomDoc.status === 'cancelled') { handleVersusRoomTerminated('Le salon a été annulé.'); return; }
  if (roomDoc.status === 'lobby') { ui.versusRoomOverlay.hidden = false; renderVersusRoomOverlay(roomDoc); return; }
  if (roomDoc.status === 'playing') {
    ui.versusRoomOverlay.hidden = true;
    if (!versusActive) enterVersusMatch(roomDoc);
    updateVersusMatchFromSnapshot(roomDoc);
    return;
  }
  if (roomDoc.status === 'finished') {
    versusActive = false;
    showVersusResult(roomDoc);
    unsubscribeVersusRoom();
    localStorage.removeItem('blindtest-versus-room');
  }
}
function handleVersusRoomTerminated(message) {
  ui.versusRoomStatus.textContent = message;
  ui.versusStartButton.hidden = true; ui.versusAbandonButton.hidden = true;
  unsubscribeVersusRoom();
  localStorage.removeItem('blindtest-versus-room');
  setTimeout(() => {
    ui.versusRoomOverlay.hidden = true; ui.versusHeader.hidden = true; ui.versusInGameAbandon.hidden = true;
    versusRoomDoc = null; versusMyRole = null; vState = null; versusActive = false;
    if (ui.game.classList.contains('hidden') === false) show(ui.setup);
  }, 2000);
}

/* ---- Salle d'attente ---- */
function renderVersusRoomOverlay(roomDoc) {
  ui.versusRoomCode.textContent = roomDoc.code;
  ui.versusRoomVisibility.textContent = roomDoc.visibility === 'public' ? 'SALON PUBLIC' : 'SALON PRIVÉ';
  ui.versusRoomHostPhoto.src = roomDoc.hostPhoto || ''; ui.versusRoomHostName.textContent = roomDoc.hostName || 'Hôte';
  if (roomDoc.guestUid) {
    ui.versusRoomGuestPhoto.hidden = false; ui.versusRoomGuestPhoto.src = roomDoc.guestPhoto || '';
    ui.versusRoomGuestName.textContent = roomDoc.guestName || 'Joueur';
  } else {
    ui.versusRoomGuestPhoto.hidden = true; ui.versusRoomGuestPhoto.removeAttribute('src');
    ui.versusRoomGuestName.textContent = 'EN ATTENTE…';
  }
  const roundTypeLabel = ROUND_TYPES[roomDoc.roundType]?.label || roomDoc.roundType;
  const speedLabel = SPEED_PRESETS[roomDoc.speedKey]?.label || roomDoc.speedKey;
  ui.versusRoomSettings.textContent = `${(roomDoc.artistName || '').toUpperCase()} · ${roundTypeLabel} · ${speedLabel} · ${roomDoc.rounds} MANCHES`;
  const isHost = versusMyRole === 'host';
  ui.versusStartButton.hidden = !isHost;
  ui.versusStartButton.disabled = !roomDoc.guestUid;
  ui.versusAbandonButton.hidden = false;
  ui.versusRoomStatus.textContent = isHost ? (roomDoc.guestUid ? '' : 'Partage le code, ou attends un joueur depuis les salons publics.') : 'En attente que l’hôte lance la partie…';
}
async function startVersusMatch() {
  if (!versusRoomDoc || versusMyRole !== 'host' || !versusRoomDoc.guestUid) return;
  ui.versusStartButton.disabled = true;
  try {
    const qcmOptions = await buildVersusRoundQcmOptions(versusRoomDoc, 0);
    await versusRoomRef(versusRoomDoc.code).update({
      status: 'playing', roundIndex: 0, roundStartedAt: Date.now(), roundResolved: false, roundWinnerUid: null,
      roundQcmOptions: qcmOptions, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error(error);
    ui.versusRoomStatus.textContent = 'Impossible de lancer la partie.';
    ui.versusStartButton.disabled = false;
  }
}

/* ---- Match en cours (réutilise le moteur de lecture partagé) ---- */
function enterVersusMatch(roomDoc) {
  versusActive = true;
  const opponentUid = versusMyRole === 'host' ? roomDoc.guestUid : roomDoc.hostUid;
  const rawSpeed = SPEED_PRESETS[roomDoc.speedKey] || SPEED_PRESETS.classic;
  // En versus, pas de bouton « passer » : une vitesse « illimitée » (Expert) est
  // plafonnée pour garantir qu'une manche se termine toujours.
  const adaptedSpeed = rawSpeed.answer == null ? { ...rawSpeed, answer: rawSpeed.scoreBudget || ROUND_SECONDS } : rawSpeed;
  vState = {
    code: roomDoc.code, myUid: currentUser.uid, opponentUid,
    roundType: roomDoc.roundType, speed: adaptedSpeed, artist: { name: roomDoc.artistName },
    lastRenderedRoundIndex: -1, lastRenderedRoundStartedAt: null,
    roundResolved: false, timerId: null, phase: null, current: null, hints: 0, revealed: new Set(),
    startedAt: 0, scoreBudgetSeconds: 0, autoplayAttempted: false, clipTimer: null, onTrackReady
  };
  vState.onAnswerTimeout = () => versusHandleTimeout();
  vState.onCorrectGuess = (options) => versusSubmitAnswer(options);
  vState.onWrongGuess = (button) => { if (vState.roundType === 'qcm') disableQcmChoices(vState.current.title, button); };
  ui.versusHeader.hidden = false; ui.versusInGameAbandon.hidden = false;
  ui.versusMePhoto.src = currentUser.photoURL || ''; ui.versusMeName.textContent = currentUser.displayName || currentUser.email || 'Toi';
  const opponentName = versusMyRole === 'host' ? roomDoc.guestName : roomDoc.hostName;
  const opponentPhoto = versusMyRole === 'host' ? roomDoc.guestPhoto : roomDoc.hostPhoto;
  ui.versusOpponentName.textContent = opponentName || 'Adversaire'; ui.versusOpponentPhoto.src = opponentPhoto || '';
  show(ui.game);
}
function updateVersusMatchFromSnapshot(roomDoc) {
  ui.versusMeScoreLive.textContent = roomDoc.scores?.[vState.myUid] || 0;
  ui.versusOpponentScoreLive.textContent = roomDoc.scores?.[vState.opponentUid] || 0;
  if (roomDoc.roundIndex !== vState.lastRenderedRoundIndex || roomDoc.roundStartedAt !== vState.lastRenderedRoundStartedAt) versusStartRound(roomDoc);
  else if (roomDoc.roundResolved && !vState.roundResolved) versusHandleRoundResolved(roomDoc);
}
function versusStartRound(roomDoc) {
  clearInterval(vState.timerId);
  vState.lastRenderedRoundIndex = roomDoc.roundIndex; vState.lastRenderedRoundStartedAt = roomDoc.roundStartedAt;
  vState.roundResolved = false; vState.submitting = false; vState.current = roomDoc.deck[roomDoc.roundIndex]; vState.qcmOptions = roomDoc.roundQcmOptions || null;
  vState.hints = 0; vState.revealed = new Set();
  vState.timerStarted = false; vState.trackReady = false; vState.phase = 'listen'; vState.scoreBudgetSeconds = 0; vState.autoplayAttempted = false;
  const isQcm = vState.roundType === 'qcm';
  const freestylePrefix = vState.roundType === 'title' ? freestylePrefixEnd(vState.current.title) : null;
  ui.input.value = freestylePrefix !== null ? vState.current.title.slice(0, freestylePrefix) : '';
  ui.input.placeholder = vState.roundType === 'artist' ? "NOM DE L'ARTISTE" : 'NOM DU MORCEAU';
  ui.input.disabled = isQcm; ui.validate.disabled = isQcm; ui.hint.disabled = isQcm;
  ui.input.hidden = isQcm; ui.validate.hidden = isQcm; ui.hint.hidden = isQcm;
  ui.skip.hidden = true; ui.skip.disabled = true;
  ui.qcmChoices.hidden = !isQcm;
  if (isQcm) renderQcmChoices();
  ui.play.disabled = Boolean(vState.speed?.listen) && !vState.speed?.allowReplay;
  ui.answerCountdown.hidden = true; ui.waveform.classList.remove('hidden'); ui.playerControls.classList.remove('hidden');
  ui.feedback.textContent = ''; ui.feedback.className = 'feedback'; ui.hintCount.textContent = `×${HINTS_PER_ROUND}`;
  ui.roundLabel.textContent = `VERSUS · MANCHE ${roomDoc.roundIndex + 1} / ${roomDoc.rounds}`;
  ui.score.textContent = roomDoc.scores?.[vState.myUid] || 0;
  if (ui.rankLabel) ui.rankLabel.hidden = true;
  ui.timer.style.transform = 'scaleX(1)'; ui.timerText.textContent = 'CHARGEMENT…';
  activeState = vState;
  loadTrack();
  renderHint();
  if (!isQcm) ui.input.focus();
}
async function versusSubmitAnswer(options = {}) {
  // Ne verrouille PAS vState.roundResolved ici : seule la snapshot Firestore
  // (via versusHandleRoundResolved) doit déclencher l'affichage du résultat,
  // sinon le joueur qui vient de gagner ne verrait jamais sa propre réponse
  // révélée (le guard `!vState.roundResolved` bloquerait son propre passage
  // dans versusHandleRoundResolved). `submitting` empêche juste un double-envoi.
  if (!versusActive || vState.roundResolved || vState.submitting) return;
  vState.submitting = true; clearInterval(vState.timerId);
  const elapsedSeconds = (performance.now() - vState.startedAt) / 1000;
  const budget = vState.scoreBudgetSeconds || ROUND_SECONDS;
  let points = Math.max(100, Math.round((budget - Math.min(elapsedSeconds, budget)) * 20) - vState.hints * 35);
  if (options.outOfOrder) points = Math.round(points * OUT_OF_ORDER_PENALTY_RATIO);
  const ref = versusRoomRef(vState.code);
  const roundIndexAtSubmit = vState.lastRenderedRoundIndex;
  try {
    await firestoreDb.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      const data = snap.data();
      if (!data || data.roundIndex !== roundIndexAtSubmit || data.roundResolved) return;
      transaction.update(ref, {
        roundResolved: true, roundWinnerUid: vState.myUid,
        [`scores.${vState.myUid}`]: (data.scores?.[vState.myUid] || 0) + points,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  } catch (error) {
    console.error('Versus answer transaction failed', error);
  } finally {
    vState.submitting = false;
  }
}
async function versusHandleTimeout() {
  if (!versusActive || vState.roundResolved || versusMyRole !== 'host') return;
  const ref = versusRoomRef(vState.code);
  const roundIndexAtTimeout = vState.lastRenderedRoundIndex;
  try {
    await firestoreDb.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      const data = snap.data();
      if (!data || data.roundIndex !== roundIndexAtTimeout || data.roundResolved) return;
      transaction.update(ref, { roundResolved: true, roundWinnerUid: null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
  } catch (error) { console.error('Versus timeout transaction failed', error); }
}
function versusHandleRoundResolved(roomDoc) {
  if (vState.roundResolved) return;
  vState.roundResolved = true; clearInterval(vState.timerId); stopPlayback();
  const winnerUid = roomDoc.roundWinnerUid; const iWon = winnerUid === vState.myUid; const nobodyWon = !winnerUid;
  ui.input.disabled = true; ui.validate.disabled = true; ui.hint.disabled = true; ui.play.disabled = true;
  if (vState.roundType === 'qcm') disableQcmChoices(vState.current.title);
  const target = roundTargetText();
  ui.feedback.textContent = nobodyWon ? `Temps écoulé : ${target}` : (iWon ? 'BIEN JOUÉ ! POINT MARQUÉ' : `${versusMyRole === 'host' ? roomDoc.guestName : roomDoc.hostName} a trouvé en premier : ${target}`);
  ui.feedback.className = `feedback ${iWon ? 'correct' : 'wrong'}`;
  if (vState.roundType !== 'qcm') ui.hintText.textContent = `${iWon ? '✓' : nobodyWon ? '…' : '✕'} ${target.toUpperCase()}`;
  vState.revealVisible = true; showTrackReveal();
  if (versusMyRole === 'host') setTimeout(() => versusAdvanceRound(roomDoc), 1700);
}
async function versusAdvanceRound(roomDoc) {
  if (versusMyRole !== 'host' || !versusActive) return;
  const ref = versusRoomRef(roomDoc.code);
  const nextIndex = roomDoc.roundIndex + 1;
  try {
    if (nextIndex >= roomDoc.rounds) { await ref.update({ status: 'finished', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); return; }
    const qcmOptions = await buildVersusRoundQcmOptions(roomDoc, nextIndex);
    await ref.update({
      roundIndex: nextIndex, roundStartedAt: Date.now(), roundResolved: false, roundWinnerUid: null, roundQcmOptions: qcmOptions,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) { console.error('Impossible d’avancer la manche versus', error); }
}

/* ---- Fin de match / abandon / sortie ---- */
function showVersusResult(roomDoc) {
  const myUid = currentUser.uid;
  const isHostMe = roomDoc.hostUid === myUid;
  const opponentUid = isHostMe ? roomDoc.guestUid : roomDoc.hostUid;
  const myScore = roomDoc.scores?.[myUid] || 0;
  const opponentScore = roomDoc.scores?.[opponentUid] || 0;
  ui.versusHeader.hidden = true; ui.versusInGameAbandon.hidden = true;
  show(ui.setup);
  ui.versusResultMePhoto.src = currentUser.photoURL || ''; ui.versusResultMeName.textContent = currentUser.displayName || currentUser.email || 'Toi';
  ui.versusResultMeScore.textContent = myScore;
  ui.versusResultOpponentPhoto.src = (isHostMe ? roomDoc.guestPhoto : roomDoc.hostPhoto) || '';
  ui.versusResultOpponentName.textContent = (isHostMe ? roomDoc.guestName : roomDoc.hostName) || 'Adversaire';
  ui.versusResultOpponentScore.textContent = opponentScore;
  let banner = 'ÉGALITÉ'; let cls = 'draw';
  if (roomDoc.abandonedBy && roomDoc.abandonedBy !== myUid) { banner = 'VICTOIRE PAR ABANDON'; cls = ''; }
  else if (roomDoc.abandonedBy && roomDoc.abandonedBy === myUid) { banner = 'ABANDON'; cls = 'lose'; }
  else if (myScore > opponentScore) { banner = 'VICTOIRE'; cls = ''; }
  else if (myScore < opponentScore) { banner = 'DÉFAITE'; cls = 'lose'; }
  ui.versusResultBanner.textContent = banner; ui.versusResultBanner.className = `versus-result-banner ${cls}`;
  ui.versusResultOverlay.hidden = false;
}
async function leaveVersusRoom() {
  if (!versusRoomDoc) { ui.versusRoomOverlay.hidden = true; return; }
  const code = versusRoomDoc.code; const role = versusMyRole; const status = versusRoomDoc.status;
  unsubscribeVersusRoom();
  ui.versusRoomOverlay.hidden = true; ui.versusHeader.hidden = true; ui.versusInGameAbandon.hidden = true;
  localStorage.removeItem('blindtest-versus-room');
  versusActive = false; versusRoomDoc = null; versusMyRole = null; vState = null;
  if (status === 'lobby') {
    try {
      if (role === 'host') await versusRoomRef(code).update({ status: 'cancelled', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      else await versusRoomRef(code).update({ guestUid: null, guestName: null, guestPhoto: null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    } catch (error) { console.error('Impossible de nettoyer le salon', error); }
  }
  show(ui.setup);
}
async function abandonVersusMatch() {
  if (!versusRoomDoc) return;
  if (versusRoomDoc.status !== 'playing') { leaveVersusRoom(); return; }
  try {
    await versusRoomRef(versusRoomDoc.code).update({ status: 'finished', abandonedBy: currentUser.uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  } catch (error) { console.error(error); }
}

/* ---- Câblage des événements ---- */
if (ui.versusButton) ui.versusButton.addEventListener('click', () => {
  const wasHidden = ui.versusPanel.hidden;
  ui.versusPanel.hidden = !ui.versusPanel.hidden;
  if (wasHidden) openVersusPanel(); else closeVersusPanel();
});
if (ui.versusPanelClose) ui.versusPanelClose.addEventListener('click', closeVersusPanel);
ui.versusTabs.forEach(button => button.addEventListener('click', () => switchVersusTab(button.dataset.versusTab)));
ui.versusVisibilityOptions.forEach(button => button.addEventListener('click', () => {
  ui.versusVisibilityOptions.forEach(item => item.classList.toggle('selected', item === button));
}));
if (ui.versusCreateButton) ui.versusCreateButton.addEventListener('click', createVersusRoom);
if (ui.versusJoinButton) ui.versusJoinButton.addEventListener('click', () => joinVersusRoom(ui.versusCodeInput.value));
if (ui.versusCodeInput) ui.versusCodeInput.addEventListener('keydown', event => { if (event.key === 'Enter') joinVersusRoom(ui.versusCodeInput.value); });
if (ui.versusRoomClose) ui.versusRoomClose.addEventListener('click', leaveVersusRoom);
if (ui.versusStartButton) ui.versusStartButton.addEventListener('click', startVersusMatch);
if (ui.versusAbandonButton) ui.versusAbandonButton.addEventListener('click', leaveVersusRoom);
if (ui.versusInGameAbandon) ui.versusInGameAbandon.addEventListener('click', abandonVersusMatch);
if (ui.versusResultClose) ui.versusResultClose.addEventListener('click', () => {
  ui.versusResultOverlay.hidden = true; versusRoomDoc = null; versusMyRole = null; vState = null;
});
if (ui.loginPromptClose) ui.loginPromptClose.addEventListener('click', () => { pendingVersusAction = null; });
