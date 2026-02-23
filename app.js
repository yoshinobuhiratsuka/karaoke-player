const folderInput = document.getElementById('folderInput');
const folderNameEl = document.getElementById('folderName');
const songList = document.getElementById('songList');
const lyricsInner = document.getElementById('lyricsInner');
const audio = document.getElementById('audio');
const nowPlaying = document.getElementById('nowPlaying');
const timeEditControls = document.getElementById('timeEditControls');
const markTimeBtn = document.getElementById('markTime');
const backOneLineBtn = document.getElementById('backOneLine');
const editLrcTimingBtn = document.getElementById('editLrcTiming');

let files = []; // フォルダ用: { name, mp3File, lrcFile }
let currentDirectoryHandle = null;
let currentSongName = '';
let currentParsedLrcLines = null; // 時間タグ付きLRCを読み込んだときのパース結果（編集モード用）
let enableSync = true;
let isTimingMode = false;
let plainLyricsLines = [];
let editableLineIndexes = [];
let currentEditPos = 0;
let timingMsByLineIndex = [];

const LRC_NO_TIME = Number.MAX_SAFE_INTEGER; // 時間タグのない行用。表示はブランク・保存時はタグなし

const AUDIO_EXTS = /\.(mp3|m4a|aac|wav|ogg|flac|webm)$/i;

function buildFilesFromList(list) {
  const audioFiles = list.filter(f => AUDIO_EXTS.test(f.name));
  const lrcMap = {};
  list.filter(f => /\.lrc$/i.test(f.name)).forEach(f => {
    const base = f.name.replace(/\.lrc$/i, '');
    lrcMap[base.toLowerCase()] = f;
  });
  return audioFiles.map(f => {
    const base = f.name.replace(AUDIO_EXTS, '');
    return { name: base, mp3File: f, lrcFile: lrcMap[base.toLowerCase()] || null };
  });
}

function fillSongList() {
  songList.innerHTML = '<option value="">-- 曲を選択 --</option>';
  files.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = f.name;
    songList.appendChild(opt);
  });
  songList.disabled = false;
  if (folderNameEl && files.length === 0) {
    const msg = '曲が見つかりませんでした。スマホではフォルダ選択が使えない場合があります。';
    folderNameEl.textContent = folderNameEl.textContent ? folderNameEl.textContent + ' ※' + msg : msg;
  }
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|webOS|Mobile/i.test(navigator.userAgent);
}

document.getElementById('openFolder').onclick = async () => {
  if (!isMobileDevice() && typeof window.showDirectoryPicker === 'function') {
    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: currentDirectoryHandle ?? undefined
      });
      currentDirectoryHandle = handle;
      folderNameEl.textContent = 'フォルダ: ' + handle.name;
      const list = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const f = await entry.getFile();
          list.push(f);
        }
      }
      files = buildFilesFromList(list);
      fillSongList();
      return;
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  }
  folderInput.click();
};

folderInput.addEventListener('change', (e) => {
  currentDirectoryHandle = null;
  const list = Array.from(e.target.files || []);
  const folderName = list.length > 0 && list[0].webkitRelativePath
    ? list[0].webkitRelativePath.split('/')[0]
    : '';
  folderNameEl.textContent = folderName ? 'フォルダ: ' + folderName : '';
  files = buildFilesFromList(list);
  fillSongList();
});

songList.addEventListener('change', () => {
  const i = parseInt(songList.value, 10);
  if (isNaN(i) || !files[i]) return;
  const item = files[i];
  currentSongName = item.name;
  audio.src = URL.createObjectURL(item.mp3File);
  nowPlaying.textContent = '再生中: ' + item.name;
  resetTimeEdit();
  if (item.lrcFile) {
    item.lrcFile.text().then(text => {
      const hasTimeTag = /^\s*\[\d{1,2}:\d{1,2}(?:[.:]\d{2,3})?\]/m.test(text);
      if (hasTimeTag) {
        const lines = parseLrc(text);
        currentParsedLrcLines = lines;
        renderLyrics(lines);
        enableSync = true;
        syncScroll();
        if (editLrcTimingBtn) editLrcTimingBtn.style.display = '';
      } else {
        currentParsedLrcLines = null;
        enableSync = false;
        renderPlainLyricsFromText(text);
        if (editLrcTimingBtn) editLrcTimingBtn.style.display = 'none';
      }
    });
  } else {
    currentParsedLrcLines = null;
    enableSync = false;
    resetTimeEdit();
    if (editLrcTimingBtn) editLrcTimingBtn.style.display = 'none';
    lyricsInner.innerHTML = '<p style="color:#888">この曲には .lrc がありません。同名の .lrc を同じフォルダに置いてください。</p>';
  }
});

