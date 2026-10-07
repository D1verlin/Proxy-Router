/**
 * Smart Proxy Switcher - Background Service Worker (Manifest V3)
 * Controls PAC script generation and proxy settings.
 */

const DEFAULT_CONFIG = {
  enabled: true,
  proxyHost: '2.27.25.190',
  proxyPort: 3128,
  proxyScheme: 'http',
  // Presets
  presetGoogle: true,
  presetGemini: true,
  presetClaude: true,
  presetOpenAI: true,
  presetGoogleStitch: true,
  excludeYouTube: true,
  // User lists
  customDomains: [],
  customExcludes: [],
  fallbackToDirect: false
};

/**
 * Builds the PAC (Proxy Auto-Config) script based on the configuration.
 */
function generatePacScript(config) {
  const host = (config.proxyHost || '2.27.25.190').trim();
  const port = parseInt(config.proxyPort || 3128, 10);
  const proxyDirective = `PROXY ${host}:${port}` + (config.fallbackToDirect ? '; DIRECT' : '');

  // 1. YouTube & custom bypass domains (always routed DIRECT)
  const excludeList = [
    'youtube.com',
    'youtu.be',
    'googlevideo.com',
    'ytimg.com',
    'youtube-nocookie.com',
    'youtubekids.com',
    'yt3.ggpht.com',
    'youtube-ui.l.google.com'
  ];
  if (Array.isArray(config.customExcludes)) {
    excludeList.push(...config.customExcludes);
  }

  // 2. Target domains to route through proxy
  const targetList = [
    'api.ipify.org',
    'ipinfo.io'
  ];

  // OpenAI / ChatGPT
  if (config.presetOpenAI) {
    targetList.push(
      'openai.com',
      'chatgpt.com',
      'oaistatic.com',
      'oaiusercontent.com',
      'sora.com'
    );
  }

  // Anthropic Claude
  if (config.presetClaude) {
    targetList.push(
      'claude.ai',
      'anthropic.com',
      'claude.site'
    );
  }

  // Google Stitch
  if (config.presetGoogleStitch) {
    targetList.push(
      'stitch.withgoogle.com',
      'withgoogle.com',
      'stitch.google.com'
    );
  }

  // Google Gemini & AI Studio
  if (config.presetGemini) {
    targetList.push(
      'gemini.google.com',
      'aistudio.google.com',
      'generativelanguage.googleapis.com',
      'bard.google.com',
      'deepmind.google',
      'deepmind.com'
    );
  }

  // Google core services & CDN (except YouTube handled above)
  if (config.presetGoogle) {
    targetList.push(
      'google.com',
      'gstatic.com',
      'googleapis.com',
      'googleusercontent.com',
      'googletagmanager.com',
      'googletagservices.com',
      'google-analytics.com',
      'google.dev',
      'googleblog.com',
      '1e100.net',
      'ggpht.com'
    );
  }

  // Custom user-defined domains
  if (Array.isArray(config.customDomains)) {
    targetList.push(...config.customDomains);
  }

  // Sanitize and deduplicate lists
  const cleanExcludes = [...new Set(excludeList.map(d => d.trim().toLowerCase()).filter(Boolean))];
  const cleanTargets = [...new Set(targetList.map(d => d.trim().toLowerCase()).filter(Boolean))];

  return `
function FindProxyForURL(url, host) {
  var h = host.toLowerCase();

  // 1. Excluded hosts (Bypass proxy -> DIRECT connection)
  var excludes = ${JSON.stringify(cleanExcludes)};
  for (var i = 0; i < excludes.length; i++) {
    var ex = excludes[i];
    if (h === ex || (h.length > ex.length && h.charAt(h.length - ex.length - 1) === '.' && h.slice(-ex.length) === ex)) {
      return "DIRECT";
    }
  }

  // 2. Target hosts to route through proxy
  var targets = ${JSON.stringify(cleanTargets)};
  for (var j = 0; j < targets.length; j++) {
    var tg = targets[j];
    if (h === tg || (h.length > tg.length && h.charAt(h.length - tg.length - 1) === '.' && h.slice(-tg.length) === tg)) {
      return "${proxyDirective}";
    }
  }

  ${config.presetGoogle ? `
  // 3. Match any regional Google domain (e.g. google.ru, google.co.uk, google.de, etc.)
  if (/(?:^|\\.)google\\.(?:com?|co|org|net|de|ru|fr|it|es|ca|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})$/i.test(h)) {
    return "${proxyDirective}";
  }
  ` : ''}

  // Default: Direct connection for all other websites
  return "DIRECT";
}
`.trim();
}

