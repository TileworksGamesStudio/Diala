/**
 * PERSONAL DIALER & CLIENT CONTACT MANAGEMENT
 * Compact Mobile & Hardware Keypad (CAT S22 Flip / D-Pad) Engine
 * With On-The-Fly Contact Detail Editing (Key 7 / Enter)
 * British Racing Green & Gold Edition
 */

(() => {
  'use strict';

  // --- 1. Database & Persistence Layer (IndexedDB) ---
  const DB_NAME = 'PersonalDialerDB';
  const DB_VERSION = 1;
  let dbInstance = null;

  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        if (!db.objectStoreNames.contains('contacts')) {
          const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
          contactStore.createIndex('name', 'name', { unique: false });
          contactStore.createIndex('phone', 'phone', { unique: false });
          contactStore.createIndex('email', 'email', { unique: false });
          contactStore.createIndex('next_follow_up_at', 'next_follow_up_at', { unique: false });
          contactStore.createIndex('status', 'status', { unique: false });
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

      request.onerror = (e) => {
        console.error('IndexedDB Open Error:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  function dbTransaction(storeName, mode) {
    return dbInstance.transaction(storeName, mode).objectStore(storeName);
  }

  // --- 2. State & Defaults ---
  const state = {
    contacts: [],
    filteredContacts: [],
    currentContactIndex: -1,
    activeQueue: 'all',
    searchQuery: '',
    lastCallTimestamp: null,
    pendingCallContact: null,
    emailDraftContext: null,
    parsedImportData: null,
    activeScreenId: 'screenContacts',
    settings: {
      templateSubject: 'Following up regarding our conversation',
      templateBody: 'Hi {first_name},\n\nThank you for speaking today. As discussed, following up with details.\n\nBest regards,\n[Your Name]',
      dailyTargetCalls: 10
    }
  };

  // --- 3. RFC 4180 CSV Engine ---
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }

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
          if (currentRow.length > 0 && currentRow.some(field => field.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
          if (char === '\r' && nextChar === '\n') {
            i++;
          }
        } else {
          currentField += char;
        }
      }
      i++;
    }

    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some(field => field.length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  function mapCSVToContacts(rows) {
    if (rows.length < 2) return [];

    const rawHeaders = rows[0].map(h => h.toLowerCase().replace(/[\s\-_]+/g, '_'));
    const standardMap = {
      name: ['name', 'full_name', 'contact_name', 'client_name'],
      phone: ['phone', 'telephone', 'mobile', 'cell', 'phone_number'],
      email: ['email', 'email_address'],
      country: ['country', 'nation'],
      city: ['city', 'town'],
      street_address: ['street_address', 'address', 'street', 'address_line_1'],
      postal_code: ['postal_code', 'zip', 'zip_code', 'postcode'],
      company: ['company', 'organisation', 'business', 'org'],
      job_title: ['job_title', 'title', 'role'],
      notes: ['notes', 'comments', 'memo']
    };

    const headerIndexes = {};
    for (const [key, aliases] of Object.entries(standardMap)) {
      for (const alias of aliases) {
        const idx = rawHeaders.indexOf(alias);
        if (idx !== -1) {
          headerIndexes[key] = idx;
          break;
        }
      }
    }

    const contacts = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length === 0) continue;

      const contact = {
        id: 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: row[headerIndexes.name] || 'Unnamed Contact',
        phone: row[headerIndexes.phone] || '',
        email: row[headerIndexes.email] || '',
        country: row[headerIndexes.country] || '',
        city: row[headerIndexes.city] || '',
        street_address: row[headerIndexes.street_address] || '',
        postal_code: row[headerIndexes.postal_code] || '',
        company: row[headerIndexes.company] || '',
        job_title: row[headerIndexes.job_title] || '',
        notes: row[headerIndexes.notes] || '',
        status: 'uncontacted',
        last_contacted_at: null,
        next_follow_up_at: null,
        created_at: new Date().toISOString()
      };

      if (contact.name || contact.phone || contact.email) {
        contacts.push(contact);
      }
    }
    return contacts;
  }

  // --- 4. Formatters & Helpers ---
  function normalisePhoneForDial(phoneStr) {
    if (!phoneStr) return '';
    const hasPlus = phoneStr.trim().startsWith('+');
    const digits = phoneStr.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
  }

  function formatDate(isoStr) {
    if (!isoStr) return 'Never';
    const date = new Date(isoStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // --- 5. Data Access Layer ---
  async function loadAllContacts() {
    return new Promise((resolve, reject) => {
      try {
        const store = dbTransaction('contacts', 'readonly');
        const req = store.getAll();
        req.onsuccess = () => {
          state.contacts = req.result || [];
          resolve(state.contacts);
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function saveContact(contact) {
    return new Promise((resolve, reject) => {
      try {
        const store = dbTransaction('contacts', 'readwrite');
        const req = store.put(contact);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function logInteraction(contactId, type, outcome, note, followUp) {
    const record = {
      contact_id: contactId,
      type: type,
      outcome: outcome,
      note: note || '',
      follow_up_scheduled: followUp || null,
      timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      try {
        const store = dbTransaction('interactions', 'readwrite');
        const req = store.add(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function getAllInteractions() {
    return new Promise((resolve, reject) => {
      try {
        const store = dbTransaction('interactions', 'readonly');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function getInteractionsForContact(contactId) {
    return new Promise((resolve, reject) => {
      try {
        const store = dbTransaction('interactions', 'readonly');
        const index = store.index('contact_id');
        const req = index.getAll(contactId);
        req.onsuccess = () => {
          const logs = req.result || [];
          logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          resolve(logs);
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function loadSettings() {
    return new Promise((resolve, reject) => {
      try {
        const store = dbTransaction('settings', 'readonly');
        const req = store.get('app_preferences');
        req.onsuccess = () => {
          if (req.result && req.result.value) {
            state.settings = { ...state.settings, ...req.result.value };
          }
          resolve(state.settings);
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function saveSettings() {
    return new Promise((resolve, reject) => {
      try {
        const store = dbTransaction('settings', 'readwrite');
        const req = store.put({ key: 'app_preferences', value: state.settings });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- 6. Metric Computation & Gamification ---
  async function updateGamifiedMetrics() {
    const total = state.contacts.length;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const dueToday = state.contacts.filter(c => {
      if (!c.next_follow_up_at || c.status === 'do_not_contact') return false;
      return new Date(c.next_follow_up_at) <= todayEnd;
    }).length;

    const allLogs = await getAllInteractions();
    const callsTotal = allLogs.filter(l => l.type === 'call').length;

    const callsToday = allLogs.filter(l => {
      return l.type === 'call' && l.timestamp.slice(0, 10) === todayStr;
    }).length;

    const distinctCallDays = new Set(
      allLogs
        .filter(l => l.type === 'call')
        .map(l => new Date(l.timestamp).toLocaleDateString('en-CA'))
    );

    let streak = 0;
    let checkDate = new Date();
    const checkDateStr = checkDate.toLocaleDateString('en-CA');

    if (distinctCallDays.has(checkDateStr)) {
      while (distinctCallDays.has(checkDate.toLocaleDateString('en-CA'))) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      }
    } else {
      checkDate.setDate(checkDate.getDate() - 1);
      while (distinctCallDays.has(checkDate.toLocaleDateString('en-CA'))) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      }
    }

    document.getElementById('streakCountText').textContent = `${streak}d`;

    const goal = state.settings.dailyTargetCalls || 10;
    const pct = Math.min(100, Math.round((callsToday / goal) * 100));
    
    const ringCircle = document.getElementById('targetProgressCircle');
    const circumference = 2 * Math.PI * 13;
    const offset = circumference - (pct / 100) * circumference;
    ringCircle.style.strokeDashoffset = offset;

    document.getElementById('targetPercentLabel').textContent = `${pct}%`;

    const clearBanner = document.getElementById('queueClearBanner');
    if (dueToday === 0 && total > 0) {
      clearBanner.classList.remove('hidden');
    } else {
      clearBanner.classList.add('hidden');
    }

    document.getElementById('metricTotal').querySelector('.metric-val').textContent = total;
    document.getElementById('metricDue').querySelector('.metric-val').textContent = dueToday;
    document.getElementById('metricCalls').querySelector('.metric-val').textContent = callsTotal;
  }

  // --- 7. List Filtering & Rendering ---
  function applyFiltersAndRender() {
    const query = state.searchQuery.toLowerCase().trim();
    const queue = state.activeQueue;
    const now = new Date();

    state.filteredContacts = state.contacts.filter(contact => {
      const searchMatch = !query ||
        contact.name.toLowerCase().includes(query) ||
        contact.phone.toLowerCase().includes(query) ||
        contact.email.toLowerCase().includes(query) ||
        contact.city.toLowerCase().includes(query) ||
        contact.company.toLowerCase().includes(query) ||
        contact.notes.toLowerCase().includes(query);

      if (!searchMatch) return false;

      if (queue === 'all') return true;
      if (queue === 'new') return contact.status === 'uncontacted';
      if (queue === 'due') {
        if (!contact.next_follow_up_at || contact.status === 'do_not_contact') return false;
        return new Date(contact.next_follow_up_at) <= new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      }
      if (queue === 'recent') {
        return contact.last_contacted_at !== null;
      }
      return true;
    });

    state.filteredContacts.sort((a, b) => {
      if (queue === 'due') {
        return new Date(a.next_follow_up_at) - new Date(b.next_follow_up_at);
      }
      if (queue === 'recent') {
        return new Date(b.last_contacted_at) - new Date(a.last_contacted_at);
      }
      return a.name.localeCompare(b.name);
    });

    renderContactList();
    updateGamifiedMetrics();
  }

  function renderContactList() {
    const listContainer = document.getElementById('contactList');
    
    if (state.filteredContacts.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <p>No contacts found.</p>
          <button id="btnEmptyImportTrigger" class="btn btn-gold btn-sm">Import CSV</button>
        </div>`;
      const btn = document.getElementById('btnEmptyImportTrigger');
      if (btn) btn.onclick = () => document.getElementById('fileCsvInput').click();
      return;
    }

    const template = document.getElementById('tmpl-contact-card');
    const fragment = document.createDocumentFragment();

    state.filteredContacts.forEach((contact, idx) => {
      const clone = template.content.cloneNode(true);
      const card = clone.querySelector('.contact-card');
      card.dataset.id = contact.id;
      card.dataset.index = idx;

      card.querySelector('.contact-name').textContent = contact.name;
      
      const metaParts = [];
      if (contact.company) metaParts.push(contact.company);
      else if (contact.phone) metaParts.push(contact.phone);
      card.querySelector('.contact-meta').textContent = metaParts.join(' • ') || 'No company';

      const badge = card.querySelector('.badge');
      if (contact.status === 'do_not_contact') {
        badge.className = 'badge badge-dnc';
        badge.textContent = 'DNC';
      } else if (contact.next_follow_up_at && new Date(contact.next_follow_up_at) <= new Date()) {
        badge.className = 'badge badge-due';
        badge.textContent = 'Due';
      } else if (contact.last_contacted_at) {
        badge.className = 'badge badge-contacted';
        badge.textContent = 'Done';
      } else {
        badge.className = 'badge badge-new';
        badge.textContent = 'New';
      }

      card.addEventListener('click', () => openContactProfile(contact.id));
      fragment.appendChild(clone);
    });

    listContainer.replaceChildren(fragment);
  }

  // --- 8. Profile View & Sticky Actions ---
  function openContactProfile(contactId) {
    const index = state.filteredContacts.findIndex(c => c.id === contactId);
    if (index === -1) return;

    state.currentContactIndex = index;
    renderProfileView(state.filteredContacts[index]);
    switchScreen('screenProfile');
  }

  async function renderProfileView(contact) {
    const detailsContainer = document.getElementById('profileDetails');
    const template = document.getElementById('tmpl-bento-profile');
    const clone = template.content.cloneNode(true);

    // Hero
    clone.querySelector('.bento-avatar').textContent = getInitials(contact.name);
    clone.querySelector('.bento-name').textContent = contact.name;
    
    const roleParts = [];
    if (contact.job_title) roleParts.push(contact.job_title);
    if (contact.company) roleParts.push(contact.company);
    clone.querySelector('.bento-role-company').textContent = roleParts.join(' at ') || 'No company listed';

    const statusBadge = clone.querySelector('.bento-status-badge');
    if (contact.status === 'do_not_contact') {
      statusBadge.className = 'badge badge-dnc';
      statusBadge.textContent = 'DNC';
    } else if (contact.next_follow_up_at && new Date(contact.next_follow_up_at) <= new Date()) {
      statusBadge.className = 'badge badge-due';
      statusBadge.textContent = 'Overdue';
    } else {
      statusBadge.className = 'badge badge-new';
      statusBadge.textContent = contact.status;
    }

    // Direct Comms
    clone.querySelector('.bento-phone-val').textContent = contact.phone || 'None registered';
    clone.querySelector('.bento-email-val').textContent = contact.email || 'None registered';

    // Outreach
    const scheduleDateText = clone.querySelector('.schedule-date-text');
    const scheduleRelativeTime = clone.querySelector('.schedule-relative-time');
    if (contact.next_follow_up_at) {
      scheduleDateText.textContent = formatDate(contact.next_follow_up_at);
      const isOverdue = new Date(contact.next_follow_up_at) < new Date();
      scheduleRelativeTime.textContent = isOverdue ? '⚠️ Overdue' : 'Scheduled';
    } else {
      scheduleDateText.textContent = 'None Scheduled';
      scheduleRelativeTime.textContent = 'Press 3 to log';
    }

    // Location / Address
    const addressStr = [contact.street_address, contact.city, contact.postal_code, contact.country]
      .filter(Boolean)
      .join(', ');
    clone.querySelector('.bento-address-val').textContent = addressStr || 'No address registered.';

    // Notes
    clone.querySelector('.bento-notes-content').textContent = contact.notes || 'No notes added.';

    // Sticky Action Dock setup
    const dialPhone = normalisePhoneForDial(contact.phone);
    const callBtn = document.getElementById('btnActionCall');
    if (dialPhone) {
      callBtn.href = `tel:${dialPhone}`;
      callBtn.onclick = () => {
        state.lastCallTimestamp = Date.now();
        state.pendingCallContact = contact;
      };
      callBtn.style.opacity = '1';
      callBtn.style.pointerEvents = 'auto';
    } else {
      callBtn.href = '#';
      callBtn.onclick = (e) => {
        e.preventDefault();
        alert('No phone number available.');
      };
      callBtn.style.opacity = '0.5';
    }

    detailsContainer.replaceChildren(clone);

    // Populate Activity Timeline
    const historyListContainer = detailsContainer.querySelector('.bento-history-list');
    const logCountLabel = detailsContainer.querySelector('.bento-log-count');
    const historyLogs = await getInteractionsForContact(contact.id);
    
    logCountLabel.textContent = `${historyLogs.length}`;

    if (historyLogs.length === 0) {
      historyListContainer.innerHTML = '<p style="font-size: 0.72rem; color: var(--text-muted); padding: 4px 0;">No logs yet.</p>';
    } else {
      const histTemplate = document.getElementById('tmpl-history-item');
      const histFragment = document.createDocumentFragment();

      historyLogs.forEach(log => {
        const hClone = histTemplate.content.cloneNode(true);
        hClone.querySelector('.history-meta-badge').textContent = log.type.toUpperCase();
        hClone.querySelector('.history-date').textContent = formatDate(log.timestamp);
        hClone.querySelector('.history-outcome').textContent = log.outcome;
        
        const noteEl = hClone.querySelector('.history-notes');
        if (log.note) {
          noteEl.textContent = log.note;
          noteEl.classList.remove('hidden');
        }
        histFragment.appendChild(hClone);
      });

      historyListContainer.replaceChildren(histFragment);
    }
  }

  function navigateProfile(direction) {
    const nextIdx = state.currentContactIndex + direction;
    if (nextIdx >= 0 && nextIdx < state.filteredContacts.length) {
      state.currentContactIndex = nextIdx;
      renderProfileView(state.filteredContacts[nextIdx]);
    }
  }

  // --- 9. On-the-Fly Contact Detail Editing (Key 7 / Button) ---
  function openEditContactModal(contact) {
    if (!contact) return;
    document.getElementById('editContactId').value = contact.id;
    document.getElementById('modalEditContactTitle').textContent = `Edit: ${contact.name}`;
    document.getElementById('editName').value = contact.name || '';
    document.getElementById('editPhone').value = contact.phone || '';
    document.getElementById('editEmail').value = contact.email || '';
    document.getElementById('editCompany').value = contact.company || '';
    document.getElementById('editJobTitle').value = contact.job_title || '';
    document.getElementById('editStreetAddress').value = contact.street_address || '';
    document.getElementById('editCity').value = contact.city || '';
    document.getElementById('editPostalCode').value = contact.postal_code || '';
    document.getElementById('editCountry').value = contact.country || '';
    document.getElementById('editNotes').value = contact.notes || '';

    document.getElementById('modalEditContact').classList.remove('hidden');
    document.getElementById('editName').focus();
  }

  async function handleEditContactSave(e) {
    e.preventDefault();
    const contactId = document.getElementById('editContactId').value;
    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact) return;

    // Update fields immediately
    contact.name = document.getElementById('editName').value.trim() || 'Unnamed Contact';
    contact.phone = document.getElementById('editPhone').value.trim();
    contact.email = document.getElementById('editEmail').value.trim();
    contact.company = document.getElementById('editCompany').value.trim();
    contact.job_title = document.getElementById('editJobTitle').value.trim();
    contact.street_address = document.getElementById('editStreetAddress').value.trim();
    contact.city = document.getElementById('editCity').value.trim();
    contact.postal_code = document.getElementById('editPostalCode').value.trim();
    contact.country = document.getElementById('editCountry').value.trim();
    contact.notes = document.getElementById('editNotes').value.trim();

    await saveContact(contact);

    document.getElementById('modalEditContact').classList.add('hidden');
    applyFiltersAndRender();

    if (state.currentContactIndex !== -1 && state.filteredContacts[state.currentContactIndex]?.id === contact.id) {
      renderProfileView(contact);
    }
  }

  // --- 10. Screen Navigation ---
  function switchScreen(targetScreenId) {
    state.activeScreenId = targetScreenId;

    document.querySelectorAll('.screen-view').forEach(screen => {
      screen.classList.add('hidden');
      screen.classList.remove('active');
    });

    const activeScreen = document.getElementById(targetScreenId);
    if (activeScreen) {
      activeScreen.classList.remove('hidden');
      activeScreen.classList.add('active');
      activeScreen.scrollTop = 0;
    }

    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.screen === targetScreenId);
    });

    if (targetScreenId === 'screenContacts') {
      applyFiltersAndRender();
    } else if (targetScreenId === 'screenFollowUps') {
      renderFollowUpsScreen();
    } else if (targetScreenId === 'screenHistory') {
      renderGlobalHistory();
    }
  }

  // --- 11. Call Return Detection via Page Visibility API ---
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.pendingCallContact) {
      const elapsed = Date.now() - state.lastCallTimestamp;
      if (elapsed > 1500) {
        const promptBar = document.getElementById('callReturnPrompt');
        document.getElementById('callPromptText').textContent = `Log ${state.pendingCallContact.name}?`;
        promptBar.classList.remove('hidden');
      }
    }
  });

  // --- 12. Call Disposition Logging Workflow ---
  function openDispositionModal(contact) {
    if (!contact) return;
    document.getElementById('dispContactId').value = contact.id;
    document.getElementById('modalDispTitle').textContent = `Log: ${contact.name}`;
    document.getElementById('dispOutcome').value = 'Spoke — interested';
    document.getElementById('dispNote').value = '';
    document.getElementById('dispFollowUpDate').value = '';
    document.getElementById('modalDisposition').classList.remove('hidden');
    document.getElementById('dispOutcome').focus();
  }

  async function handleDispositionSave(e) {
    e.preventDefault();
    const contactId = document.getElementById('dispContactId').value;
    const outcome = document.getElementById('dispOutcome').value;
    const note = document.getElementById('dispNote').value;
    const followUpVal = document.getElementById('dispFollowUpDate').value;
    const contact = state.contacts.find(c => c.id === contactId);

    if (!contact) return;

    contact.last_contacted_at = new Date().toISOString();
    if (outcome === 'Do not contact') {
      contact.status = 'do_not_contact';
      contact.next_follow_up_at = null;
    } else {
      contact.status = 'contacted';
      contact.next_follow_up_at = followUpVal ? new Date(followUpVal).toISOString() : null;
    }

    await saveContact(contact);
    await logInteraction(contact.id, 'call', outcome, note, contact.next_follow_up_at);

    document.getElementById('callReturnPrompt').classList.add('hidden');
    document.getElementById('modalDisposition').classList.add('hidden');
    state.pendingCallContact = null;

    applyFiltersAndRender();
    if (state.currentContactIndex !== -1 && state.filteredContacts[state.currentContactIndex]?.id === contact.id) {
      renderProfileView(contact);
    }
  }

  // --- 13. Email Preparation Workflow ---
  function openEmailModal(contact) {
    if (!contact || !contact.email) {
      alert('No email registered.');
      return;
    }

    state.emailDraftContext = contact;
    const firstName = contact.name.split(' ')[0] || contact.name;
    
    const subject = state.settings.templateSubject
      .replace('{name}', contact.name)
      .replace('{first_name}', firstName)
      .replace('{company}', contact.company || '');

    const body = state.settings.templateBody
      .replace('{name}', contact.name)
      .replace('{first_name}', firstName)
      .replace('{company}', contact.company || '')
      .replace('{phone}', contact.phone || '');

    document.getElementById('emailTo').value = contact.email;
    document.getElementById('emailSubject').value = subject;
    document.getElementById('emailBody').value = body;
    document.getElementById('emailConfirmNotice').classList.add('hidden');
    document.getElementById('modalEmail').classList.remove('hidden');
    document.getElementById('btnLaunchMailto').focus();
  }

  function launchMailto() {
    const to = encodeURIComponent(document.getElementById('emailTo').value);
    const sub = encodeURIComponent(document.getElementById('emailSubject').value);
    const body = encodeURIComponent(document.getElementById('emailBody').value);
    
    window.location.href = `mailto:${to}?subject=${sub}&body=${body}`;
    document.getElementById('emailConfirmNotice').classList.remove('hidden');
  }

  function launchGmailWeb() {
    const to = encodeURIComponent(document.getElementById('emailTo').value);
    const sub = encodeURIComponent(document.getElementById('emailSubject').value);
    const body = encodeURIComponent(document.getElementById('emailBody').value);

    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${sub}&body=${body}`;
    window.open(url, '_blank');
    document.getElementById('emailConfirmNotice').classList.remove('hidden');
  }

  async function confirmEmailSent() {
    const contact = state.emailDraftContext;
    if (!contact) return;

    await logInteraction(contact.id, 'email', 'Email Sent', document.getElementById('emailSubject').value, null);
    contact.last_contacted_at = new Date().toISOString();
    await saveContact(contact);

    document.getElementById('modalEmail').classList.add('hidden');
    state.emailDraftContext = null;
    applyFiltersAndRender();
    if (state.currentContactIndex !== -1) {
      renderProfileView(contact);
    }
  }

  // --- 14. Follow-Ups & History Views ---
  async function renderFollowUpsScreen() {
    const container = document.getElementById('followUpsList');
    const scheduled = state.contacts
      .filter(c => c.next_follow_up_at && c.status !== 'do_not_contact')
      .sort((a, b) => new Date(a.next_follow_up_at) - new Date(b.next_follow_up_at));

    if (scheduled.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No scheduled follow-ups.</p></div>';
      return;
    }

    const template = document.getElementById('tmpl-contact-card');
    const fragment = document.createDocumentFragment();

    scheduled.forEach(c => {
      const clone = template.content.cloneNode(true);
      const card = clone.querySelector('.contact-card');
      card.dataset.id = c.id;

      card.querySelector('.contact-name').textContent = c.name;
      card.querySelector('.contact-meta').textContent = formatDate(c.next_follow_up_at);
      
      const badge = card.querySelector('.badge');
      const isOverdue = new Date(c.next_follow_up_at) < new Date();
      badge.className = `badge ${isOverdue ? 'badge-due' : 'badge-contacted'}`;
      badge.textContent = isOverdue ? 'Overdue' : 'Due';

      card.addEventListener('click', () => openContactProfile(c.id));
      fragment.appendChild(clone);
    });

    container.replaceChildren(fragment);
  }

  async function renderGlobalHistory() {
    const container = document.getElementById('globalHistoryList');
    const logs = await getAllInteractions();

    if (logs.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No interactions logged yet.</p></div>';
      return;
    }

    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const template = document.getElementById('tmpl-history-item');
    const fragment = document.createDocumentFragment();

    logs.slice(0, 40).forEach(log => {
      const clone = template.content.cloneNode(true);
      const contact = state.contacts.find(c => c.id === log.contact_id);
      const contactName = contact ? contact.name : 'Unknown';

      clone.querySelector('.history-meta-badge').textContent = `${contactName} • ${log.type.toUpperCase()}`;
      clone.querySelector('.history-date').textContent = formatDate(log.timestamp);
      clone.querySelector('.history-outcome').textContent = log.outcome;

      const notesEl = clone.querySelector('.history-notes');
      if (log.note) {
        notesEl.textContent = log.note;
        notesEl.classList.remove('hidden');
      }

      fragment.appendChild(clone);
    });

    container.replaceChildren(fragment);
  }

  // --- 15. Import CSV with Fast Deduplication ---
  function handleCsvFileSelect(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const rows = parseCSV(text);
        const imported = mapCSVToContacts(rows);

        if (imported.length === 0) {
          alert('No valid contacts in CSV.');
          return;
        }

        const phoneMap = new Set();
        const emailMap = new Set();

        state.contacts.forEach(c => {
          const norm = normalisePhoneForDial(c.phone);
          if (norm) phoneMap.add(norm);
          if (c.email) emailMap.add(c.email.trim().toLowerCase());
        });

        let duplicatesCount = 0;
        imported.forEach(c => {
          const normPhone = normalisePhoneForDial(c.phone);
          const normEmail = (c.email || '').trim().toLowerCase();
          if ((normPhone && phoneMap.has(normPhone)) || (normEmail && emailMap.has(normEmail))) {
            duplicatesCount++;
          }
        });

        state.parsedImportData = imported;

        const summaryBox = document.getElementById('importSummaryDetails');
        summaryBox.replaceChildren();

        const p1 = document.createElement('p');
        p1.innerHTML = `Total Rows: <strong>${imported.length}</strong>`;
        const p2 = document.createElement('p');
        p2.innerHTML = `Duplicates: <strong>${duplicatesCount}</strong>`;
        summaryBox.appendChild(p1);
        summaryBox.appendChild(p2);

        document.getElementById('modalImportReview').classList.remove('hidden');
      } catch (err) {
        alert('CSV Parse error: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  async function commitImport() {
    const strategy = document.getElementById('importDuplicateStrategy').value;
    const incoming = state.parsedImportData;
    if (!incoming) return;

    const phoneMap = new Map();
    const emailMap = new Map();

    state.contacts.forEach(c => {
      const cleanPhone = normalisePhoneForDial(c.phone);
      if (cleanPhone) phoneMap.set(cleanPhone, c);
      if (c.email) emailMap.set(c.email.trim().toLowerCase(), c);
    });

    const tx = dbInstance.transaction('contacts', 'readwrite');
    const store = tx.objectStore('contacts');

    for (const record of incoming) {
      const cleanIncomingPhone = normalisePhoneForDial(record.phone);
      const cleanIncomingEmail = (record.email || '').trim().toLowerCase();

      const duplicate = (cleanIncomingPhone && phoneMap.get(cleanIncomingPhone)) ||
                        (cleanIncomingEmail && emailMap.get(cleanIncomingEmail));

      if (duplicate) {
        if (strategy === 'skip') {
          continue;
        } else if (strategy === 'overwrite') {
          record.id = duplicate.id;
          record.last_contacted_at = duplicate.last_contacted_at;
          record.next_follow_up_at = duplicate.next_follow_up_at;
          store.put(record);
        } else if (strategy === 'keepBoth') {
          store.put(record);
        }
      } else {
        store.put(record);
        if (cleanIncomingPhone) phoneMap.set(cleanIncomingPhone, record);
        if (cleanIncomingEmail) emailMap.set(cleanIncomingEmail, record);
      }
    }

    tx.oncomplete = async () => {
      document.getElementById('modalImportReview').classList.add('hidden');
      state.parsedImportData = null;
      document.getElementById('fileCsvInput').value = '';
      await loadAllContacts();
      applyFiltersAndRender();
      alert('Contacts imported successfully.');
    };

    tx.onerror = (e) => {
      alert('Error saving import: ' + e.target.error.message);
    };
  }

  // --- 16. Export & Restore ---
  function exportContactsCsv() {
    if (state.contacts.length === 0) {
      alert('No contacts to export.');
      return;
    }

    const headers = ['name', 'phone', 'email', 'company', 'job_title', 'street_address', 'city', 'postal_code', 'country', 'notes', 'status'];
    const rows = [headers.join(',')];

    state.contacts.forEach(c => {
      const row = headers.map(h => {
        let val = (c[h] || '').toString().replace(/"/g, '""');
        return `"${val}"`;
      });
      rows.push(row.join(','));
    });

    const csvBlob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(csvBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportJsonBackup() {
    const logs = await getAllInteractions();
    const backupData = {
      version: 1,
      exported_at: new Date().toISOString(),
      contacts: state.contacts,
      interactions: logs,
      settings: state.settings
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dialler_backup_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleJsonRestore(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.contacts || !Array.isArray(data.contacts)) throw new Error('Invalid format');

        const tx = dbInstance.transaction(['contacts', 'interactions', 'settings'], 'readwrite');
        tx.objectStore('contacts').clear();
        tx.objectStore('interactions').clear();

        data.contacts.forEach(c => tx.objectStore('contacts').put(c));
        if (data.interactions) data.interactions.forEach(i => tx.objectStore('interactions').put(i));
        if (data.settings) tx.objectStore('settings').put({ key: 'app_preferences', value: data.settings });

        tx.oncomplete = async () => {
          await loadAllContacts();
          await loadSettings();
          applyFiltersAndRender();
          alert('Database restored.');
        };
      } catch (err) {
        alert('Restore failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // --- 17. Hardware Keypad & D-Pad Keyboard Controller ---
  function setupHardwareKeypadShortcuts() {
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      // Global Escape / Back key
      if (e.key === 'Escape' || e.key === 'Backspace') {
        const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
        if (openModal) {
          openModal.classList.add('hidden');
          e.preventDefault();
          return;
        }
        if (state.activeScreenId === 'screenProfile') {
          switchScreen('screenContacts');
          e.preventDefault();
          return;
        }
      }

      if (isInputActive) {
        if (e.key === 'Enter' && activeTag === 'input' && document.activeElement.id === 'searchInput') {
          document.activeElement.blur();
        }
        return;
      }

      // Keypad Shortcuts (1-9)
      switch (e.key) {
        case '1': // Call
          if (state.activeScreenId === 'screenProfile') {
            const callBtn = document.getElementById('btnActionCall');
            if (callBtn && callBtn.href && callBtn.href !== '#') {
              callBtn.click();
            }
          }
          break;

        case '2': // Email
          if (state.activeScreenId === 'screenProfile') {
            document.getElementById('btnActionEmail').click();
          }
          break;

        case '3': // Log call outcome
          if (!document.getElementById('callReturnPrompt').classList.contains('hidden')) {
            document.getElementById('btnPromptLog').click();
          } else if (state.activeScreenId === 'screenProfile') {
            document.getElementById('btnActionDisposition').click();
          }
          break;

        case '4': // Prev contact
          if (state.activeScreenId === 'screenProfile') {
            navigateProfile(-1);
          }
          break;

        case '5': // Search Focus
          e.preventDefault();
          const sInput = document.getElementById('searchInput');
          if (state.activeScreenId !== 'screenContacts') {
            switchScreen('screenContacts');
          }
          sInput.focus();
          break;

        case '6': // Next contact
          if (state.activeScreenId === 'screenProfile') {
            navigateProfile(1);
          }
          break;

        case '7': // Quick Edit Contact Details on the fly!
          if (state.activeScreenId === 'screenProfile' && state.currentContactIndex !== -1) {
            e.preventDefault();
            openEditContactModal(state.filteredContacts[state.currentContactIndex]);
          }
          break;

        case '0': // Back to contacts list
          if (state.activeScreenId === 'screenProfile') {
            switchScreen('screenContacts');
          }
          break;

        case '9': // Quick CSV Import
          document.getElementById('fileCsvInput').click();
          break;

        case 'ArrowLeft':
          if (state.activeScreenId === 'screenContacts') {
            navigateQueuePills(-1);
          } else if (state.activeScreenId === 'screenProfile') {
            navigateProfile(-1);
          }
          break;

        case 'ArrowRight':
          if (state.activeScreenId === 'screenContacts') {
            navigateQueuePills(1);
          } else if (state.activeScreenId === 'screenProfile') {
            navigateProfile(1);
          }
          break;
      }
    });
  }

  function navigateQueuePills(dir) {
    const pills = Array.from(document.querySelectorAll('.queue-pills .pill'));
    const currentIdx = pills.findIndex(p => p.classList.contains('active'));
    let nextIdx = currentIdx + dir;
    if (nextIdx < 0) nextIdx = pills.length - 1;
    if (nextIdx >= pills.length) nextIdx = 0;
    pills[nextIdx].click();
  }

  // --- 18. Initialization ---
  async function initApp() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }

    await initDB();
    await loadSettings();
    await loadAllContacts();

    document.getElementById('templateSubject').value = state.settings.templateSubject;
    document.getElementById('templateBody').value = state.settings.templateBody;
    document.getElementById('inputDailyCallTarget').value = state.settings.dailyTargetCalls || 10;

    // Search events
    const searchInput = document.getElementById('searchInput');
    const clearSearch = document.getElementById('btnClearSearch');
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      clearSearch.classList.toggle('hidden', !state.searchQuery);
      applyFiltersAndRender();
    });
    clearSearch.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearSearch.classList.add('hidden');
      applyFiltersAndRender();
    });

    // Queue tab pills
    document.querySelectorAll('.queue-pills .pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.queue-pills .pill').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.activeQueue = e.currentTarget.dataset.queue;
        applyFiltersAndRender();
      });
    });

    // Main navigation tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => switchScreen(tab.dataset.screen));
    });

    // Profile navigation
    document.getElementById('btnBackToList').addEventListener('click', () => switchScreen('screenContacts'));
    document.getElementById('btnPrevContact').addEventListener('click', () => navigateProfile(-1));
    document.getElementById('btnNextContact').addEventListener('click', () => navigateProfile(1));

    // Edit Contact Trigger
    document.getElementById('btnEditContact').addEventListener('click', () => {
      if (state.currentContactIndex !== -1) {
        openEditContactModal(state.filteredContacts[state.currentContactIndex]);
      }
    });

    document.getElementById('btnActionDisposition').addEventListener('click', () => {
      if (state.currentContactIndex !== -1) {
        openDispositionModal(state.filteredContacts[state.currentContactIndex]);
      }
    });

    document.getElementById('btnActionEmail').addEventListener('click', () => {
      if (state.currentContactIndex !== -1) {
        openEmailModal(state.filteredContacts[state.currentContactIndex]);
      }
    });

    // Edit Modal events
    document.getElementById('btnCloseModalEdit').addEventListener('click', () => {
      document.getElementById('modalEditContact').classList.add('hidden');
    });
    document.getElementById('btnCancelEdit').addEventListener('click', () => {
      document.getElementById('modalEditContact').classList.add('hidden');
    });
    document.getElementById('formEditContact').addEventListener('submit', handleEditContactSave);

    // Disposition modal events
    document.getElementById('btnCloseModalDisp').addEventListener('click', () => {
      document.getElementById('modalDisposition').classList.add('hidden');
    });
    document.getElementById('btnCancelDisp').addEventListener('click', () => {
      document.getElementById('modalDisposition').classList.add('hidden');
    });
    document.getElementById('formDisposition').addEventListener('submit', handleDispositionSave);

    // Call return prompt events
    document.getElementById('btnPromptLog').addEventListener('click', () => {
      openDispositionModal(state.pendingCallContact);
    });
    document.getElementById('btnPromptDismiss').addEventListener('click', () => {
      document.getElementById('callReturnPrompt').classList.add('hidden');
      state.pendingCallContact = null;
    });

    // Email modal events
    document.getElementById('btnCloseModalEmail').addEventListener('click', () => {
      document.getElementById('modalEmail').classList.add('hidden');
    });
    document.getElementById('btnLaunchMailto').addEventListener('click', launchMailto);
    document.getElementById('btnLaunchGmailWeb').addEventListener('click', launchGmailWeb);
    document.getElementById('btnConfirmEmailSent').addEventListener('click', confirmEmailSent);
    document.getElementById('btnCancelEmailSent').addEventListener('click', () => {
      document.getElementById('modalEmail').classList.add('hidden');
    });

    // Import events
    document.getElementById('btnQuickImport').addEventListener('click', () => {
      document.getElementById('fileCsvInput').click();
    });
    document.getElementById('fileCsvInput').addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleCsvFileSelect(e.target.files[0]);
    });
    document.getElementById('btnCommitImport').addEventListener('click', commitImport);
    document.getElementById('btnCancelImport').addEventListener('click', () => {
      document.getElementById('modalImportReview').classList.add('hidden');
      document.getElementById('fileCsvInput').value = '';
    });
    document.getElementById('btnCloseModalImport').addEventListener('click', () => {
      document.getElementById('modalImportReview').classList.add('hidden');
      document.getElementById('fileCsvInput').value = '';
    });

    // Settings actions
    document.getElementById('btnSaveTargetGoal').addEventListener('click', async () => {
      const val = parseInt(document.getElementById('inputDailyCallTarget').value, 10);
      if (val > 0) {
        state.settings.dailyTargetCalls = val;
        await saveSettings();
        await updateGamifiedMetrics();
        alert('Goal saved.');
      }
    });

    document.getElementById('btnSaveTemplate').addEventListener('click', async () => {
      state.settings.templateSubject = document.getElementById('templateSubject').value;
      state.settings.templateBody = document.getElementById('templateBody').value;
      await saveSettings();
      alert('Template saved.');
    });

    document.getElementById('btnExportCsv').addEventListener('click', exportContactsCsv);
    document.getElementById('btnExportJsonBackup').addEventListener('click', exportJsonBackup);
    document.getElementById('fileJsonRestore').addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleJsonRestore(e.target.files[0]);
    });

    document.getElementById('btnClearAllData').addEventListener('click', () => {
      if (confirm('Erase all local contacts and logs?')) {
        const tx = dbInstance.transaction(['contacts', 'interactions'], 'readwrite');
        tx.objectStore('contacts').clear();
        tx.objectStore('interactions').clear();
        tx.oncomplete = () => {
          state.contacts = [];
          applyFiltersAndRender();
          alert('Local data cleared.');
        };
      }
    });

    setupHardwareKeypadShortcuts();
    applyFiltersAndRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();