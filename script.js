/**
 * PERSONAL DIALER & CLIENT CONTACT MANAGEMENT
 * Bubbly Flip Phone Engine with Full Physical Keypad & D-Pad Controls
 * Optimized for CAT S22 Flip (2.8" display)
 * British Racing Green & Illuminated Gold Edition
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
    focusedCardIndex: 0,
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

  // --- 6. Ambient Status Computations ---
  async function updateAmbientStatus() {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const dueCount = state.contacts.filter(c => {
      if (!c.next_follow_up_at || c.status === 'do_not_contact') return false;
      return new Date(c.next_follow_up_at) <= todayEnd;
    }).length;

    const allLogs = await getAllInteractions();

    // Streak count
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
    document.getElementById('dueCounterText').textContent = `${dueCount} due`;
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
    updateAmbientStatus();
  }

  function renderContactList() {
    const listContainer = document.getElementById('contactList');
    
    if (state.filteredContacts.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state-bubble">
          <p>No contacts found.</p>
          <button id="btnEmptyImportTrigger" class="btn btn-gold btn-sm"><span class="k-badge">9</span> Import CSV</button>
        </div>`;
      const btn = document.getElementById('btnEmptyImportTrigger');
      if (btn) btn.onclick = () => document.getElementById('fileCsvInput').click();
      return;
    }

    const template = document.getElementById('tmpl-contact-card');
    const fragment = document.createDocumentFragment();

    state.filteredContacts.forEach((contact, idx) => {
      const clone = template.content.cloneNode(true);
      const card = clone.querySelector('.bubbly-contact-card');
      card.dataset.id = contact.id;
      card.dataset.index = idx;

      // Avatar
      card.querySelector('.card-avatar').textContent = getInitials(contact.name);

      // Name & details
      card.querySelector('.card-name').textContent = contact.name;
      
      const metaParts = [];
      if (contact.job_title && contact.company) metaParts.push(`${contact.job_title} at ${contact.company}`);
      else if (contact.company) metaParts.push(contact.company);
      else if (contact.phone) metaParts.push(contact.phone);
      card.querySelector('.card-meta').textContent = metaParts.join(' • ') || 'No company registered';

      const submetaParts = [];
      if (contact.phone && metaParts[0] !== contact.phone) submetaParts.push(contact.phone);
      if (contact.city) submetaParts.push(contact.city);
      card.querySelector('.card-submeta').textContent = submetaParts.join(' • ');

      // Badge
      const badge = card.querySelector('.bubbly-badge');
      if (contact.status === 'do_not_contact') {
        badge.className = 'bubbly-badge badge-dnc';
        badge.textContent = 'DNC';
      } else if (contact.next_follow_up_at && new Date(contact.next_follow_up_at) <= new Date()) {
        badge.className = 'bubbly-badge badge-due';
        badge.textContent = 'Due';
      } else if (contact.last_contacted_at) {
        badge.className = 'bubbly-badge badge-contacted';
        badge.textContent = 'Done';
      } else {
        badge.className = 'bubbly-badge badge-new';
        badge.textContent = 'New';
      }

      card.addEventListener('click', () => openContactProfile(contact.id));
      fragment.appendChild(clone);
    });

    listContainer.replaceChildren(fragment);

    // Apply D-Pad focus to first card if applicable
    highlightCurrentCard(false);
  }

  function highlightCurrentCard(shouldScroll = true) {
    const cards = document.querySelectorAll('.bubbly-contact-card');
    if (cards.length === 0) return;

    if (state.focusedCardIndex < 0) state.focusedCardIndex = 0;
    if (state.focusedCardIndex >= cards.length) state.focusedCardIndex = cards.length - 1;

    cards.forEach((c, idx) => {
      c.classList.toggle('focused-dpad', idx === state.focusedCardIndex);
    });

    if (shouldScroll && cards[state.focusedCardIndex]) {
      cards[state.focusedCardIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // --- 8. Profile View & Actions ---
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
    clone.querySelector('.hero-avatar').textContent = getInitials(contact.name);
    clone.querySelector('.hero-name').textContent = contact.name;
    
    const roleParts = [];
    if (contact.job_title) roleParts.push(contact.job_title);
    if (contact.company) roleParts.push(contact.company);
    clone.querySelector('.hero-title-company').textContent = roleParts.join(' at ') || 'No company listed';

    clone.querySelector('.hero-counter-label').textContent = `${state.currentContactIndex + 1} of ${state.filteredContacts.length}`;

    const statusBadge = clone.querySelector('.hero-badge');
    if (contact.status === 'do_not_contact') {
      statusBadge.className = 'bubbly-badge badge-dnc';
      statusBadge.textContent = 'DNC';
    } else if (contact.next_follow_up_at && new Date(contact.next_follow_up_at) <= new Date()) {
      statusBadge.className = 'bubbly-badge badge-due';
      statusBadge.textContent = 'Overdue';
    } else {
      statusBadge.className = 'bubbly-badge badge-new';
      statusBadge.textContent = contact.status;
    }

    // Direct Comms
    clone.querySelector('.profile-phone-val').textContent = contact.phone || 'None registered';
    clone.querySelector('.profile-email-val').textContent = contact.email || 'None registered';

    // Outreach
    const scheduleDateText = clone.querySelector('.schedule-date-highlight');
    const scheduleRelativeTime = clone.querySelector('.schedule-status-tag');
    if (contact.next_follow_up_at) {
      scheduleDateText.textContent = formatDate(contact.next_follow_up_at);
      const isOverdue = new Date(contact.next_follow_up_at) < new Date();
      scheduleRelativeTime.textContent = isOverdue ? '⚠️ Overdue' : 'Scheduled';
    } else {
      scheduleDateText.textContent = 'None Scheduled';
      scheduleRelativeTime.textContent = 'Press 3 to set';
    }

    // Address
    const addressStr = [contact.street_address, contact.city, contact.postal_code, contact.country]
      .filter(Boolean)
      .join(', ');
    clone.querySelector('.profile-address-val').textContent = addressStr || 'No address registered.';

    // Notes
    clone.querySelector('.profile-notes-val').textContent = contact.notes || 'No notes added yet.';

    // Navigation Buttons inside card
    clone.querySelector('#btnPrevProfile').onclick = () => navigateProfile(-1);
    clone.querySelector('#btnNextProfile').onclick = () => navigateProfile(1);

    // Contextual Bottom Action Dock setup
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
    const historyListContainer = detailsContainer.querySelector('.profile-history-stream');
    const logCountLabel = detailsContainer.querySelector('.profile-logs-count');
    const historyLogs = await getInteractionsForContact(contact.id);
    
    logCountLabel.textContent = `${historyLogs.length}`;

    if (historyLogs.length === 0) {
      historyListContainer.innerHTML = '<p style="font-size: 0.78rem; color: var(--text-muted); padding: 4px 0;">No recorded interactions yet.</p>';
    } else {
      const histTemplate = document.getElementById('tmpl-history-item');
      const histFragment = document.createDocumentFragment();

      historyLogs.forEach(log => {
        const hClone = histTemplate.content.cloneNode(true);
        hClone.querySelector('.log-type-tag').textContent = log.type.toUpperCase();
        hClone.querySelector('.log-date').textContent = formatDate(log.timestamp);
        hClone.querySelector('.log-outcome').textContent = log.outcome;
        
        const noteEl = hClone.querySelector('.log-note');
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

  // --- 9. On-the-Fly Contact Detail Editing (Key 7) ---
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

  // --- 10. Screen Navigation & Bottom Dock Switcher ---
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

    // Update screen title crumb
    const titleMap = {
      screenContacts: 'Contacts',
      screenProfile: 'Profile',
      screenFollowUps: 'Due Queue',
      screenHistory: 'Logs',
      screenSettings: 'Config'
    };
    document.getElementById('activeScreenTitle').textContent = titleMap[targetScreenId] || 'Dialler';

    // Toggle between Default Tab Dock and Profile Action Dock
    const isProfile = targetScreenId === 'screenProfile';
    document.getElementById('dockDefaultView').classList.toggle('hidden', isProfile);
    document.getElementById('dockProfileView').classList.toggle('hidden', !isProfile);

    // Update active tab highlight in default dock
    document.querySelectorAll('.dock-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.screen === targetScreenId);
    });

    if (targetScreenId === 'screenContacts') {
      applyFiltersAndRender();
    } else if (targetScreenId === 'screenFollowUps') {
      renderFollowUpsScreen();
    } else if (targetScreenId === 'screenHistory') {
      renderGlobalHistory();
    }
  }

  // --- 11. Call Return Detection via Visibility API ---
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

  // --- 12. Call Disposition Logging (Key 3) ---
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

  // --- 13. Email Flow (Key 2) ---
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

  // --- 14. Follow-Ups & Global History Views ---
  async function renderFollowUpsScreen() {
    const container = document.getElementById('followUpsList');
    const scheduled = state.contacts
      .filter(c => c.next_follow_up_at && c.status !== 'do_not_contact')
      .sort((a, b) => new Date(a.next_follow_up_at) - new Date(b.next_follow_up_at));

    if (scheduled.length === 0) {
      container.innerHTML = '<div class="empty-state-bubble"><p>No scheduled follow-ups.</p></div>';
      return;
    }

    const template = document.getElementById('tmpl-contact-card');
    const fragment = document.createDocumentFragment();

    scheduled.forEach(c => {
      const clone = template.content.cloneNode(true);
      const card = clone.querySelector('.bubbly-contact-card');
      card.dataset.id = c.id;

      card.querySelector('.card-avatar').textContent = getInitials(c.name);
      card.querySelector('.card-name').textContent = c.name;
      card.querySelector('.card-meta').textContent = formatDate(c.next_follow_up_at);
      card.querySelector('.card-submeta').textContent = c.phone || c.email || '';
      
      const badge = card.querySelector('.bubbly-badge');
      const isOverdue = new Date(c.next_follow_up_at) < new Date();
      badge.className = `bubbly-badge ${isOverdue ? 'badge-due' : 'badge-contacted'}`;
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
      container.innerHTML = '<div class="empty-state-bubble"><p>No interactions logged yet.</p></div>';
      return;
    }

    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const template = document.getElementById('tmpl-history-item');
    const fragment = document.createDocumentFragment();

    logs.slice(0, 40).forEach(log => {
      const clone = template.content.cloneNode(true);
      const contact = state.contacts.find(c => c.id === log.contact_id);
      const contactName = contact ? contact.name : 'Unknown';

      clone.querySelector('.log-type-tag').textContent = `${contactName} • ${log.type.toUpperCase()}`;
      clone.querySelector('.log-date').textContent = formatDate(log.timestamp);
      clone.querySelector('.log-outcome').textContent = log.outcome;

      const notesEl = clone.querySelector('.log-note');
      if (log.note) {
        notesEl.textContent = log.note;
        notesEl.classList.remove('hidden');
      }

      fragment.appendChild(clone);
    });

    container.replaceChildren(fragment);
  }

  // --- 15. CSV Import Logic ---
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
        p1.innerHTML = `Parsed: <strong>${imported.length} contacts</strong>`;
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
      alert('Contacts imported.');
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

  // --- 17. COMPLETE PHYSICAL KEYPAD (0-9, *, #) & D-PAD ENGINE ---
  function setupHardwareKeypadShortcuts() {
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      // 1. GLOBAL ESCAPE / BACK BUTTON (Hardware Flip Phone Back key)
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
        if (document.getElementById('callReturnPrompt') && !document.getElementById('callReturnPrompt').classList.contains('hidden')) {
          document.getElementById('callReturnPrompt').classList.add('hidden');
          e.preventDefault();
          return;
        }
      }

      // If typing in input, let normal characters pass through, but handle Enter/Escape
      if (isInputActive) {
        if (e.key === 'Enter') {
          if (document.activeElement.id === 'searchInput') {
            document.activeElement.blur();
            e.preventDefault();
          }
        }
        return;
      }

      // 2. D-PAD NAVIGATION (Arrow Up / Down / Left / Right / Enter)
      if (state.activeScreenId === 'screenContacts') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.focusedCardIndex++;
          highlightCurrentCard(true);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.focusedCardIndex--;
          highlightCurrentCard(true);
          return;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (state.filteredContacts[state.focusedCardIndex]) {
            openContactProfile(state.filteredContacts[state.focusedCardIndex].id);
          }
          return;
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          cycleQueue(-1);
          return;
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          cycleQueue(1);
          return;
        }
      } else if (state.activeScreenId === 'screenProfile') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateProfile(-1);
          return;
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateProfile(1);
          return;
        }
      }

      // 3. PHYSICAL NUMERIC KEYPAD SHORTCUTS (1-9, 0, *, #)
      switch (e.key) {
        // [Key 1] CALL (or switch to Contacts tab)
        case '1':
          if (state.activeScreenId === 'screenProfile') {
            const callBtn = document.getElementById('btnActionCall');
            if (callBtn && callBtn.href && callBtn.href !== '#') callBtn.click();
          } else if (state.activeScreenId === 'screenContacts') {
            // Direct call highlighted contact!
            const targetContact = state.filteredContacts[state.focusedCardIndex];
            if (targetContact && targetContact.phone) {
              state.lastCallTimestamp = Date.now();
              state.pendingCallContact = targetContact;
              window.location.href = `tel:${normalisePhoneForDial(targetContact.phone)}`;
            } else {
              switchScreen('screenContacts');
            }
          } else {
            switchScreen('screenContacts');
          }
          break;

        // [Key 2] EMAIL (or switch to Due tab)
        case '2':
          if (state.activeScreenId === 'screenProfile') {
            document.getElementById('btnActionEmail').click();
          } else if (state.activeScreenId === 'screenContacts') {
            const targetContact = state.filteredContacts[state.focusedCardIndex];
            if (targetContact) openEmailModal(targetContact);
            else switchScreen('screenFollowUps');
          } else {
            switchScreen('screenFollowUps');
          }
          break;

        // [Key 3] LOG CALL OUTCOME (or switch to Logs tab)
        case '3':
          if (!document.getElementById('callReturnPrompt').classList.contains('hidden')) {
            document.getElementById('btnPromptLog').click();
          } else if (state.activeScreenId === 'screenProfile') {
            document.getElementById('btnActionDisposition').click();
          } else if (state.activeScreenId === 'screenContacts') {
            const targetContact = state.filteredContacts[state.focusedCardIndex];
            if (targetContact) openDispositionModal(targetContact);
            else switchScreen('screenHistory');
          } else {
            switchScreen('screenHistory');
          }
          break;

        // [Key 4] PREV CONTACT (or switch to Config tab)
        case '4':
          if (state.activeScreenId === 'screenProfile') {
            navigateProfile(-1);
          } else {
            switchScreen('screenSettings');
          }
          break;

        // [Key 5] or [*] SEARCH FOCUS
        case '5':
        case '*':
          e.preventDefault();
          if (state.activeScreenId !== 'screenContacts') {
            switchScreen('screenContacts');
          }
          document.getElementById('searchInput').focus();
          break;

        // [Key 6] NEXT CONTACT
        case '6':
          if (state.activeScreenId === 'screenProfile') {
            navigateProfile(1);
          }
          break;

        // [Key 7] QUICK EDIT DETAILS (On-the-fly)
        case '7':
          if (state.activeScreenId === 'screenProfile' && state.currentContactIndex !== -1) {
            e.preventDefault();
            openEditContactModal(state.filteredContacts[state.currentContactIndex]);
          } else if (state.activeScreenId === 'screenContacts') {
            const targetContact = state.filteredContacts[state.focusedCardIndex];
            if (targetContact) openEditContactModal(targetContact);
          }
          break;

        // [Key 8] or [#] CYCLE TABS / FILTER QUEUES
        case '8':
        case '#':
          e.preventDefault();
          cycleQueue(1);
          break;

        // [Key 9] QUICK CSV IMPORT
        case '9':
          document.getElementById('fileCsvInput').click();
          break;

        // [Key 0] BACK TO LIST / TOP
        case '0':
          if (state.activeScreenId === 'screenProfile') {
            switchScreen('screenContacts');
          } else if (state.activeScreenId === 'screenContacts') {
            state.focusedCardIndex = 0;
            highlightCurrentCard(true);
          }
          break;
      }
    });
  }

  function cycleQueue(dir) {
    const pills = Array.from(document.querySelectorAll('.bubbly-queue-row .bubbly-pill'));
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
    document.querySelectorAll('.bubbly-queue-row .bubbly-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.bubbly-queue-row .bubbly-pill').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.activeQueue = e.currentTarget.dataset.queue;
        state.focusedCardIndex = 0;
        applyFiltersAndRender();
      });
    });

    // Bottom Navigation tab clicks
    document.querySelectorAll('.dock-btn').forEach(btn => {
      btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
    });

    // Profile Context Dock Buttons
    document.getElementById('btnProfileBack').addEventListener('click', () => switchScreen('screenContacts'));
    document.getElementById('btnProfileEdit').addEventListener('click', () => {
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

    // CSV Import events
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
        await updateAmbientStatus();
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