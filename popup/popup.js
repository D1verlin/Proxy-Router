/**
 * Smart Proxy Switcher - Dark Monolith Popup Controller
 * Bulletproof implementation with defensive element queries and error handling.
 */

const DEFAULT_CONFIG = {
  enabled: true,
  proxyHost: '2.27.25.190',
  proxyPort: 3128,
  proxyScheme: 'http',
  presetGoogle: true,
  presetGemini: true,
  presetClaude: true,
  presetOpenAI: true,
  presetGoogleStitch: true,
  excludeYouTube: true, // Always true internally so YouTube is direct
  customDomains: [],
  customExcludes: [],
  fallbackToDirect: false
};

let currentConfig = { ...DEFAULT_CONFIG };
let toastTimeout = null;

/**
 * Safely adds an event listener if the element exists in DOM.
 */
function safeListen(id, event, callback) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, callback);
  }
}

/**
 * Safely sets checkbox checked state if element exists.
 */
function safeSetChecked(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.checked = Boolean(value);
  }
}

/**
 * Safely sets input value if element exists.
 */
function safeSetValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.value = value ?? '';
  }
}

/**
 * Normalizes input domain (removes protocol, port, paths).
 */
function cleanDomain(input) {
  if (!input) return '';
  let str = input.trim().toLowerCase();
  str = str.replace(/^[a-z]+:\/\//, '');
  str = str.split('/')[0];
  str = str.split(':')[0];
  return str;
}

/**
 * Displays feedback toast.
 */
function showToast(message = 'Settings updated') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  if (toastTimeout) clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 1600);
}

/**
 * Updates the status banner UI and shows/hides whitelist alert.
 */
function updateStatusBanner(health = null) {
  const masterToggle = document.getElementById('masterToggle');
  const statusBanner = document.getElementById('statusBanner');
  const statusText = document.getElementById('statusText');
  const proxyServerDisplay = document.getElementById('proxyServerDisplay');
  const proxyHost = document.getElementById('proxyHost');
  const proxyPort = document.getElementById('proxyPort');
  const whitelistCard = document.getElementById('whitelistCard');

  if (!statusBanner) return;

  const isEnabled = masterToggle ? masterToggle.checked : currentConfig.enabled;
  const host = (proxyHost ? proxyHost.value.trim() : currentConfig.proxyHost) || '2.27.25.190';
  const port = (proxyPort ? proxyPort.value.trim() : currentConfig.proxyPort) || '3128';

  if (!isEnabled) {
    statusBanner.className = 'status-card';
    if (statusText) statusText.textContent = 'DISABLED';
    if (proxyServerDisplay) proxyServerDisplay.textContent = 'DIRECT';
    if (whitelistCard) whitelistCard.classList.add('hidden');
    return;
  }

  // Enabled mode: evaluate health status
  const currentHealth = health || currentConfig.proxyHealth;

  if (currentHealth && currentHealth.status === 'blocked') {
    statusBanner.className = 'status-card status-blocked';
    if (statusText) statusText.textContent = 'NOT WHITELISTED';
    if (proxyServerDisplay) proxyServerDisplay.textContent = `${host}:${port}`;
    if (whitelistCard) whitelistCard.classList.remove('hidden');
  } else if (currentHealth && currentHealth.status === 'checking') {
    statusBanner.className = 'status-card status-checking';
    if (statusText) statusText.textContent = 'CHECKING...';
    if (proxyServerDisplay) proxyServerDisplay.textContent = `${host}:${port}`;
    // Preserve whitelistCard visibility during check to prevent jumpy UI
  } else if (currentHealth && currentHealth.status === 'active') {
    statusBanner.className = 'status-card status-active';
    if (statusText) statusText.textContent = 'ACTIVE';
    if (proxyServerDisplay) proxyServerDisplay.textContent = `${host}:${port}`;
    if (whitelistCard) whitelistCard.classList.add('hidden');
  } else {
    statusBanner.className = 'status-card status-checking';
    if (statusText) statusText.textContent = 'CHECKING...';
    if (proxyServerDisplay) proxyServerDisplay.textContent = `${host}:${port}`;
  }
}

/**
 * Triggers a live proxy connectivity and whitelist check.
 */
