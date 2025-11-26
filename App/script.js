// ---- FILE & CRYPTO STATE ----

let fileHandle = null;
let entries = [];
let currentPassword = null;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ---- DOM refs ----

const dateInput = document.getElementById("dateInput");
const ratingInput = document.getElementById("ratingInput");
const ratingValue = document.getElementById("ratingValue");
const ratingEmoji = document.getElementById("ratingEmoji");
const labelInput = document.getElementById("labelInput");
const noteInput = document.getElementById("noteInput");
const importantInput = document.getElementById("importantInput");
const moodForm = document.getElementById("moodForm");
const clearFormBtn = document.getElementById("clearFormBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const clearDayBtn = document.getElementById("clearDayBtn");
const todayText = document.getElementById("todayText");
const submitBtn = document.getElementById("submitBtn");
const formTitle = document.getElementById("formTitle");
const formSubtitle = document.getElementById("formSubtitle");
const promptText = document.getElementById("promptText");
const connectFileBtn = document.getElementById("connectFileBtn");
const fileStatus = document.getElementById("fileStatus");

const monthLabel = document.getElementById("monthLabel");
const calendarBody = document.getElementById("calendarBody");
const prevMonthBtn = document.getElementById("prevMonthBtn");
const nextMonthBtn = document.getElementById("nextMonthBtn");
const dayDetailsDate = document.getElementById("dayDetailsDate");
const dayDetailsEmpty = document.getElementById("dayDetailsEmpty");
const dayDetailsList = document.getElementById("dayDetailsList");

const statAvg = document.getElementById("statAvg");
const statCount = document.getElementById("statCount");
const statCurrentStreak = document.getElementById("statCurrentStreak");
const statLongestStreak = document.getElementById("statLongestStreak");

const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

const lockScreen = document.getElementById("lockScreen");
const lockInput = document.getElementById("lockInput");
const lockBtn = document.getElementById("lockBtn");
const lockError = document.getElementById("lockError");

const changePwBtn = document.getElementById("changePwBtn");
const pwModal = document.getElementById("pwModal");
const pwOldInput = document.getElementById("pwOldInput");
const pwNewInput = document.getElementById("pwNewInput");
const pwNewConfirmInput = document.getElementById("pwNewConfirmInput");
const pwModalError = document.getElementById("pwModalError");
const pwModalCancel = document.getElementById("pwModalCancel");
const pwModalSave = document.getElementById("pwModalSave");

let currentMonth;
let currentYear;
let selectedDateISO;
let editingEntryId = null;

// If you ever wanna add more prompts, shove them in here:
const PROMPTS = [
  // "Example prompt 1",
  // "Example prompt 2"
];

// ---- Lock screen ----

lockBtn.addEventListener("click", () => {
  const val = lockInput.value;
  if (!val) {
    lockError.textContent = "Password required.";
    lockError.style.display = "block";
    return;
  }
  currentPassword = val;
  lockInput.value = "";
  lockError.style.display = "none";
  lockScreen.style.display = "none";
});

lockInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") lockBtn.click();
});

// ---- Helpers ----

function supportsFileSystemAPI() {
  return "showOpenFilePicker" in window || "showSaveFilePicker" in window;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(str) {
  const binary = atob(str);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// format a Date as local YYYY-MM-DD (no timezone shenanigans)
function formatLocalDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---- Crypto helpers ----

async function deriveKeyFromPassword(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptEntriesForStorage(entries, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassword(password, salt);
  const plaintext = textEncoder.encode(JSON.stringify(entries));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  const cipherBytes = new Uint8Array(cipherBuf);
  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(cipherBytes)
  };
}

async function decryptEntriesFromStorage(obj, password) {
  const salt = base64ToBytes(obj.salt);
  const iv = base64ToBytes(obj.iv);
  const cipherBytes = base64ToBytes(obj.ciphertext);
  const key = await deriveKeyFromPassword(password, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipherBytes
  );
  const plaintext = textDecoder.decode(plainBuf);
  const parsed = JSON.parse(plaintext);
  if (!Array.isArray(parsed)) {
    throw new Error("Decrypted data is not an array");
  }
  return parsed;
}

function openPwModal() {
  if (!currentPassword) {
    alert("Unlock first to change your password.");
    return;
  }
  if (!fileHandle) {
    alert("Connect your data file first.");
    return;
  }
  pwOldInput.value = "";
  pwNewInput.value = "";
  pwNewConfirmInput.value = "";
  pwModalError.style.display = "none";
  pwModalError.textContent = "";
  pwModal.style.display = "flex";
}

function closePwModal() {
  pwModal.style.display = "none";
}

// ---- File loading/saving ----

async function connectDataFile() {
  if (!supportsFileSystemAPI()) {
    alert("This feature needs Chrome or Edge (File System Access API).");
    return;
  }
  if (!currentPassword) {
    alert("Unlock with your password first.");
    return;
  }

  try {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "Mood data JSON",
          accept: { "application/json": [".json"] }
        }
      ]
    });
    fileHandle = handles[0];
    await loadEntriesFromFile();
    updateFileStatus();
    renderCalendar();
    renderDayDetails(selectedDateISO);
    updateStats();
    renderSearchResults(searchInput.value.trim().toLowerCase());
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(err);
      alert("Could not open or decrypt file. Check your password or file.");
      fileHandle = null;
      entries = [];
      updateFileStatus();
    }
  }
}

