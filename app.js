/**
 * Komorebi — Calm Focus & Ritual
 * Core Application Controller & Offline Engines
 */

'use strict';

/* ===================================================
   1. DATA STORE
   =================================================== */
const DB = {
  save(k, v) {
    try {
      localStorage.setItem('km_' + k, JSON.stringify(v));
    } catch (e) {}
  },
  load(k, def) {
    try {
      const s = localStorage.getItem('km_' + k);
      if (s) return JSON.parse(s);
      // Legacy migration from old keys
      const old = localStorage.getItem('fp_' + k);
      if (old) return JSON.parse(old);
      return def;
    } catch (e) {
      return def;
    }
  }
};

/* ===================================================
   2. PROCEDURAL GENERATIVE WEB AUDIO (100% Offline)
   =================================================== */
const AmbientAudio = {
  ctx: null,
  masterGain: null,
  activeSound: 'none',
  isPlaying: false,
  volume: 0.7,
  activeNodes: [],
  lfoTimer: null,

  getCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  },

  initMaster() {
    const ctx = this.getCtx();
    if (!ctx) return null;
    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      const savedVol = DB.load('ambient_vol', 0.7);
      this.volume = typeof savedVol === 'number' ? savedVol : 0.7;
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(ctx.destination);
    }
    return ctx;
  },

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, parseFloat(val)));
    DB.save('ambient_vol', this.volume);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  },

  stop() {
    this.isPlaying = false;
    if (this.lfoTimer) {
      clearInterval(this.lfoTimer);
      this.lfoTimer = null;
    }
    this.activeNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {}
    });
    this.activeNodes = [];
  },

  play(soundType) {
    if (soundType === 'none') {
      this.stop();
      this.activeSound = 'none';
      return;
    }
    const ctx = this.initMaster();
    if (!ctx) return;
    this.stop();
    this.activeSound = soundType;
    this.isPlaying = true;

    if (soundType === 'rain') {
      // Natural soothing rainfall with soft low-pass filter
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      const gain = ctx.createGain();
      gain.gain.value = 0.35;
      src.connect(lp);
      lp.connect(gain);
      gain.connect(this.masterGain);
      src.start();
      this.activeNodes.push(src, lp, gain);
    }
    else if (soundType === 'brown') {
      // Deep Brown Noise rumble
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0.0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + (0.02 * white)) / 1.02;
        last = data[i];
        data[i] *= 3.2;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      src.connect(lp);
      lp.connect(this.masterGain);
      src.start();
      this.activeNodes.push(src, lp);
    }
    else if (soundType === 'forest') {
      // Woodland breeze & distant singing birds
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 650;
      bp.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0.28;
      src.connect(bp);
      bp.connect(gain);
      gain.connect(this.masterGain);
      src.start();
      this.activeNodes.push(src, bp, gain);

      const chirp = () => {
        if (!this.isPlaying) return;
        const osc = ctx.createOscillator();
        const cGain = ctx.createGain();
        osc.type = 'sine';
        const now = ctx.currentTime;
        const baseF = 2600 + Math.random() * 800;
        osc.frequency.setValueAtTime(baseF, now);
        osc.frequency.exponentialRampToValueAtTime(baseF + 400, now + 0.08);
        osc.frequency.exponentialRampToValueAtTime(baseF - 200, now + 0.16);
        cGain.gain.setValueAtTime(0.0001, now);
        cGain.gain.linearRampToValueAtTime(0.02, now + 0.04);
        cGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.connect(cGain);
        cGain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.2);
        this.activeNodes.push(osc, cGain);
      };
      this.lfoTimer = setInterval(chirp, 3400);
    }
    else if (soundType === 'lofi') {
      // Warm Rhodes chord progression
      const chords = [
        [261.63, 329.63, 392.00, 493.88], // Cmaj7
        [220.00, 261.63, 329.63, 392.00], // Am7
        [174.61, 220.00, 261.63, 329.63], // Fmaj7
        [196.00, 246.94, 293.66, 392.00]  // G7
      ];
      let step = 0;
      const playChord = () => {
        if (!this.isPlaying) return;
        const freqs = chords[step % chords.length];
        step++;
        const now = ctx.currentTime;
        freqs.forEach(f => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const flt = ctx.createBiquadFilter();
          osc.type = 'triangle';
          osc.frequency.value = f;
          flt.type = 'lowpass';
          flt.frequency.value = 520;
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(0.018, now + 0.8);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.6);
          osc.connect(flt);
          flt.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 5.8);
          this.activeNodes.push(osc, gain, flt);
        });
      };
      playChord();
      this.lfoTimer = setInterval(playChord, 6000);
    }
    else if (soundType === 'komorebi') {
      // Japanese pentatonic wind chimes
      const scale = [293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99];
      const playChime = () => {
        if (!this.isPlaying) return;
        const freq = scale[Math.floor(Math.random() * scale.length)];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.022, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 2.8);
        this.activeNodes.push(osc, gain);
      };
      playChime();
      this.lfoTimer = setInterval(playChime, 1800);
    }
  }
};