async function performHealthCheck(manual = false) {
  if (!currentConfig.enabled) {
    updateStatusBanner({ status: 'disabled' });
    return;
  }

  if (manual) {
    updateStatusBanner({ status: 'checking' });
  }

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'checkHealth',
      forceReapply: manual
    });
    if (resp && resp.health) {
      currentConfig.proxyHealth = resp.health;
      updateStatusBanner(resp.health);
      if (manual) {
        if (resp.health.status === 'active') {
          showToast('Proxy active');
        } else {
          showToast('Not in whitelist');
        }
      }
    } else {
      updateStatusBanner({ status: 'blocked', reason: 'No response' });
      if (manual) showToast('Check failed');
    }
  } catch (err) {
    console.warn('Health check communication error:', err);
    updateStatusBanner({ status: 'blocked', error: err.message });
    if (manual) showToast('Connection error');
  }
}

/**
 * Renders tag chips for custom domains or excludes.
 */
function renderTagList(containerId, items, onRemove) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';
  if (!items || items.length === 0) {
    const emptySpan = document.createElement('span');
    emptySpan.style.fontSize = '10px';
    emptySpan.style.color = '#555555';
    emptySpan.style.fontFamily = 'var(--font-mono)';
    emptySpan.textContent = 'Empty';
    container.appendChild(emptySpan);
    return;
  }

  items.forEach((item, index) => {
    const chip = document.createElement('div');
    chip.className = 'chip-item';

    const text = document.createElement('span');
    text.textContent = item;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'chip-remove';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', `Remove ${item}`);
    delBtn.addEventListener('click', () => onRemove(index));

    chip.appendChild(text);
    chip.appendChild(delBtn);
    container.appendChild(chip);
  });
}

/**
 * Persists config changes into chrome.storage.local.
 */
async function saveConfig(updates) {
  try {
    currentConfig = { ...currentConfig, ...updates };
    await chrome.storage.local.set(updates);
    updateStatusBanner();
    showToast('Saved');
  } catch (error) {
    console.error('Error saving config:', error);
    showToast('Error saving');
  }
}

function removeDomain(index) {
  const list = [...(currentConfig.customDomains || [])];
  list.splice(index, 1);
  saveConfig({ customDomains: list });
  renderTagList('customDomainsList', list, removeDomain);
}

function removeExclude(index) {
  const list = [...(currentConfig.customExcludes || [])];
  list.splice(index, 1);
  saveConfig({ customExcludes: list });
  renderTagList('customExcludesList', list, removeExclude);
}

/**
 * Loads configuration from storage and initializes UI.
 */
async function init() {
  try {
    const stored = await chrome.storage.local.get(null);
    currentConfig = { ...DEFAULT_CONFIG, ...stored };

    // Apply switches
    safeSetChecked('masterToggle', currentConfig.enabled !== false);
    safeSetChecked('presetGoogle', currentConfig.presetGoogle !== false);
    safeSetChecked('presetGemini', currentConfig.presetGemini !== false);
    safeSetChecked('presetClaude', currentConfig.presetClaude !== false);
    safeSetChecked('presetOpenAI', currentConfig.presetOpenAI !== false);
    safeSetChecked('presetGoogleStitch', currentConfig.presetGoogleStitch !== false);
    safeSetChecked('fallbackToDirect', currentConfig.fallbackToDirect === true);

    // Apply input values
    safeSetValue('proxyHost', currentConfig.proxyHost || '2.27.25.190');
    safeSetValue('proxyPort', currentConfig.proxyPort || 3128);

    // Render tag chips
    renderTagList('customDomainsList', currentConfig.customDomains, removeDomain);
    renderTagList('customExcludesList', currentConfig.customExcludes, removeExclude);

    updateStatusBanner(currentConfig.proxyHealth);
    updateActiveTargetsCount();

    if (currentConfig.enabled) {
      performHealthCheck();
    }
  } catch (error) {
    console.error('Failed to initialize popup:', error);
  }
}

/**
 * Updates the active targets count indicator in the collapsed accordion.
 */
function updateActiveTargetsCount() {
  const countEl = document.getElementById('activeTargetsCount');
  if (!countEl) return;
  const presets = ['presetGoogle', 'presetGemini', 'presetClaude', 'presetOpenAI', 'presetGoogleStitch'];
  const count = presets.filter(id => {
    const el = document.getElementById(id);
    return el ? el.checked : (currentConfig[id] !== false);
  }).length;
  countEl.textContent = `${count}/5 active`;
}