async function loadEntriesFromFile() {
  if (!fileHandle) {
    entries = [];
    return;
  }
  const file = await fileHandle.getFile();
  const text = await file.text();
  if (!text.trim()) {
    entries = [];
    return;
  }
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    entries = parsed; // unencrypted legacy
  } else if (parsed && parsed.ciphertext) {
    if (!currentPassword) throw new Error("No password set");
    entries = await decryptEntriesFromStorage(parsed, currentPassword);
  } else {
    entries = [];
  }
}

async function saveEntriesToFile() {
  if (!fileHandle || !currentPassword) return;
  const encryptedObj = await encryptEntriesForStorage(entries, currentPassword);
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(encryptedObj, null, 2));
  await writable.close();
}

function updateFileStatus() {
  if (!fileHandle) {
    fileStatus.innerHTML = '<span class="file-status-strong">No file connected</span>';
    return;
  }
  fileStatus.innerHTML =
    '<span class="file-status-strong">Connected:</span> ' +
    (fileHandle.name || "mood-entries.json");
}

// ---- UI + logic ----

const PROMPTS_SIMPLE = PROMPTS.length ? PROMPTS : [
  "What was the strongest emotion you felt today, and what triggered it?"
];

function applyThemeByTime() {
  const h = new Date().getHours();
  let theme;

  if (h >= 5 && h < 8) theme = "sunrise";
  else if (h >= 8 && h < 17) theme = "day";
  else if (h >= 17 && h < 20) theme = "sunset";
  else theme = "night";

  document.body.setAttribute("data-theme", theme);
}

function formatToday() {
  const d = new Date();
  const iso = formatLocalDate(d);
  dateInput.value = iso;

  const options = { weekday: "short", year: "numeric", month: "short", day: "numeric" };
  todayText.textContent = d.toLocaleDateString(undefined, options);

  selectedDateISO = iso;
}

