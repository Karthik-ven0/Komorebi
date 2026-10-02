/**
 * Komorebi Codex Pet Terminal v2
 * REAL Codex Pet integration — fetches actual pets from the community gallery
 * at https://pets.ydb-qdrant.tech and downloads real animated spritesheets.
 *
 * Security: Only whitelisted codex commands accepted. Spritesheets are loaded
 * as images only — no script execution, no eval, no arbitrary code.
 */

'use strict';

const PetTerminal = (() => {
  // Auto-detect: use local proxy when on localhost (dev server), direct API on GitHub Pages
  const IS_LOCAL     = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const CODEX_PROXY  = IS_LOCAL ? '/codex-proxy'    : 'https://pets.ydb-qdrant.tech'; // ~161 pets
  const OPEN_PROXY   = IS_LOCAL ? '/openpets-proxy' : 'https://openpets.sh';           // ~5,877 pets
  const API_BASE     = 'https://pets.ydb-qdrant.tech'; // always for external links only

  /* ===================================================
     STATE
     =================================================== */
  let isOpen = false;
  let commandHistory = [];
  let historyIndex = -1;
  let outputEl = null;
  let inputEl = null;
  let catalogCache     = null; // local pre-bundled catalog (codex-catalog.json)
  let registryCache    = null; // codex gallery cache
  let openPetsCache    = null; // openpets.sh cache

  /* ===================================================
     PERSISTENCE
     =================================================== */
  function loadInstalledPets() {
    try {
      const raw = localStorage.getItem('km_installed_pets');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [{ id: 'maomao', slug: 'maomao', displayName: 'Maomao', sprite: 'maomao.webp', builtIn: true, emoji: '🐱', description: 'Peaceful herb-gathering cat companion' }];
  }

  function saveInstalledPets(list) {
    try { localStorage.setItem('km_installed_pets', JSON.stringify(list)); } catch (e) {}
  }

  function loadActivePet() {
    try {
      const raw = localStorage.getItem('km_active_pet');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return 'maomao';
  }

  function saveActivePet(id) {
    try { localStorage.setItem('km_active_pet', JSON.stringify(id)); } catch (e) {}
  }

  /* ===================================================
     OUTPUT HELPERS
     =================================================== */
  function print(text, type = 'system') {
    if (!outputEl) return;
    const line = document.createElement('div');
    line.className = `term-line ${type}`;
    line.innerHTML = text;
    outputEl.appendChild(line);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function clearOutput() { if (outputEl) outputEl.innerHTML = ''; }
  function printSpacer() { print('', 'muted'); }

  function printPetSpeak(msg) {
    print(`🐾 "${msg}"`, 'pet-speak');
  }

  function escTerminal(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ===================================================
     CATALOG & REGISTRIES
     =================================================== */
  async function fetchCatalog() {
    if (catalogCache) return catalogCache;
    try {
      const res = await fetch('codex-catalog.json');
      if (res.ok) {
        catalogCache = await res.json();
        return catalogCache;
      }
    } catch (e) {}
    return [];
  }

  /* Registry 1: Codex Gallery (uses catalog first, fallback to dev proxy) */
  async function fetchRegistry() {
    if (registryCache) return registryCache;
    const catalog = await fetchCatalog();
    if (catalog && catalog.length > 0) {
      registryCache = catalog;
      return registryCache;
    }
    if (IS_LOCAL) {
      try {
        const res = await fetch(`${CODEX_PROXY}/api/manifest`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        registryCache = data.pets || [];
        return registryCache;
      } catch (err) {
        print(`⚠ Codex gallery unreachable: ${err.message}`, 'muted');
        return [];
      }
    }
    return [];
  }

  async function fetchPetBySlug(slug) {
    const pets = await fetchRegistry();
    return pets.find(p => (p.slug || p.id) === slug) || null;
  }

  /* Registry 2: openpets.sh (~5,877 pets) */
  async function fetchOpenPets(query) {
    if (!IS_LOCAL) return []; // avoid CORS failure on static hosts
    try {
      const url = query
        ? `${OPEN_PROXY}/api/pets?search=${encodeURIComponent(query)}&pageSize=15`
        : `${OPEN_PROXY}/api/pets?pageSize=20`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.pets || [];
    } catch (err) {
      return [];
    }
  }

  async function fetchOpenPetById(id) {
    if (!IS_LOCAL) return null;
    try {
      const res = await fetch(`${OPEN_PROXY}/api/pets/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.pet || data || null;
    } catch (err) {
      return null;
    }
  }

  /* Combined search across catalog and live dev proxies */
  async function searchAllPets(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return [];

    const catalog = await fetchCatalog();
    const catalogMatches = catalog.filter(p =>
      (p.slug || p.id || '').toLowerCase().includes(q) ||
      (p.displayName || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    ).map(p => ({ ...p, _source: p.source || 'catalog' }));

    if (catalogMatches.length > 0) {
      return catalogMatches;
    }

    if (IS_LOCAL) {
      const [codexPets, openPets] = await Promise.all([
        fetchRegistry(),
        fetchOpenPets(query),
      ]);
      const codexMatches = codexPets.filter(p =>
        (p.slug || p.id || '').toLowerCase().includes(q) ||
        (p.displayName || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.tags || []).some(t => t.toLowerCase().includes(q))
      ).map(p => ({ ...p, _source: 'codex' }));
      const openMatches = openPets.map(p => ({ ...p, _source: 'openpets' }));
      return [...codexMatches, ...openMatches];
    }

    return [];
  }

  /* Find a pet by slug/id across catalog and registries */
  async function findPetAnywhere(slug) {
    const q = (slug || '').toLowerCase().trim();

    // 1. Check local catalog first (instant, works on GitHub Pages & offline)
    const catalog = await fetchCatalog();
    const exact = catalog.find(p => (p.slug || p.id || '').toLowerCase() === q);
    if (exact) return { pet: exact, source: 'catalog' };

    // Partial match in catalog
    const partial = catalog.find(p => (p.slug || p.id || '').toLowerCase().includes(q) || (p.displayName || '').toLowerCase().includes(q));
    if (partial) return { pet: partial, source: 'catalog' };

    // 2. Fall back to live dev server proxy if local
    if (IS_LOCAL) {
      const codexPet = await fetchPetBySlug(q);
      if (codexPet) return { pet: codexPet, source: 'codex' };

      const openPet = await fetchOpenPetById(q);
      if (openPet) return { pet: openPet, source: 'openpets' };

      const results = await fetchOpenPets(q);
      const openMatch = results.find(p => p.id === q || p.id.includes(q));
      if (openMatch) return { pet: openMatch, source: 'openpets' };
    }

    return null;
  }

  /* ===================================================
     SPRITE SWITCHING — Actually swap the visible pet
     =================================================== */
  function switchVisiblePet(petData) {
    if (!window._maomao) return;
    const pet = window._maomao;

    if (petData.slug === 'maomao' || petData.builtIn) {
      pet.swapSprite('maomao.webp', 8, 11);
      pet._updateBadge('Maomao 🐱');
    } else {
      const spriteUrl = petData.sprite || petData.spritesheetUrl;

      // Use stored rows (saved at install time), or detect from tags
      const storedRows = petData.rows;
      const tags = (petData.tags || []).join(' ').toLowerCase();
      const rows = storedRows || (tags.includes('v2') ? 11 : 9);

      pet.swapSprite(spriteUrl, 8, rows);
      pet._updateBadge(petData.displayName || petData.slug || petData.id);
    }
  }

  /* ===================================================
     WELCOME
     =================================================== */
  function printWelcome() {
    print('╭──────────────────────────────────────╮', 'accent');
    print('│  🌸 Komorebi Codex Pet Console v2    │', 'accent');
    print('│  Real Codex Pets · Live Gallery       │', 'accent');
    print('╰──────────────────────────────────────╯', 'accent');
    printSpacer();
    const installed = loadInstalledPets();
    const activeId = loadActivePet();
    const activePet = installed.find(p => (p.slug || p.id) === activeId);
    print(`  Active: ${activePet ? (activePet.emoji || '🐾') + ' ' + activePet.displayName : activeId}`, 'success');
    print(`  Installed: ${installed.length} · Catalog: 300+ Codex & OpenPets`, 'info');
    printSpacer();
    print('  Type <span class="cmd-highlight">help</span> for commands, <span class="cmd-highlight">search &lt;query&gt;</span> to browse pets', 'system');
    print('  Install with: <span class="cmd-highlight">install &lt;slug&gt;</span> (e.g. install fennec-fox)', 'muted');
    printSpacer();
  }

  /* ===================================================
     COMMAND ROUTER
     =================================================== */
  async function executeCommand(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    commandHistory.push(trimmed);
    if (commandHistory.length > 50) commandHistory.shift();
    historyIndex = commandHistory.length;

    print(`<span style="color:#FF6A00;">codex ❯</span> ${escTerminal(trimmed)}`, 'system');

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Handle ANY npx codex-pets / codexpetdb / @astandrik format:
    // npx codex-pets add orihime-tybw
    // npx @astandrik/codex-pets install fennec-fox
    // npx codexpetdb install red-panda
    if (cmd === 'npx') {
      const actionIdx = parts.findIndex(p => ['install', 'add', 'list', 'search', 'browse'].includes(p));
      if (actionIdx !== -1) {
        const action = parts[actionIdx];
        const slug   = parts.slice(actionIdx + 1).join('-'); // join remaining as slug
        if ((action === 'install' || action === 'add') && slug) {
          await cmdInstall([slug]);
        } else if (action === 'list') {
          await cmdList([]);
        } else if (action === 'search' || action === 'browse') {
          await cmdSearch(parts.slice(actionIdx + 1));
        }
      } else {
        print('⚠ Unrecognised npx command. Try: npx codex-pets add &lt;slug&gt;', 'warning');
      }
      printSpacer();
      return;
    }

    reactPet('observe');

    switch (cmd) {
      case 'help': cmdHelp(); break;
      case 'clear': clearOutput(); break;
      case 'install': case 'add': await cmdInstall(args); break;
      case 'remove': case 'uninstall': cmdRemove(args); break;
      case 'use': case 'switch': cmdUse(args); break;
      case 'list': await cmdList(args); break;
      case 'search': case 'browse': case 'find': await cmdSearch(args); break;
      case 'info': await cmdInfo(args); break;
      case 'status': cmdStatus(); break;
      case 'timer': cmdTimer(args); break;
      case 'task': cmdTask(args); break;
      case 'sound': cmdSound(args); break;
      case 'theme': cmdTheme(args); break;
      case 'pet': cmdPetAction(args); break;
      case 'version': print('Komorebi Codex v2.0.0 — Real Codex Pet Integration', 'info'); break;
      case 'whoami':
        const ap = loadInstalledPets().find(p => (p.slug || p.id) === loadActivePet());
        print(`You are the guardian of ${ap ? ap.displayName : 'your companion'}`, 'info');
        break;
      default:
        print(`⚠ Unknown command: "${escTerminal(cmd)}"`, 'error');
        print('  Type <span class="cmd-highlight">help</span> for available commands.', 'muted');
        break;
    }
    printSpacer();
  }

  /* ===================================================
     COMMAND IMPLEMENTATIONS
     =================================================== */
  function cmdHelp() {
    printSpacer();
    print('╭─ 🌸 CODEX COMMANDS ─────────────────╮', 'info');
    printSpacer();
    print('  <span class="cmd-highlight">Pet Management (Real Codex Pets):</span>', 'info');
    print('    install &lt;slug&gt;       Download & install from gallery', 'system');
    print('    search &lt;query&gt;       Search 160+ community pets', 'system');
    print('    list                 Your installed pets', 'system');
    print('    list all             Browse entire gallery', 'system');
    print('    use &lt;slug&gt;           Switch active companion', 'system');
    print('    remove &lt;slug&gt;        Uninstall a pet', 'system');
    print('    info &lt;slug&gt;          Pet details from gallery', 'system');
    printSpacer();
    print('  <span class="cmd-highlight">Also accepts npx format:</span>', 'info');
    print('    npx @astandrik/codex-pets install &lt;slug&gt;', 'muted');
    print('    npx codex-pets add &lt;slug&gt;', 'muted');
    printSpacer();
    print('  <span class="cmd-highlight">App Controls:</span>', 'info');
    print('    timer start|pause|reset|set &lt;mins&gt;', 'system');
    print('    task add|list|done|focus &lt;args&gt;', 'system');
    print('    sound rain|brown|forest|lofi|komorebi|silence', 'system');
    print('    theme dark|light|toggle', 'system');
    printSpacer();
    print('  <span class="cmd-highlight">Utility:</span>', 'info');
    print('    status  pet greet  pet speak  clear  version', 'system');
    printSpacer();
    print('╰──────────────────────────────────────╯', 'info');
  }

  async function cmdInstall(args) {
    if (!args.length) {
      print('Usage: install &lt;slug&gt;  (e.g. install orihime-tybw)', 'warning');
      print('  Use <span class="cmd-highlight">search &lt;query&gt;</span> to find pets', 'muted');
      return;
    }

    const slug = args.join('-').toLowerCase(); // allow spaces as dashes
    const installed = loadInstalledPets();

    if (installed.find(p => (p.slug || p.id) === slug)) {
      print(`✓ "${slug}" is already installed!`, 'warning');
      return;
    }

    print(`🔍 Searching both registries for "${escTerminal(slug)}"...`, 'info');

    const found = await findPetAnywhere(slug);
    if (!found) {
      print(`✗ Pet "${escTerminal(slug)}" not found in any registry`, 'error');
      print('  Use <span class="cmd-highlight">search &lt;query&gt;</span> to find available pets', 'muted');
      return;
    }

    const { pet, source } = found;
    const petId = pet.id || pet.slug;
    const petName = pet.displayName || petId;

    print(`📦 Found: ${petName} [${source}] — "${(pet.description || '').substring(0, 80)}"`, 'system');
    print(`  Installing ${petName}...`, 'info');

    // Build the full spritesheet URL based on which registry / source it came from
    let spriteUrl = pet.spritesheetUrl || pet.sprite;
    if (source === 'catalog') {
      spriteUrl = pet.spritesheetUrl;
      // If local, rewrite to proxy if applicable
      if (IS_LOCAL) {
        if (spriteUrl.includes('pets.ydb-qdrant.tech/api/assets/')) {
          spriteUrl = '/codex-proxy/api/assets/' + spriteUrl.split('/api/assets/')[1];
        } else if (spriteUrl.includes('openpets.sh/api/pets/')) {
          spriteUrl = '/openpets-proxy/api/pets/' + spriteUrl.split('/api/pets/')[1];
        }
      }
    } else if (source === 'openpets') {
      spriteUrl = IS_LOCAL
        ? `${OPEN_PROXY}/api/pets/${encodeURIComponent(petId)}/spritesheet`
        : `https://openpets.sh/api/pets/${encodeURIComponent(petId)}/spritesheet`;
    } else {
      spriteUrl = pet.spritesheetUrl.startsWith('http')
        ? (IS_LOCAL ? CODEX_PROXY + '/api/assets/' + pet.spritesheetUrl.split('/api/assets/')[1] : pet.spritesheetUrl)
        : (IS_LOCAL ? CODEX_PROXY + pet.spritesheetUrl : 'https://pets.ydb-qdrant.tech' + pet.spritesheetUrl);
    }

    print(`  ├─ Downloading spritesheet...`, 'muted');

    try {
      await new Promise((resolve, reject) => {
        const img = new Image();
        // Do NOT set img.crossOrigin = 'anonymous' to avoid CORS rejection on external CDNs
        img.onload = resolve;
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = spriteUrl;
      });

      const tags = pet.tags || [];
      const rows = pet.rows || ((pet.validationReport && pet.validationReport.spriteVersionNumber === 2) ? 11
                 : tags.includes('v2') ? 11 : 9);

      print(`  ├─ Spritesheet verified ✓ (v${rows === 11 ? 2 : 1} format, ${(pet.tags || []).slice(0,4).join(', ') || 'no tags'})`, 'muted');
      print(`  ├─ Registering pet...`, 'muted');

      const petRecord = {
        slug: petId,
        id: petId,
        displayName: petName,
        description: pet.description || '',
        sprite: spriteUrl,
        spritesheetUrl: spriteUrl,
        rows,
        tags: tags,
        kind: pet.kind || 'creature',
        submittedBy: pet.submittedBy || pet.ownerName,
        source,
        builtIn: false,
        emoji: getEmojiForKind(pet.kind, tags),
      };

      installed.push(petRecord);
      saveInstalledPets(installed);
      renderPetSelector();

      print(`  └─ Done!`, 'muted');
      print(`✓ ${petRecord.emoji} ${petName} installed successfully!`, 'success');
      print(`  Switch to it: <span class="cmd-highlight">use ${petId}</span>`, 'info');
      printPetSpeak(`Welcome ${petName} to the family!`);
      reactPet('celebrate');

    } catch (err) {
      print(`  └─ ✗ Download failed: ${err.message}`, 'error');
      print('  Spritesheet could not be loaded. Check your connection.', 'muted');
    }
  }

  function cmdRemove(args) {
    if (!args.length) { print('Usage: remove &lt;slug&gt;', 'warning'); return; }
    const slug = args[0].toLowerCase();
    const installed = loadInstalledPets();
    const pet = installed.find(p => (p.slug || p.id) === slug);

    if (!pet) { print(`✗ "${slug}" is not installed`, 'warning'); return; }
    if (pet.builtIn) { print(`✗ Cannot remove built-in pet "${pet.displayName}"`, 'error'); return; }

    if (loadActivePet() === slug) {
      saveActivePet('maomao');
      switchVisiblePet({ slug: 'maomao', builtIn: true });
    }

    saveInstalledPets(installed.filter(p => (p.slug || p.id) !== slug));
    renderPetSelector();
    print(`✓ ${pet.emoji || '🐾'} ${pet.displayName} removed`, 'success');
  }

  function cmdUse(args) {
    if (!args.length) { print('Usage: use &lt;slug&gt;', 'warning'); return; }
    const slug = args[0].toLowerCase();
    const installed = loadInstalledPets();
    const pet = installed.find(p => (p.slug || p.id) === slug);

    if (!pet) {
      print(`✗ "${slug}" not installed. Install it first: install ${slug}`, 'warning');
      return;
    }

    if (loadActivePet() === slug) {
      print(`✓ "${pet.displayName}" is already active!`, 'info');
      return;
    }

    saveActivePet(slug);
    renderPetSelector();
    switchVisiblePet(pet);
    print(`✓ Switched to ${pet.emoji || '🐾'} ${pet.displayName}!`, 'success');
    reactPet('wave');
  }

  async function cmdList(args) {
    const showAll = args[0] === 'all' || args[0] === 'gallery';

    if (showAll) {
      print('🌐 Fetching Codex Pet Gallery...', 'info');
      const pets = await fetchRegistry();
      if (!pets.length) return;

      print(`📦 Gallery: ${pets.length} pets available`, 'info');
      printSpacer();
      const installed = loadInstalledPets();
      const installedSlugs = installed.map(p => p.slug || p.id);

      // Show first 30
      pets.slice(0, 30).forEach(p => {
        const isInst = installedSlugs.includes(p.slug);
        const badge = isInst ? ' <span style="color:#28C840;">✓</span>' : '';
        print(`  <span class="val-highlight">${p.slug}</span> — ${p.displayName}${badge}`, 'system');
      });
      if (pets.length > 30) {
        print(`  ... and ${pets.length - 30} more. Use <span class="cmd-highlight">search &lt;query&gt;</span> to find specific pets.`, 'muted');
      }
    } else {
      const installed = loadInstalledPets();
      const activeId = loadActivePet();
      print(`📦 Installed Pets (${installed.length}):`, 'info');
      printSpacer();
      installed.forEach(p => {
        const isActive = (p.slug || p.id) === activeId;
        const badge = isActive ? ' <span style="color:#FF6A00;">★ ACTIVE</span>' : '';
        print(`  ${p.emoji || '🐾'} <span class="val-highlight">${p.slug || p.id}</span> — ${p.displayName}${badge}`, isActive ? 'accent' : 'system');
      });
    }
  }

  async function cmdSearch(args) {
    const query = args.join(' ');
    if (!query) { print('Usage: search &lt;query&gt;  (e.g. search bleach, search anime)', 'warning'); return; }

    print(`🔍 Searching both registries for "${escTerminal(query)}"...`, 'info');
    const results = await searchAllPets(query);

    if (!results.length) {
      print(`  No pets found matching "${escTerminal(query)}"`, 'warning');
      return;
    }

    print(`  Found ${results.length} pet${results.length === 1 ? '' : 's'}:`, 'success');
    printSpacer();

    const installed = loadInstalledPets();
    const installedIds = installed.map(p => p.slug || p.id);

    results.slice(0, 18).forEach(p => {
      const id = p.id || p.slug;
      const isInst = installedIds.includes(id);
      const badge = isInst ? ' <span style="color:#28C840;">✓ installed</span>' : '';
      const src = p._source === 'openpets' ? ' <span style="color:#888;font-size:10px;">[openpets]</span>' : '';
      const emoji = getEmojiForKind(p.kind, p.tags);
      print(`  ${emoji} <span class="val-highlight">${escTerminal(id)}</span> — ${escTerminal(p.displayName || id)}${badge}${src}`, 'system');
      const desc = p.description ? p.description.substring(0, 78) + (p.description.length > 78 ? '...' : '') : '';
      if (desc) print(`     ${escTerminal(desc)}`, 'muted');
    });

    if (results.length > 18) {
      print(`  ... and ${results.length - 18} more`, 'muted');
    }
    printSpacer();
    print('  Install with: <span class="cmd-highlight">install &lt;slug&gt;</span>', 'muted');
  }

  async function cmdInfo(args) {
    if (!args.length) { print('Usage: info &lt;slug&gt;', 'warning'); return; }
    const slug = args[0].toLowerCase();

    // Check installed first
    const installed = loadInstalledPets();
    let pet = installed.find(p => (p.slug || p.id) === slug);

    if (!pet) {
      print(`🔍 Looking up "${slug}" in catalog...`, 'info');
      const found = await findPetAnywhere(slug);
      if (found) pet = found.pet;
    }

    if (!pet) { print(`✗ Pet "${escTerminal(slug)}" not found`, 'error'); return; }

    const isInstalled = installed.some(p => (p.slug || p.id) === slug);
    const isActive = loadActivePet() === slug;
    const emoji = pet.emoji || getEmojiForKind(pet.kind, pet.tags);

    printSpacer();
    print(`╭──── ${emoji} ${pet.displayName || pet.slug} ────╮`, 'info');
    print(`  Slug:        <span class="val-highlight">${pet.slug}</span>`, 'system');
    if (pet.description) print(`  Description: ${pet.description.substring(0, 100)}`, 'system');
    if (pet.kind) print(`  Kind:        ${pet.kind}`, 'system');
    if (pet.tags && pet.tags.length) print(`  Tags:        [${pet.tags.slice(0, 6).join(', ')}]`, 'system');
    if (pet.submittedBy) print(`  Author:      ${pet.submittedBy}`, 'system');
    print(`  Status:      ${isActive ? '★ Active' : isInstalled ? '✓ Installed' : '⬇ Available'}`, isActive ? 'accent' : isInstalled ? 'success' : 'info');
    if (pet.installCommand) print(`  Install:     ${pet.installCommand}`, 'muted');
    if (pet.pageUrl) print(`  Gallery:     ${pet.pageUrl}`, 'muted');
    print(`╰${'─'.repeat(Math.min(40, (pet.displayName || pet.slug).length + 10))}╯`, 'info');
  }

  function cmdStatus() {
    printSpacer();
    print('╭─ 🌸 KOMOREBI STATUS ─────────────────╮', 'info');
    printSpacer();
    const activeId = loadActivePet();
    const installed = loadInstalledPets();
    const activePet = installed.find(p => (p.slug || p.id) === activeId);
    print(`  🐾 Pet:     ${activePet ? (activePet.emoji || '🐾') + ' ' + activePet.displayName : activeId}`, 'system');
    if (typeof App !== 'undefined') {
      const rem = App.formatTime ? App.formatTime(App.timerRemainingSecs) : '--:--';
      print(`  ⏱  Timer:   ${rem} (${App.timerMode === 'focus' ? 'Focus' : 'Break'} — ${App.timerRunning ? 'Running' : 'Paused'})`, App.timerRunning ? 'success' : 'system');
      print(`  🎯 Intent:  ${App.activeTask ? App.activeTask.title : 'None'}`, App.activeTask ? 'accent' : 'system');
      const tasks = App.getTasks ? App.getTasks() : [];
      print(`  📋 Tasks:   ${tasks.filter(t => t.status !== 'done').length} active, ${tasks.filter(t => t.status === 'done').length} done`, 'system');
      print(`  🔊 Sound:   ${typeof AmbientAudio !== 'undefined' ? (AmbientAudio.activeSound === 'none' ? 'Silence' : AmbientAudio.activeSound) : 'unknown'}`, 'system');
      print(`  🎨 Theme:   ${document.body.classList.contains('dark-mode') ? 'Dark' : 'Light'}`, 'system');
    }
    print(`  📦 Pets:    ${installed.length} installed`, 'system');
    printSpacer();
    print('╰──────────────────────────────────────╯', 'info');
  }

  /* --- App integration commands (same as before) --- */
  function cmdTimer(args) {
    if (typeof App === 'undefined') { print('⚠ App not ready', 'error'); return; }
    const sub = (args[0] || '').toLowerCase();
    switch (sub) {
      case 'start': App.timerStart(); print('▶ Timer started 🌿', 'success'); break;
      case 'pause': App.timerPause(); print('❚❚ Timer paused', 'warning'); break;
      case 'reset': App.timerReset(); print('↺ Timer reset', 'info'); break;
      case 'skip': App.timerSkip(); print('⏭ Skipped', 'info'); break;
      case 'set':
        const m = parseInt(args[1]);
        if (isNaN(m) || m < 1 || m > 120) { print('Usage: timer set &lt;1-120&gt;', 'warning'); return; }
        App.setTimerDuration(m); print(`⏱ Set to ${m}m`, 'success'); break;
      default:
        print(`⏱ ${App.formatTime ? App.formatTime(App.timerRemainingSecs) : '--:--'} — ${App.timerRunning ? 'Running' : 'Paused'}`, 'system');
    }
  }

  function cmdTask(args) {
    if (typeof App === 'undefined') { print('⚠ App not ready', 'error'); return; }
    const sub = (args[0] || '').toLowerCase();
    switch (sub) {
      case 'add': {
        const title = args.slice(1).join(' ');
        if (!title) { print('Usage: task add &lt;title&gt;', 'warning'); return; }
        const tasks = App.getTasks();
        tasks.unshift({ id: 'task-' + Date.now(), title, priority: 'normal', time: null, status: 'active', date: App.getTodayIso(), createdAt: Date.now() });
        App.saveTasks(tasks); App.renderQueue();
        print(`✓ Added: "${escTerminal(title)}"`, 'success'); break;
      }
      case 'list': {
        const active = App.getTasks().filter(t => t.status !== 'done');
        if (!active.length) { print('📋 Queue clear ☕', 'info'); return; }
        active.forEach((t, i) => print(`  ${i + 1}. ${escTerminal(t.title)}`, 'system'));
        break;
      }
      case 'done': {
        const n = parseInt(args[1]);
        const active = App.getTasks().filter(t => t.status !== 'done');
        if (isNaN(n) || n < 1 || n > active.length) { print(`Usage: task done &lt;1-${active.length}&gt;`, 'warning'); return; }
        App.toggleTask(active[n - 1].id, true);
        print(`✓ Done: "${escTerminal(active[n - 1].title)}"`, 'success'); reactPet('celebrate'); break;
      }
      case 'focus': {
        const n = parseInt(args[1]);
        const active = App.getTasks().filter(t => t.status !== 'done');
        if (isNaN(n) || n < 1 || n > active.length) { print(`Usage: task focus &lt;1-${active.length}&gt;`, 'warning'); return; }
        App.setIntent({ id: active[n - 1].id, title: active[n - 1].title });
        print(`🎯 Focusing: "${escTerminal(active[n - 1].title)}"`, 'accent'); break;
      }
      default: print('📋 task add|list|done|focus', 'info');
    }
  }

  function cmdSound(args) {
    if (typeof App === 'undefined') { print('⚠ App not ready', 'error'); return; }
    const map = { rain: ['rain','Rain','🌧️'], brown: ['brown','Brown Noise','⚡'], forest: ['forest','Forest','🌲'], lofi: ['lofi','Lofi Chords','☕'], komorebi: ['komorebi','Komorebi','🌸'], chimes: ['komorebi','Komorebi','🌸'], none: ['none','Silence','🔇'], silence: ['none','Silence','🔇'], off: ['none','Silence','🔇'] };
    const s = (args[0] || '').toLowerCase();
    if (!s) { print('🔊 Sounds: rain, brown, forest, lofi, komorebi, silence', 'info'); return; }
    const m = map[s];
    if (!m) { print(`✗ Unknown: "${escTerminal(s)}"`, 'error'); return; }
    App.selectAmbientSound(m[0], m[1], m[2]);
    print(`${m[2]} Now: ${m[1]}`, 'success');
  }

  function cmdTheme(args) {
    if (typeof App === 'undefined') return;
    const s = (args[0] || '').toLowerCase();
    if (s === 'dark') { App.toggleTheme(true); print('🌙 Dark', 'success'); }
    else if (s === 'light') { App.toggleTheme(false); print('☀️ Light', 'success'); }
    else if (s === 'toggle') { App.toggleTheme(!App.settings.darkMode); print(`🎨 ${App.settings.darkMode ? 'Dark' : 'Light'}`, 'success'); }
    else print('Usage: theme dark|light|toggle', 'info');
  }

  function cmdPetAction(args) {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'greet' || sub === 'wave') {
      if (window._maomao) { window._maomao._onPetClicked(); print('👋 Waving!', 'success'); }
    } else if (sub === 'speak') {
      printPetSpeak('I\'m here for you! Let\'s focus together 🌸');
      if (window._maomao) window._maomao._showBubble('greet');
    } else if (sub === 'reset') {
      if (window._maomao) { window._maomao.resetToCorner(); print('↺ Reset position', 'info'); }
    } else {
      print('🐾 pet greet | speak | reset', 'info');
    }
  }

  /* ===================================================
     HELPERS
     =================================================== */
  function getEmojiForKind(kind, tags) {
    const tagStr = (tags || []).join(' ').toLowerCase();
    if (tagStr.includes('cat')) return '🐱';
    if (tagStr.includes('dog') || tagStr.includes('corgi')) return '🐕';
    if (tagStr.includes('fox') || tagStr.includes('fennec')) return '🦊';
    if (tagStr.includes('rabbit') || tagStr.includes('bunny')) return '🐰';
    if (tagStr.includes('dragon')) return '🐉';
    if (tagStr.includes('owl')) return '🦉';
    if (tagStr.includes('penguin')) return '🐧';
    if (tagStr.includes('panda')) return '🐼';
    if (tagStr.includes('bear')) return '🐻';
    if (tagStr.includes('deer')) return '🦌';
    if (tagStr.includes('wolf')) return '🐺';
    if (tagStr.includes('anime') || tagStr.includes('chibi')) return '✨';
    if (kind === 'creature') return '🐾';
    if (kind === 'character') return '🧑';
    return '🐾';
  }

  function reactPet(type) {
    if (!window._maomao) return;
    const pet = window._maomao;
    const rows = { observe: [8, 'Reading 📖'], celebrate: [4, 'Yay! 🌸'], wave: [3, 'Hello! 👋'] };
    const r = rows[type];
    if (r) {
      pet.row = r[0]; pet.frame = 0; pet._updateBadge(r[1]);
      setTimeout(() => { if (window._maomao) { pet.row = 6; pet._updateBadge('Waiting'); } }, 2200);
    }
  }

  /* ===================================================
     PET SELECTOR (Settings visual grid)
     =================================================== */
  function renderPetSelector() {
    const grid = document.getElementById('pet-selector-grid');
    if (!grid) return;
    const installed = loadInstalledPets();
    const activeId = loadActivePet();

    if (!installed.length) {
      grid.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:8px;">No pets installed.</div>';
      return;
    }

    grid.innerHTML = installed.map(p => {
      const id = p.slug || p.id;
      const isActive = id === activeId;
      return `
        <div class="pet-select-card ${isActive ? 'active' : ''}" onclick="PetTerminal.selectPet('${id}')">
          <div class="pet-select-emoji">${p.emoji || '🐾'}</div>
          <div class="pet-select-name">${escTerminal(p.displayName || p.slug || p.id)}</div>
        </div>`;
    }).join('');
  }

  function selectPet(id) {
    const installed = loadInstalledPets();
    const pet = installed.find(p => (p.slug || p.id) === id);
    if (!pet) return;

    saveActivePet(id);
    renderPetSelector();
    switchVisiblePet(pet);

    if (typeof showToast === 'function') {
      showToast(`Switched to ${pet.emoji || '🐾'} ${pet.displayName}`);
    }
  }

  /* ===================================================
     TERMINAL UI
     =================================================== */
  function toggle() {
    isOpen = !isOpen;
    const container = document.getElementById('terminal-container');
    const label = document.getElementById('terminal-toggle-label');
    if (container) container.style.display = isOpen ? 'block' : 'none';
    if (label) label.textContent = isOpen ? '▴ Close' : '▾ Open';
    if (isOpen && !outputEl) init();
    if (isOpen && inputEl) setTimeout(() => inputEl.focus(), 200);
  }

  function init() {
    outputEl = document.getElementById('terminal-output');
    inputEl = document.getElementById('terminal-input');
    if (!outputEl || !inputEl) return;

    printWelcome();

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = inputEl.value; inputEl.value = '';
        executeCommand(val);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIndex > 0) { historyIndex--; inputEl.value = commandHistory[historyIndex] || ''; }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex < commandHistory.length - 1) { historyIndex++; inputEl.value = commandHistory[historyIndex] || ''; }
        else { historyIndex = commandHistory.length; inputEl.value = ''; }
      }
    });

    renderPetSelector();
  }

  /* ===================================================
     BOOT
     =================================================== */
  function boot() {
    setTimeout(() => {
      renderPetSelector();
      // On load, switch to the saved active pet
      const activeId = loadActivePet();
      if (activeId && activeId !== 'maomao') {
        const installed = loadInstalledPets();
        const pet = installed.find(p => (p.slug || p.id) === activeId);
        if (pet) {
          // Wait for MaomaoPet to fully boot, then swap sprite
          setTimeout(() => switchVisiblePet(pet), 1800);
        }
      }
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ===================================================
     PUBLIC API
     =================================================== */
  return {
    toggle,
    selectPet,
    init,
    loadActivePet,
    loadInstalledPets,
  };
})();