function resetTimeEdit() {
  isTimingMode = false;
  plainLyricsLines = [];
  editableLineIndexes = [];
  currentEditPos = 0;
  timingMsByLineIndex = [];
  if (timeEditControls) timeEditControls.style.display = 'none';
  if (markTimeBtn) markTimeBtn.disabled = true;
  if (backOneLineBtn) backOneLineBtn.disabled = true;
  const linesEls = lyricsInner.querySelectorAll('.lyrics-line');
  linesEls.forEach(el => el.classList.remove('editing-current'));
}

function startLrcTimeEdit() {
  if (!currentParsedLrcLines || currentParsedLrcLines.length === 0) return;
  enableSync = false;
  plainLyricsLines = currentParsedLrcLines.map(l => l.text);
  timingMsByLineIndex = currentParsedLrcLines.map(l => l.time);
  editableLineIndexes = [];
  plainLyricsLines.forEach((line, idx) => {
    if (line.trim() !== '') editableLineIndexes.push(idx);
  });
  const html = plainLyricsLines.map((line, idx) =>
    `<div class="lyrics-line" data-line-index="${idx}"><span class="lyrics-line-text">${escapeHtml(line) || '&nbsp;'}</span><span class="lyrics-time" data-line-index="${idx}"></span></div>`
  ).join('');
  lyricsInner.innerHTML = html;
  plainLyricsLines.forEach((_, idx) => setLineTimeDisplay(idx, timingMsByLineIndex[idx]));
  timeEditControls.style.display = 'block';
  isTimingMode = true;
  currentEditPos = -1;
  markTimeBtn.disabled = false;
  backOneLineBtn.disabled = true;
  if (editLrcTimingBtn) editLrcTimingBtn.style.display = 'none';
}

function renderPlainLyricsFromText(text) {
  plainLyricsLines = text.split(/\r?\n/);
  editableLineIndexes = [];
  timingMsByLineIndex = new Array(plainLyricsLines.length).fill(null);
  const html = plainLyricsLines.map((line, idx) => {
    if (line.trim() !== '') {
      editableLineIndexes.push(idx);
    }
    return `<div class="lyrics-line" data-line-index="${idx}"><span class="lyrics-line-text">${escapeHtml(line) || '&nbsp;'}</span><span class="lyrics-time" data-line-index="${idx}"></span></div>`;
  }).join('');
  lyricsInner.innerHTML = html;
  if (editableLineIndexes.length > 0) {
    timeEditControls.style.display = 'block';
    isTimingMode = true;
    currentEditPos = -1;
    markTimeBtn.disabled = false;
    backOneLineBtn.disabled = true;
  } else {
    timeEditControls.style.display = 'none';
    isTimingMode = false;
    markTimeBtn.disabled = true;
  }
}

function parseLrc(text) {
  const lines = [];
  const re = /^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{2,3}))?\](.*)$/;
  text.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    const m = trimmed.match(re);
    if (m) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const cent = parseInt(m[3] || '0', 10);
      const ms = (min * 60 + sec) * 1000 + (cent <= 99 ? cent * 10 : cent);
      lines.push({ time: ms, text: m[4].trim() });
    } else if (trimmed !== '') {
      // 時間タグのない行も表示に含める。再生時はハイライトされない（前の行で止まる）
      lines.push({ time: LRC_NO_TIME, text: trimmed });
    }
  });
  // ファイルの行順を保持（時間でソートしない）
  return lines;
}