function getDayOfYear(dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

function updatePrompt() {
  const iso = dateInput.value || formatLocalDate(new Date());
  const dayOfYear = getDayOfYear(iso);
  const prompt = PROMPTS_SIMPLE[dayOfYear % PROMPTS_SIMPLE.length];
  promptText.textContent = prompt;
}

function getEmojiForRating(r) {
  r = Number(r);
  if (r <= 2) return "😫";
  if (r <= 4) return "😕";
  if (r <= 6) return "😐";
  if (r <= 8) return "🙂";
  return "🤩";
}

function moodSummary(r) {
  r = Number(r);
  if (r <= 2) return "Really rough day.";
  if (r <= 4) return "Kinda low energy / not great.";
  if (r <= 6) return "Mixed or neutral vibes.";
  if (r <= 8) return "Pretty decent overall.";
  return "Really good mood today.";
}

function resetFormToCreateMode() {
  editingEntryId = null;
  submitBtn.textContent = "Save entry";
  formTitle.textContent = "Log today’s mood";
  formSubtitle.textContent = "Use this like a mini diary. Be honest, no one else sees this.";
}

function startEdit(entry) {
  editingEntryId = entry.id;
  dateInput.value = entry.date;
  ratingInput.value = entry.rating;
  ratingValue.textContent = entry.rating;
  ratingEmoji.textContent = getEmojiForRating(entry.rating);
  labelInput.value = entry.label;
  noteInput.value = entry.note || "";
  importantInput.checked = !!entry.important;

  submitBtn.textContent = "Update entry";
  formTitle.textContent = "Edit mood entry";
  formSubtitle.textContent = "You’re editing an existing entry. Change what you want, then save.";
  updatePrompt();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getEntries() {
  return entries;
}

function getEntriesByDate() {
  const map = {};
  for (const e of entries) {
    if (!map[e.date]) map[e.date] = [];
    map[e.date].push(e);
  }
  Object.keys(map).forEach(date => {
    map[date].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  });
  return map;
}

async function addEntry(entry) {
  entries.push(entry);
  await saveEntriesToFile();
  renderCalendar();
  renderDayDetails(selectedDateISO);
  updateStats();
  renderSearchResults(searchInput.value.trim().toLowerCase());
}

async function updateEntry(id, updates) {
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  entries[idx] = { ...entries[idx], ...updates };
  await saveEntriesToFile();
  selectedDateISO = entries[idx].date;
  renderCalendar();
  renderDayDetails(selectedDateISO);
  updateStats();
  renderSearchResults(searchInput.value.trim().toLowerCase());
}

async function deleteEntry(id) {
  if (!confirm("Delete this entry? This can’t be undone.")) return;
  entries = entries.filter(e => e.id !== id);
  await saveEntriesToFile();
  resetFormToCreateMode();
  renderCalendar();
  renderDayDetails(selectedDateISO);
  updateStats();
  renderSearchResults(searchInput.value.trim().toLowerCase());
}

function updateStats() {
  const all = getEntries();
  const now = new Date(currentYear, currentMonth, 1);
  const m = now.getMonth();
  const y = now.getFullYear();

  const monthEntries = all.filter(e => {
    const d = new Date(e.date + "T00:00:00");
    return d.getMonth() === m && d.getFullYear() === y;
  });

  if (monthEntries.length === 0) {
    statAvg.textContent = "–";
    statCount.textContent = "0";
  } else {
    const avg =
      monthEntries.reduce((acc, e) => acc + Number(e.rating || 0), 0) /
      monthEntries.length;
    statAvg.textContent = avg.toFixed(1);
    statCount.textContent = String(monthEntries.length);
  }

  if (all.length === 0) {
    statCurrentStreak.textContent = "0 days";
    statLongestStreak.textContent = "0 days";
    return;
  }

  const dateSet = new Set(all.map(e => e.date));
  const sortedDates = Array.from(dateSet)
    .map(d => new Date(d + "T00:00:00"))
    .sort((a, b) => a - b);

  let longest = 1;
  let current = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = sortedDates[i - 1];
    const curr = sortedDates[i];
    const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }

  let currentStreak = 0;
  const today = new Date();
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  while (true) {
    const iso = formatLocalDate(cursor);
    if (dateSet.has(iso)) {
      currentStreak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  statCurrentStreak.textContent = `${currentStreak} day${currentStreak === 1 ? "" : "s"}`;
  statLongestStreak.textContent = `${longest} day${longest === 1 ? "" : "s"}`;
}

function renderCalendar() {
  const entriesByDate = getEntriesByDate();
  calendarBody.innerHTML = "";

  const firstDay = new Date(currentYear, currentMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const monthName = firstDay.toLocaleString(undefined, { month: "long", year: "numeric" });
  monthLabel.textContent = monthName;

  const todayISO = formatLocalDate(new Date());

  for (let i = 0; i < startWeekday; i++) {
    const cell = document.createElement("div");
    cell.className = "calendar-cell empty";
    calendarBody.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(currentYear, currentMonth, day);
    const iso = formatLocalDate(cellDate);

    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    cell.dataset.date = iso;

    if (iso === todayISO) cell.classList.add("today");
    if (iso === selectedDateISO) cell.classList.add("selected");

    const dateDiv = document.createElement("div");
    dateDiv.className = "cell-date";
    dateDiv.textContent = day;

    const badgesDiv = document.createElement("div");
    badgesDiv.className = "cell-badges";

const entriesForDay = entriesByDate[iso] || [];
if (entriesForDay.length > 0) {
  // mark the cell so mobile CSS can show a simple dot
  cell.classList.add("has-entries");

  const last = entriesForDay[0];
  const badge = document.createElement("div");
  badge.className = "cell-badge";

  const emojiSpan = document.createElement("span");
  emojiSpan.textContent = getEmojiForRating(last.rating);

  const textSpan = document.createElement("span");
  if (entriesForDay.length === 1) {
    textSpan.textContent = `${last.rating}/10 · ${last.label}`;
  } else {
    textSpan.textContent = `${entriesForDay.length} entries`;
  }

  badge.appendChild(emojiSpan);
  badge.appendChild(textSpan);
  badgesDiv.appendChild(badge);

  if (entriesForDay.some(e => e.important)) {
    const star = document.createElement("div");
    star.className = "cell-important";
    star.textContent = "⭐";
    cell.appendChild(star);
  }
}


    cell.appendChild(dateDiv);
    cell.appendChild(badgesDiv);

    cell.addEventListener("click", () => {
      selectedDateISO = iso;
      renderCalendar();
      renderDayDetails(iso);
    });

    calendarBody.appendChild(cell);
  }

  updateStats();
}

function renderDayDetails(dateISO) {
  if (!dateISO) {
    dayDetailsDate.textContent = "Select a day";
    dayDetailsEmpty.style.display = "block";
    dayDetailsList.innerHTML = "";
    return;
  }

  const entriesByDate = getEntriesByDate();
  const entriesForDay = entriesByDate[dateISO] || [];

  const d = new Date(dateISO + "T00:00:00");
  const label = d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  dayDetailsDate.textContent = label;
  dayDetailsList.innerHTML = "";

  if (!entriesForDay.length) {
    dayDetailsEmpty.style.display = "block";
    return;
  } else {
    dayDetailsEmpty.style.display = "none";
  }

  entriesForDay.forEach(entry => {
    const li = document.createElement("li");
    li.className = "day-entry";

    const top = document.createElement("div");
    top.className = "day-entry-top";

    const timeSpan = document.createElement("span");
    timeSpan.className = "day-entry-time";
    timeSpan.textContent = entry.time || "";

    const right = document.createElement("div");

    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = `${entry.rating}/10 · ${entry.label}`;

    right.appendChild(pill);

    if (entry.important) {
      const imp = document.createElement("span");
      imp.className = "important-pill";
      imp.textContent = "⭐ important";
      right.appendChild(imp);
    }

    top.appendChild(timeSpan);
    top.appendChild(right);
    li.appendChild(top);

    if (entry.note && entry.note.trim()) {
      const note = document.createElement("div");
      note.className = "day-entry-note";
      note.textContent = entry.note;
      li.appendChild(note);
    }

    const summary = document.createElement("div");
    summary.className = "day-entry-summary";
    summary.textContent = moodSummary(entry.rating);
    li.appendChild(summary);

    const actions = document.createElement("div");
    actions.className = "entry-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn inline neutral";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEdit(entry));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn inline danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteEntry(entry.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    li.appendChild(actions);

    dayDetailsList.appendChild(li);
  });
}

function renderSearchResults(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  const container = searchResults;
  const titleNode = container.querySelector(".search-results-title");

  const oldList = container.querySelector(".search-results-list");
  if (oldList) oldList.remove();
  const oldEmpty = container.querySelector(".empty-search");
  if (oldEmpty) oldEmpty.remove();

  if (!q) {
    if (titleNode) titleNode.textContent = "Search results";
    return;
  }

  const all = getEntries();
  const matches = all
    .filter(e => {
      const text = ((e.note || "") + " " + (e.label || "") + " " + (e.date || "")).toLowerCase();
      return text.includes(q);
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 40);

  if (titleNode) {
    titleNode.textContent = `Search results (${matches.length})`;
  }

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "empty-search empty";
    empty.textContent = "No matches.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "search-results-list";

  matches.forEach(e => {
    const li = document.createElement("li");
    li.className = "search-result";

    const title = document.createElement("div");
    title.className = "search-result-title";
    title.textContent = `${e.date} · ${e.rating}/10 · ${e.label}${e.important ? " · ⭐" : ""}`;

    const snippet = document.createElement("div");
    snippet.className = "search-result-snippet";
    if (e.note && e.note.trim()) {
      const txt = e.note.trim();
      snippet.textContent = txt.length > 120 ? txt.slice(0, 120) + "…" : txt;
    } else {
      snippet.textContent = moodSummary(e.rating);
    }

    li.appendChild(title);
    li.appendChild(snippet);

    li.addEventListener("click", () => {
      selectedDateISO = e.date;
      const d = new Date(e.date + "T00:00:00");
      currentMonth = d.getMonth();
      currentYear = d.getFullYear();
      renderCalendar();
      renderDayDetails(selectedDateISO);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    list.appendChild(li);
  });

  container.appendChild(list);
}

// ---- Event wiring ----

changePwBtn.addEventListener("click", openPwModal);

pwModalCancel.addEventListener("click", () => {
  closePwModal();
});

pwModalSave.addEventListener("click", async () => {
  const oldPw = pwOldInput.value.trim();
  const newPw = pwNewInput.value.trim();
  const newPw2 = pwNewConfirmInput.value.trim();

  pwModalError.style.display = "none";
  pwModalError.textContent = "";

  if (!oldPw || !newPw || !newPw2) {
    pwModalError.textContent = "Please fill out all fields.";
    pwModalError.style.display = "block";
    return;
  }

  if (oldPw !== currentPassword) {
    pwModalError.textContent = "Current password is incorrect.";
    pwModalError.style.display = "block";
    return;
  }

  if (newPw.length < 8) {
    pwModalError.textContent = "New password must be at least 8 characters.";
    pwModalError.style.display = "block";
    return;
  }

  if (newPw !== newPw2) {
    pwModalError.textContent = "New passwords do not match.";
    pwModalError.style.display = "block";
    return;
  }

  try {
    const previousPassword = currentPassword;
    currentPassword = newPw;          // switch to new password in memory
    await saveEntriesToFile();        // re-encrypt file with new password
    closePwModal();
    alert("Password updated. Use your new password next time you unlock.");
  } catch (err) {
    console.error(err);
    pwModalError.textContent = "Error updating password. Your old password is still active.";
    pwModalError.style.display = "block";
  }
});

ratingInput.addEventListener("input", () => {
  ratingValue.textContent = ratingInput.value;
  ratingEmoji.textContent = getEmojiForRating(ratingInput.value);
});

dateInput.addEventListener("change", updatePrompt);

clearFormBtn.addEventListener("click", () => {
  ratingInput.value = 5;
  ratingValue.textContent = "5";
  ratingEmoji.textContent = getEmojiForRating(5);
  labelInput.value = "Meh";
  noteInput.value = "";
  importantInput.checked = false;
  dateInput.value = formatLocalDate(new Date());
  updatePrompt();
  resetFormToCreateMode();
});

clearAllBtn.addEventListener("click", async () => {
  if (!entries.length) return;
  if (!confirm("Clear ALL mood entries for all days? This can’t be undone.")) return;
  entries = [];
  await saveEntriesToFile();
  resetFormToCreateMode();
  renderCalendar();
  renderDayDetails(selectedDateISO);
  updateStats();
  renderSearchResults(searchInput.value.trim().toLowerCase());
});

clearDayBtn.addEventListener("click", async () => {
  if (!selectedDateISO) return;
  const entriesByDate = getEntriesByDate();
  const entriesForDay = entriesByDate[selectedDateISO] || [];
  if (!entriesForDay.length) return;
  if (!confirm(`Delete all entries for ${selectedDateISO}? This can’t be undone.`)) return;

  entries = entries.filter(e => e.date !== selectedDateISO);
  await saveEntriesToFile();
  resetFormToCreateMode();
  renderCalendar();
  renderDayDetails(selectedDateISO);
  updateStats();
  renderSearchResults(searchInput.value.trim().toLowerCase());
});

moodForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!fileHandle) {
    alert("Connect a data file first (top right).");
    return;
  }
  if (!currentPassword) {
    alert("Unlock with your password first.");
    return;
  }

  const now = new Date();
  const base = {
    date: dateInput.value,
    rating: Number(ratingInput.value),
    label: labelInput.value,
    note: noteInput.value.trim(),
    important: !!importantInput.checked,
    timestamp: now.getTime(),
    time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };

  if (editingEntryId) {
    await updateEntry(editingEntryId, base);
  } else {
    const entry = {
      id: now.getTime(),
      ...base
    };
    await addEntry(entry);
  }

  noteInput.value = "";
  importantInput.checked = false;
  resetFormToCreateMode();
});

prevMonthBtn.addEventListener("click", () => {
  currentMonth -= 1;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear -= 1;
  }
  const d = new Date(currentYear, currentMonth, 1);
  selectedDateISO = formatLocalDate(d);
  renderCalendar();
  renderDayDetails(selectedDateISO);
});

nextMonthBtn.addEventListener("click", () => {
  currentMonth += 1;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear += 1;
  }
  const d = new Date(currentYear, currentMonth, 1);
  selectedDateISO = formatLocalDate(d);
  renderCalendar();
  renderDayDetails(selectedDateISO);
});

searchInput.addEventListener("input", () => {
  renderSearchResults(searchInput.value);
});

connectFileBtn.addEventListener("click", () => {
  connectDataFile();
});

// ---- Init ----

(function init() {
  applyThemeByTime();
  setInterval(applyThemeByTime, 10 * 60 * 1000);

  formatToday();
  ratingValue.textContent = ratingInput.value;
  ratingEmoji.textContent = getEmojiForRating(ratingInput.value);

  const today = new Date();
  currentMonth = today.getMonth();
  currentYear = today.getFullYear();

  updatePrompt();
  updateFileStatus();
  renderCalendar();
  renderDayDetails(selectedDateISO);
  renderSearchResults("");
})();