/**
 * Retrieves the current merged configuration from chrome.storage.local.
 */
async function getConfig() {
  const stored = await chrome.storage.local.get(null);
  return { ...DEFAULT_CONFIG, ...stored };
}

/**
 * Applies or removes proxy settings in Chrome according to config.
 */
async function applyProxySettings() {
  const config = await getConfig();

  try {
    if (config.enabled) {
      const pacScriptData = generatePacScript(config);

      await chrome.proxy.settings.set({
        value: {
          mode: 'pac_script',
          pacScript: {
            data: pacScriptData,
            mandatory: false
          }
        },
        scope: 'regular'
      });

      await chrome.action.setBadgeText({ text: 'ON' });
      await chrome.action.setBadgeBackgroundColor({ color: '#222222' });
      await chrome.action.setTitle({
        title: `Proxy Router: Active (${config.proxyHost}:${config.proxyPort})`
      });
      console.log('Smart Proxy: PAC script successfully applied.');
      
      // Perform health check asynchronously
      checkProxyHealth();
    } else {
      // Revert to system default proxy
      await chrome.proxy.settings.set({
        value: {
          mode: 'system'
        },
        scope: 'regular'
      });

      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({
        title: 'Proxy Router: Disabled (direct connection)'
      });
      await chrome.storage.local.set({ proxyHealth: { status: 'disabled', timestamp: Date.now() } });
      console.log('Smart Proxy: Proxy disabled, returned to system mode.');
    }
  } catch (error) {
    console.error('Smart Proxy: Failed to update proxy settings:', error);
  }
}

/**
 * Updates proxy state to blocked.
 */
async function markProxyBlocked(reason = 'Proxy Authentication Required (407)') {
  const result = {
    status: 'blocked',
    reason,
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ proxyHealth: result });
  await chrome.action.setBadgeText({ text: 'ERR' });
  await chrome.action.setBadgeBackgroundColor({ color: '#552222' });
  await chrome.action.setTitle({
    title: 'Proxy Router: IP Not Whitelisted'
  });
  return result;
}

/**
 * Updates proxy state to active.
 */
async function markProxyActive(ip, host, port) {
  const result = {
    status: 'active',
    ip,
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ proxyHealth: result });
  await chrome.action.setBadgeText({ text: 'ON' });
  await chrome.action.setBadgeBackgroundColor({ color: '#222222' });
  await chrome.action.setTitle({
    title: `Proxy Router: Active (${host}:${port})`
  });
  return result;
}

/**
 * Performs a health and whitelist check.
 * Flushes Chrome's internal bad-proxy retry penalty, probes the routed Google 204 endpoint,
 * and confirms outbound proxy connectivity.
 */