function playCompletionChime() {
  const settings = DB.load('settings', { chime: true });
  if (settings.chime === false) return;
  const ctx = AmbientAudio.getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50]; // Crystal C major arpeggio
  notes.forEach((f, i) => {
    const delay = i * 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.linearRampToValueAtTime(0.12 / (i + 1), now + delay + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.65);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 0.7);
  });
}

/* ===================================================
   3. MAIN APPLICATION CONTROLLER
   =================================================== */
const App = {
  currentScreen: 's-focus',
  timerMode: 'focus', // 'focus' | 'break' | 'long_break'
  timerRunning: false,
  timerDurationSecs: 25 * 60,
  timerRemainingSecs: 25 * 60,
  targetEndTime: 0,
  sessionStartTime: 0,
  tickInterval: null,
  wakeLock: null,

  activeTask: null, // { id, title }
  newTaskPrio: 'normal',
  showCompletedTasks: false,

  settings: {
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
    chime: true,
    push: false,
    petEnabled: true,
    petSize: 'normal',
    darkMode: false,
  },

  /* --- INITIALIZATION --- */
  init() {
    // Load Settings
    this.settings = Object.assign(this.settings, DB.load('settings', {}));
    this.syncSettingsUI();
    if (this.settings.darkMode) document.body.classList.add('dark-mode');
    this.syncThemeIcon();

    // Load active intent
    this.activeTask = DB.load('active_intent', null);
    this.updateIntentUI();

    // Set Header Date & Greeting
    this.updateHeaderGreeting();

    // Render today's queue & progress
    this.renderQueue();
    this.renderProgress();

    // Restore or initialize timer
    this.restoreTimerState();

    // Handle visibility change (Drift-free timer refresh)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.timerRunning) {
        this.clockTick();
      }
    });

    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').then(reg => {
        reg.update();
      }).catch(() => {});
    }
  },

  /* --- HEADER & GREETING --- */
  updateHeaderGreeting() {
    const hr = new Date().getHours();
    let greet = 'Good morning';
    if (hr >= 12 && hr < 17) greet = 'Good afternoon';
    else if (hr >= 17) greet = 'Good evening';
    const hdrGreet = document.getElementById('hdr-greeting');
    if (hdrGreet) hdrGreet.textContent = greet;

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const hdrDate = document.getElementById('hdr-date');
    if (hdrDate) hdrDate.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
  },

  /* --- NAVIGATION --- */
  navigate(screenId, btnEl) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
      target.scrollTop = 0;
    }

    document.querySelectorAll('.dock-btn, .desktop-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`[data-screen="${screenId}"]`).forEach(b => b.classList.add('active'));

    this.currentScreen = screenId;
    if (screenId === 's-focus') {
      this.updateDialDisplay();
      this.renderQueue();
    } else if (screenId === 's-queue') {
      this.renderQueue();
    } else if (screenId === 's-progress') {
      this.renderProgress();
    }
  },

  /* --- FOCUS INTENT --- */
  toggleIntentEdit() {
    const box = document.getElementById('intent-input-box');
    const isEditing = box.classList.toggle('open');
    if (isEditing) {
      const f = document.getElementById('intent-field');
      f.value = this.activeTask ? this.activeTask.title : '';
      f.focus();
    }
  },
  saveIntentInline() {
    const val = document.getElementById('intent-field').value.trim();
    if (val) {
      this.setIntent({ id: 'custom-' + Date.now(), title: val });
    } else {
      this.setIntent(null);
    }
    document.getElementById('intent-input-box').classList.remove('open');
  },
  setIntent(taskObj) {
    this.activeTask = taskObj;
    DB.save('active_intent', taskObj);
    this.updateIntentUI();
    this.renderQueue();
  },
  updateIntentUI() {
    const txt = document.getElementById('intent-text');
    const btn = document.getElementById('intent-btn-edit');
    if (this.activeTask && this.activeTask.title) {
      if (txt) txt.textContent = this.activeTask.title;
      if (btn) btn.textContent = '✕';
      btn.onclick = (e) => {
        e.stopPropagation();
        this.setIntent(null);
      };
    } else {
      if (txt) txt.textContent = 'What are you focusing on?';
      if (btn) btn.textContent = '✎';
      btn.onclick = (e) => {
        e.stopPropagation();
        this.toggleIntentEdit();
      };
    }
  },

  /* --- TIMER ENGINE (Timestamp Delta & Drift-Free) --- */
  restoreTimerState() {
    const saved = DB.load('timer_state', null);
    if (saved) {
      this.timerMode = saved.mode || 'focus';
      this.timerDurationSecs = saved.duration || this.settings.focus * 60;
      if (saved.running && saved.targetEndTime && saved.targetEndTime > Date.now()) {
        this.targetEndTime = saved.targetEndTime;
        this.sessionStartTime = saved.sessionStart || Date.now();
        this.timerRemainingSecs = Math.max(0, Math.ceil((this.targetEndTime - Date.now()) / 1000));
        this.timerRunning = true;
        this.startTimerTicks();
        this.updateDialDisplay();
        return;
      } else {
        this.timerRemainingSecs = saved.remaining || this.timerDurationSecs;
      }
    } else {
      this.timerDurationSecs = this.settings.focus * 60;
      this.timerRemainingSecs = this.timerDurationSecs;
    }
    this.updateDialDisplay();
  },

  saveTimerState() {
    DB.save('timer_state', {
      running: this.timerRunning,
      mode: this.timerMode,
      duration: this.timerDurationSecs,
      remaining: this.timerRemainingSecs,
      targetEndTime: this.targetEndTime,
      sessionStart: this.sessionStartTime
    });
  },

  openPresetModal() {
    if (this.timerRunning) return;
    const currentM = Math.round(this.timerDurationSecs / 60);
    const presets = [15, 25, 45, 60];
    const nextIdx = (presets.indexOf(currentM) + 1) % presets.length;
    const nextVal = presets[nextIdx] || 25;
    this.setTimerDuration(nextVal);
    showToast(`Timer set to ${nextVal}m`);
  },

  setTimerDuration(mins) {
    if (this.timerRunning) return;
    this.timerMode = 'focus';
    this.timerDurationSecs = mins * 60;
    this.timerRemainingSecs = this.timerDurationSecs;
    this.saveTimerState();
    this.updateDialDisplay();
    // Update chip active states
    document.querySelectorAll('.preset-chip').forEach(c => {
      c.classList.toggle('active', c.textContent.trim() === `${mins}m`);
    });
  },

  timerToggle() {
    if (this.timerRunning) {
      this.timerPause();
    } else {
      this.timerStart();
    }
  },

  timerStart() {
    if (this.timerRunning) return;
    this.timerRunning = true;
    this.targetEndTime = Date.now() + (this.timerRemainingSecs * 1000);
    this.sessionStartTime = this.sessionStartTime || Date.now();
    this.saveTimerState();

    // Start background keeper & request WakeLock
    this.acquireWakeLock();
    const keeper = document.getElementById('timer-media-keeper');
    if (keeper) keeper.play().catch(() => {});

    // React with Maomao companion
    if (window._maomao && this.settings.petEnabled !== false) {
      window._maomao.row = 6; // WAITING
      window._maomao._updateBadge('Focusing 🌿');
    }

    this.startTimerTicks();
    this.updateDialDisplay();
  },

  startTimerTicks() {
    clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => this.clockTick(), 500);
  },

  clockTick() {
    const remMs = this.targetEndTime - Date.now();
    this.timerRemainingSecs = Math.max(0, Math.ceil(remMs / 1000));
    this.updateDialDisplay();

    if (this.timerRemainingSecs <= 0) {
      this.timerComplete();
    }
  },

  timerPause() {
    this.timerRunning = false;
    clearInterval(this.tickInterval);
    this.releaseWakeLock();
    const keeper = document.getElementById('timer-media-keeper');
    if (keeper) keeper.pause();

    // Log elapsed if >= 1 min
    this.recordSessionElapsed();
    this.saveTimerState();

    if (window._maomao && this.settings.petEnabled !== false) {
      window._maomao.row = 6;
      window._maomao._updateBadge('Paused');
    }

    this.updateDialDisplay();
  },

  timerReset() {
    this.timerPause();
    this.timerRemainingSecs = this.timerDurationSecs;
    this.saveTimerState();
    this.updateDialDisplay();
  },

  timerSkip() {
    this.timerPause();
    if (this.timerMode === 'focus') {
      // Start short break
      this.timerMode = 'break';
      this.timerDurationSecs = this.settings.shortBreak * 60;
      this.timerRemainingSecs = this.timerDurationSecs;
      showToast('Break started ☕');
    } else {
      this.timerMode = 'focus';
      this.timerDurationSecs = this.settings.focus * 60;
      this.timerRemainingSecs = this.timerDurationSecs;
      showToast('Ready to focus 🎯');
    }
    this.saveTimerState();
    this.updateDialDisplay();
  },

  timerComplete() {
    this.timerPause();
    this.recordSessionElapsed();

    playCompletionChime();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);

    // Send push notification if enabled
    if (this.settings.push && Notification.permission === 'granted') {
      new Notification('Komorebi — Time is Up! 🌸', {
        body: this.activeTask ? `Great focus on: "${this.activeTask.title}"` : 'Your focus session is complete.',
        icon: 'icons/icon-192.png'
      });
    }

    // Companion reaction
    if (window._maomao && this.settings.petEnabled !== false) {
      window._maomao.row = 4; // JUMP / CELEBRATE
      window._maomao.frame = 0;
      window._maomao._updateBadge('Great job! 🌸');
      setTimeout(() => {
        if (window._maomao) {
          window._maomao.row = 6;
          window._maomao._updateBadge('Resting ☕');
        }
      }, 2200);
    }

    // Open calm completion modal
    const modal = document.getElementById('completion-modal');
    const compTask = document.getElementById('comp-task-name');
    if (compTask) compTask.textContent = this.activeTask ? this.activeTask.title : 'Focus Session';
    if (modal) modal.classList.add('open');
  },

  recordSessionElapsed() {
    if (!this.sessionStartTime) return;
    const elapsedMins = Math.floor((Date.now() - this.sessionStartTime) / 60000);
    if (elapsedMins >= 1 && this.timerMode === 'focus') {
      const history = DB.load('sessions', []);
      const today = this.getTodayIso();
      history.unshift({
        id: 'sess-' + Date.now(),
        date: today,
        minutes: elapsedMins,
        at: Date.now(),
        taskTitle: this.activeTask ? this.activeTask.title : 'Focus Session'
      });
      DB.save('sessions', history.slice(0, 500));
      this.renderProgress();
    }
    this.sessionStartTime = 0;
  },

  updateDialDisplay() {
    const disp = this.formatTime(this.timerRemainingSecs);
    const digits = document.getElementById('dial-digits');
    if (digits) digits.textContent = disp;

    const status = document.getElementById('dial-status');
    if (status) {
      if (!this.timerRunning) {
        status.textContent = this.timerMode === 'focus' ? 'Focus' : 'Break';
      } else {
        status.textContent = this.timerMode === 'focus' ? 'Focusing' : 'Resting';
      }
    }

    const playBtn = document.getElementById('btn-timer-main');
    const playIcon = document.getElementById('timer-btn-icon');
    const playLabel = document.getElementById('timer-btn-label');
    const dialOuter = document.getElementById('dial-outer-el');

    if (playBtn) {
      if (this.timerRunning) {
        if (playIcon) playIcon.textContent = '❚❚';
        if (playLabel) playLabel.textContent = 'PAUSE';
        if (dialOuter) dialOuter.classList.add('running');
      } else {
        if (playIcon) playIcon.textContent = '▶';
        if (playLabel) playLabel.textContent = this.timerMode === 'focus' ? 'START FOCUS' : 'START BREAK';
        if (dialOuter) dialOuter.classList.remove('running');
      }
    }

    // Update SVG Clockwise Countdown Ring
    const ring = document.getElementById('dial-ring-indicator');
    if (ring) {
      const r = 105;
      const C = 2 * Math.PI * r; // ~659.734
      ring.style.strokeDasharray = C;
      const total = this.timerDurationSecs || 1;
      const progress = Math.max(0, Math.min(1, this.timerRemainingSecs / total));
      // Ring depletes clockwise from 12 o'clock
      const offset = C * (1 - progress);
      ring.style.strokeDashoffset = offset;
    }

    // Document title update when tab is in background
    if (document.visibilityState === 'hidden' && this.timerRunning) {
      const task = this.activeTask ? this.activeTask.title : 'Focus';
      document.title = `(${disp}) ⏳ ${task} · Komorebi`;
    } else {
      document.title = 'Komorebi — Calm Focus & Ritual';
    }
  },

  formatTime(totalSecs) {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  getTodayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /* --- SCREEN WAKELOCK API --- */
  async acquireWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
  },
  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  },

  /* --- FULLSCREEN FOCUS IMMERSION --- */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        const lbl = document.getElementById('lbl-fullscreen');
        if (lbl) lbl.textContent = 'Exit Immersion';
      }).catch(() => showToast('Full Screen not supported'));
    } else {
      document.exitFullscreen();
      const lbl = document.getElementById('lbl-fullscreen');
      if (lbl) lbl.textContent = 'Focus Immersion';
    }
  },

  /* --- COMPLETION ACTIONS --- */
  finishAndCompleteTask() {
    document.getElementById('completion-modal').classList.remove('open');
    if (this.activeTask && this.activeTask.id && !this.activeTask.id.startsWith('custom-')) {
      this.toggleTask(this.activeTask.id, true);
    }
    this.setIntent(null);
    this.timerSkip();
  },
  takeBreakOnly() {
    document.getElementById('completion-modal').classList.remove('open');
    this.timerSkip();
  },
  continueFocusSession() {
    document.getElementById('completion-modal').classList.remove('open');
    this.timerDurationSecs = 5 * 60;
    this.timerRemainingSecs = 5 * 60;
    this.timerStart();
  },

  /* --- TASKS & FOCUS QUEUE CRUD --- */
  getTasks() {
    return DB.load('tasks', []);
  },
  saveTasks(list) {
    DB.save('tasks', list);
  },

  setNewTaskPrio(prio, btn) {
    this.newTaskPrio = prio;
    document.querySelectorAll('.prio-dot-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  },

  addTaskFromInput() {
    const input = document.getElementById('new-task-input');
    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }
    const timeVal = document.getElementById('new-task-time').value || null;

    const tasks = this.getTasks();
    const newTask = {
      id: 'task-' + Date.now(),
      title,
      priority: this.newTaskPrio || 'normal',
      time: timeVal,
      status: 'active',
      date: this.getTodayIso(),
      createdAt: Date.now()
    };
    tasks.unshift(newTask);
    this.saveTasks(tasks);

    input.value = '';
    // Automatically bind to focus intent if none active
    if (!this.activeTask) {
      this.setIntent({ id: newTask.id, title: newTask.title });
    }
    this.renderQueue();
    showToast('Task added to Queue');
  },

  toggleTask(id, forceDone = false) {
    const tasks = this.getTasks();
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    t.status = forceDone ? 'done' : (t.status === 'done' ? 'active' : 'done');
    if (t.status === 'done') {
      t.completedAt = Date.now();
      showToast('Task completed! ✓');
      if (this.activeTask && this.activeTask.id === id) {
        this.setIntent(null);
      }
      if (window._maomao && this.settings.petEnabled !== false) {
        window._maomao.row = 4; // JUMP
        window._maomao.frame = 0;
        window._maomao._updateBadge('Nice! 🌸');
        setTimeout(() => {
          if (window._maomao) {
            window._maomao.row = 6;
            window._maomao._updateBadge('Waiting');
          }
        }, 1800);
      }
    }
    this.saveTasks(tasks);
    this.renderQueue();
    this.renderProgress();
  },

  deleteTask(id) {
    const tasks = this.getTasks().filter(x => x.id !== id);
    this.saveTasks(tasks);
    if (this.activeTask && this.activeTask.id === id) {
      this.setIntent(null);
    }
    this.renderQueue();
  },

  focusTaskNow(id) {
    const tasks = this.getTasks();
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    this.setIntent({ id: t.id, title: t.title });
    this.navigate('s-focus');
    showToast(`Focused on: ${t.title}`);
  },

  renderQueue() {
    const tasks = this.getTasks();
    const activeList = tasks.filter(t => t.status !== 'done');
    const doneList = tasks.filter(t => t.status === 'done');

    // 1. Home Mini-Queue (Top 3 active)
    const homeListEl = document.getElementById('home-queue-list');
    if (homeListEl) {
      if (activeList.length === 0) {
        homeListEl.innerHTML = `<div style="text-align:center;padding:12px;font-size:13px;color:var(--text-3);">No tasks today. Tap to add what you're working on.</div>`;
      } else {
        homeListEl.innerHTML = activeList.slice(0, 3).map((t, idx) => {
          const isCurrent = this.activeTask && this.activeTask.id === t.id;
          return `
            <div class="queue-item ${isCurrent ? 'active-intent' : ''}">
              <div class="queue-item-left">
                <span class="queue-idx">${idx + 1}.</span>
                <span class="queue-text">${esc(t.title)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                ${!isCurrent ? `<button class="btn-focus-now" onclick="App.focusTaskNow('${t.id}')">Focus</button>` : `<span style="font-size:11px;font-weight:800;color:var(--accent);">ACTIVE</span>`}
                <div class="queue-check" onclick="App.toggleTask('${t.id}')">✓</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Full Queue Screen List
    const fullListEl = document.getElementById('full-queue-list');
    const countBadge = document.getElementById('queue-count-badge');
    if (countBadge) countBadge.textContent = `${activeList.length} task${activeList.length === 1 ? '' : 's'}`;

    if (fullListEl) {
      if (activeList.length === 0) {
        fullListEl.innerHTML = `
          <div style="text-align:center;padding:40px 20px;color:var(--text-3);">
            <div style="font-size:32px;margin-bottom:8px;">☕</div>
            <div style="font-size:14px;font-weight:600;">Queue is all clear.</div>
            <p style="font-size:12px;margin-top:4px;">Add a task above to choose your next focus.</p>
          </div>
        `;
      } else {
        fullListEl.innerHTML = activeList.map((t, idx) => {
          const isCurrent = this.activeTask && this.activeTask.id === t.id;
          return `
            <div class="full-queue-item ${isCurrent ? 'active-intent' : ''}">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                <span class="queue-idx">${idx + 1}</span>
                <div class="queue-check" onclick="App.toggleTask('${t.id}')"></div>
                <div style="min-width:0;">
                  <div class="queue-text">${esc(t.title)}</div>
                  <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-3);margin-top:2px;">
                    ${t.priority === 'high' ? `<span style="color:var(--accent);font-weight:700;">High Priority</span>` : ''}
                    ${t.time ? `<span>⏰ ${t.time}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="task-actions">
                ${!isCurrent ? `<button class="btn-focus-now" onclick="App.focusTaskNow('${t.id}')">Focus</button>` : `<span style="font-size:11px;font-weight:800;color:var(--accent);padding:0 6px;">ACTIVE</span>`}
                <button class="btn-task-del" onclick="App.deleteTask('${t.id}')">✕</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 3. Completed Accordion
    const doneCountVal = document.getElementById('done-count-val');
    if (doneCountVal) doneCountVal.textContent = doneList.length;
    const completedListEl = document.getElementById('completed-queue-list');
    if (completedListEl) {
      completedListEl.innerHTML = doneList.map(t => `
        <div class="queue-item done">
          <div class="queue-item-left">
            <span class="queue-text">${esc(t.title)}</span>
          </div>
          <button class="btn-task-del" onclick="App.deleteTask('${t.id}')">✕</button>
        </div>
      `).join('');
    }
  },

  toggleCompletedList() {
    this.showCompletedTasks = !this.showCompletedTasks;
    const el = document.getElementById('completed-queue-list');
    const arr = document.getElementById('comp-toggle-arrow');
    if (el) el.style.display = this.showCompletedTasks ? 'block' : 'none';
    if (arr) arr.textContent = this.showCompletedTasks ? '▴' : '▾';
  },

  /* --- CALM ANALYTICS & PROGRESS --- */
  renderProgress() {
    const history = DB.load('sessions', []);
    const tasks = this.getTasks();
    const today = this.getTodayIso();

    // Today calculations
    const todaySessions = history.filter(s => s.date === today);
    const todayMins = todaySessions.reduce((acc, s) => acc + (s.minutes || 0), 0);
    const todayTasksDone = tasks.filter(t => t.status === 'done').length;

    // Home summary
    const homeSum = document.getElementById('home-progress-summary');
    if (homeSum) {
      homeSum.textContent = `${todayMins}m focused today · ${todaySessions.length} session${todaySessions.length === 1 ? '' : 's'}`;
    }

    // Stats Grid
    const stTime = document.getElementById('stat-today-time');
    if (stTime) {
      stTime.textContent = todayMins >= 60 ? `${Math.floor(todayMins / 60)}h ${todayMins % 60}m` : `${todayMins}m`;
    }

    const stSess = document.getElementById('stat-today-sessions');
    if (stSess) stSess.textContent = todaySessions.length;

    const stDone = document.getElementById('stat-today-tasks');
    if (stDone) stDone.textContent = todayTasksDone;

    // 7-Day Chart (Monday to Sunday)
    const chartBars = document.getElementById('week-chart-bars');
    if (chartBars) {
      const now = new Date();
      const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Mon, 6 = Sun
      const monday = new Date(now);
      monday.setDate(now.getDate() - dayOfWeek);

      const daysData = [];
      let maxMins = 30; // base visual minimum scale
      let weekTotalMins = 0;

      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const daySess = history.filter(s => s.date === iso);
        const mins = daySess.reduce((acc, s) => acc + (s.minutes || 0), 0);
        weekTotalMins += mins;
        if (mins > maxMins) maxMins = mins;
        daysData.push({
          label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
          mins,
          isToday: iso === today
        });
      }

      const weekTotEl = document.getElementById('chart-week-total');
      if (weekTotEl) {
        weekTotEl.textContent = weekTotalMins >= 60 ? `${Math.floor(weekTotalMins / 60)}h ${weekTotalMins % 60}m` : `${weekTotalMins}m`;
      }

      chartBars.innerHTML = daysData.map(d => {
        const pct = Math.max(4, Math.round((d.mins / maxMins) * 100));
        return `
          <div class="bar-col ${d.isToday ? 'today' : ''}" title="${d.label}: ${d.mins}m">
            <div class="bar-pill" style="height: ${pct}%;"></div>
            <span class="bar-lbl">${d.label}</span>
          </div>
        `;
      }).join('');
    }
  },

  /* --- AMBIENT SOUND SHEET --- */
  openSoundSheet() {
    const m = document.getElementById('sound-sheet-modal');
    if (m) m.classList.add('open');
  },
  closeSoundSheet() {
    const m = document.getElementById('sound-sheet-modal');
    if (m) m.classList.remove('open');
  },
  selectAmbientSound(key, name, icon) {
    AmbientAudio.play(key);
    document.querySelectorAll('.sound-card').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-sound') === key);
    });
    document.querySelectorAll('.ambient-mini-chip').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-sound') === key);
    });
    const statusEl = document.getElementById('desk-sound-status');
    if (statusEl) {
      statusEl.textContent = key === 'none' ? 'Silence' : `Playing ${name}`;
    }
    const hdrIcon = document.getElementById('hdr-sound-icon');
    const hdrName = document.getElementById('hdr-sound-name');
    if (hdrIcon) hdrIcon.textContent = icon;
    if (hdrName) hdrName.textContent = name;
    showToast(`Ambient Sound: ${name}`);
  },
  setAmbientVolume(v) {
    AmbientAudio.setVolume(v);
  },

  /* --- SETTINGS HANDLERS --- */
  syncSettingsUI() {
    const fVal = document.getElementById('set-val-focus');
    if (fVal) fVal.textContent = `${this.settings.focus}m`;
    const sVal = document.getElementById('set-val-short');
    if (sVal) sVal.textContent = `${this.settings.shortBreak}m`;
    const lVal = document.getElementById('set-val-long');
    if (lVal) lVal.textContent = `${this.settings.longBreak}m`;

    const chimeToggle = document.getElementById('set-sound-chime');
    if (chimeToggle) chimeToggle.checked = this.settings.chime !== false;

    const pushToggle = document.getElementById('set-push-toggle');
    if (pushToggle) pushToggle.checked = !!this.settings.push;

    const petToggle = document.getElementById('set-pet-toggle');
    if (petToggle) petToggle.checked = this.settings.petEnabled !== false;

    const petSize = document.getElementById('set-pet-size');
    if (petSize) petSize.value = this.settings.petSize || 'normal';

    const themeToggle = document.getElementById('set-theme-toggle');
    if (themeToggle) themeToggle.checked = !!this.settings.darkMode;
  },

  adjustSetting(key, delta) {
    if (key === 'focus') this.settings.focus = Math.max(5, Math.min(120, this.settings.focus + delta));
    if (key === 'shortBreak') this.settings.shortBreak = Math.max(1, Math.min(30, this.settings.shortBreak + delta));
    if (key === 'longBreak') this.settings.longBreak = Math.max(5, Math.min(60, this.settings.longBreak + delta));
    DB.save('settings', this.settings);
    this.syncSettingsUI();
  },

  toggleChime(val) {
    this.settings.chime = val;
    DB.save('settings', this.settings);
  },

  togglePush(val) {
    this.settings.push = val;
    DB.save('settings', this.settings);
    if (val && 'Notification' in window) {
      Notification.requestPermission().then(p => {
        if (p !== 'granted') showToast('Notification permission not granted');
      });
    }
  },

  togglePet(val) {
    this.settings.petEnabled = val;
    DB.save('settings', this.settings);
    document.body.classList.toggle('pet-disabled', !val);
    if (window._maomao && typeof window._maomao.applySettings === 'function') {
      window._maomao.applySettings({ enabled: val });
    }
  },

  setPetSize(val) {
    this.settings.petSize = val;
    DB.save('settings', this.settings);
    if (window._maomao && typeof window._maomao.applySettings === 'function') {
      window._maomao.applySettings({ size: val });
    }
  },

  toggleTheme(val) {
    this.settings.darkMode = val;
    DB.save('settings', this.settings);
    document.body.classList.toggle('dark-mode', val);
    this.syncThemeIcon();
    this.syncSettingsUI();
  },

  syncThemeIcon() {
    const btn = document.getElementById('hdr-theme-btn');
    if (!btn) return;
    if (this.settings.darkMode) {
      btn.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
      btn.title = 'Switch to Light Mode';
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
      btn.title = 'Switch to Dark Mode';
    }
  },

  clearData() {
    if (!confirm('Are you sure you want to reset all tasks, history, and settings?')) return;
    localStorage.clear();
    location.reload();
  }
};

/* ===================================================
   4. HELPERS & GLOBAL EVENTS
   =================================================== */
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// Modal overlay dismissal on background click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// Boot app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
