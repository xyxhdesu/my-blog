(() => {
  const app = document.getElementById('pomodoro-app');
  if (!app) return;

  const recordsKey = 'blog-pomodoro-records:v1';
  const settingsKey = 'blog-pomodoro-settings:v1';
  const cycleKey = 'blog-pomodoro-cycle:v1';
  const modes = {
    focus: { label: '专注', setting: 'focus' },
    shortBreak: { label: '短休息', setting: 'shortBreak' },
    longBreak: { label: '长休息', setting: 'longBreak' },
  };

  const defaultSettings = {
    focus: Number(app.dataset.focusDuration) || 25,
    shortBreak: Number(app.dataset.shortBreakDuration) || 5,
    longBreak: Number(app.dataset.longBreakDuration) || 15,
    longBreakInterval: Number(app.dataset.longBreakInterval) || 4,
    sound: true,
  };

  const timeDisplay = app.querySelector('[data-pomodoro-time]');
  const statusDisplay = app.querySelector('[data-pomodoro-status]');
  const dial = app.querySelector('[data-pomodoro-dial]');
  const taskInput = app.querySelector('[data-pomodoro-task]');
  const startButton = app.querySelector('[data-pomodoro-start]');
  const resetButton = app.querySelector('[data-pomodoro-reset]');
  const skipButton = app.querySelector('[data-pomodoro-skip]');
  const completeButton = app.querySelector('[data-pomodoro-complete]');
  const modeButtons = [...app.querySelectorAll('[data-pomodoro-mode]')];
  const settingInputs = [...app.querySelectorAll('[data-pomodoro-setting]')];
  const soundInput = app.querySelector('[data-pomodoro-sound]');
  const recordsContainer = app.querySelector('[data-pomodoro-records]');
  const exportButton = app.querySelector('[data-pomodoro-export]');
  const clearButton = app.querySelector('[data-pomodoro-clear]');
  const originalTitle = document.title;

  let settings = loadSettings();
  let records = loadRecords();
  let completedFocusCount = loadCycleCount();
  let mode = 'focus';
  let totalSeconds = settings.focus * 60;
  let remainingSeconds = totalSeconds;
  let startedAt = null;
  let targetAt = 0;
  let timerId = 0;
  let isRunning = false;

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      return {
        ...defaultSettings,
        ...stored,
        focus: clampMinutes(stored.focus, 1, 180, defaultSettings.focus),
        shortBreak: clampMinutes(stored.shortBreak, 1, 60, defaultSettings.shortBreak),
        longBreak: clampMinutes(stored.longBreak, 1, 90, defaultSettings.longBreak),
        sound: stored.sound === undefined ? defaultSettings.sound : Boolean(stored.sound),
      };
    } catch {
      return { ...defaultSettings };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch (error) {
      console.warn('Pomodoro settings could not be saved', error);
    }
  }

  function loadRecords() {
    try {
      const saved = JSON.parse(localStorage.getItem(recordsKey) || '[]');
      return Array.isArray(saved)
        ? saved.filter((record) => record && record.id && record.startedAt && record.endedAt)
        : [];
    } catch {
      return [];
    }
  }

  function loadCycleCount() {
    try {
      return Number(sessionStorage.getItem(cycleKey)) || 0;
    } catch {
      return 0;
    }
  }

  function saveRecords() {
    try {
      localStorage.setItem(recordsKey, JSON.stringify(records.slice(0, 300)));
    } catch (error) {
      console.warn('Pomodoro records could not be saved', error);
    }
  }

  function clampMinutes(value, min, max, fallback) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatTimer(seconds) {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    return `${pad(minutes)}:${pad(safeSeconds % 60)}`;
  }

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function weekStart(date = new Date()) {
    const start = new Date(date);
    const day = start.getDay() || 7;
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - day + 1);
    return start;
  }

  function renderTimer(message) {
    const elapsed = totalSeconds - remainingSeconds;
    const progress = totalSeconds > 0 ? Math.min(1, Math.max(0, elapsed / totalSeconds)) : 0;
    timeDisplay.textContent = formatTimer(remainingSeconds);
    statusDisplay.textContent = message || (isRunning ? `${modes[mode].label}中` : `${modes[mode].label}待开始`);
    dial.style.setProperty('--progress', progress.toFixed(4));
    startButton.textContent = isRunning ? '暂停' : '开始';
    completeButton.disabled = mode !== 'focus' || (!isRunning && !startedAt && remainingSeconds === totalSeconds);
    document.title = isRunning ? `${formatTimer(remainingSeconds)} · ${modes[mode].label}` : originalTitle;

    modeButtons.forEach((button) => {
      const active = button.dataset.pomodoroMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  function switchMode(nextMode, message) {
    stopTimer();
    mode = nextMode;
    totalSeconds = settings[modes[mode].setting] * 60;
    remainingSeconds = totalSeconds;
    startedAt = null;
    renderTimer(message);
  }

  function stopTimer() {
    window.clearInterval(timerId);
    timerId = 0;
    isRunning = false;
    document.title = originalTitle;
  }

  function startTimer() {
    if (isRunning) {
      remainingSeconds = Math.max(0, Math.ceil((targetAt - Date.now()) / 1000));
      stopTimer();
      renderTimer('已暂停');
      return;
    }

    if (!startedAt) startedAt = new Date().toISOString();
    isRunning = true;
    targetAt = Date.now() + remainingSeconds * 1000;
    timerId = window.setInterval(tick, 250);
    renderTimer();
  }

  function tick() {
    remainingSeconds = Math.max(0, Math.ceil((targetAt - Date.now()) / 1000));
    renderTimer();
    if (remainingSeconds === 0) finishSession(false);
  }

  function finishSession(finishedEarly) {
    const completedMode = mode;
    const completedTotal = totalSeconds;
    const elapsedSeconds = finishedEarly ? Math.max(60, totalSeconds - remainingSeconds) : completedTotal;
    const started = startedAt || new Date(Date.now() - elapsedSeconds * 1000).toISOString();
    const ended = new Date().toISOString();
    stopTimer();

    if (completedMode === 'focus') {
      const minutes = Math.max(1, Math.round(elapsedSeconds / 60));
      records.unshift({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        task: taskInput.value.trim() || '未命名专注',
        minutes,
        startedAt: started,
        endedAt: ended,
        date: dateKey(new Date(ended)),
      });
      records = records.slice(0, 300);
      saveRecords();
      renderRecords();
      renderStats();
      completedFocusCount += 1;
      try {
        sessionStorage.setItem(cycleKey, String(completedFocusCount));
      } catch {
        // The timer still works when session storage is unavailable.
      }

      const nextMode = completedFocusCount % settings.longBreakInterval === 0 ? 'longBreak' : 'shortBreak';
      playDoneSound();
      switchMode(nextMode, `已记录 ${minutes} 分钟，进入${modes[nextMode].label}`);
      return;
    }

    playDoneSound();
    switchMode('focus', '休息结束，准备下一轮专注');
  }

  function resetTimer() {
    switchMode(mode, '已重置');
  }

  function skipTimer() {
    const nextMode = mode === 'focus' ? 'shortBreak' : 'focus';
    switchMode(nextMode, `已切换到${modes[nextMode].label}`);
  }

  function playDoneSound() {
    if (!settings.sound) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55);
      gain.connect(context.destination);
      [660, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(context.currentTime + index * 0.14);
        oscillator.stop(context.currentTime + 0.5 + index * 0.14);
      });
      window.setTimeout(() => context.close(), 900);
    } catch (error) {
      console.warn('Pomodoro sound could not be played', error);
    }
  }

  function renderStats() {
    const today = dateKey();
    const weekStartTime = weekStart().getTime();
    const todayRecords = records.filter((record) => record.date === today);
    const weekRecords = records.filter((record) => new Date(record.startedAt).getTime() >= weekStartTime);
    const uniqueDates = [...new Set(records.map((record) => record.date))].sort().reverse();
    let streak = 0;
    let cursor = new Date();

    while (uniqueDates.includes(dateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    setStat('todayCount', todayRecords.length);
    setStat('todayMinutes', sumMinutes(todayRecords));
    setStat('weekMinutes', sumMinutes(weekRecords));
    setStat('streak', streak);
  }

  function setStat(name, value) {
    const element = app.querySelector(`[data-pomodoro-stat="${name}"]`);
    if (element) element.textContent = String(value);
  }

  function sumMinutes(items) {
    return items.reduce((total, record) => total + (Number(record.minutes) || 0), 0);
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  }

  function renderRecords() {
    recordsContainer.replaceChildren();

    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'pomodoro-empty';
      empty.textContent = '还没有记录。完成一轮专注后，这里会自动留下时间。';
      recordsContainer.append(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'pomodoro-record-list';
    records.slice(0, 40).forEach((record) => {
      const item = document.createElement('article');
      item.className = 'pomodoro-record';

      const content = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = record.task || '未命名专注';
      const meta = document.createElement('span');
      meta.textContent = `${formatDateTime(record.startedAt)} · ${record.minutes} 分钟`;
      content.append(title, meta);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.pomodoroRemove = record.id;
      remove.setAttribute('aria-label', `删除记录：${record.task || '未命名专注'}`);
      remove.title = '删除记录';
      remove.textContent = '×';

      item.append(content, remove);
      list.append(item);
    });

    recordsContainer.append(list);
  }

  function exportCsv() {
    if (!records.length) return;
    const rows = [
      ['任务', '日期', '开始时间', '结束时间', '分钟'],
      ...records.map((record) => [
        record.task || '未命名专注',
        record.date,
        record.startedAt,
        record.endedAt,
        record.minutes,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pomodoro-records-${dateKey()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      switchMode(button.dataset.pomodoroMode, `已切换到${button.textContent.trim()}`);
    });
  });

  settingInputs.forEach((input) => {
    const key = input.dataset.pomodoroSetting;
    input.value = settings[key];
    input.addEventListener('change', () => {
      const max = key === 'focus' ? 180 : key === 'shortBreak' ? 60 : 90;
      settings[key] = clampMinutes(input.value, 1, max, defaultSettings[key]);
      input.value = settings[key];
      saveSettings();
      if (!isRunning && modes[mode].setting === key) {
        totalSeconds = settings[key] * 60;
        remainingSeconds = totalSeconds;
        renderTimer('设置已更新');
      }
    });
  });

  if (soundInput) {
    soundInput.checked = settings.sound;
    soundInput.addEventListener('change', () => {
      settings.sound = soundInput.checked;
      saveSettings();
    });
  }

  startButton.addEventListener('click', startTimer);
  resetButton.addEventListener('click', resetTimer);
  skipButton.addEventListener('click', skipTimer);
  completeButton.addEventListener('click', () => finishSession(true));
  exportButton.addEventListener('click', exportCsv);
  clearButton.addEventListener('click', () => {
    if (!records.length || !window.confirm('确定清空全部番茄钟记录吗？')) return;
    records = [];
    saveRecords();
    renderRecords();
    renderStats();
  });

  recordsContainer.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-pomodoro-remove]');
    if (!remove) return;
    records = records.filter((record) => record.id !== remove.dataset.pomodoroRemove);
    saveRecords();
    renderRecords();
    renderStats();
  });

  window.addEventListener('beforeunload', () => {
    if (isRunning) document.title = originalTitle;
  });

  renderTimer();
  renderRecords();
  renderStats();
})();
