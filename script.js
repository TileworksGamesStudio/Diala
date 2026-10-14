/**
 * PERSONAL DIALER & CLIENT CONTACT MANAGEMENT
 * Bubbly Flip Phone Engine - High-Velocity Cockpit Edition
 * Optimized for Small Screen Devices (CAT S22 Flip / 2.8" Displays)
 * British Racing Green & Illuminated 24K Gold
 *
 * Strict Keypad Matrix:
 *  - LIST: [1] Call Lead | [2] Email Lead | [4] Logs | [5/*] Search | [6] Setup | [7] Fresh | [8] Call Back | [9] Contacted | [#] CSV | [Enter] Open Cockpit
 *  - COCKPIT: [1] Call | [2] Email | [3] No Answer | [4] Call Back | [5] Contacted | [6] Edit | [7] D.N.C. | [0] Back
 */

(() => {
  'use strict';

  // --- 1. MODULAR EMAIL TEMPLATES BANK ---
  const DEFAULT_EMAIL_TEMPLATES = {
    intro: {
      id: 'intro',
      title: 'Introduction',
      subject: 'Great speaking earlier | CannaGames resources for {company}',
      body: 'Hi {first_name},\n\nThank you for taking the time to speak with me earlier. I really appreciate the opportunity to introduce myself to {company}.\n\nTo recap: my name is Christian John, founder of Tileworks Studio. I’m developing a free educational web app that helps improve cannabis knowledge through fun, engaging puzzle games.\n\nThe aim is to improve cannabis education, focusing on the plant, products, science, strains, and the wider world of cannabis. By helping staff become confident, knowledgeable educators, we can build customer trust, improve experiences, and nurture a stronger culture of learning within the workplace.\n\nCannaGames is completely free, with no adverts, no personal data collection, and no payments required.\n\nYou can explore the app here:\nhttps://tileworksgamesstudio.github.io/CannaGames-Home/\n\nI’d really appreciate your support in helping the project reach your team. Sharing the app with your staff, encouraging them to try it, or passing it on to other businesses that may benefit would make a real difference. Any feedback would also be greatly appreciated.\n\nOur goal is to keep cannabis education accessible to everyone. Optional donations help us maintain the ad-free app and fund future updates and educational content:\nhttps://buy.stripe.com/14AbJ0czm3Ct3ARdPgefC0U\n\nThank you again for your time. I hope CannaGames can be a useful resource for your team and the wider cannabis industry.\n\nKind regards,\n\nChristian John\nFounder, Tileworks Studio'
    },
    followup: {
      id: 'followup',
      title: 'Post-Call Follow-Up',
      subject: 'Following up on our conversation | {first_name}',
      body: 'Hi {first_name},\n\nGreat speaking with you just now. As discussed, I am following up with the relevant details for {company}.\n\nLet me know if you have any questions.\n\nBest regards,\nChristian John'
    },
    voicemail: {
      id: 'voicemail',
      title: 'Left Voicemail',
      subject: 'Just left you a voicemail | {company}',
      body: 'Hi {first_name},\n\nI just left you a quick voicemail on {phone}. Please let me know when you might have 3 minutes to connect.\n\nBest regards,\nChristian John'
    },
    reconnect: {
      id: 'reconnect',
      title: 'Check-In',
      subject: 'Checking in | {company}',
      body: 'Hi {first_name},\n\nCircling back on our previous touchpoint. Would love to get a brief update on your schedule this week.\n\nBest regards,\nChristian John'
    }
  };

  // --- 2. IndexedDB Layer ---
  const DB_NAME = 'FlipDiallerDB';
  const DB_VERSION = 2;
  let dbInstance = null;

  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        if (!db.objectStoreNames.contains('contacts')) {
          const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
          contactStore.createIndex('company', 'company', { unique: false });
          contactStore.createIndex('name', 'name', { unique: false });
          contactStore.createIndex('phone', 'phone', { unique: false });
          contactStore.createIndex('stage', 'stage', { unique: false });
          contactStore.createIndex('next_callback_at', 'next_callback_at', { unique: false });
        }

        if (!db.objectStoreNames.contains('interactions')) {
          const logStore = db.createObjectStore('interactions', { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('contact_id', 'contact_id', { unique: false });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  function dbStore(storeName, mode) {
    return dbInstance.transaction(storeName, mode).objectStore(storeName);
  }

  // --- 3. App State ---
  const state = {
    contacts: [],
    filteredContacts: [],
    currentContactIndex: -1,
    activeQueue: 'uncontacted', // 'uncontacted' | 'callback' | 'contacted' | 'all'
    searchQuery: '',
    focusedCardIndex: 0,
    activeScreenId: 'screenContacts',
    emailTemplates: { ...DEFAULT_EMAIL_TEMPLATES },
    activeTemplateId: 'intro',
    pendingCallbackContact: null,
    settings: {
      dailyCallTarget: 10,
      todayCallCount: 0
    }
  };

  // --- 4. CSV Parsing Engine ---
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
          if (nextChar === '"') {
            currentField += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          currentRow.push(currentField.trim());
          currentField = '';
        } else if (char === '\r' || char === '\n') {
          currentRow.push(currentField.trim());
          if (currentRow.some(f => f.length > 0)) rows.push(currentRow);
          currentRow = [];
          currentField = '';
          if (char === '\r' && nextChar === '\n') i++;
        } else {
          currentField += char;
        }
      }
      i++;
    }
    if (currentField || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) rows.push(currentRow);
    }
    return rows;
  }

  function mapCSVToContacts(rows) {
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.toLowerCase().replace(/[\s\-_]+/g, '_'));
    
    const findIndex = (aliases) => {
      for (const a of aliases) {
        const idx = headers.indexOf(a);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idxCompany = findIndex(['company', 'business', 'organization', 'org', 'account', 'business_name', 'company_name']);
    const idxName = findIndex(['name', 'full_name', 'contact', 'client', 'contact_name']);
    const idxPhone = findIndex(['phone', 'telephone', 'mobile', 'cell', 'tel', 'phone_number']);
    const idxEmail = findIndex(['email', 'mail', 'email_address']);
    const idxRole = findIndex(['title', 'role', 'job_title', 'position']);
    const idxNotes = findIndex(['notes', 'comments', 'memo', 'description']);

    const contacts = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const company = (row[idxCompany] || '').trim();
      const name = (row[idxName] || '').trim();
      const phone = (row[idxPhone] || '').trim();
      const email = (row[idxEmail] || '').trim();

      if (company || name || phone || email) {
        contacts.push({
          id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8),
          company: company,
          name: name,
          phone: phone,
          email: email,
          job_title: (row[idxRole] || '').trim(),
          notes: (row[idxNotes] || '').trim(),
          stage: 'uncontacted',
          attempts: 0,
          last_contacted_at: null,
          next_callback_at: null,
          created_at: new Date().toISOString()
        });
      }
    }
    return contacts;
  }

  // --- 5. Formatters & Helpers ---
  function cleanPhoneForDial(str) {
    if (!str) return '';
    const hasPlus = str.trim().startsWith('+');
    const digits = str.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
  }

  function cleanBodyForEmailClient(text) {
    if (!text) return '';
    // If any HTML <a> tags were entered or stored, convert them cleanly to URLs
    return text
      .replace(/<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>.*?<\/a>/gi, '$1')
      .replace(/<[^>]+>/g, '');
  }

  function getInitials(primaryStr, fallbackStr) {
    const target = (primaryStr || fallbackStr || '?').trim();
    const parts = target.split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // --- 6. Data Persistence Operations ---
  async function loadAllData() {
    return new Promise((resolve) => {
      const store = dbStore('contacts', 'readonly');
      const req = store.getAll();
      req.onsuccess = () => {
        state.contacts = req.result || [];
        resolve(state.contacts);
      };
    });
  }

  async function saveContact(contact) {
    return new Promise((resolve) => {
      const store = dbStore('contacts', 'readwrite');
      store.put(contact).onsuccess = () => resolve(true);
    });
  }

  async function deleteContact(id) {
    return new Promise((resolve) => {
      const store = dbStore('contacts', 'readwrite');
      store.delete(id).onsuccess = () => {
        state.contacts = state.contacts.filter(c => c.id !== id);
        resolve(true);
      };
    });
  }

  async function logAudit(contactId, action, outcome, note) {
    const record = {
      contact_id: contactId,
      action: action,
      outcome: outcome,
      note: note || '',
      timestamp: new Date().toISOString()
    };
    return new Promise((resolve) => {
      const store = dbStore('interactions', 'readwrite');
      store.add(record).onsuccess = () => resolve(record);
    });
  }

  async function getAuditLogsForContact(contactId) {
    return new Promise((resolve) => {
      const store = dbStore('interactions', 'readonly');
      const index = store.index('contact_id');
      index.getAll(contactId).onsuccess = (e) => {
        const logs = e.target.result || [];
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(logs);
      };
    });
  }

  async function getAllAuditLogs() {
    return new Promise((resolve) => {
      const store = dbStore('interactions', 'readonly');
      store.getAll().onsuccess = (e) => {
        const logs = e.target.result || [];
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(logs);
      };
    });
  }

  async function loadSettings() {
    return new Promise((resolve) => {
      const store = dbStore('settings', 'readonly');
      store.get('app_prefs').onsuccess = async (e) => {
        if (e.target.result && e.target.result.val) {
          state.settings = { ...state.settings, ...e.target.result.val.settings };
          if (e.target.result.val.templates) {
            state.emailTemplates = { ...state.emailTemplates, ...e.target.result.val.templates };
          }
        }

        // Auto-heal: Purge any raw HTML tags from stored templates to fix mail client rendering
        let changed = false;
        if (state.emailTemplates.intro) {
          if (state.emailTemplates.intro.body.includes('<a href=') || !state.emailTemplates.intro.body.includes('CannaGames')) {
            state.emailTemplates.intro = DEFAULT_EMAIL_TEMPLATES.intro;
            changed = true;
          }
        }

        Object.keys(state.emailTemplates).forEach(k => {
          if (state.emailTemplates[k].body && state.emailTemplates[k].body.includes('<a href=')) {
            state.emailTemplates[k].body = cleanBodyForEmailClient(state.emailTemplates[k].body);
            changed = true;
          }
        });

        if (changed) {
          await persistSettings();
        }

        resolve(true);
      };
    });
  }

  async function persistSettings() {
    return new Promise((resolve) => {
      const store = dbStore('settings', 'readwrite');
      store.put({ key: 'app_prefs', val: { settings: state.settings, templates: state.emailTemplates } }).onsuccess = () => resolve(true);
    });
  }

  // --- 7. HUD Telemetry ---
  async function refreshTelemetryHUD() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const logs = await getAllAuditLogs();

    const todayCalls = logs.filter(l => l.action === 'call' && new Date(l.timestamp).toLocaleDateString('en-CA') === todayStr).length;
    document.getElementById('hudCallCount').textContent = `${todayCalls}/${state.settings.dailyCallTarget}`;

    const dueCount = state.contacts.filter(c => c.stage === 'callback' && c.next_callback_at && new Date(c.next_callback_at) <= now).length;
    document.getElementById('hudDueCount').textContent = `${dueCount} Due`;

    const uncontacted = state.contacts.filter(c => c.stage === 'uncontacted').length;
    const callbacks = state.contacts.filter(c => c.stage === 'callback').length;
    const contacted = state.contacts.filter(c => c.stage === 'contacted').length;

    document.getElementById('countUncontacted').textContent = uncontacted;
    document.getElementById('countCallback').textContent = callbacks;
    document.getElementById('countContacted').textContent = contacted;
  }

  // --- 8. Filter Pipeline & List Rendering ---
  function applyPipelineFilter() {
    const q = state.searchQuery.toLowerCase().trim();
    const stage = state.activeQueue;

    state.filteredContacts = state.contacts.filter(c => {
      const matchesSearch = !q ||
        (c.company && c.company.toLowerCase().includes(q)) ||
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q));

      if (!matchesSearch) return false;
      if (stage === 'all') return true;
      return c.stage === stage;
    });

    state.filteredContacts.sort((a, b) => {
      if (stage === 'callback') {
        return new Date(a.next_callback_at || 0) - new Date(b.next_callback_at || 0);
      }
      const titleA = (a.company || a.name || '').toLowerCase();
      const titleB = (b.company || b.name || '').toLowerCase();
      return titleA.localeCompare(titleB);
    });

    renderContactList();
    refreshTelemetryHUD();
  }

  function renderContactList() {
    const list = document.getElementById('contactList');
    if (state.filteredContacts.length === 0) {
      list.innerHTML = `
        <div class="bento-box" style="padding: 24px 8px; text-align: center;">
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 8px;">No leads in this queue.</p>
          <button id="btnEmptyImportTrigger" class="btn btn-gold btn-sm"><span class="key-badge">#</span> Import CSV</button>
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

      // BUSINESS NAME IS PRIMARY HEADER
      const primaryHeader = c.company ? c.company : (c.name ? c.name : '');
      const secondaryPerson = c.company && c.name ? (c.job_title ? `${c.name} • ${c.job_title}` : c.name) : (c.company ? '' : (c.job_title || ''));

      card.querySelector('.bento-avatar').textContent = getInitials(c.company, c.name);
      
      const headEl = card.querySelector('.bento-header-primary');
      if (primaryHeader) {
        headEl.textContent = primaryHeader;
      } else {
        headEl.style.display = 'none';
      }

      const subEl = card.querySelector('.bento-sub-person');
      if (secondaryPerson) {
        subEl.textContent = secondaryPerson;
      } else {
        subEl.style.display = 'none';
      }

      const phoneEl = card.querySelector('.bento-direct-phone');
      if (c.phone) {
        phoneEl.textContent = `📞 ${c.phone}`;
      } else {
        phoneEl.style.display = 'none';
      }

      // Status Tag
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

      card.addEventListener('click', () => openCockpit(c.id));
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

  // --- 9. Cockpit View (Zero-Placeholder Architecture) ---
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

    // Business Name as Header
    const heroTitle = clone.querySelector('.hero-business-title');
    const heroPerson = clone.querySelector('.hero-person-row');
    const heroPhone = clone.querySelector('.hero-phone-row');
    const heroEmail = clone.querySelector('.hero-email-row');

    if (contact.company) {
      heroTitle.textContent = contact.company;
      if (contact.name || contact.job_title) {
        heroPerson.textContent = [contact.name, contact.job_title].filter(Boolean).join(' • ');
      } else {
        heroPerson.style.display = 'none';
      }
    } else if (contact.name) {
      heroTitle.textContent = contact.name;
      if (contact.job_title) {
        heroPerson.textContent = contact.job_title;
      } else {
        heroPerson.style.display = 'none';
      }
    } else {
      heroTitle.style.display = 'none';
      heroPerson.style.display = 'none';
    }

    // Phone / Email rows (zero placeholder strings)
    if (contact.phone) {
      heroPhone.textContent = `📞 ${contact.phone}`;
    } else {
      heroPhone.style.display = 'none';
    }

    if (contact.email) {
      heroEmail.textContent = `✉️ ${contact.email}`;
    } else {
      heroEmail.style.display = 'none';
    }

    // DUAL ACTION: VOICE CALL TILE
    const cleanPhone = cleanPhoneForDial(contact.phone);
    const callBtn = clone.querySelector('#btnCockpitCall');
    if (cleanPhone) {
      callBtn.href = `tel:${cleanPhone}`;
      callBtn.onclick = () => {
        logAudit(contact.id, 'call', 'Dialed', `Outbound voice call to ${cleanPhone}`);
        refreshTelemetryHUD();
      };
      callBtn.style.opacity = '1';
    } else {
      callBtn.href = '#';
      callBtn.onclick = (e) => { e.preventDefault(); alert('No phone number recorded.'); };
      callBtn.style.opacity = '0.4';
    }

    // DUAL ACTION: SHOOT EMAIL TILE
    const emailBtn = clone.querySelector('#btnCockpitEmail');
    if (contact.email) {
      emailBtn.onclick = () => openEmailPickerSheet(contact);
      emailBtn.style.opacity = '1';
    } else {
      emailBtn.onclick = () => alert('No email address recorded.');
      emailBtn.style.opacity = '0.4';
    }

    // 4-WAY INSTANT DISPOSITION (KEYS 3, 4, 5, 7)
    clone.querySelector('#btnDispNoAnswer').onclick = () => handleDispositionNoAnswer(contact);
    clone.querySelector('#btnDispCallBack').onclick = () => openCallbackScheduler(contact);
    clone.querySelector('#btnDispContacted').onclick = () => handleDispositionContacted(contact);
    clone.querySelector('#btnDispDNC').onclick = () => handleDispositionDNC(contact);

    // Notes Box: Hide completely if empty
    const notesBox = clone.querySelector('#cockpitNotesBox');
    const notesText = clone.querySelector('.cockpit-notes-text');
    if (contact.notes && contact.notes.trim()) {
      notesText.textContent = contact.notes;
    } else {
      notesBox.style.display = 'none';
    }
    clone.querySelector('#btnQuickEditNotes').onclick = () => openEditModal(contact);

    // Activity History Box: Hide if zero interactions
    const historyBox = clone.querySelector('#cockpitHistoryBox');
    const feed = clone.querySelector('.cockpit-history-feed');
    const logs = await getAuditLogsForContact(contact.id);
    
    if (logs.length > 0) {
      clone.querySelector('.cockpit-log-count').textContent = `${logs.length}`;
      logs.forEach(l => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <div class="history-head">
            <span>${l.action.toUpperCase()}</span>
            <span>${formatDate(l.timestamp)}</span>
          </div>
          <div class="history-action">${l.outcome}</div>
          ${l.note ? `<div style="font-size: 0.72rem; color: #b2cfbe;">${l.note}</div>` : ''}
        `;
        feed.appendChild(item);
      });
    } else {
      historyBox.style.display = 'none';
    }

    container.replaceChildren(clone);
  }

  // --- 10. Instant 4-Way Disposition Handlers ---
  async function handleDispositionNoAnswer(contact) {
    contact.attempts = (contact.attempts || 0) + 1;
    contact.last_contacted_at = new Date().toISOString();
    contact.stage = 'uncontacted'; // Stays in fresh queue

    await saveContact(contact);
    await logAudit(contact.id, 'disposition', 'No Answer', `Dial attempt #${contact.attempts}`);
    advanceToNextLeadOrExit();
  }

  function openCallbackScheduler(contact) {
    state.pendingCallbackContact = contact;
    document.getElementById('customCallbackInput').value = '';
    document.getElementById('modalScheduleCallback').classList.remove('hidden');
  }

  async function scheduleCallbackForLead(hoursOffset, customIsoString = null) {
    const contact = state.pendingCallbackContact;
    if (!contact) return;

    let targetDate;
    if (customIsoString) {
      targetDate = new Date(customIsoString);
    } else {
      targetDate = new Date();
      targetDate.setHours(targetDate.getHours() + hoursOffset);
    }

    contact.stage = 'callback';
    contact.next_callback_at = targetDate.toISOString();
    contact.last_contacted_at = new Date().toISOString();

    await saveContact(contact);
    await logAudit(contact.id, 'disposition', 'Call Back Scheduled', `Due: ${formatDate(contact.next_callback_at)}`);

    document.getElementById('modalScheduleCallback').classList.add('hidden');
    state.pendingCallbackContact = null;
    advanceToNextLeadOrExit();
  }

  async function handleDispositionContacted(contact) {
    contact.stage = 'contacted';
    contact.next_callback_at = null;
    contact.last_contacted_at = new Date().toISOString();

    await saveContact(contact);
    await logAudit(contact.id, 'disposition', 'Contacted / Spoken', 'Successfully contacted');
    advanceToNextLeadOrExit();
  }

  async function handleDispositionDNC(contact) {
    const promptName = contact.company || contact.name || 'this lead';
    if (confirm(`Mark "${promptName}" as D.N.C. and delete contact?`)) {
      await logAudit(contact.id, 'disposition', 'DNC / Purged', 'Scrubbed from records');
      await deleteContact(contact.id);
      advanceToNextLeadOrExit();
    }
  }

  function advanceToNextLeadOrExit() {
    applyPipelineFilter();
    if (state.filteredContacts.length > 0) {
      if (state.currentContactIndex >= state.filteredContacts.length) {
        state.currentContactIndex = 0;
      }
      renderCockpitView(state.filteredContacts[state.currentContactIndex]);
    } else {
      switchScreen('screenContacts');
    }
  }

  // --- 11. Email Drawer Logic ---
  function openEmailPickerSheet(contact) {
    if (!contact.email) {
      alert('Lead has no registered email.');
      return;
    }

    const select = document.getElementById('pickerTemplateSelect');
    select.replaceChildren();

    Object.values(state.emailTemplates).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      select.appendChild(opt);
    });

    select.value = state.activeTemplateId;
    updateEmailDraftFields(contact, state.activeTemplateId);

    select.onchange = (e) => {
      state.activeTemplateId = e.target.value;
      updateEmailDraftFields(contact, state.activeTemplateId);
    };

    document.getElementById('btnLaunchMailtoApp').onclick = () => launchMailtoNative(contact);
    document.getElementById('btnLaunchWebGmail').onclick = () => launchGmailWebTab(contact);
    document.getElementById('btnMarkEmailLogged').onclick = async () => {
      await logAudit(contact.id, 'email', 'Template Sent', document.getElementById('draftSubject').value);
      document.getElementById('modalEmailPicker').classList.add('hidden');
      renderCockpitView(contact);
      refreshTelemetryHUD();
    };

    document.getElementById('modalEmailPicker').classList.remove('hidden');
  }

  function updateEmailDraftFields(contact, templateId) {
    const t = state.emailTemplates[templateId] || state.emailTemplates.intro;
    const firstName = contact.name ? contact.name.trim().split(' ')[0] : 'there';
    const comp = contact.company || '';

    const sub = t.subject
      .replace('{name}', contact.name || '')
      .replace('{first_name}', firstName)
      .replace('{company}', comp);

    const body = cleanBodyForEmailClient(t.body)
      .replace('{name}', contact.name || '')
      .replace('{first_name}', firstName)
      .replace('{company}', comp)
      .replace('{phone}', contact.phone || '');

    document.getElementById('draftSubject').value = sub;
    document.getElementById('draftBody').value = body;
  }

  function launchMailtoNative(contact) {
    const to = encodeURIComponent(contact.email);
    const sub = encodeURIComponent(document.getElementById('draftSubject').value);
    const cleanBody = cleanBodyForEmailClient(document.getElementById('draftBody').value);
    const body = encodeURIComponent(cleanBody);
    window.location.href = `mailto:${to}?subject=${sub}&body=${body}`;
  }

  function launchGmailWebTab(contact) {
    const to = encodeURIComponent(contact.email);
    const sub = encodeURIComponent(document.getElementById('draftSubject').value);
    const cleanBody = cleanBodyForEmailClient(document.getElementById('draftBody').value);
    const body = encodeURIComponent(cleanBody);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${sub}&body=${body}`, '_blank');
  }

  // --- 12. Screen Switching ---
  function switchScreen(targetScreenId) {
    state.activeScreenId = targetScreenId;

    document.querySelectorAll('.screen-view').forEach(s => {
      s.classList.add('hidden');
      s.classList.remove('active');
    });

    const active = document.getElementById(targetScreenId);
    if (active) {
      active.classList.remove('hidden');
      active.classList.add('active');
      active.scrollTop = 0;
    }

    const titleMap = {
      screenContacts: state.activeQueue.toUpperCase(),
      screenProfile: 'COCKPIT',
      screenHistory: 'AUDIT LOGS',
      screenSettings: 'SETTINGS'
    };
    document.getElementById('activeScreenTitle').textContent = titleMap[targetScreenId] || 'DIALLER';

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
    const logs = await getAllAuditLogs();

    if (logs.length === 0) {
      container.innerHTML = '<div class="bento-box" style="text-align:center;"><p style="color:var(--text-muted);">No logs recorded.</p></div>';
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
        ${l.note ? `<div style="font-size:0.75rem; color:#b2cfbe;">${l.note}</div>` : ''}
      `;
      container.appendChild(div);
    });
  }

  // --- 13. Edit Contact Modal ---
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

  async function handleContactSave(e) {
    e.preventDefault();
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

  // --- 14. ORTHOGONAL HARDWARE KEYPAD ENGINE (NO OVERLAPPING MAPPINGS) ---
  function setupHardwareKeypadShortcuts() {
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const inInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      // 1. GLOBAL ESCAPE / HARDWARE BACK BUTTON
      if (e.key === 'Escape' || e.key === 'Backspace') {
        const openModal = document.querySelector('.modal-sheet-backdrop:not(.hidden)');
        if (openModal) {
          openModal.classList.add('hidden');
          e.preventDefault();
          return;
        }
        if (state.activeScreenId === 'screenProfile' || state.activeScreenId === 'screenHistory' || state.activeScreenId === 'screenSettings') {
          switchScreen('screenContacts');
          e.preventDefault();
          return;
        }
      }

      // If typing inside an input field, allow text entry
      if (inInput) {
        if (e.key === 'Enter') {
          if (document.activeElement.id === 'searchInput') {
            document.activeElement.blur();
            e.preventDefault();
          }
        }
        return;
      }

      // 2. MODAL-ISOLATED KEYPAD MAPPINGS (PREVENTS BACKGROUND FIRING)
      const isCallbackOpen = !document.getElementById('modalScheduleCallback').classList.contains('hidden');
      const isEmailOpen = !document.getElementById('modalEmailPicker').classList.contains('hidden');
      const isEditOpen = !document.getElementById('modalEditContact').classList.contains('hidden');

      if (isCallbackOpen) {
        if (e.key === '1') { scheduleCallbackForLead(2); e.preventDefault(); return; }
        if (e.key === '2') { scheduleCallbackForLead(4); e.preventDefault(); return; }
        if (e.key === '3') { scheduleCallbackForLead(24); e.preventDefault(); return; }
        if (e.key === '4') { scheduleCallbackForLead(48); e.preventDefault(); return; }
        if (e.key === '5') { scheduleCallbackForLead(168); e.preventDefault(); return; }
        if (e.key === '0') { document.getElementById('modalScheduleCallback').classList.add('hidden'); e.preventDefault(); return; }
        return;
      }

      if (isEmailOpen) {
        const contact = state.filteredContacts[state.currentContactIndex];
        if (e.key === '1') { if (contact) launchMailtoNative(contact); e.preventDefault(); return; }
        if (e.key === '2') { if (contact) launchGmailWebTab(contact); e.preventDefault(); return; }
        if (e.key === '3') { document.getElementById('btnMarkEmailLogged').click(); e.preventDefault(); return; }
        if (e.key === '0') { document.getElementById('modalEmailPicker').classList.add('hidden'); e.preventDefault(); return; }
        return;
      }

      if (isEditOpen) {
        if (e.key === '0') { document.getElementById('modalEditContact').classList.add('hidden'); e.preventDefault(); return; }
        return;
      }

      // 3. COCKPIT (PROFILE) SCREEN - EXCLUSIVE KEYS
      if (state.activeScreenId === 'screenProfile' && state.currentContactIndex !== -1) {
        const contact = state.filteredContacts[state.currentContactIndex];
        switch (e.key) {
          case '1': // VOICE CALL
            e.preventDefault();
            document.getElementById('btnCockpitCall').click();
            break;

          case '2': // EMAIL DRAWER
            e.preventDefault();
            if (contact && contact.email) openEmailPickerSheet(contact);
            else alert('No email address on file.');
            break;

          case '3': // DISPOSITION: NO ANSWER (Keeps in Fresh)
            e.preventDefault();
            handleDispositionNoAnswer(contact);
            break;

          case '4': // DISPOSITION: CALL BACK (Opens Schedule)
            e.preventDefault();
            openCallbackScheduler(contact);
            break;

          case '5': // DISPOSITION: CONTACTED (Graduates to Contacted)
            e.preventDefault();
            handleDispositionContacted(contact);
            break;

          case '6': // EDIT LEAD DETAILS
            e.preventDefault();
            openEditModal(contact);
            break;

          case '7': // DISPOSITION: D.N.C. (Purges Contact)
            e.preventDefault();
            handleDispositionDNC(contact);
            break;

          case '0': // RETURN TO LIST
            e.preventDefault();
            switchScreen('screenContacts');
            break;
        }
        return;
      }

      // 4. CONTACTS LIST SCREEN - EXCLUSIVE KEYS
      if (state.activeScreenId === 'screenContacts') {
        // D-Pad Navigation
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

        // Numeric Keypad
        switch (e.key) {
          case '1': // DIRECT CALL HIGHLIGHTED LEAD
            e.preventDefault();
            const targetLead = state.filteredContacts[state.focusedCardIndex];
            if (targetLead && targetLead.phone) {
              const clean = cleanPhoneForDial(targetLead.phone);
              logAudit(targetLead.id, 'call', 'Dialed', `Quick dial to ${clean}`);
              window.location.href = `tel:${clean}`;
            }
            break;

          case '2': // DIRECT EMAIL HIGHLIGHTED LEAD
            e.preventDefault();
            const emailLead = state.filteredContacts[state.focusedCardIndex];
            if (emailLead && emailLead.email) {
              openEmailPickerSheet(emailLead);
            }
            break;

          case '4': // SWITCH TO AUDIT LOGS
            e.preventDefault();
            switchScreen('screenHistory');
            break;

          case '5': // SEARCH FOCUS
          case '*':
            e.preventDefault();
            document.getElementById('searchInput').focus();
            break;

          case '6': // SWITCH TO SETUP
            e.preventDefault();
            switchScreen('screenSettings');
            break;

          case '7': // FILTER: FRESH QUEUE
            e.preventDefault();
            selectQueue('uncontacted');
            break;

          case '8': // FILTER: CALL BACK QUEUE
            e.preventDefault();
            selectQueue('callback');
            break;

          case '9': // FILTER: CONTACTED QUEUE
            e.preventDefault();
            selectQueue('contacted');
            break;

          case '0': // RESET SCROLL TO TOP
            e.preventDefault();
            state.focusedCardIndex = 0;
            highlightCard(true);
            break;

          case '#': // TRIGGER CSV IMPORT
            e.preventDefault();
            document.getElementById('fileCsvInput').click();
            break;
        }
        return;
      }

      // 5. LOGS & SETTINGS SCREENS
      if (state.activeScreenId === 'screenHistory' || state.activeScreenId === 'screenSettings') {
        if (e.key === '0' || e.key === '1') {
          e.preventDefault();
          switchScreen('screenContacts');
        }
      }
    });
  }

  function selectQueue(q) {
    document.querySelectorAll('.stage-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.queue === q);
    });
    state.activeQueue = q;
    state.focusedCardIndex = 0;
    applyPipelineFilter();
  }

  // --- 15. CSV Import & Export ---
  function handleCsvFileSelect(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const rows = parseCSV(text);
        const imported = mapCSVToContacts(rows);

        if (imported.length === 0) {
          alert('No leads detected in CSV.');
          return;
        }

        const tx = dbInstance.transaction('contacts', 'readwrite');
        const store = tx.objectStore('contacts');
        imported.forEach(c => store.put(c));

        tx.oncomplete = async () => {
          await loadAllData();
          applyPipelineFilter();
          alert(`Imported ${imported.length} leads into Fresh.`);
        };
      } catch (err) {
        alert('CSV import error: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function exportCsvFile() {
    if (state.contacts.length === 0) {
      alert('No contacts to export.');
      return;
    }
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

  // --- 16. App Initialization ---
  async function initApp() {
    await initDB();
    await loadSettings();
    await loadAllData();

    document.getElementById('inputDailyCallTarget').value = state.settings.dailyCallTarget || 10;
    
    // Setup Template Selector in Settings
    const tmplSelect = document.getElementById('templateSelector');
    tmplSelect.replaceChildren();
    Object.values(state.emailTemplates).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      tmplSelect.appendChild(opt);
    });

    const loadTemplateToSettings = (id) => {
      const t = state.emailTemplates[id] || state.emailTemplates.intro;
      document.getElementById('templateSubject').value = t.subject;
      document.getElementById('templateBody').value = cleanBodyForEmailClient(t.body);
    };

    tmplSelect.onchange = (e) => loadTemplateToSettings(e.target.value);
    loadTemplateToSettings(tmplSelect.value);

    document.getElementById('btnSaveTemplate').onclick = async () => {
      const id = tmplSelect.value;
      if (state.emailTemplates[id]) {
        state.emailTemplates[id].subject = document.getElementById('templateSubject').value;
        state.emailTemplates[id].body = cleanBodyForEmailClient(document.getElementById('templateBody').value);
        await persistSettings();
        alert('Template saved!');
      }
    };

    document.getElementById('btnSaveTarget').onclick = async () => {
      state.settings.dailyCallTarget = parseInt(document.getElementById('inputDailyCallTarget').value, 10) || 10;
      await persistSettings();
      refreshTelemetryHUD();
      alert('Goal saved!');
    };

    // Stage Tab Clicks
    document.querySelectorAll('.stage-tab').forEach(tab => {
      tab.addEventListener('click', (e) => selectQueue(e.currentTarget.dataset.queue));
    });

    // Search events
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

    // Callback choices
    document.querySelectorAll('.quick-choice-grid .btn-choice').forEach(b => {
      b.addEventListener('click', (e) => scheduleCallbackForLead(parseInt(e.currentTarget.dataset.hours, 10)));
    });

    document.getElementById('btnConfirmCallbackSchedule').onclick = () => {
      const val = document.getElementById('customCallbackInput').value;
      if (!val) { alert('Pick a time option or pick custom date.'); return; }
      scheduleCallbackForLead(0, val);
    };

    document.getElementById('btnCancelCallback').onclick = () => {
      document.getElementById('modalScheduleCallback').classList.add('hidden');
    };
    document.getElementById('btnCloseCallbackSheet').onclick = () => {
      document.getElementById('modalScheduleCallback').classList.add('hidden');
    };

    // Bottom Dock navigation
    document.querySelectorAll('.dock-item').forEach(btn => {
      btn.onclick = () => switchScreen(btn.dataset.screen);
    });

    document.getElementById('btnDockBack').onclick = () => switchScreen('screenContacts');
    document.getElementById('btnDockEdit').onclick = () => {
      if (state.currentContactIndex !== -1) {
        openEditModal(state.filteredContacts[state.currentContactIndex]);
      }
    };

    // Modals Close & Submit
    document.getElementById('btnCancelEmail').onclick = () => {
      document.getElementById('modalEmailPicker').classList.add('hidden');
    };
    document.getElementById('btnCloseEmailSheet').onclick = () => {
      document.getElementById('modalEmailPicker').classList.add('hidden');
    };
    document.getElementById('btnCancelEdit').onclick = () => {
      document.getElementById('modalEditContact').classList.add('hidden');
    };
    document.getElementById('btnCloseEditSheet').onclick = () => {
      document.getElementById('modalEditContact').classList.add('hidden');
    };
    document.getElementById('formEditContact').onsubmit = handleContactSave;

    // CSV File Operations
    document.getElementById('fileCsvInput').addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleCsvFileSelect(e.target.files[0]);
    });
    document.getElementById('btnExportCsv').onclick = exportCsvFile;

    document.getElementById('btnClearAllData').onclick = async () => {
      if (confirm('Permanently wipe ALL local records?')) {
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

    setupHardwareKeypadShortcuts();
    applyPipelineFilter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();