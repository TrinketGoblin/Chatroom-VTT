const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
 
const app = express();
const server = http.createServer(app);
const io = new Server(server);
 
const PORT = process.env.PORT || 3000;
const CHAR_FILE = path.join(__dirname, 'characters.json');
const WORLD_FILE = path.join(__dirname, 'world.json');
const CALENDAR_FILE = path.join(__dirname, 'calendar.json');
const CAMPAIGN_FILE = path.join(__dirname, 'campaign.json');
const ASSETS_FILE = path.join(__dirname, 'assets.json');
const ARCHIVE_DIR = path.join(__dirname, 'archives');
const UPLOADS_DIR = path.join(__dirname, 'public/uploads');
 
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'node_modules/pdfjs-dist/build')));
app.use(express.json());
 
// ---------- JSON file helpers ----------
// Every persisted store (world, calendar, characters, session backups) uses the
// same read-with-fallback / pretty-write pattern, so it lives in one place.
 
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return typeof fallback === 'function' ? fallback(e) : fallback;
  }
}
 
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
 
function seedFileIfMissing(file, makeDefault) {
  if (!fs.existsSync(file)) writeJson(file, makeDefault());
}
 
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
 
// Keep the original file extension so express.static serves the right
// content-type (e.g. application/pdf, image/png) and pdf.js can read it.
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    cb(null, `${file.fieldname}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB — rulebook PDFs and big maps
});
 
// ---------- Logging: one growing master log + 3 rotating session backups ----------
// Master log: appended forever, never deleted. Full history across every run.
// Session backups: 3 files that take turns being overwritten with the full
// current-session transcript, so if the server dies mid-write, the other two
// backup files are still intact and readable.
 
const LOG_DIR = path.join(__dirname, 'logs');
const MASTER_LOG_FILE = path.join(LOG_DIR, 'master-log.txt');
const BACKUP_FILES = [1, 2, 3].map((n) => path.join(LOG_DIR, `session-backup-${n}.json`));
 
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);
if (!fs.existsSync(MASTER_LOG_FILE)) fs.writeFileSync(MASTER_LOG_FILE, '', 'utf8');
 
let sessionTranscript = [];
let backupIndex = 0;
 
function appendMaster(line) {
  fs.appendFileSync(MASTER_LOG_FILE, line + '\n', 'utf8');
}
 
function saveSessionBackup() {
  const file = BACKUP_FILES[backupIndex % BACKUP_FILES.length];
  writeJson(file, sessionTranscript);
  backupIndex++;
}
 
// Write every backup slot at once (startup + New Game) so all files begin from
// a consistent, complete snapshot.
function saveAllSessionBackups() {
  for (let i = 0; i < BACKUP_FILES.length; i++) saveSessionBackup();
}
 
function recordEvent(type, text) {
  const time = new Date().toLocaleTimeString();
  sessionTranscript.push({ type, time: new Date().toISOString(), text });
  appendMaster(`[${time}] ${text}`);
  saveSessionBackup();
}
 
appendMaster(`\n=== Session started ${new Date().toString()} ===`);
saveAllSessionBackups();
 
// ---------- World Truths ----------
 
function defaultWorld() {
  return { townName: '', ironValleyIs: '', peopleAre: '', magicIs: '' };
}
 
function loadWorld() {
  try {
    return { ...defaultWorld(), ...JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8')) };
  } catch (e) {
    return defaultWorld();
  }
  return { ...defaultWorld(), ...readJson(WORLD_FILE, {}) };
}
 
function saveWorld(world) {
  fs.writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2), 'utf8');
  writeJson(WORLD_FILE, world);
}
 
if (!fs.existsSync(WORLD_FILE)) saveWorld(defaultWorld());
seedFileIfMissing(WORLD_FILE, defaultWorld);
 
// ---------- Calendar ----------
// Matches the paper sheet: 4 seasons of 25 days each, weekdays cycle through
// Bread/Friends/Soup/Laundry/Rest Day, with the named holidays from the
// player sheet pre-filled (day numbers are a best-effort read of the sheet's
// layout — labels are fully editable in the app if any need correcting).
// Per the rulebook, each calendar day can hold a maximum of 4 ticks from the
// move Time Passes; on the 4th tick the day is over.
 
const WEEKDAY_CYCLE = ['Bread Day', 'Friends Day', 'Soup Day', 'Laundry Day', 'Rest Day'];
const SEASONS = ['spring', 'summer', 'fall', 'winter'];
const SEASON_HOLIDAYS = {
  spring: { 6: '🍎 Community Garden Day', 13: '🌸 Blossom Day', 15: '🧹 Spring Cleaning', 16: '📦 Flea Market', 22: '🍫 Candy Day' },
  summer: { 2: '⚽ Sports Day', 6: '🥭 Community Garden Day', 16: '🌊 Beach Party', 18: "🍖🥕 Town's Cook-Off", 24: '🎣 Fishing Tournament' },
  fall: { 6: '🌾 Community Garden Day', 16: '🌠 Starfall Day', 18: '🌕 Harvest Moon', 20: '🎃 Costume Day', 23: '🌾 Harvest Feast' },
  winter: { 6: '🍠 Community Garden Day', 16: '🎭 Art Festival', 18: '🏅 Founding Day', 24: '🎄🍲 Soupmas', 25: '🎆 New Years Eve' },
};
 
function buildSeasonDays(season) {
  const holidays = SEASON_HOLIDAYS[season] || {};
  const days = [];
  for (let d = 1; d <= 25; d++) {
    days.push({
      day: d,
      weekday: WEEKDAY_CYCLE[(d - 1) % 5],
      label: holidays[d] || '',
      ticks: 0,
    });
  }
  return days;
}
 
// Apply fn to each season key and collect the results into a season->value map.
function mapSeasons(fn) {
  const out = {};
  for (const s of SEASONS) out[s] = fn(s);
  return out;
}
 
function defaultCalendar() {
  return {
    current: { season: 'spring', day: 1 },
    seasons: mapSeasons(buildSeasonDays),
  };
}
 
// Merge an incoming calendar payload over the defaults: keep known current-day
// fields and accept only well-formed (array) season data, falling back to the
// generated defaults otherwise. Shared by the initial load and the PUT handler.
function mergeCalendar(incoming) {
  const raw = incoming || {};
  const base = defaultCalendar();
  return {
    current: { ...base.current, ...(raw.current || {}) },
    seasons: mapSeasons((s) => (Array.isArray(raw.seasons && raw.seasons[s]) ? raw.seasons[s] : base.seasons[s])),
  };
}
 
function loadCalendar() {
  return mergeCalendar(readJson(CALENDAR_FILE, null));
}
 
function saveCalendar(calendar) {
  writeJson(CALENDAR_FILE, calendar);
}
 
seedFileIfMissing(CALENDAR_FILE, defaultCalendar);
 
// ---------- Shared assets: rulebook PDF + world map ----------
// The rulebook and map are shared across everyone at the table, so they live
// on the server (uploaded once, seen by all) rather than in each browser.
// assets.json just records the public URL of the current file for each slot.
 
function defaultAssets() {
  return { rulebook: null, map: null };
}
 
function loadAssets() {
  return { ...defaultAssets(), ...readJson(ASSETS_FILE, {}) };
}
 
function saveAssets(assets) {
  writeJson(ASSETS_FILE, assets);
}
 
seedFileIfMissing(ASSETS_FILE, defaultAssets);
 
// ---------- Campaign ----------
// The active campaign's name lives on the server so everyone at the table sees
// the same label. Switching campaigns archives the current one and restores a
// previously-archived campaign's characters/world/calendar into the live files.
 
function defaultCampaign() {
  return { name: 'Default Campaign' };
}
 
function loadCampaign() {
  return { ...defaultCampaign(), ...readJson(CAMPAIGN_FILE, {}) };
}
 
function saveCampaign(campaign) {
  writeJson(CAMPAIGN_FILE, campaign);
}
 
seedFileIfMissing(CAMPAIGN_FILE, defaultCampaign);
 
// ---------- Characters + sheets ----------
 
function blankSheet(type) {
  if (type === 'townie') {
    return {
      species: '',
      pronouns: '',
      genderPresentation: '',
      age: '',
      job: '',
      birthday: '',
      favor: 0,
      heartEvents: 0,
      // Favor/hearts are tracked per player character (keyed by name) so each
      // player has their own relationship with this townie:
      //   relationships: { "Etoile": { favor: 3, hearts: 1 }, ... }
      relationships: {},
      notes: '',
    };
  }
  return {
    species: '',
    pronouns: '',
    genderPresentation: '',
    birthday: '',
    whyLeft: '',
    stayingWhere: '',
    backpack: '',
    howLongStay: '',
    stats: { Edge: '', Heart: '', Iron: '', Shadow: '', Wits: '' },
    skills: [],
    satisfaction: 0,
    promises: [],
    notes: '',
  };
}
 
// Coerce a townie's per-player favor map to a safe shape: an object keyed by
// player character name, each value { favor: int>=0, hearts: int 0..10 }.
function normalizeRelationships(incoming) {
  const out = {};
  if (incoming && typeof incoming === 'object') {
    for (const [name, rel] of Object.entries(incoming)) {
      const r = rel && typeof rel === 'object' ? rel : {};
      const favor = Math.max(0, parseInt(r.favor, 10) || 0);
      const hearts = Math.min(10, Math.max(0, parseInt(r.hearts, 10) || 0));
      out[name] = { favor, hearts };
    }
  }
  return out;
}
 
// Merge an incoming sheet over the blank template for its type, coercing the
// player-only collection fields (stats/skills/promises) to safe shapes. Shared
// by character normalization on load and the sheet-save handler.
function buildSheet(type, incoming = {}) {
  const base = blankSheet(type);
  const sheet = { ...base, ...incoming };
  if (type === 'player') {
    sheet.stats = { ...base.stats, ...(incoming.stats || {}) };
    sheet.skills = Array.isArray(incoming.skills) ? incoming.skills : [];
    sheet.promises = Array.isArray(incoming.promises) ? incoming.promises : [];
  } else {
    sheet.relationships = normalizeRelationships(incoming.relationships);
  }
  return sheet;
}
 
// A brand-new campaign (or a first-ever run) starts with one ready-to-claim
// player slot so there's always something in the roster to join — instead of
// forcing the first person in to build a character from a totally empty list.
function defaultCharacters() {
  return [
    {
      name: 'New Player',
      emoji: '🧍',
      color: '#6b7fcd',
      type: 'player',
      sheet: blankSheet('player'),
    },
  ];
}
 
// Fills in any missing fields with defaults so older/partial data never crashes the UI.
function normalizeCharacter(c) {
  const type = c.type === 'townie' ? 'townie' : 'player';
  const sheet = buildSheet(type, c.sheet || {});
  return {
    name: c.name,
    emoji: c.emoji || (type === 'townie' ? '🧑' : '🧍'),
    color: c.color || '#6b7fcd',
    type,
    sheet,
  };
}
 
function loadCharacters() {
  const raw = readJson(CHAR_FILE, (e) => {
    console.error('Could not read characters.json, using empty list.', e);
    return [];
  });
  return Array.isArray(raw) ? raw.map(normalizeCharacter) : [];
}
 
function saveCharacters(characters) {
  writeJson(CHAR_FILE, characters);
}
 
// First-ever run on a machine: no characters.json yet, so seed the default slot.
seedFileIfMissing(CHAR_FILE, defaultCharacters);
 
// characterName -> { socketId, playerName }
const claims = {};
// socketId -> { playerName, characterName }
const connected = {};
 
// Human-readable "Player (Character)" label for log lines and broadcasts.
function describePlayer(info) {
  return info ? `${info.playerName} (${info.characterName})` : 'Someone';
}
 
function broadcastState() {
  const characters = loadCharacters().map((c) => ({
    ...c,
    claimedBy: claims[c.name] ? claims[c.name].playerName : null,
  }));
  io.emit('state', { characters, online: Object.keys(connected).length, world: loadWorld(), calendar: loadCalendar() });
  io.emit('state', { characters, online: Object.keys(connected).length, world: loadWorld(), calendar: loadCalendar(), assets: loadAssets(), campaign: loadCampaign() });
}
 
// ---------- REST: World Truths ----------
 
app.get('/api/world', (req, res) => {
  res.json(loadWorld());
});
 
app.put('/api/world', (req, res) => {
  const world = { ...defaultWorld(), ...(req.body || {}) };
  saveWorld(world);
  res.json(world);
  broadcastState();
  recordEvent('system', `SYSTEM: World Truths updated.`);
});
 
// ---------- REST: Calendar ----------
 
app.get('/api/calendar', (req, res) => {
  res.json(loadCalendar());
});
 
// Full replace — used when saving edits made in the calendar modal (labels,
// manually adjusted ticks, moving the current-day marker, etc.)
app.put('/api/calendar', (req, res) => {
  const calendar = mergeCalendar(req.body);
  saveCalendar(calendar);
  res.json(calendar);
  broadcastState();
});
 
// Convenience endpoint for the move Time Passes: mark 1 tick on the current
// day; on the 4th tick the day is over and the pointer advances automatically
// (with season/year rollover).
app.post('/api/calendar/time-passes', (req, res) => {
  const calendar = loadCalendar();
  const { season, day } = calendar.current;
  const seasonDays = calendar.seasons[season];
  const dayObj = seasonDays.find((d) => d.day === day);
  if (!dayObj) return res.status(400).json({ error: 'Invalid current day.' });
 
  dayObj.ticks = Math.min(4, (dayObj.ticks || 0) + 1);
  let dayOver = false;
  if (dayObj.ticks >= 4) {
    dayOver = true;
    const order = ['spring', 'summer', 'fall', 'winter'];
    if (day >= 25) {
      const nextSeason = order[(order.indexOf(season) + 1) % order.length];
      calendar.current = { season: nextSeason, day: 1 };
    } else {
      calendar.current = { season, day: day + 1 };
    }
  }
  saveCalendar(calendar);
  broadcastState();
  recordEvent('system', `SYSTEM: Time Passes — ${season} day ${day} now at ${dayObj.ticks}/4 ticks.${dayOver ? ` The day is over; now ${calendar.current.season} day ${calendar.current.day}.` : ''}`);
  res.json(calendar);
});
 
// ---------- REST: shared assets (rulebook + map) ----------
 
app.get('/api/assets', (req, res) => {
  res.json(loadAssets());
});
 
// Removes the previously-stored file for a slot so uploads don't pile up.
function removeUploaded(url) {
  if (!url) return;
  const file = path.join(__dirname, 'public', url.replace(/^\/+/, ''));
  if (file.startsWith(UPLOADS_DIR) && fs.existsSync(file)) {
    try { fs.unlinkSync(file); } catch (e) { /* best effort */ }
  }
}
 
app.post('/api/upload/rulebook', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (path.extname(req.file.filename).toLowerCase() !== '.pdf') {
    removeUploaded('/uploads/' + req.file.filename);
    return res.status(400).json({ error: 'The rulebook must be a PDF file.' });
  }
  const assets = loadAssets();
  removeUploaded(assets.rulebook);
  assets.rulebook = '/uploads/' + req.file.filename;
  saveAssets(assets);
  broadcastState();
  recordEvent('system', `SYSTEM: Rulebook PDF uploaded (${req.file.originalname}).`);
  res.json(assets);
});
 
app.post('/api/upload/map', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const okExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  if (!okExt.includes(path.extname(req.file.filename).toLowerCase())) {
    removeUploaded('/uploads/' + req.file.filename);
    return res.status(400).json({ error: 'The map must be an image (png, jpg, gif, webp).' });
  }
  const assets = loadAssets();
  removeUploaded(assets.map);
  assets.map = '/uploads/' + req.file.filename;
  saveAssets(assets);
  broadcastState();
  recordEvent('system', `SYSTEM: World map uploaded (${req.file.originalname}).`);
  res.json(assets);
});
 
// ---------- REST: character management ----------
 
app.post('/api/characters', (req, res) => {
  const { name, emoji, color, type } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const characters = loadCharacters();
  if (characters.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(400).json({ error: 'A character with that name already exists.' });
  }
  const finalType = type === 'townie' ? 'townie' : 'player';
  const newChar = {
    name: name.trim(),
    emoji: (emoji && emoji.trim()) || (finalType === 'townie' ? '🧑' : '🧍'),
    color: (color && color.trim()) || '#6b7fcd',
    type: finalType,
    sheet: blankSheet(finalType),
  };
  characters.push(newChar);
  saveCharacters(characters);
  broadcastState();
  recordEvent('system', `SYSTEM: New ${finalType} character created: ${newChar.name}.`);
  res.json(newChar);
});
 
app.get('/api/characters/:name', (req, res) => {
  const characters = loadCharacters();
  const char = characters.find((c) => c.name === req.params.name);
  if (!char) return res.status(404).json({ error: 'Character not found.' });
  res.json(char);
});
 
app.put('/api/characters/:name/sheet', (req, res) => {
  const characters = loadCharacters();
  const idx = characters.findIndex((c) => c.name === req.params.name);
  if (idx === -1) return res.status(404).json({ error: 'Character not found.' });
  const type = characters[idx].type;
  const sheet = buildSheet(type, (req.body && req.body.sheet) || {});
 
  // Optional rename — Name is the first field on the paper sheet, so the sheet
  // editor lets people set/change it right there instead of only at creation.
  const requestedName = (req.body && typeof req.body.name === 'string') ? req.body.name.trim() : null;
  const oldName = characters[idx].name;
  let finalName = oldName;
  if (requestedName && requestedName !== oldName) {
    const clash = characters.some((c, i) => i !== idx && c.name.toLowerCase() === requestedName.toLowerCase());
    if (clash) return res.status(400).json({ error: 'A character with that name already exists.' });
    finalName = requestedName;
  }
 
  // Aesthetic updates — emoji and color can be updated
  if (req.body && typeof req.body.emoji === 'string') {
    characters[idx].emoji = req.body.emoji.trim() || characters[idx].emoji;
  }
  if (req.body && typeof req.body.color === 'string') {
    characters[idx].color = req.body.color.trim() || characters[idx].color;
  }
 
  characters[idx].name = finalName;
  characters[idx].sheet = sheet;
  saveCharacters(characters);
 
  if (finalName !== oldName) {
    // Carry over any active claim/connection so the renamed character stays joined.
    if (claims[oldName]) {
      claims[finalName] = claims[oldName];
      delete claims[oldName];
      const connInfo = connected[claims[finalName].socketId];
      if (connInfo) connInfo.characterName = finalName;
    }
    recordEvent('system', `SYSTEM: "${oldName}" renamed to "${finalName}".`);
  }
 
  res.json(characters[idx]);
  broadcastState();
});
 
app.delete('/api/characters/:name', (req, res) => {
  let characters = loadCharacters();
  const existed = characters.some((c) => c.name === req.params.name);
  characters = characters.filter((c) => c.name !== req.params.name);
  saveCharacters(characters);
  if (claims[req.params.name]) delete claims[req.params.name];
  broadcastState();
  res.json({ deleted: existed });
});
 
// ---------- REST: New Game ----------
// ---------- REST: Campaigns ----------
// A campaign is a full snapshot of characters + world + calendar + name. The
// live files are the active campaign; archived campaigns sit in archives/<stamp>.
 
const CAMPAIGN_PARTS = [
  { file: CHAR_FILE, name: 'characters.json' },
  { file: WORLD_FILE, name: 'world.json' },
  { file: CALENDAR_FILE, name: 'calendar.json' },
  { file: CAMPAIGN_FILE, name: 'campaign.json' },
];
 
// Copy the current live campaign into archives/<stamp> and return the stamp.
function archiveCurrent() {
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(ARCHIVE_DIR, stamp);
  fs.mkdirSync(dest);
  for (const { file, name } of CAMPAIGN_PARTS) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dest, name));
  }
  writeJson(path.join(dest, 'transcript.json'), sessionTranscript);
  return stamp;
}
 
// Read a small summary for each archived campaign so the picker can list them.
function listArchivedCampaigns() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs
    .readdirSync(ARCHIVE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(ARCHIVE_DIR, d.name);
      const meta = readJson(path.join(dir, 'campaign.json'), {});
      const chars = readJson(path.join(dir, 'characters.json'), []);
      const world = readJson(path.join(dir, 'world.json'), {});
      return {
        stamp: d.name,
        name: (meta && meta.name) || (world && world.townName) || 'Unnamed campaign',
        characterCount: Array.isArray(chars) ? chars.length : 0,
      };
    })
    .sort((a, b) => (a.stamp < b.stamp ? 1 : -1)); // newest first
}
 
app.get('/api/campaigns', (req, res) => {
  res.json({ active: loadCampaign(), archived: listArchivedCampaigns() });
});
 
// Rename the active campaign.
app.put('/api/campaign', (req, res) => {
  const name = (req.body && typeof req.body.name === 'string') ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Campaign name is required.' });
  saveCampaign({ ...loadCampaign(), name });
  broadcastState();
  recordEvent('system', `SYSTEM: Campaign renamed to "${name}".`);
  res.json(loadCampaign());
});
 
// Reset the live campaign back to a blank state (used by New Game + switch).
function resetLiveCampaign() {
  Object.keys(claims).forEach((k) => delete claims[k]);
  sessionTranscript = [];
  saveAllSessionBackups();
}
 
app.post('/api/newgame', (req, res) => {
  const stamp = archiveCurrent();
 
  saveCharacters(defaultCharacters());
  saveWorld(defaultWorld());
  saveCalendar(defaultCalendar());
  saveCampaign(defaultCampaign());
 
  resetLiveCampaign();
  appendMaster(`\n=== NEW GAME — previous campaign archived to archives/${stamp} ===`);
 
  io.emit('gameReset', { archivedTo: stamp });
  broadcastState();
  res.json({ archivedTo: stamp });
});
 
// Switch to a previously-archived campaign: archive the current one, restore the
// selected archive's files into the live slots, then remove that archive folder
// (it's now the active campaign). Assets (rulebook/map) are shared globally and
// are intentionally left untouched.
app.post('/api/campaigns/switch', (req, res) => {
  const stamp = (req.body && typeof req.body.stamp === 'string') ? req.body.stamp : '';
  const src = path.join(ARCHIVE_DIR, stamp);
  // Guard against path traversal and missing archives.
  if (!stamp || path.dirname(src) !== ARCHIVE_DIR || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    return res.status(404).json({ error: 'Campaign not found.' });
  }
 
  const savedStamp = archiveCurrent();
 
  for (const { file, name } of CAMPAIGN_PARTS) {
    const from = path.join(src, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, file);
  }
  // Normalize restored data through the loaders so any older/partial files are healed.
  saveCharacters(loadCharacters());
  saveWorld(loadWorld());
  saveCalendar(loadCalendar());
  saveCampaign(loadCampaign());
 
  fs.rmSync(src, { recursive: true, force: true });
 
  resetLiveCampaign();
  const restored = loadCampaign();
  appendMaster(`\n=== SWITCHED to campaign "${restored.name}" (was archived to archives/${savedStamp}) ===`);
 
  io.emit('gameReset', { switchedTo: restored.name });
  broadcastState();
  res.json({ active: restored, archivedTo: savedStamp });
});
 
// ---------- Sockets: chat + join + dice ----------
 
io.on('connection', (socket) => {
  socket.on('join', ({ playerName, characterName }) => {
    const characters = loadCharacters();
    const valid = characters.find((c) => c.name === characterName);
    if (!valid) {
      socket.emit('joinError', 'That character does not exist.');
      return;
    }
    if (claims[characterName] && claims[characterName].socketId !== socket.id) {
      socket.emit('joinError', `${characterName} is already claimed by ${claims[characterName].playerName}.`);
      return;
    }
 
    if (connected[socket.id]) {
      delete claims[connected[socket.id].characterName];
    }
 
    claims[characterName] = { socketId: socket.id, playerName };
    connected[socket.id] = { playerName, characterName };
 
    socket.emit('joined', { characterName, character: valid });
    io.emit('system', `${playerName} is now playing ${characterName}.`);
    recordEvent('system', `SYSTEM: ${playerName} is now playing ${characterName}.`);
    broadcastState();
  });
 
  socket.on('message', (payload) => {
    const info = connected[socket.id];
    if (!info) return;
    const text = typeof payload === 'string' ? payload : (payload && payload.text);
    const ooc = !!(payload && typeof payload === 'object' && payload.ooc);
    if (!text || !text.trim()) return;
    const characters = loadCharacters();
    const char = characters.find((c) => c.name === info.characterName) || {};
    io.emit('message', {
      characterName: info.characterName,
      playerName: info.playerName,
      emoji: char.emoji || '💬',
      color: char.color || '#444',
      text: text.trim(),
      ooc,
      time: Date.now(),
    });
    recordEvent('message', `${ooc ? '[OOC] ' : ''}${info.characterName} (${info.playerName}): ${text.trim()}`);
  });
 
  socket.on('roll', ({ min, max, label }) => {
    const info = connected[socket.id];
    let lo = parseInt(min, 10);
    let hi = parseInt(max, 10);
    if (Number.isNaN(lo) || Number.isNaN(hi)) return;
    if (lo > hi) [lo, hi] = [hi, lo];
    const result = Math.floor(Math.random() * (hi - lo + 1)) + lo;
 
    const who = describePlayer(info);
    io.emit('diceRoll', { who, min: lo, max: hi, result, label: label || null, time: Date.now() });
    recordEvent('dice', `DICE: ${who} rolled (${lo}-${hi}): ${result}${label ? ` — ${label}` : ''}`);
  });
 
  socket.on('oracleRoll', ({ type, result, detail }) => {
    const info = connected[socket.id];
    const who = describePlayer(info);
    io.emit('oracleRoll', { who, type, result, detail, time: Date.now() });
    recordEvent('oracle', `ORACLE: ${who} consulted ${type}: ${result}${detail ? ` ${detail}` : ''}`);
  });
 
  socket.on('disconnect', () => {
    const info = connected[socket.id];
    if (info) {
      delete claims[info.characterName];
      delete connected[socket.id];
      const who = describePlayer(info);
      io.emit('system', `${who} left.`);
      recordEvent('system', `SYSTEM: ${who} left.`);
      broadcastState();
    }
  });
 
  broadcastState();
});
 
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Character chat running!`);
  console.log(`On this machine:  http://localhost:${PORT}`);
  console.log(`On your network:  http://<this-computer's-LAN-IP>:${PORT}`);
  console.log(`Master log:        ${MASTER_LOG_FILE}`);
  console.log(`Session backups:   ${BACKUP_FILES.join(', ')}`);
});