async function checkProxyHealth() {
  const config = await getConfig();
  if (!config.enabled) {
    const res = { status: 'disabled', timestamp: Date.now() };
    await chrome.storage.local.set({ proxyHealth: res });
    return res;
  }

  // 1. Flush Chrome's internal ProxyRetryInfoMap so Chrome retries proxy immediately
  await applyProxySettings();

  const expectedIp = (config.proxyHost || '2.27.25.190').trim();

  // Flag to detect if proxy auth challenge occurs during this probe
  let authChallenged = false;
  const tempListener = (details) => {
    if (details.isProxy) authChallenged = true;
  };
  chrome.webRequest.onAuthRequired.addListener(tempListener, { urls: ['<all_urls>'] });

  try {
    // 2. Primary lightning-fast probe: http://google.com/generate_204 (routed via proxy in PAC script)
    // If client IP is not whitelisted, Squid IMMEDIATELY responds with 407 (10-20ms).
    // If client IP is whitelisted, Squid allows connection and returns 204 (30-50ms).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    const probeUrl = `http://google.com/generate_204?_t=${Date.now()}`;
    let probeStatus = 0;
    try {
      const resp = await fetch(probeUrl, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store'
      });
      probeStatus = resp.status;
    } catch (err) {
      // Squid 407 triggers onAuthRequired, which cancels request and fetch throws
    } finally {
      clearTimeout(timer);
    }

    if (authChallenged) {
      chrome.webRequest.onAuthRequired.removeListener(tempListener);
      return await markProxyBlocked('Proxy Authentication Required (407)');
    }

    if (probeStatus !== 204 && probeStatus !== 200) {
      // Connection failed, refused, or 403
      chrome.webRequest.onAuthRequired.removeListener(tempListener);
      return await markProxyBlocked(probeStatus ? `HTTP ${probeStatus}` : 'Connection Failed');
    }

    // 3. Fast secondary verification of outbound egress IP via api.ipify.org
    try {
      const ipController = new AbortController();
      const ipTimer = setTimeout(() => ipController.abort(), 2500);
      const ipResp = await fetch(`https://api.ipify.org?format=json&_t=${Date.now()}`, {
        method: 'GET',
        signal: ipController.signal,
        cache: 'no-store'
      });
      clearTimeout(ipTimer);
      if (ipResp.ok) {
        const data = await ipResp.json();
        const observedIp = (data?.ip || '').trim();
        if (observedIp && observedIp !== expectedIp && !observedIp.startsWith(expectedIp)) {
          chrome.webRequest.onAuthRequired.removeListener(tempListener);
          return await markProxyBlocked(`Direct IP detected (${observedIp})`);
        }
      }
    } catch (e) {
      // If ipify has TLS/timeout delay, but Google 204 succeeded without auth challenge, proxy is healthy
    }

    chrome.webRequest.onAuthRequired.removeListener(tempListener);
    return await markProxyActive(expectedIp, expectedIp, config.proxyPort);
  } catch (err) {
    chrome.webRequest.onAuthRequired.removeListener(tempListener);
    return await markProxyBlocked(err.message || 'Connection Error');
  }
}

// Extension installation or update
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Smart Proxy installed/updated:', details.reason);
  const current = await chrome.storage.local.get(null);
  if (!current || Object.keys(current).length === 0) {
    await chrome.storage.local.set(DEFAULT_CONFIG);
  }
  await applyProxySettings();
});

// Browser startup
chrome.runtime.onStartup.addListener(async () => {
  await applyProxySettings();
});

// Watch for storage changes and automatically apply new PAC script
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local') {
    // Only re-apply if configuration keys changed, not proxyHealth
    const keys = Object.keys(changes);
    if (keys.some(k => k !== 'proxyHealth')) {
      await applyProxySettings();
    }
  }
});

// Intercept proxy authentication challenges (HTTP 407).
// When client IP is not in whitelist, Squid proxy asks for credentials.
// We silently cancel the native browser login prompt and instantly flag proxy as blocked.
chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (details.isProxy) {
      console.warn('Smart Proxy: Auth challenge detected (IP not in whitelist):', details);
      markProxyBlocked('Proxy Authentication Required (407)');
      // Cancel challenge to completely suppress Chrome's login/password prompt!
      return { cancel: true };
    }
  },
  { urls: ['<all_urls>'] },
  ['blocking']
);

// Listen for proxy errors
chrome.proxy.onProxyError.addListener(async (details) => {
  console.warn('Smart Proxy onProxyError:', details);
  const result = {
    status: 'blocked',
    reason: details.error || 'Proxy Error',
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ proxyHealth: result });
  await chrome.action.setBadgeText({ text: 'ERR' });
  await chrome.action.setBadgeBackgroundColor({ color: '#552222' });
});

// Handle messages from popup UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === 'getConfig') {
        const config = await getConfig();
        const stored = await chrome.storage.local.get('proxyHealth');
        sendResponse({ success: true, config, proxyHealth: stored.proxyHealth });
      } else if (message.action === 'checkHealth') {
        if (message.forceReapply) {
          await applyProxySettings();
        }
        const health = await checkProxyHealth();
        sendResponse({ success: true, health });
      } else if (message.action === 'toggleProxy') {
        const config = await getConfig();
        const newEnabled = !config.enabled;
        await chrome.storage.local.set({ enabled: newEnabled });
        sendResponse({ success: true, enabled: newEnabled });
      } else if (message.action === 'reapply') {
        await applyProxySettings();
        const health = await checkProxyHealth();
        sendResponse({ success: true, health });
      } else {
        sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (err) {
      console.error('Smart Proxy message handler error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();
  return true; // Keep message port open for async response
});
