/**
 * PERSONAL DIALER & CLIENT CONTACT MANAGEMENT
 * High-Velocity Cockpit Engine - Production Edition
 * Designed for Rugged Hardware Flip Phones (CAT S22 Flip / 2.8" Displays)
 *
 * Deterministic Keypad Finite State Machine (FSM):
 *  - CONTEXT_LIST:     [1] Call | [2] Email | [3] SMS | [4] Logs | [5/*] Search/T9 | [6] Setup | [7] Fresh | [8] Due | [9] Spoken | [0] Top/Undo | [#] CSV | [Enter] Cockpit
 *  - CONTEXT_COCKPIT:  [1] Call | [2] Email | [3] SMS | [4] No Answer | [5] Call Back | [6] Contacted | [7] DNC | [8] Notes | [*] Prompter | [0] Back
 *  - CONTEXT_CALLBACK: [1] 2h | [2] 4h | [3] 24h | [4] 48h | [5] 168h | [0] Cancel
 *  - CONTEXT_COMM:     [1] Native App | [2] Web Gmail | [3] Log Sent | [0] Cancel
 */

(() => {
  'use strict';

  // --- 1. DEFAULT DATA & TEMPLATES ---
  const DEFAULT_TEMPLATES = {
    hospitality_demo: {
      id: 'hospitality_demo',
      type: 'email',
      title: 'Interactive Demonstration Follow-Up',
      subject: 'Interactive training demonstration | {company}',
      body: 'Hello again [First Name],\n\nThank you again for your time today. It was a real pleasure speaking with you.\n\nAs discussed, I’ve included a link to our interactive demonstration app so you can explore the training resource for yourself:\n\n**Try the demonstration here:**  \nhttps://tileworksgamesstudio.github.io/86/\n\nTileworks Studio develops engaging, puzzle-based training activities designed to help hospitality staff build their knowledge in an enjoyable and memorable way. By helping your team develop greater confidence and consistency, these resources can support a higher standard of customer service and strengthen your brand’s reputation.\n\nI’d love to hear what you think of the demonstration. If you feel this could be a valuable addition to your team’s training, we could arrange a brief follow-up call to answer any questions and learn more about your current training resources and needs.\n\nSpeak soon,\n\nChristian J.  \nFounder, Tileworks Studio'
    },
    quick_sms: {
      id: 'quick_sms',
      type: 'sms',
      title: 'Quick SMS Follow-Up',
      subject: 'SMS',
      body: 'Hello again [First Name]! Following up from Tileworks Studio regarding our interactive hospitality training demo for {company}: https://tileworksgamesstudio.github.io/86/'
    }
  };

  // --- 2. TIMEZONE & E.164 AREA CODE MATRIX ---
  const US_CA_AREA_CODES = {
    '201':'America/New_York','202':'America/New_York','203':'America/New_York','212':'America/New_York','215':'America/New_York',
    '216':'America/New_York','305':'America/New_York','315':'America/New_York','330':'America/New_York','404':'America/New_York',
    '412':'America/New_York','416':'America/Toronto','514':'America/Toronto','617':'America/New_York','704':'America/New_York',
    '718':'America/New_York','917':'America/New_York',
    '214':'America/Chicago','312':'America/Chicago','314':'America/Chicago','414':'America/Chicago','504':'America/Chicago',
    '512':'America/Chicago','612':'America/Chicago','713':'America/Chicago','816':'America/Chicago','832':'America/Chicago','901':'America/Chicago',
    '303':'America/Denver','385':'America/Denver','406':'America/Denver','480':'America/Phoenix','505':'America/Denver',
    '520':'America/Phoenix','602':'America/Phoenix','623':'America/Phoenix','719':'America/Denver','801':'America/Denver','970':'America/Denver',
    '206':'America/Los_Angeles','209':'America/Los_Angeles','213':'America/Los_Angeles','250':'America/Vancouver','310':'America/Los_Angeles',
    '408':'America/Los_Angeles','415':'America/Los_Angeles','503':'America/Los_Angeles','530':'America/Los_Angeles','559':'America/Los_Angeles',
    '604':'America/Vancouver','619':'America/Los_Angeles','626':'America/Los_Angeles','702':'America/Los_Angeles','714':'America/Los_Angeles',
    '818':'America/Los_Angeles','858':'America/Los_Angeles','916':'America/Los_Angeles','925':'America/Los_Angeles','949':'America/Los_Angeles','971':'America/Los_Angeles'
  };

  // --- 3. HARDWARE AUDIO & HAPTIC SYNTHESIZER ---
  class HardwareFeedbackEngine {
    constructor() {
      this.ctx = null;
    }

    init() {
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    trigger(type = 'click') {
      const mode = state.settings.feedbackMode || 'all';

      // Haptics
      if (navigator.vibrate && (mode === 'all' || mode === 'vibrate')) {
        if (type === 'click') navigator.vibrate(12);
        else if (type === 'success') navigator.vibrate([18, 30, 25]);
        else if (type === 'alert') navigator.vibrate([40, 40, 40]);
      }

      // Audio Synthesis
      if (mode === 'all' || mode === 'sound') {
        try {
          this.init();
          if (!this.ctx) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.connect(gain);
          gain.connect(this.ctx.destination);

          const now = this.ctx.currentTime;
          if (type === 'click') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(650, now);
            osc.frequency.exponentialRampToValueAtTime(180, now + 0.03);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.03);
            osc.start(now);
            osc.stop(now + 0.03);
          } else if (type === 'success') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.05);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
          } else if (type === 'alert') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.linearRampToValueAtTime(90, now + 0.15);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
          }
        } catch (e) {
          // Audio errors safely swallowed
        }
      }
    }
  }

  const feedback = new HardwareFeedbackEngine();

  // --- 4. RESILIENT WAKELOCK SENTINEL ---
  let wakeLockInstance = null;
  async function requestScreenWakeLock() {
    if (!('wakeLock' in navigator) || !state.settings.enableWakeLock) return;
    try {
      if (!wakeLockInstance) {
        wakeLockInstance = await navigator.wakeLock.request('screen');
        wakeLockInstance.addEventListener('release', () => { wakeLockInstance = null; });
      }
    } catch (e) {}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestScreenWakeLock();
      checkActiveCallElapsed();
    }
  });

  // --- 5. INDEXEDDB TRANSACTIONAL LAYER (DAL) ---
  const DB_NAME = 'FlipDiallerDB_v4';
  const DB_VERSION = 4;
  let dbInstance = null;

  function initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('contacts')) {
          const cStore = db.createObjectStore('contacts', { keyPath: 'id' });
          cStore.createIndex('company', 'company', { unique: false });
          cStore.createIndex('phone', 'phone', { unique: false });
          cStore.createIndex('email', 'email', { unique: false });
          cStore.createIndex('stage', 'stage', { unique: false });
          cStore.createIndex('next_callback_at', 'next_callback_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('interactions')) {
          const iStore = db.createObjectStore('interactions', { keyPath: 'id', autoIncrement: true });
          iStore.createIndex('contact_id', 'contact_id', { unique: false });
          iStore.createIndex('action', 'action', { unique: false });
          iStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function getStore(storeName, mode = 'readonly') {
    return dbInstance.transaction(storeName, mode).objectStore(storeName);
  }

  // --- 6. STATE CONTAINER ---
  const state = {
    contacts: [],
    filteredContacts: [],
    currentContactIndex: -1,
    activeQueue: 'uncontacted',
    searchQuery: '',
    focusedCardIndex: 0,
    activeScreenId: 'screenContacts',
    emailTemplates: { ...DEFAULT_TEMPLATES },
    activeTemplateId: 'hospitality_demo',
    pendingCallbackContact: null,
    activeCallSession: null,
    historyFilterAction: 'all',
    historyQuery: '',
    undoQueue: null,
    powerDialTimer: null,
    powerDialCountdown: 3,
    t9Buffer: '',
    t9Timeout: null,
    settings: {
      dailyCallTarget: 10,
      textDensity: 'density-normal',
      feedbackMode: 'all',
      enableWakeLock: true,
      powerDialerEnabled: false,
      dupHandling: 'skip',
      currentStreak: 0,
      lastStreakDate: null
    }
  };

  // --- 7. STRING TOKENIZER & TIMEZONE RESOLVER ---
  function getContactTimezone(phoneStr) {
    if (!phoneStr) return { tz: '', localTime: '', isCallable: true };
    const digits = phoneStr.replace(/\D/g, '');
    let area = '';

    if (digits.length === 10) area = digits.substring(0, 3);
    else if (digits.length === 11 && digits.startsWith('1')) area = digits.substring(1, 4);

    const ianaTz = US_CA_AREA_CODES[area];
    if (!ianaTz) return { tz: '', localTime: '', isCallable: true };

    try {
      const now = new Date();
      const localTimeStr = new Intl.DateTimeFormat('en-US', {
        timeZone: ianaTz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).format(now);

      const hour24 = parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: ianaTz,
        hour: 'numeric',
        hour12: false
      }).format(now), 10);

      const isCallable = hour24 >= 9 && hour24 < 17;
      const tzAbbr = new Intl.DateTimeFormat('en-US', { timeZone: ianaTz, timeZoneName: 'short' })
        .formatToParts(now).find(p => p.type === 'timeZoneName')?.value || 'LOCAL';

      return { tz: tzAbbr, localTime: `${tzAbbr} ${localTimeStr}`, isCallable };
    } catch (e) {
      return { tz: '', localTime: '', isCallable: true };
    }
  }

  function resolveTokens(templateStr, contact) {
    if (!templateStr) return '';
    const firstName = contact.name ? contact.name.trim().split(' ')[0] : '';
    const fullName = contact.name ? contact.name.trim() : '';
    const comp = contact.company ? contact.company.trim() : '';
    const phone = contact.phone ? contact.phone.trim() : '';
    const email = contact.email ? contact.email.trim() : '';
    const jobTitle = contact.job_title ? contact.job_title.trim() : '';
    const notes = contact.notes ? contact.notes.trim() : '';

    const now = new Date();
    const greeting = now.getHours() < 12 ? 'Good morning' : 'Good afternoon';

    return templateStr
      // Bracket token variants: [First Name], [Company], [Job Title], etc.
      .replace(/\[first[\s_]?name\]/gi, firstName || 'there')
      .replace(/\[name\]/gi, fullName || 'there')
      .replace(/\[full[\s_]?name\]/gi, fullName || 'there')
      .replace(/\[company\]/gi, comp)
      .replace(/\[business\]/gi, comp)
      .replace(/\[phone\]/gi, phone)
      .replace(/\[telephone\]/gi, phone)
      .replace(/\[email\]/gi, email)
      .replace(/\[job[\s_]?title\]/gi, jobTitle)
      .replace(/\[role\]/gi, jobTitle)
      .replace(/\[title\]/gi, jobTitle)
      .replace(/\[notes\]/gi, notes)
      .replace(/\[memo\]/gi, notes)
      .replace(/\[greeting\]/gi, greeting)
      .replace(/\[my[\s_]?name\]/gi, 'Christian J.')

      // Dynamic fallbacks: {first_name|fallback}, {company|fallback}
      .replace(/\{first_name\|?([^}]*)\}/gi, (match, fallback) => firstName || fallback || 'there')
      .replace(/\{name\|?([^}]*)\}/gi, (match, fallback) => fullName || fallback || 'there')
      .replace(/\{company\|?([^}]*)\}/gi, (match, fallback) => comp || fallback || '')
      .replace(/\{job_title\|?([^}]*)\}/gi, (match, fallback) => jobTitle || fallback || '')
      .replace(/\{notes\|?([^}]*)\}/gi, (match, fallback) => notes || fallback || '')

      // Standard curly bracket variants: {first_name}, {company}, etc.
      .replace(/\{first_name\}/gi, firstName || 'there')
      .replace(/\{name\}/gi, fullName || 'there')
      .replace(/\{company\}/gi, comp)
      .replace(/\{phone\}/gi, phone)
      .replace(/\{email\}/gi, email)
      .replace(/\{job_title\}/gi, jobTitle)
      .replace(/\{role\}/gi, jobTitle)
      .replace(/\{notes\}/gi, notes)
      .replace(/\{greeting\}/gi, greeting)
      .replace(/\{my_name\}/gi, 'Christian J.');
  }

  function cleanPhoneForDial(str) {
    if (!str) return '';
    const hasPlus = str.trim().startsWith('+');
    const digits = str.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
  }

  function getInitials(primaryStr, fallbackStr) {
    const target = (primaryStr || fallbackStr || '?').trim();
    const parts = target.split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  // --- 8. PERSISTENCE & DATA MANAGEMENT ---
  async function loadAllData() {
    return new Promise((resolve) => {
      const store = getStore('contacts', 'readonly');
      const req = store.getAll();
      req.onsuccess = () => {
        state.contacts = req.result || [];
        resolve(state.contacts);
      };
    });
  }

  async function saveContact(contact) {
    return new Promise((resolve) => {
      const store = getStore('contacts', 'readwrite');
      store.put(contact).onsuccess = () => resolve(true);
    });
  }

  async function deleteContact(id) {
    return new Promise((resolve) => {
      const store = getStore('contacts', 'readwrite');
      store.delete(id).onsuccess = () => {
        state.contacts = state.contacts.filter(c => c.id !== id);
        resolve(true);
      };
    });
  }

  async function logAudit(contactId, action, outcome, note = '', durationSec = 0) {
    const record = {
      contact_id: contactId,
      action,
      outcome,
      note: note || '',
      duration_sec: durationSec,
      timestamp: new Date().toISOString()
    };
    return new Promise((resolve) => {
      const store = getStore('interactions', 'readwrite');
      store.add(record).onsuccess = () => resolve(record);
    });
  }

  async function getAllAuditLogs() {
    return new Promise((resolve) => {
      const store = getStore('interactions', 'readonly');
      store.getAll().onsuccess = (e) => {
        const logs = e.target.result || [];
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(logs);
      };
    });
  }

  async function getAuditLogsForContact(contactId) {
    return new Promise((resolve) => {
      const store = getStore('interactions', 'readonly');
      const idx = store.index('contact_id');
      idx.getAll(contactId).onsuccess = (e) => {
        const logs = e.target.result || [];
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(logs);
      };
    });
  }

  async function loadSettings() {
    return new Promise((resolve) => {
      const store = getStore('settings', 'readonly');
      store.get('app_prefs').onsuccess = (e) => {
        if (e.target.result && e.target.result.val) {
          state.settings = { ...state.settings, ...e.target.result.val.settings };
          if (e.target.result.val.templates) {
            const loadedTemplates = e.target.result.val.templates;
            // Purge outdated drafts so only the requested email template is active
            delete loadedTemplates.intro;
            delete loadedTemplates.followup;
            state.emailTemplates = { ...DEFAULT_TEMPLATES, ...loadedTemplates };
          }
        }
        applyDisplayDensity(state.settings.textDensity);
        resolve(true);
      };
    });
  }

  async function persistSettings() {
    return new Promise((resolve) => {
      const store = getStore('settings', 'readwrite');
      store.put({ key: 'app_prefs', val: { settings: state.settings, templates: state.emailTemplates } })
        .onsuccess = () => resolve(true);
    });
  }

  function applyDisplayDensity(densityClass) {
    document.body.classList.remove('density-compact', 'density-normal', 'density-large');
    document.body.classList.add(densityClass || 'density-normal');
  }

  // --- 9. TELEMETRY, HUD & STREAKS ---
  async function refreshTelemetryHUD() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const logs = await getAllAuditLogs();

    const todayCalls = logs.filter(l => l.action === 'call' && new Date(l.timestamp).toLocaleDateString('en-CA') === todayStr).length;
    document.getElementById('hudCallCount').textContent = `${todayCalls}/${state.settings.dailyCallTarget}`;

    if (todayCalls >= state.settings.dailyCallTarget && state.settings.lastStreakDate !== todayStr) {
      state.settings.currentStreak = (state.settings.currentStreak || 0) + 1;
      state.settings.lastStreakDate = todayStr;
      persistSettings();
    }
    document.getElementById('hudStreakBadge').textContent = `${state.settings.currentStreak || 0}d`;
    document.getElementById('hudPowerIndicator').classList.toggle('hidden', !state.settings.powerDialerEnabled);

    const dueCount = state.contacts.filter(c => c.stage === 'callback' && c.next_callback_at && new Date(c.next_callback_at) <= now).length;
    document.getElementById('hudDueCount').textContent = `${dueCount} Due`;

    document.getElementById('countUncontacted').textContent = state.contacts.filter(c => c.stage === 'uncontacted').length;
    document.getElementById('countCallback').textContent = state.contacts.filter(c => c.stage === 'callback').length;
    document.getElementById('countContacted').textContent = state.contacts.filter(c => c.stage === 'contacted').length;
  }

  // --- 10. CALL DURATION TRACKING ENGINE ---
  function beginCallTracking(contact) {
    state.activeCallSession = {
      contactId: contact.id,
      phone: contact.phone,
      startTime: Date.now()
    };
    const timerBadge = document.getElementById('heroActiveTimer');
    if (timerBadge) {
      timerBadge.classList.remove('hidden');
      timerBadge.textContent = '⏱ Dialing...';
    }
  }

  async function checkActiveCallElapsed() {
    if (!state.activeCallSession) return;
    const elapsedSec = Math.round((Date.now() - state.activeCallSession.startTime) / 1000);
    const session = { ...state.activeCallSession };
    state.activeCallSession = null;

    const timerBadge = document.getElementById('heroActiveTimer');
    if (timerBadge) timerBadge.classList.add('hidden');

    if (elapsedSec >= 2) {
      await logAudit(session.contactId, 'call', 'Dialed', `Call duration: ${elapsedSec}s`, elapsedSec);
      refreshTelemetryHUD();
    }
  }

  // --- 11. UNDO SAFETY BUFFER ---
  let undoTimeout = null;
  function triggerUndoBuffer(message, revertFn) {
    if (undoTimeout) clearTimeout(undoTimeout);
    state.undoQueue = revertFn;

    const toast = document.getElementById('undoToast');
    const msg = document.getElementById('undoMessage');
    const progress = document.getElementById('undoTimerProgress');

    msg.textContent = message;
    toast.classList.remove('hidden');
    progress.style.transition = 'none';
    progress.style.width = '100%';

    setTimeout(() => {
      progress.style.transition = 'width 5000ms linear';
      progress.style.width = '0%';
    }, 20);

    undoTimeout = setTimeout(() => {
      toast.classList.add('hidden');
      state.undoQueue = null;
    }, 5000);
  }

  function executeUndoAction() {
    if (state.undoQueue) {
      feedback.trigger('success');
      state.undoQueue();
      state.undoQueue = null;
      if (undoTimeout) clearTimeout(undoTimeout);
      document.getElementById('undoToast').classList.add('hidden');
    }
  }

  // --- 12. POWER-DIALER AUTOMATION ---
  function startPowerDialCountdown() {
    if (!state.settings.powerDialerEnabled || state.filteredContacts.length === 0) return;

    let nextIdx = state.currentContactIndex + 1;
    if (nextIdx >= state.filteredContacts.length) nextIdx = 0;
    const nextLead = state.filteredContacts[nextIdx];
    if (!nextLead) return;

    state.powerDialCountdown = 3;
    const overlay = document.getElementById('powerDialOverlay');
    const numEl = document.getElementById('powerCountdownNumber');
    const leadNameEl = document.getElementById('powerNextName');

    numEl.textContent = state.powerDialCountdown;
    leadNameEl.textContent = nextLead.company || nextLead.name || 'Next Contact';
    overlay.classList.remove('hidden');

    if (state.powerDialTimer) clearInterval(state.powerDialTimer);

    state.powerDialTimer = setInterval(() => {
      state.powerDialCountdown--;
      if (state.powerDialCountdown > 0) {
        numEl.textContent = state.powerDialCountdown;
        feedback.trigger('click');
      } else {
        cancelPowerDial();
        openCockpit(nextLead.id);
        const clean = cleanPhoneForDial(nextLead.phone);
        if (clean) {
          beginCallTracking(nextLead);
          window.location.href = `tel:${clean}`;
        }
      }
    }, 1000);
  }

  function cancelPowerDial() {
    if (state.powerDialTimer) {
      clearInterval(state.powerDialTimer);
      state.powerDialTimer = null;
    }
    document.getElementById('powerDialOverlay').classList.add('hidden');
  }

  // --- 13. T9 MULTI-TAP ENGINE ---
  const T9_MAP = {
    '2': ['a','b','c'], '3': ['d','e','f'], '4': ['g','h','i'],
    '5': ['j','k','l'], '6': ['m','n','o'], '7': ['p','q','r','s'],
    '8': ['t','u','v'], '9': ['w','x','y','z']
  };

  function handleT9Input(key) {
    if (!T9_MAP[key]) return;
    feedback.trigger('click');

    if (state.t9Timeout) clearTimeout(state.t9Timeout);
    state.t9Buffer += key;

    const matchingIdx = state.filteredContacts.findIndex(c => {
      const name = (c.company || c.name || '').toLowerCase();
      return name.startsWith(T9_MAP[key][0]) || name.startsWith(T9_MAP[key][1]) || name.startsWith(T9_MAP[key][2]);
    });

    if (matchingIdx !== -1) {
      state.focusedCardIndex = matchingIdx;
      highlightCard(true);
    }

    state.t9Timeout = setTimeout(() => {
      state.t9Buffer = '';
    }, 1000);
  }

  // --- 14. LIST FILTER & RENDERING PIPELINE ---
  function applyPipelineFilter() {
    const q = state.searchQuery.toLowerCase().trim();
    const stage = state.activeQueue;

    state.filteredContacts = state.contacts.filter(c => {
      const matchesSearch = !q ||
        (c.company && c.company.toLowerCase().includes(q)) ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q));

      if (!matchesSearch) return false;
      if (stage === 'all') return true;
      return c.stage === stage;
    });

    state.filteredContacts.sort((a, b) => {
      if (stage === 'callback') {
        return new Date(a.next_callback_at || 0) - new Date(b.next_callback_at || 0);
      }
      return (a.company || a.name || '').localeCompare(b.company || b.name || '');
    });

    renderContactList();
    refreshTelemetryHUD();
  }

  function renderContactList() {
    const list = document.getElementById('contactList');
    if (state.filteredContacts.length === 0) {
      list.innerHTML = `
        <div class="bento-box" style="padding: 24px 8px; text-align: center;">
          <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 8px;">No contacts in this queue.</p>
          <button id="btnEmptyImportTrigger" class="btn btn-gold btn-sm"><span class="key-badge">#</span> Import Leads CSV</button>
        </div>`;
      const btn = document.getElementById('btnEmptyImportTrigger');
      if (btn) btn.onclick = () => document.getElementById('fileCsvInput').click();
      return;
    }

    const tmpl = document.getElementById('tmpl-contact-card');
    const frag = document.createDocumentFragment();

    state.filteredContacts.forEach((c, idx) => {
      const clone = tmpl.content.cloneNode(true);
      const card = clone.querySelector('.bento-card');
      card.dataset.id = c.id;
      card.dataset.index = idx;

      const primaryTitle = c.company ? c.company : (c.name ? c.name : 'Unknown Contact');
      const secondaryPerson = c.company && c.name ? (c.job_title ? `${c.name} • ${c.job_title}` : c.name) : (c.job_title || '');

      card.querySelector('.bento-avatar').textContent = getInitials(c.company, c.name);
      card.querySelector('.bento-header-primary').textContent = primaryTitle;

      const subEl = card.querySelector('.bento-sub-person');
      if (secondaryPerson) subEl.textContent = secondaryPerson;
      else subEl.style.display = 'none';

      const phoneEl = card.querySelector('.bento-direct-phone');
      if (c.phone) phoneEl.textContent = `📞 ${c.phone}`;
      else phoneEl.style.display = 'none';

      const tzInfo = getContactTimezone(c.phone);
      const tzEl = card.querySelector('.bento-tz-pill');
      if (tzInfo.localTime) {
        tzEl.textContent = tzInfo.localTime;
        if (!tzInfo.isCallable) tzEl.style.color = '#fed353';
      } else tzEl.style.display = 'none';

      const tag = card.querySelector('.status-tag');
      if (c.stage === 'uncontacted') {
        tag.className = 'status-tag tag-uncontacted';
        tag.textContent = c.attempts > 0 ? `Att: ${c.attempts}` : 'Fresh';
      } else if (c.stage === 'callback') {
        const isOverdue = c.next_callback_at && new Date(c.next_callback_at) <= new Date();
        tag.className = `status-tag ${isOverdue ? 'tag-due' : 'tag-callback'}`;
        tag.textContent = isOverdue ? 'Due Now' : 'Callback';
      } else if (c.stage === 'contacted') {
        tag.className = 'status-tag tag-contacted';
        tag.textContent = 'Spoken';
      }

      card.addEventListener('click', () => {
        feedback.trigger('click');
        openCockpit(c.id);
      });

      frag.appendChild(clone);
    });

    list.replaceChildren(frag);
    highlightCard(false);
  }

  function highlightCard(shouldScroll = true) {
    const cards = document.querySelectorAll('.bento-card');
    if (cards.length === 0) return;

    if (state.focusedCardIndex < 0) state.focusedCardIndex = 0;
    if (state.focusedCardIndex >= cards.length) state.focusedCardIndex = cards.length - 1;

    cards.forEach((card, idx) => {
      card.classList.toggle('focused-dpad', idx === state.focusedCardIndex);
    });

    if (shouldScroll && cards[state.focusedCardIndex]) {
      cards[state.focusedCardIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // --- 15. COCKPIT ZERO-PLACEHOLDER VIEW ---
  function openCockpit(contactId) {
    const idx = state.filteredContacts.findIndex(c => c.id === contactId);
    if (idx === -1) return;

    state.currentContactIndex = idx;
    renderCockpitView(state.filteredContacts[idx]);
    switchScreen('screenProfile');
  }

  async function renderCockpitView(contact) {
    const container = document.getElementById('profileCockpit');
    const tmpl = document.getElementById('tmpl-cockpit');
    const clone = tmpl.content.cloneNode(true);

    clone.querySelector('.hero-avatar').textContent = getInitials(contact.company, contact.name);

    const heroTitle = clone.querySelector('.hero-business-title');
    const heroPerson = clone.querySelector('.hero-person-row');
    const heroPhone = clone.querySelector('.hero-phone-row');
    const heroEmail = clone.querySelector('.hero-email-row');
    const tzBadge = clone.querySelector('#heroTzBadge');

    if (contact.company) {
      heroTitle.textContent = contact.company;
      if (contact.name || contact.job_title) {
        heroPerson.textContent = [contact.name, contact.job_title].filter(Boolean).join(' • ');
      } else heroPerson.style.display = 'none';
    } else if (contact.name) {
      heroTitle.textContent = contact.name;
      if (contact.job_title) heroPerson.textContent = contact.job_title;
      else heroPerson.style.display = 'none';
    } else {
      heroTitle.textContent = 'Unnamed Contact';
      heroPerson.style.display = 'none';
    }

    if (contact.phone) heroPhone.textContent = `📞 ${contact.phone}`;
    else heroPhone.style.display = 'none';

    if (contact.email) heroEmail.textContent = `✉️ ${contact.email}`;
    else heroEmail.style.display = 'none';

    const tzInfo = getContactTimezone(contact.phone);
    if (tzInfo.localTime) {
      tzBadge.textContent = tzInfo.localTime;
      if (!tzInfo.isCallable) tzBadge.style.color = '#fed353';
    } else tzBadge.style.display = 'none';

    // Call Action
    const cleanPhone = cleanPhoneForDial(contact.phone);
    const callBtn = clone.querySelector('#btnCockpitCall');
    if (cleanPhone) {
      callBtn.href = `tel:${cleanPhone}`;
      callBtn.onclick = () => {
        feedback.trigger('click');
        beginCallTracking(contact);
      };
      callBtn.style.opacity = '1';
    } else {
      callBtn.href = '#';
      callBtn.onclick = (e) => { e.preventDefault(); alert('No phone recorded.'); };
      callBtn.style.opacity = '0.35';
    }

    // Email Action
    const emailBtn = clone.querySelector('#btnCockpitEmail');
    if (contact.email) {
      emailBtn.onclick = () => { feedback.trigger('click'); openCommSheet(contact, 'email'); };
      emailBtn.style.opacity = '1';
    } else {
      emailBtn.onclick = () => alert('No email recorded.');
      emailBtn.style.opacity = '0.35';
    }

    // SMS Action
    const smsBtn = clone.querySelector('#btnCockpitSms');
    if (cleanPhone) {
      smsBtn.onclick = () => { feedback.trigger('click'); openCommSheet(contact, 'sms'); };
      smsBtn.style.opacity = '1';
    } else {
      smsBtn.onclick = () => alert('No phone recorded for SMS.');
      smsBtn.style.opacity = '0.35';
    }

    // Dispositions
    clone.querySelector('#btnDispNoAnswer').onclick = () => handleDispositionNoAnswer(contact);
    clone.querySelector('#btnDispCallBack').onclick = () => openCallbackScheduler(contact);
    clone.querySelector('#btnDispContacted').onclick = () => handleDispositionContacted(contact);
    clone.querySelector('#btnDispDNC').onclick = () => handleDispositionDNC(contact);

    // Notes Box
    const notesBox = clone.querySelector('#cockpitNotesBox');
    const notesText = clone.querySelector('.cockpit-notes-text');
    if (contact.notes && contact.notes.trim()) {
      notesText.textContent = contact.notes;
    } else notesBox.style.display = 'none';
    clone.querySelector('#btnQuickEditNotes').onclick = () => openEditModal(contact);

    // History Feed
    const historyBox = clone.querySelector('#cockpitHistoryBox');
    const feed = clone.querySelector('.cockpit-history-feed');
    const logs = await getAuditLogsForContact(contact.id);
    if (logs.length > 0) {
      clone.querySelector('.cockpit-log-count').textContent = `${logs.length}`;
      logs.slice(0, 10).forEach(l => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <div class="history-head">
            <span>${l.action.toUpperCase()}</span>
            <span>${formatDate(l.timestamp)}</span>
          </div>
          <div class="history-action">${l.outcome}</div>
          ${l.note ? `<div style="font-size:0.72rem; color:#b2cfbe;">${l.note}</div>` : ''}
        `;
        feed.appendChild(item);
      });
    } else historyBox.style.display = 'none';

    container.replaceChildren(clone);
  }

  // --- 16. DISPOSITION HANDLERS WITH SAFETY BUFFER ---
  async function handleDispositionNoAnswer(contact) {
    feedback.trigger('click');
    const prevAttempts = contact.attempts || 0;
    const prevStage = contact.stage;

    contact.attempts = prevAttempts + 1;
    contact.last_contacted_at = new Date().toISOString();
    contact.stage = 'uncontacted';
    await saveContact(contact);
    await logAudit(contact.id, 'disposition', 'No Answer', `Dial attempt #${contact.attempts}`);

    triggerUndoBuffer(`Marked No Answer (${contact.company || contact.name})`, async () => {
      contact.attempts = prevAttempts;
      contact.stage = prevStage;
      await saveContact(contact);
      applyPipelineFilter();
    });

    cycleNextLead();
  }

  function openCallbackScheduler(contact) {
    state.pendingCallbackContact = contact;
    document.getElementById('customCallbackInput').value = '';
    document.getElementById('modalScheduleCallback').classList.remove('hidden');
  }

  async function scheduleCallback(hoursOffset, customIsoString = null) {
    feedback.trigger('success');
    const contact = state.pendingCallbackContact;
    if (!contact) return;

    const prevStage = contact.stage;
    const prevCb = contact.next_callback_at;

    let targetDate = customIsoString ? new Date(customIsoString) : new Date();
    if (!customIsoString) targetDate.setHours(targetDate.getHours() + hoursOffset);

    contact.stage = 'callback';
    contact.next_callback_at = targetDate.toISOString();
    contact.last_contacted_at = new Date().toISOString();

    await saveContact(contact);
    await logAudit(contact.id, 'disposition', 'Call Back Set', `Due: ${formatDate(contact.next_callback_at)}`);

    document.getElementById('modalScheduleCallback').classList.add('hidden');
    state.pendingCallbackContact = null;

    triggerUndoBuffer(`Callback set: ${formatDate(contact.next_callback_at)}`, async () => {
      contact.stage = prevStage;
      contact.next_callback_at = prevCb;
      await saveContact(contact);
      applyPipelineFilter();
    });

    cycleNextLead();
  }

  async function handleDispositionContacted(contact) {
    feedback.trigger('success');
    const prevStage = contact.stage;
    contact.stage = 'contacted';
    contact.next_callback_at = null;
    contact.last_contacted_at = new Date().toISOString();

    await saveContact(contact);
    await logAudit(contact.id, 'disposition', 'Spoken / Contacted', 'Conversation qualified');

    triggerUndoBuffer(`Marked Contacted (${contact.company || contact.name})`, async () => {
      contact.stage = prevStage;
      await saveContact(contact);
      applyPipelineFilter();
    });

    cycleNextLead();
  }

  async function handleDispositionDNC(contact) {
    feedback.trigger('alert');
    const copy = { ...contact };
    if (confirm(`Scrub "${contact.company || contact.name}" from database?`)) {
      await logAudit(contact.id, 'disposition', 'DNC / Purged', 'Scrubbed from records');
      await deleteContact(contact.id);

      triggerUndoBuffer(`Purged "${copy.company || copy.name}"`, async () => {
        await saveContact(copy);
        state.contacts.push(copy);
        applyPipelineFilter();
      });

      cycleNextLead();
    }
  }

  function cycleNextLead() {
    applyPipelineFilter();
    if (state.settings.powerDialerEnabled) {
      startPowerDialCountdown();
    } else {
      if (state.filteredContacts.length > 0) {
        if (state.currentContactIndex >= state.filteredContacts.length) {
          state.currentContactIndex = 0;
        }
        renderCockpitView(state.filteredContacts[state.currentContactIndex]);
      } else {
        switchScreen('screenContacts');
      }
    }
  }

  // --- 17. COMMUNICATION DISPATCH ENGINE ---
  function openCommSheet(contact, mode = 'email') {
    const isEmail = mode === 'email';
    document.getElementById('modalCommTitle').textContent = isEmail ? 'Send Rapid Email' : 'Send Rapid SMS';
    document.getElementById('groupDraftSubject').style.display = isEmail ? 'flex' : 'none';
    document.getElementById('btnLaunchWebGmail').style.display = isEmail ? 'inline-flex' : 'none';

    const select = document.getElementById('pickerTemplateSelect');
    select.replaceChildren();

    Object.values(state.emailTemplates).forEach(t => {
      if (isEmail && t.type === 'sms') return;
      if (!isEmail && t.type === 'email') return;
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      select.appendChild(opt);
    });

    if (select.children.length === 0) {
      Object.values(state.emailTemplates).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title;
        select.appendChild(opt);
      });
    }

    state.activeTemplateId = select.value;
    updateCommDraftFields(contact, state.activeTemplateId);

    select.onchange = (e) => {
      state.activeTemplateId = e.target.value;
      updateCommDraftFields(contact, state.activeTemplateId);
    };

    document.getElementById('btnLaunchMailtoApp').onclick = () => {
      feedback.trigger('click');
      if (isEmail) launchMailtoNative(contact);
      else launchSmsNative(contact);
    };

    document.getElementById('btnLaunchWebGmail').onclick = () => {
      feedback.trigger('click');
      launchGmailWebTab(contact);
    };

    document.getElementById('btnMarkEmailLogged').onclick = async () => {
      feedback.trigger('success');
      const actionType = isEmail ? 'email' : 'sms';
      await logAudit(contact.id, actionType, `${isEmail ? 'Email' : 'SMS'} Sent`, document.getElementById('draftBody').value);
      document.getElementById('modalEmailPicker').classList.add('hidden');
      renderCockpitView(contact);
      refreshTelemetryHUD();
    };

    document.getElementById('modalEmailPicker').classList.remove('hidden');
  }

  function updateCommDraftFields(contact, templateId) {
    const t = state.emailTemplates[templateId] || state.emailTemplates.hospitality_demo || Object.values(state.emailTemplates)[0];
    document.getElementById('draftSubject').value = resolveTokens(t.subject, contact);
    document.getElementById('draftBody').value = resolveTokens(t.body, contact);
  }

  function launchMailtoNative(contact) {
    const to = encodeURIComponent(contact.email);
    const sub = encodeURIComponent(document.getElementById('draftSubject').value);
    const body = encodeURIComponent(document.getElementById('draftBody').value);
    window.location.href = `mailto:${to}?subject=${sub}&body=${body}`;
  }

  function launchGmailWebTab(contact) {
    const to = encodeURIComponent(contact.email);
    const sub = encodeURIComponent(document.getElementById('draftSubject').value);
    const body = encodeURIComponent(document.getElementById('draftBody').value);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${sub}&body=${body}`, '_blank');
  }

  function launchSmsNative(contact) {
    const clean = cleanPhoneForDial(contact.phone);
    const body = encodeURIComponent(document.getElementById('draftBody').value);
    window.location.href = `sms:${clean}?body=${body}`;
  }

  // --- 18. EDIT MODAL & SPEECH DICTATION ---
  function openEditModal(contact) {
    document.getElementById('editContactId').value = contact.id;
    document.getElementById('editModalHeading').textContent = `Edit: ${contact.company || contact.name || 'Lead'}`;
    document.getElementById('editCompany').value = contact.company || '';
    document.getElementById('editName').value = contact.name || '';
    document.getElementById('editPhone').value = contact.phone || '';
    document.getElementById('editEmail').value = contact.email || '';
    document.getElementById('editJobTitle').value = contact.job_title || '';
    document.getElementById('editNotes').value = contact.notes || '';

    document.getElementById('modalEditContact').classList.remove('hidden');
    document.getElementById('editCompany').focus();
  }

  function setupSpeechRecognition() {
    const btn = document.getElementById('btnDictateNotes');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      btn.style.display = 'none';
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      btn.textContent = '🔴 Listening...';
      feedback.trigger('alert');
    };

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      const notesArea = document.getElementById('editNotes');
      notesArea.value = notesArea.value ? `${notesArea.value} ${transcript}` : transcript;
    };

    recognition.onerror = () => { btn.textContent = '🎙️ Dictate'; };
    recognition.onend = () => { btn.textContent = '🎙️ Dictate'; };

    btn.onclick = () => {
      try { recognition.start(); } catch (err) { recognition.stop(); }
    };
  }

  async function handleContactSave(e) {
    e.preventDefault();
    feedback.trigger('success');
    const id = document.getElementById('editContactId').value;
    const contact = state.contacts.find(c => c.id === id);
    if (!contact) return;

    contact.company = document.getElementById('editCompany').value.trim();
    contact.name = document.getElementById('editName').value.trim();
    contact.phone = document.getElementById('editPhone').value.trim();
    contact.email = document.getElementById('editEmail').value.trim();
    contact.job_title = document.getElementById('editJobTitle').value.trim();
    contact.notes = document.getElementById('editNotes').value.trim();

    await saveContact(contact);
    document.getElementById('modalEditContact').classList.add('hidden');
    applyPipelineFilter();

    if (state.activeScreenId === 'screenProfile') {
      renderCockpitView(contact);
    }
  }

  // --- 19. SCREEN TRANSITIONS ---
  function switchScreen(targetScreenId) {
    feedback.trigger('click');
    state.activeScreenId = targetScreenId;

    document.querySelectorAll('.screen-view').forEach(s => {
      s.classList.add('hidden');
      s.classList.remove('active');
    });

    const target = document.getElementById(targetScreenId);
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('active');
      target.scrollTop = 0;
    }

    const titles = {
      screenContacts: state.activeQueue.toUpperCase(),
      screenProfile: 'COCKPIT',
      screenHistory: 'AUDIT LOGS',
      screenSettings: 'SETTINGS'
    };
    document.getElementById('activeScreenTitle').textContent = titles[targetScreenId] || 'DIALLER';

    const isProfile = targetScreenId === 'screenProfile';
    document.getElementById('dockDefaultView').classList.toggle('hidden', isProfile);
    document.getElementById('dockProfileView').classList.toggle('hidden', !isProfile);

    document.querySelectorAll('.dock-item').forEach(b => {
      b.classList.toggle('active', b.dataset.screen === targetScreenId);
    });

    if (targetScreenId === 'screenContacts') applyPipelineFilter();
    if (targetScreenId === 'screenHistory') renderHistoryScreen();
  }

  async function renderHistoryScreen() {
    const container = document.getElementById('globalHistoryList');
    let logs = await getAllAuditLogs();

    if (state.historyFilterAction !== 'all') {
      logs = logs.filter(l => l.action === state.historyFilterAction);
    }

    if (state.historyQuery) {
      const q = state.historyQuery.toLowerCase();
      logs = logs.filter(l => (l.note && l.note.toLowerCase().includes(q)) || (l.outcome && l.outcome.toLowerCase().includes(q)));
    }

    if (logs.length === 0) {
      container.innerHTML = '<div class="bento-box" style="text-align:center;"><p style="color:var(--text-muted);font-size:0.8rem;">No logs matching criteria.</p></div>';
      return;
    }

    container.replaceChildren();
    logs.slice(0, 50).forEach(l => {
      const c = state.contacts.find(x => x.id === l.contact_id);
      const title = c ? (c.company || c.name || 'Lead') : 'Deleted Lead';
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="history-head">
          <span>${title} • ${l.action.toUpperCase()}</span>
          <span>${formatDate(l.timestamp)}</span>
        </div>
        <div class="history-action">${l.outcome}</div>
        ${l.note ? `<div style="font-size:0.72rem; color:#b2cfbe;">${l.note}</div>` : ''}
      `;
      container.appendChild(div);
    });
  }

  // --- 20. ANALYTICS ENGINE ---
  async function openAnalyticsModal() {
    feedback.trigger('click');
    const logs = await getAllAuditLogs();
    const todayStr = new Date().toLocaleDateString('en-CA');
    const todayLogs = logs.filter(l => new Date(l.timestamp).toLocaleDateString('en-CA') === todayStr);

    const callLogs = todayLogs.filter(l => l.action === 'call');
    const spokenLogs = todayLogs.filter(l => l.action === 'disposition' && l.outcome.includes('Spoken'));

    const dialCount = callLogs.length;
    const spokenCount = spokenLogs.length;
    const convRate = dialCount > 0 ? Math.round((spokenCount / dialCount) * 100) : 0;

    let totalDuration = 0;
    callLogs.forEach(c => totalDuration += (c.duration_sec || 0));
    const avgDuration = dialCount > 0 ? Math.round(totalDuration / dialCount) : 0;

    document.getElementById('metricDialsToday').textContent = dialCount;
    document.getElementById('metricConvRate').textContent = `${convRate}%`;
    document.getElementById('metricAvgDuration').textContent = `${avgDuration}s`;
    document.getElementById('metricStreakDays').textContent = state.settings.currentStreak || 0;

    const hoursPace = new Array(8).fill(0);
    todayLogs.forEach(l => {
      const h = new Date(l.timestamp).getHours();
      if (h >= 9 && h <= 17) hoursPace[h - 9]++;
    });

    const paceContainer = document.getElementById('hourlyPaceChart');
    paceContainer.replaceChildren();
    const maxPace = Math.max(...hoursPace, 1);
    hoursPace.forEach(count => {
      const col = document.createElement('div');
      col.className = 'pace-col';
      col.style.height = `${(count / maxPace) * 100}%`;
      paceContainer.appendChild(col);
    });

    document.getElementById('modalAnalytics').classList.remove('hidden');
  }

  // --- 21. DETERMINISTIC HARDWARE KEYPAD ENGINE (FSM) ---
  function setupKeypadMatrixFSM() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      // Global Hardware Back / Escape
      if (e.key === 'Escape' || e.key === 'Backspace') {
        const activeModal = document.querySelector('.modal-sheet-backdrop:not(.hidden)');
        if (activeModal) {
          activeModal.classList.add('hidden');
          cancelPowerDial();
          e.preventDefault();
          return;
        }
        if (state.activeScreenId !== 'screenContacts') {
          switchScreen('screenContacts');
          e.preventDefault();
          return;
        }
      }

      if (inInput) {
        if (e.key === 'Enter') document.activeElement.blur();
        return;
      }

      // Context: Modal Dialogs
      const isCallbackOpen = !document.getElementById('modalScheduleCallback').classList.contains('hidden');
      const isCommOpen = !document.getElementById('modalEmailPicker').classList.contains('hidden');
      const isEditOpen = !document.getElementById('modalEditContact').classList.contains('hidden');
      const isObjectionsOpen = !document.getElementById('modalObjectionsDrawer').classList.contains('hidden');
      const isAnalyticsOpen = !document.getElementById('modalAnalytics').classList.contains('hidden');

      if (isCallbackOpen) {
        if (['1','2','3','4','5'].includes(e.key)) {
          const map = { '1': 2, '2': 4, '3': 24, '4': 48, '5': 168 };
          scheduleCallback(map[e.key]);
          e.preventDefault();
        } else if (e.key === '0') {
          document.getElementById('modalScheduleCallback').classList.add('hidden');
          e.preventDefault();
        }
        return;
      }

      if (isCommOpen) {
        const c = state.filteredContacts[state.currentContactIndex];
        if (e.key === '1') { launchMailtoNative(c); e.preventDefault(); }
        else if (e.key === '2') { launchGmailWebTab(c); e.preventDefault(); }
        else if (e.key === '3') { document.getElementById('btnMarkEmailLogged').click(); e.preventDefault(); }
        else if (e.key === '0') { document.getElementById('modalEmailPicker').classList.add('hidden'); e.preventDefault(); }
        return;
      }

      if (isEditOpen || isObjectionsOpen || isAnalyticsOpen) {
        if (e.key === '0') {
          document.querySelectorAll('.modal-sheet-backdrop').forEach(m => m.classList.add('hidden'));
          e.preventDefault();
        }
        return;
      }

      // Undo Catch
      if (e.key === '0' && state.undoQueue) {
        e.preventDefault();
        executeUndoAction();
        return;
      }

      // Context: Cockpit Screen
      if (state.activeScreenId === 'screenProfile' && state.currentContactIndex !== -1) {
        const c = state.filteredContacts[state.currentContactIndex];
        switch (e.key) {
          case '1': e.preventDefault(); document.getElementById('btnCockpitCall').click(); break;
          case '2': e.preventDefault(); openCommSheet(c, 'email'); break;
          case '3': e.preventDefault(); openCommSheet(c, 'sms'); break;
          case '4': e.preventDefault(); handleDispositionNoAnswer(c); break;
          case '5': e.preventDefault(); openCallbackScheduler(c); break;
          case '6': e.preventDefault(); handleDispositionContacted(c); break;
          case '7': e.preventDefault(); handleDispositionDNC(c); break;
          case '8': e.preventDefault(); openEditModal(c); break;
          case '*': e.preventDefault(); document.getElementById('modalObjectionsDrawer').classList.remove('hidden'); break;
          case '0': e.preventDefault(); switchScreen('screenContacts'); break;
        }
        return;
      }

      // Context: Contacts List Screen
      if (state.activeScreenId === 'screenContacts') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.focusedCardIndex++;
          highlightCard(true);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.focusedCardIndex--;
          highlightCard(true);
          return;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (state.filteredContacts[state.focusedCardIndex]) {
            openCockpit(state.filteredContacts[state.focusedCardIndex].id);
          }
          return;
        }

        const currentLead = state.filteredContacts[state.focusedCardIndex];
        switch (e.key) {
          case '1':
            e.preventDefault();
            if (currentLead && currentLead.phone) {
              const clean = cleanPhoneForDial(currentLead.phone);
              beginCallTracking(currentLead);
              window.location.href = `tel:${clean}`;
            }
            break;
          case '2':
            e.preventDefault();
            if (currentLead && currentLead.email) openCommSheet(currentLead, 'email');
            break;
          case '3':
            e.preventDefault();
            if (currentLead && currentLead.phone) openCommSheet(currentLead, 'sms');
            break;
          case '4': e.preventDefault(); switchScreen('screenHistory'); break;
          case '5': e.preventDefault(); document.getElementById('searchInput').focus(); break;
          case '6': e.preventDefault(); switchScreen('screenSettings'); break;
          case '7': e.preventDefault(); selectQueue('uncontacted'); break;
          case '8': e.preventDefault(); selectQueue('callback'); break;
          case '9': e.preventDefault(); selectQueue('contacted'); break;
          case '0': e.preventDefault(); state.focusedCardIndex = 0; highlightCard(true); break;
          case '#': e.preventDefault(); document.getElementById('fileCsvInput').click(); break;
          case '*': e.preventDefault(); document.getElementById('searchInput').focus(); break;
          default:
            if (['2','3','4','5','6','7','8','9'].includes(e.key)) {
              handleT9Input(e.key);
            }
            break;
        }
        return;
      }

      // Context: Logs & Settings
      if (state.activeScreenId === 'screenHistory' || state.activeScreenId === 'screenSettings') {
        if (e.key === '0' || e.key === '1') {
          e.preventDefault();
          switchScreen('screenContacts');
        }
      }
    });
  }

  function selectQueue(q) {
    feedback.trigger('click');
    document.querySelectorAll('.stage-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.queue === q);
    });
    state.activeQueue = q;
    state.focusedCardIndex = 0;
    applyPipelineFilter();
  }

  // --- 22. CSV DEDUPLICATING ENGINE ---
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') { currentField += '"'; i++; }
          else inQuotes = false;
        } else currentField += char;
      } else {
        if (char === '"') inQuotes = true;
        else if (char === ',') { currentRow.push(currentField.trim()); currentField = ''; }
        else if (char === '\r' || char === '\n') {
          currentRow.push(currentField.trim());
          if (currentRow.some(f => f.length > 0)) rows.push(currentRow);
          currentRow = [];
          currentField = '';
          if (char === '\r' && nextChar === '\n') i++;
        } else currentField += char;
      }
      i++;
    }
    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) rows.push(currentRow);
    }
    return rows;
  }

  function handleCsvFileSelect(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const rows = parseCSV(e.target.result);
        if (rows.length < 2) { alert('CSV file is empty or invalid.'); return; }

        const headers = rows[0].map(h => h.toLowerCase().replace(/[\s\-_]+/g, '_'));
        const findIdx = (aliases) => headers.findIndex(h => aliases.includes(h));

        const idxCompany = findIdx(['company', 'business', 'business_name', 'organization', 'account']);
        const idxName = findIdx(['name', 'full_name', 'contact', 'client']);
        const idxPhone = findIdx(['phone', 'tel', 'telephone', 'mobile', 'cell']);
        const idxEmail = findIdx(['email', 'mail', 'email_address']);
        const idxRole = findIdx(['title', 'role', 'job_title', 'position']);
        const idxNotes = findIdx(['notes', 'comments', 'memo']);

        const dupRule = state.settings.dupHandling || 'skip';
        let imported = 0;
        let skipped = 0;

        const tx = dbInstance.transaction('contacts', 'readwrite');
        const store = tx.objectStore('contacts');

        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const company = (row[idxCompany] || '').trim();
          const name = (row[idxName] || '').trim();
          const phone = (row[idxPhone] || '').trim();
          const email = (row[idxEmail] || '').trim();

          if (!company && !name && !phone && !email) continue;

          const existing = state.contacts.find(c => (phone && c.phone === phone) || (email && c.email.toLowerCase() === email.toLowerCase()));
          if (existing) {
            if (dupRule === 'skip') {
              skipped++;
              continue;
            } else if (dupRule === 'update') {
              existing.company = company || existing.company;
              existing.name = name || existing.name;
              existing.job_title = (row[idxRole] || '').trim() || existing.job_title;
              existing.notes = (row[idxNotes] || '').trim() || existing.notes;
              store.put(existing);
              imported++;
              continue;
            }
          }

          store.put({
            id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substr(2, 7),
            company,
            name,
            phone,
            email,
            job_title: (row[idxRole] || '').trim(),
            notes: (row[idxNotes] || '').trim(),
            stage: 'uncontacted',
            attempts: 0,
            last_contacted_at: null,
            next_callback_at: null,
            created_at: new Date().toISOString()
          });
          imported++;
        }

        tx.oncomplete = async () => {
          feedback.trigger('success');
          await loadAllData();
          applyPipelineFilter();
          alert(`Import complete: ${imported} added/updated, ${skipped} duplicates skipped.`);
        };
      } catch (err) {
        alert('CSV Parsing error: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // --- 23. CHECKSUMMED BACKUP ENGINE ---
  async function computeSHA256(str) {
    const buf = new TextEncoder().encode(str);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function exportFullJsonBackup() {
    feedback.trigger('click');
    const logs = await getAllAuditLogs();
    const dataPayload = {
      contacts: state.contacts,
      interactions: logs,
      settings: state.settings,
      templates: state.emailTemplates
    };

    const dataStr = JSON.stringify(dataPayload);
    const checksum = await computeSHA256(dataStr);

    const snapshot = {
      version: DB_VERSION,
      export_date: new Date().toISOString(),
      checksum,
      data: dataPayload
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FlipDialler_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleJsonRestoreFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const snapshot = JSON.parse(e.target.result);
        if (!snapshot.data || !snapshot.checksum) {
          alert('Invalid backup file structure.');
          return;
        }

        const verifiedHash = await computeSHA256(JSON.stringify(snapshot.data));
        if (verifiedHash !== snapshot.checksum) {
          alert('Backup integrity verification failed: Checksum mismatch.');
          return;
        }

        if (confirm(`Restore ${snapshot.data.contacts.length} leads? Current records will be replaced.`)) {
          const tx = dbInstance.transaction(['contacts', 'interactions'], 'readwrite');
          tx.objectStore('contacts').clear();
          tx.objectStore('interactions').clear();

          snapshot.data.contacts.forEach(c => tx.objectStore('contacts').put(c));
          if (snapshot.data.interactions) {
            snapshot.data.interactions.forEach(l => tx.objectStore('interactions').put(l));
          }

          tx.oncomplete = async () => {
            if (snapshot.data.settings) state.settings = { ...state.settings, ...snapshot.data.settings };
            if (snapshot.data.templates) state.emailTemplates = { ...state.emailTemplates, ...snapshot.data.templates };
            await persistSettings();
            await loadAllData();
            applyPipelineFilter();
            feedback.trigger('success');
            alert('Database verified and restored!');
          };
        }
      } catch (err) {
        alert('Restore failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function exportContactsCsv() {
    if (state.contacts.length === 0) { alert('No contacts to export.'); return; }
    const headers = ['company', 'name', 'phone', 'email', 'job_title', 'stage', 'attempts', 'notes'];
    const rows = [headers.join(',')];

    state.contacts.forEach(c => {
      const r = headers.map(h => `"${(c[h] || '').toString().replace(/"/g, '""')}"`);
      rows.push(r.join(','));
    });

    const blob = new Blob([rows.join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportAuditLogsCsv() {
    const logs = await getAllAuditLogs();
    if (logs.length === 0) { alert('No logs to export.'); return; }

    const headers = ['timestamp', 'action', 'outcome', 'duration_sec', 'note'];
    const rows = [headers.join(',')];

    logs.forEach(l => {
      const r = [
        `"${l.timestamp}"`,
        `"${l.action}"`,
        `"${(l.outcome || '').replace(/"/g, '""')}"`,
        `"${l.duration_sec || 0}"`,
        `"${(l.note || '').replace(/"/g, '""')}"`
      ];
      rows.push(r.join(','));
    });

    const blob = new Blob([rows.join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dialler_audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- 24. BACKGROUND CALLBACK ALARM MONITOR ---
  function initCallbackMonitor() {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }

    navigator.serviceWorker?.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'NAVIGATE_CONTACT') {
        openCockpit(e.data.contactId);
      }
    });

    setInterval(() => {
      const now = new Date();
      state.contacts.forEach(c => {
        if (c.stage === 'callback' && c.next_callback_at && !c.alertFired) {
          const due = new Date(c.next_callback_at);
          if (due <= now && now - due < 300000) {
            c.alertFired = true;
            feedback.trigger('alert');
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(`📞 Callback Due: ${c.company || c.name}`, {
                body: `Scheduled for now (${c.phone})`,
                data: { contactId: c.id },
                icon: './manifest.json'
              });
            }
          }
        }
      });
      refreshTelemetryHUD();
    }, 30000);
  }

  // --- 25. INITIALIZATION SEQUENCE ---
  async function initApp() {
    await initDB();
    await loadSettings();
    await loadAllData();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    requestScreenWakeLock();
    setupSpeechRecognition();
    initCallbackMonitor();

    // Check deep-linking query param
    const urlParams = new URLSearchParams(window.location.search);
    const deepContactId = urlParams.get('contactId');
    if (deepContactId) {
      setTimeout(() => openCockpit(deepContactId), 200);
    }

    // Populate Settings UI
    document.getElementById('inputDailyCallTarget').value = state.settings.dailyCallTarget || 10;
    document.getElementById('selectTextDensity').value = state.settings.textDensity || 'density-normal';
    document.getElementById('selectHapticsSound').value = state.settings.feedbackMode || 'all';
    document.getElementById('checkWakeLock').checked = !!state.settings.enableWakeLock;
    document.getElementById('checkPowerDialer').checked = !!state.settings.powerDialerEnabled;
    document.getElementById('selectDupHandling').value = state.settings.dupHandling || 'skip';

    document.getElementById('selectTextDensity').onchange = async (e) => {
      state.settings.textDensity = e.target.value;
      applyDisplayDensity(state.settings.textDensity);
      await persistSettings();
    };

    document.getElementById('selectHapticsSound').onchange = async (e) => {
      state.settings.feedbackMode = e.target.value;
      await persistSettings();
    };

    document.getElementById('checkWakeLock').onchange = async (e) => {
      state.settings.enableWakeLock = e.target.checked;
      if (state.settings.enableWakeLock) requestScreenWakeLock();
      await persistSettings();
    };

    document.getElementById('checkPowerDialer').onchange = async (e) => {
      state.settings.powerDialerEnabled = e.target.checked;
      refreshTelemetryHUD();
      await persistSettings();
    };

    document.getElementById('selectDupHandling').onchange = async (e) => {
      state.settings.dupHandling = e.target.value;
      await persistSettings();
    };

    document.getElementById('btnSaveTarget').onclick = async () => {
      state.settings.dailyCallTarget = parseInt(document.getElementById('inputDailyCallTarget').value, 10) || 10;
      await persistSettings();
      refreshTelemetryHUD();
      feedback.trigger('success');
      alert('Target updated!');
    };

    // Template Selector Setup
    const tmplSelect = document.getElementById('templateSelector');
    tmplSelect.replaceChildren();
    Object.values(state.emailTemplates).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.title} [${t.type.toUpperCase()}]`;
      tmplSelect.appendChild(opt);
    });

    const loadTmplFields = (id) => {
      const t = state.emailTemplates[id] || state.emailTemplates.hospitality_demo || Object.values(state.emailTemplates)[0];
      document.getElementById('templateSubject').value = t.subject || '';
      document.getElementById('templateBody').value = t.body || '';
    };

    tmplSelect.onchange = (e) => loadTmplFields(e.target.value);
    loadTmplFields(tmplSelect.value);

    document.getElementById('btnSaveTemplate').onclick = async () => {
      const id = tmplSelect.value;
      if (state.emailTemplates[id]) {
        state.emailTemplates[id].subject = document.getElementById('templateSubject').value;
        state.emailTemplates[id].body = document.getElementById('templateBody').value;
        await persistSettings();
        feedback.trigger('success');
        alert('Template saved!');
      }
    };

    // Stage Tab Clicks
    document.querySelectorAll('.stage-tab').forEach(tab => {
      tab.addEventListener('click', (e) => selectQueue(e.currentTarget.dataset.queue));
    });

    // Search Input
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('btnClearSearch');
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      clearBtn.classList.toggle('hidden', !state.searchQuery);
      applyPipelineFilter();
    });
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearBtn.classList.add('hidden');
      applyPipelineFilter();
    });

    // History Filters
    document.querySelectorAll('#historyFilterGroup .hist-pill').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#historyFilterGroup .hist-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.historyFilterAction = btn.dataset.action;
        renderHistoryScreen();
      };
    });

    document.getElementById('searchHistoryInput').addEventListener('input', (e) => {
      state.historyQuery = e.target.value;
      renderHistoryScreen();
    });

    // Callback Choices
    document.querySelectorAll('.quick-choice-grid .btn-choice').forEach(b => {
      b.onclick = (e) => scheduleCallback(parseInt(e.currentTarget.dataset.hours, 10));
    });

    document.getElementById('btnConfirmCallbackSchedule').onclick = () => {
      const val = document.getElementById('customCallbackInput').value;
      if (!val) { alert('Choose a quick option or select custom time.'); return; }
      scheduleCallback(0, val);
    };

    // Dock Navigation
    document.querySelectorAll('.dock-item').forEach(btn => {
      btn.onclick = () => switchScreen(btn.dataset.screen);
    });

    document.getElementById('btnDockBack').onclick = () => switchScreen('screenContacts');
    document.getElementById('btnDockObjections').onclick = () => document.getElementById('modalObjectionsDrawer').classList.remove('hidden');
    document.getElementById('btnDockEdit').onclick = () => {
      if (state.currentContactIndex !== -1) openEditModal(state.filteredContacts[state.currentContactIndex]);
    };

    // Modal Dismissals
    document.getElementById('btnCloseCallbackSheet').onclick = () => document.getElementById('modalScheduleCallback').classList.add('hidden');
    document.getElementById('btnCancelCallback').onclick = () => document.getElementById('modalScheduleCallback').classList.add('hidden');
    document.getElementById('btnCloseEmailSheet').onclick = () => document.getElementById('modalEmailPicker').classList.add('hidden');
    document.getElementById('btnCancelEmail').onclick = () => document.getElementById('modalEmailPicker').classList.add('hidden');
    document.getElementById('btnCloseEditSheet').onclick = () => document.getElementById('modalEditContact').classList.add('hidden');
    document.getElementById('btnCancelEdit').onclick = () => document.getElementById('modalEditContact').classList.add('hidden');
    document.getElementById('btnCloseObjectionsSheet').onclick = () => document.getElementById('modalObjectionsDrawer').classList.add('hidden');
    document.getElementById('btnDismissObjections').onclick = () => document.getElementById('modalObjectionsDrawer').classList.add('hidden');
    document.getElementById('btnCloseAnalytics').onclick = () => document.getElementById('modalAnalytics').classList.add('hidden');
    document.getElementById('btnDismissAnalytics').onclick = () => document.getElementById('modalAnalytics').classList.add('hidden');
    document.getElementById('btnOpenAnalytics').onclick = openAnalyticsModal;
    document.getElementById('btnTriggerUndo').onclick = executeUndoAction;
    document.getElementById('btnCancelPowerCountdown').onclick = cancelPowerDial;

    document.getElementById('formEditContact').onsubmit = handleContactSave;

    // File Management
    document.getElementById('fileCsvInput').onchange = (e) => { if (e.target.files.length) handleCsvFileSelect(e.target.files[0]); };
    document.getElementById('btnExportContactsCsv').onclick = exportContactsCsv;
    document.getElementById('btnExportLogsCsv').onclick = exportAuditLogsCsv;
    document.getElementById('btnExportJson').onclick = exportFullJsonBackup;
    document.getElementById('fileJsonRestore').onchange = (e) => { if (e.target.files.length) handleJsonRestoreFile(e.target.files[0]); };

    document.getElementById('btnClearAllData').onclick = async () => {
      if (confirm('Permanently purge ALL contacts and interactions from this device?')) {
        const tx = dbInstance.transaction(['contacts', 'interactions'], 'readwrite');
        tx.objectStore('contacts').clear();
        tx.objectStore('interactions').clear();
        tx.oncomplete = () => {
          state.contacts = [];
          applyPipelineFilter();
          alert('Database cleared.');
        };
      }
    };

    setupKeypadMatrixFSM();
    applyPipelineFilter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();