/**
 * Setup event listeners when DOM is fully loaded.
 */
function setupListeners() {
  // Master toggle
  safeListen('masterToggle', 'change', async (e) => {
    await saveConfig({ enabled: e.target.checked });
    if (e.target.checked) {
      performHealthCheck();
    } else {
      updateStatusBanner({ status: 'disabled' });
    }
  });

  // Recheck button
  safeListen('recheckBtn', 'click', async () => {
    const recheckBtn = document.getElementById('recheckBtn');
    if (recheckBtn) recheckBtn.disabled = true;
    showToast('Checking connection...');
    try {
      await performHealthCheck(true);
    } finally {
      if (recheckBtn) recheckBtn.disabled = false;
    }
  });

  // Target presets
  safeListen('presetGoogle', 'change', async (e) => {
    await saveConfig({ presetGoogle: e.target.checked });
    updateActiveTargetsCount();
  });

  safeListen('presetGemini', 'change', async (e) => {
    await saveConfig({ presetGemini: e.target.checked });
    updateActiveTargetsCount();
  });

  safeListen('presetClaude', 'change', async (e) => {
    await saveConfig({ presetClaude: e.target.checked });
    updateActiveTargetsCount();
  });

  safeListen('presetOpenAI', 'change', async (e) => {
    await saveConfig({ presetOpenAI: e.target.checked });
    updateActiveTargetsCount();
  });

  safeListen('presetGoogleStitch', 'change', async (e) => {
    await saveConfig({ presetGoogleStitch: e.target.checked });
    updateActiveTargetsCount();
  });

  safeListen('fallbackToDirect', 'change', async (e) => {
    await saveConfig({ fallbackToDirect: e.target.checked });
  });

  // Proxy Host & Port
  safeListen('proxyHost', 'change', async (e) => {
    const val = e.target.value.trim();
    if (val) {
      await saveConfig({ proxyHost: val });
      performHealthCheck();
    }
  });

  safeListen('proxyPort', 'change', async (e) => {
    const val = parseInt(e.target.value.trim(), 10);
    if (val > 0 && val <= 65535) {
      await saveConfig({ proxyPort: val });
      performHealthCheck();
    } else {
      e.target.value = currentConfig.proxyPort || 3128;
    }
  });

  // Custom Domains
  async function handleAddDomain() {
    const input = document.getElementById('customDomainInput');
    if (!input) return;
    const domain = cleanDomain(input.value);
    if (!domain) return;

    const list = [...(currentConfig.customDomains || [])];
    if (!list.includes(domain)) {
      list.push(domain);
      input.value = '';
      await saveConfig({ customDomains: list });
      renderTagList('customDomainsList', list, removeDomain);
    } else {
      showToast('Already added');
    }
  }

  safeListen('addDomainBtn', 'click', handleAddDomain);
  safeListen('customDomainInput', 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddDomain();
    }
  });

  // Custom Excludes
  async function handleAddExclude() {
    const input = document.getElementById('customExcludeInput');
    if (!input) return;
    const domain = cleanDomain(input.value);
    if (!domain) return;

    const list = [...(currentConfig.customExcludes || [])];
    if (!list.includes(domain)) {
      list.push(domain);
      input.value = '';
      await saveConfig({ customExcludes: list });
      renderTagList('customExcludesList', list, removeExclude);
    } else {
      showToast('Already added');
    }
  }

  safeListen('addExcludeBtn', 'click', handleAddExclude);
  safeListen('customExcludeInput', 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddExclude();
    }
  });

  // Reset defaults
  safeListen('resetDefaultsBtn', 'click', async () => {
    await saveConfig({ ...DEFAULT_CONFIG });
    await init();
    showToast('Reset to defaults');
  });

  // Open external links reliably in Chrome tabs
  document.querySelectorAll('a[href]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.getAttribute('href');
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        chrome.tabs.create({ url });
      }
    });
  });

  // Real-time synchronization of proxy health state from background worker
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.proxyHealth) {
      currentConfig.proxyHealth = changes.proxyHealth.newValue;
      updateStatusBanner(changes.proxyHealth.newValue);
    }
  });
}

// Bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupListeners();
    init();
  });
} else {
  setupListeners();
  init();
}