function renderLyrics(lines) {
  lyricsInner.innerHTML = lines.map((line, i) =>
    `<div class="lyrics-line" data-time="${line.time}" data-index="${i}">${escapeHtml(line.text) || '&nbsp;'}</div>`
  ).join('');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

audio.addEventListener('timeupdate', syncScroll);

function syncScroll() {
  if (!enableSync) return;
  const t = audio.currentTime * 1000;
  const lines = lyricsInner.querySelectorAll('.lyrics-line');
  lines.forEach(el => el.classList.remove('current', 'past'));
  let current = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const time = parseInt(lines[i].dataset.time, 10);
    if (time <= t) {
      current = lines[i];
      for (let j = 0; j < i; j++) lines[j].classList.add('past');
      break;
    }
  }
  if (current) {
    current.classList.add('current');
    current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function setCurrentEditHighlight() {
  const linesEls = lyricsInner.querySelectorAll('.lyrics-line');
  linesEls.forEach(el => el.classList.remove('editing-current'));
  if (!isTimingMode || currentEditPos < 0 || currentEditPos >= editableLineIndexes.length) return;
  const lineIndex = editableLineIndexes[currentEditPos];
  const target = lyricsInner.querySelector(`.lyrics-line[data-line-index="${lineIndex}"]`);
  if (target) {
    target.classList.add('editing-current');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function formatTimeTag(ms) {
  const totalMs = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(totalMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const cent = Math.floor((totalMs % 1000) / 10);
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const cc = String(cent).padStart(2, '0');
  return `[${mm}:${ss}.${cc}]`;
}

function formatTimeDisplay(ms) {
  const totalMs = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(totalMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const cent = Math.floor((totalMs % 1000) / 10);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cent).padStart(2, '0')}`;
}

function setLineTimeDisplay(lineIndex, ms) {
  const el = lyricsInner.querySelector(`.lyrics-time[data-line-index="${lineIndex}"]`);
  if (el) el.textContent = (ms != null && ms !== LRC_NO_TIME) ? formatTimeDisplay(ms) : '';
}

function buildLrcFromTiming() {
  if (!plainLyricsLines.length) return '';
  return plainLyricsLines.map((line, idx) => {
    const text = line;
    if (text.trim() === '') return '';
    const ms = timingMsByLineIndex[idx];
    if (ms == null || ms === LRC_NO_TIME) return text;
    return formatTimeTag(ms) + ' ' + text;
  }).join('\n');
}

let saveMessageTimer = null;

function showSaveMessage() {
  const el = document.getElementById('saveMessage');
  if (!el) return;
  if (saveMessageTimer) clearTimeout(saveMessageTimer);
  el.textContent = 'LRCを保存しました';
  saveMessageTimer = setTimeout(() => {
    el.textContent = '';
    saveMessageTimer = null;
  }, 10000);
}

async function saveLrcToFile() {
  const content = buildLrcFromTiming();
  if (!content || !currentSongName) return;
  const filename = currentSongName + '.lrc';
  if (currentDirectoryHandle) {
    try {
      const fileHandle = await currentDirectoryHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      showSaveMessage();
      const lines = parseLrc(content);
      currentParsedLrcLines = lines;
      enableSync = true;
      isTimingMode = false;
      timeEditControls.style.display = 'none';
      renderLyrics(lines);
      syncScroll();
      if (editLrcTimingBtn) editLrcTimingBtn.style.display = '';
      return;
    } catch (err) {
      console.error(err);
    }
  }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  showSaveMessage();
  const lines = parseLrc(content);
  currentParsedLrcLines = lines;
  enableSync = true;
  isTimingMode = false;
  timeEditControls.style.display = 'none';
  renderLyrics(lines);
  syncScroll();
  if (editLrcTimingBtn) editLrcTimingBtn.style.display = '';
}

markTimeBtn.addEventListener('click', () => {
  if (!isTimingMode) return;
  if (currentEditPos === -1) {
    currentEditPos = 0;
    backOneLineBtn.disabled = false;
    const lineIndex = editableLineIndexes[0];
    const ms = Math.max(0, Math.floor(audio.currentTime * 1000) - 300);
    timingMsByLineIndex[lineIndex] = ms;
    setLineTimeDisplay(lineIndex, ms);
    setCurrentEditHighlight();
    return;
  }
  if (currentEditPos >= editableLineIndexes.length) return;
  const ms = Math.max(0, Math.floor(audio.currentTime * 1000) - 300);
  const isLastLine = (currentEditPos === editableLineIndexes.length - 1);
  if (isLastLine) {
    const lineIndex = editableLineIndexes[currentEditPos];
    timingMsByLineIndex[lineIndex] = ms;
    setLineTimeDisplay(lineIndex, ms);
    currentEditPos++;
    const linesEls = lyricsInner.querySelectorAll('.lyrics-line');
    linesEls.forEach(el => el.classList.remove('editing-current'));
    markTimeBtn.disabled = true;
  } else {
    currentEditPos++;
    const lineIndex = editableLineIndexes[currentEditPos];
    timingMsByLineIndex[lineIndex] = ms;
    setLineTimeDisplay(lineIndex, ms);
    setCurrentEditHighlight();
  }
});

document.getElementById('saveLrc').addEventListener('click', () => saveLrcToFile());

editLrcTimingBtn.addEventListener('click', () => startLrcTimeEdit());

backOneLineBtn.addEventListener('click', () => {
  if (!isTimingMode) return;
  if (currentEditPos === -1) return;
  if (currentEditPos >= editableLineIndexes.length) {
    currentEditPos = editableLineIndexes.length - 1;
    const lineIndex = editableLineIndexes[currentEditPos];
    timingMsByLineIndex[lineIndex] = null;
    setLineTimeDisplay(lineIndex, null);
    setCurrentEditHighlight();
    markTimeBtn.disabled = false;
    return;
  }
  const lineIndexToClear = editableLineIndexes[currentEditPos];
  timingMsByLineIndex[lineIndexToClear] = null;
  setLineTimeDisplay(lineIndexToClear, null);
  currentEditPos--;
  if (currentEditPos === -1) {
    const linesEls = lyricsInner.querySelectorAll('.lyrics-line');
    linesEls.forEach(el => el.classList.remove('editing-current'));
    backOneLineBtn.disabled = true;
  } else {
    setCurrentEditHighlight();
  }
});
