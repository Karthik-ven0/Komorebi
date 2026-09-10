/**
 * Spotify Integration Module — Loop PWA
 * Uses OAuth 2.0 PKCE (no client secret, no backend needed)
 * Playback via Spotify Connect API (works on Free + Premium)
 * Audio plays through the user's existing Spotify app on phone/desktop
 */

'use strict';

/* ===================================================
   SPOTIFY CONFIG
   User must provide their own Client ID from:
   https://developer.spotify.com/dashboard
   Redirect URI to register: http://localhost:3000 (or your domain)
   =================================================== */
const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  'streaming'
].join(' ');

const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');

/* ===================================================
   PKCE UTILITIES
   =================================================== */
async function generateCodeVerifier(len = 128) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(x => chars[x % chars.length]).join('');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ===================================================
   SPOTIFY AUTH
   =================================================== */
const Spotify = {
  clientId: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,
  deviceId: null,
  currentTrack: null,
  isPlaying: false,
  selectedPlaylist: null,
  reminderTrack: null,
  pollInterval: null,

  /* --- INIT --- */
  init() {
    // Load from storage
    const cfg = DB.load('spotify_cfg', {});
    this.clientId = cfg.clientId || null;
    this.accessToken = cfg.accessToken || null;
    this.refreshToken = cfg.refreshToken || null;
    this.expiresAt = cfg.expiresAt || 0;
    this.selectedPlaylist = cfg.selectedPlaylist || null;
    this.reminderTrack = cfg.reminderTrack || null;

    // Handle OAuth callback
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (code) {
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
      this.exchangeCode(code);
    } else if (error) {
      window.history.replaceState({}, document.title, window.location.pathname);
      showToast('Spotify login cancelled');
    }

    this.updateUI();
  },

  /* --- AUTH FLOW --- */
  async connect(clientId) {
    if (!clientId || clientId.trim().length < 10) {
      showToast('Please enter a valid Client ID');
      return;
    }
    this.clientId = clientId.trim();
    this.saveConfig();

    const verifier = await generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    sessionStorage.setItem('sp_verifier', verifier);

    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
    authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('show_dialog', 'true');

    window.location.href = authUrl.toString();
  },

  async exchangeCode(code) {
    const verifier = sessionStorage.getItem('sp_verifier');
    if (!verifier) { showToast('Auth error — please try again'); return; }

    const clientId = this.clientId || DB.load('spotify_cfg', {}).clientId;
    if (!clientId) { showToast('Client ID missing'); return; }

    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'authorization_code',
          code,
          redirect_uri: SPOTIFY_REDIRECT_URI,
          code_verifier: verifier,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error_description || data.error);

      this.clientId = clientId;
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token || null;
      this.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
      sessionStorage.removeItem('sp_verifier');
      this.saveConfig();
      showToast('Spotify connected! 🎵');
      this.updateUI();
      this.fetchProfile();
    } catch (err) {
      console.error('Spotify token exchange failed:', err);
      showToast('Spotify login failed — check Client ID & redirect URI');
    }
  },

  async refreshAccessToken() {
    if (!this.refreshToken || !this.clientId) return false;
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.clientId,
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        this.accessToken = data.access_token;
        this.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
        if (data.refresh_token) this.refreshToken = data.refresh_token;
        this.saveConfig();
        return true;
      }
    } catch (e) {}
    return false;
  },

  async ensureToken() {
    if (!this.accessToken) return false;
    if (Date.now() >= this.expiresAt) {
      return await this.refreshAccessToken();
    }
    return true;
  },

  isConnected() {
    return !!this.accessToken;
  },

  disconnect() {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.selectedPlaylist = null;
    this.reminderTrack = null;
    this.currentTrack = null;
    this.stopPollNowPlaying();
    this.saveConfig();
    this.updateUI();
    showToast('Spotify disconnected');
  },

  saveConfig() {
    DB.save('spotify_cfg', {
      clientId: this.clientId,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
      selectedPlaylist: this.selectedPlaylist,
      reminderTrack: this.reminderTrack,
    });
  },

  /* --- API CALLS --- */
  async api(endpoint, options = {}) {
    const ok = await this.ensureToken();
    if (!ok) { showToast('Spotify session expired — please reconnect'); return null; }
    const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (res.status === 204) return {};
    if (res.status === 401) { this.disconnect(); return null; }
    if (!res.ok) return null;
    return res.json().catch(() => ({}));
  },

  async fetchProfile() {
    const data = await this.api('/me');
    if (!data) return;
    const name = data.display_name || data.id;
    showToast(`Spotify: Logged in as ${name} 🎵`);
    const nameEl = document.getElementById('sp-user-name');
    if (nameEl) nameEl.textContent = name;
  },

  async fetchPlaylists() {
    const data = await this.api('/me/playlists?limit=50');
    return data?.items || [];
  },

  async fetchPlaylistTracks(playlistId) {
    const data = await this.api(`/playlists/${playlistId}/tracks?limit=30&fields=items(track(id,name,artists,album(images)))`);
    return (data?.items || []).map(i => i.track).filter(Boolean);
  },

  async getNowPlaying() {
    return await this.api('/me/player/currently-playing');
  },

  async getDevices() {
    const data = await this.api('/me/player/devices');
    return data?.devices || [];
  },

  /* --- PLAYBACK CONTROLS (Spotify Connect) --- */
  async play(contextUri, trackUris) {
    const body = {};
    if (contextUri) body.context_uri = contextUri;
    else if (trackUris) body.uris = trackUris;
    await this.api('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    this.isPlaying = true;
    this.updatePlayUI();
    this.startPollNowPlaying();
  },

  async pause() {
    await this.api('/me/player/pause', { method: 'PUT' });
    this.isPlaying = false;
    this.updatePlayUI();
    this.stopPollNowPlaying();
  },

  async resume() {
    await this.api('/me/player/play', { method: 'PUT' });
    this.isPlaying = true;
    this.updatePlayUI();
    this.startPollNowPlaying();
  },

  async next() {
    await this.api('/me/player/next', { method: 'POST' });
    setTimeout(() => this.pollNowPlaying(), 800);
  },

  async prev() {
    await this.api('/me/player/previous', { method: 'POST' });
    setTimeout(() => this.pollNowPlaying(), 800);
  },

  async setVolume(pct) {
    await this.api(`/me/player/volume?volume_percent=${pct}`, { method: 'PUT' });
  },

  async playPlaylist(playlist) {
    this.selectedPlaylist = playlist;
    this.saveConfig();
    await this.play(playlist.uri);
    showToast(`Playing: ${playlist.name} 🎵`);
  },

  async playTrackOnce(track) {
    await this.api('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify({ uris: [track.uri] }),
    });
  },

  /* --- NOW PLAYING POLLING --- */
  startPollNowPlaying() {
    this.stopPollNowPlaying();
    this.pollNowPlaying();
    this.pollInterval = setInterval(() => this.pollNowPlaying(), 5000);
  },
  stopPollNowPlaying() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  },
  async pollNowPlaying() {
    const data = await this.getNowPlaying();
    if (!data || !data.item) return;
    this.currentTrack = {
      name: data.item.name,
      artist: data.item.artists?.map(a => a.name).join(', ') || '',
      art: data.item.album?.images?.[0]?.url || null,
      id: data.item.id,
      uri: data.item.uri,
    };
    this.isPlaying = data.is_playing;
    this.updateNowPlayingUI();
  },

  /* --- UI --- */
  updateUI() {
    const connected = this.isConnected();
    // Settings section
    const statusEl = document.getElementById('sp-connect-status');
    const btnEl = document.getElementById('sp-connect-btn');
    const connectedSection = document.getElementById('sp-connected-section');
    const disconnectedSection = document.getElementById('sp-disconnected-section');

    if (statusEl) statusEl.textContent = connected ? '✓ Connected' : 'Not connected';
    if (connectedSection) connectedSection.style.display = connected ? 'block' : 'none';
    if (disconnectedSection) disconnectedSection.style.display = connected ? 'none' : 'block';

    // Sync Client ID inputs
    const modalInput = document.getElementById('sp-modal-client-id');
    const settingsInput = document.getElementById('sp-client-id-input');
    if (this.clientId) {
      if (modalInput && !modalInput.value) modalInput.value = this.clientId;
      if (settingsInput && !settingsInput.value) settingsInput.value = this.clientId;
    }
    const uriEl = document.getElementById('sp-modal-uri');
    if (uriEl) uriEl.textContent = SPOTIFY_REDIRECT_URI;

    // Profile modal status
    const profText = document.getElementById('profile-sp-text');
    const profSub = document.getElementById('profile-sp-sub');
    if (profText) profText.textContent = connected ? 'Spotify Connected ✓' : 'Spotify not connected';
    if (profSub) profSub.textContent = connected ? (this.selectedPlaylist?.name || 'Tap to choose playlist') : 'Tap to set up & connect';

    // Focus screen Spotify banner: show only when NOT connected
    const banner = document.getElementById('sp-focus-banner');
    if (banner) banner.style.display = connected ? 'none' : 'flex';

    // Focus screen grove bar
    this.updateGrooveBar();

    // If connected, fetch profile + start polling if playing
    if (connected) {
      this.fetchProfile();
      if (this.isPlaying) this.startPollNowPlaying();
    }
  },

  updateGrooveBar() {
    const bar = document.getElementById('groove-bar');
    if (!bar) return;
    if (!this.isConnected()) {
      bar.innerHTML = `
        <div class="groove-l">
          <div class="wave-bars"><div class="wb"></div><div class="wb"></div><div class="wb"></div></div>
          <span>♫ Groove Tunes</span>
        </div>
        <span style="font-size:13px;color:var(--text-2);" id="groove-x">✕</span>`;
      return;
    }
    if (this.currentTrack) {
      bar.innerHTML = `
        <div class="groove-l">
          ${this.currentTrack.art ? `<img src="${this.currentTrack.art}" style="width:32px;height:32px;border-radius:6px;flex-shrink:0;object-fit:cover;">` : '<div class="wave-bars"><div class="wb"></div><div class="wb"></div><div class="wb"></div></div>'}
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${esc(this.currentTrack.name)}</div>
            <div style="font-size:11px;color:var(--text-2);">${esc(this.currentTrack.artist)}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button onclick="Spotify.prev()" style="border:none;background:none;font-size:16px;cursor:pointer;">⏮</button>
          <button onclick="Spotify.isPlaying?Spotify.pause():Spotify.resume()" style="border:none;background:var(--accent);color:#fff;width:32px;height:32px;border-radius:50%;font-size:13px;cursor:pointer;">${this.isPlaying ? '❚❚' : '▶'}</button>
          <button onclick="Spotify.next()" style="border:none;background:none;font-size:16px;cursor:pointer;">⏭</button>
        </div>`;
    } else {
      bar.innerHTML = `
        <div class="groove-l">
          <img src="https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_Green.png" style="height:18px;object-fit:contain;">
          <span style="font-size:13px;font-weight:700;">Choose Playlist</span>
        </div>
        <button onclick="Spotify.openPlaylistPicker()" style="border:none;background:var(--accent);color:#fff;padding:6px 14px;border-radius:var(--r-full);font-size:12.5px;font-weight:700;cursor:pointer;">Browse</button>`;
    }
  },

  updatePlayUI() {
    this.updateGrooveBar();
  },

  updateNowPlayingUI() {
    this.updateGrooveBar();
  },

  /* --- PLAYLIST PICKER MODAL --- */
  async openPlaylistPicker() {
    if (!this.isConnected()) {
      showToast('Connect Spotify first in Settings');
      return;
    }
    openModal('sp-playlist-modal');
    const grid = document.getElementById('sp-playlist-grid');
    grid.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-2);">Loading playlists...</div>`;

    const playlists = await this.fetchPlaylists();
    if (!playlists.length) {
      grid.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-2);">No playlists found.</div>`;
      return;
    }
    grid.innerHTML = playlists.map(pl => `
      <div class="sp-pl-card ${this.selectedPlaylist?.id === pl.id ? 'active' : ''}" onclick="Spotify.pickPlaylist('${pl.id}','${esc(pl.name)}','${pl.uri}','${pl.images?.[0]?.url||''}')">
        ${pl.images?.[0]?.url ? `<img src="${pl.images[0].url}" style="width:100%;aspect-ratio:1;border-radius:10px;object-fit:cover;margin-bottom:8px;">` : `<div style="width:100%;aspect-ratio:1;border-radius:10px;background:#E5E7EB;display:grid;place-items:center;font-size:28px;margin-bottom:8px;">🎵</div>`}
        <div style="font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(pl.name)}</div>
        <div style="font-size:11px;color:var(--text-2);">${pl.tracks?.total||0} tracks</div>
      </div>`).join('');
  },

  pickPlaylist(id, name, uri, imgUrl) {
    this.selectedPlaylist = { id, name, uri, imgUrl };
    this.saveConfig();
    // Update UI selection
    document.querySelectorAll('.sp-pl-card').forEach(c => c.classList.remove('active'));
    event.currentTarget?.classList.add('active');
    showToast(`Selected: ${name}`);
  },

  playSelectedPlaylist() {
    if (!this.selectedPlaylist) { showToast('Pick a playlist first'); return; }
    this.playPlaylist(this.selectedPlaylist);
    closeModal('sp-playlist-modal');
  },

  /* --- REMINDER TRACK PICKER --- */
  async openReminderPicker() {
    if (!this.isConnected() || !this.selectedPlaylist) {
      showToast('Select a playlist first');
      return;
    }
    openModal('sp-reminder-modal');
    const feed = document.getElementById('sp-reminder-feed');
    feed.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-2);">Loading tracks...</div>`;
    const tracks = await this.fetchPlaylistTracks(this.selectedPlaylist.id);
    if (!tracks.length) { feed.innerHTML = 'No tracks found'; return; }
    feed.innerHTML = tracks.slice(0, 20).map(t => `
      <div class="sp-track-row ${this.reminderTrack?.id === t.id ? 'active' : ''}" onclick="Spotify.setReminderTrack('${t.id}','${esc(t.name)}','${esc(t.artists?.[0]?.name||'')}','${t.uri}','${t.album?.images?.[0]?.url||''}')">
        ${t.album?.images?.[0]?.url ? `<img src="${t.album.images[0].url}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0;">` : `<div style="width:40px;height:40px;border-radius:6px;background:#E5E7EB;display:grid;place-items:center;font-size:18px;flex-shrink:0;">🎵</div>`}
        <div style="flex:1;min-width:0;">
          <div style="font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.name)}</div>
          <div style="font-size:11.5px;color:var(--text-2);">${esc(t.artists?.map(a=>a.name).join(', ')||'')}</div>
        </div>
        <button onclick="event.stopPropagation();Spotify.previewTrack('${t.uri}')" style="background:var(--accent-light);border:none;border-radius:50%;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;font-size:12px;color:var(--accent);">▶</button>
      </div>`).join('');
  },

  setReminderTrack(id, name, artist, uri, art) {
    this.reminderTrack = { id, name, artist, uri, art };
    this.saveConfig();
    document.querySelectorAll('.sp-track-row').forEach(r => r.classList.remove('active'));
    event.currentTarget?.classList.add('active');
    const el = document.getElementById('set-reminder-track-name');
    if (el) el.textContent = name + ' — ' + artist;
    showToast(`Reminder tone: ${name}`);
  },

  async previewTrack(uri) {
    await this.playTrackOnce({ uri });
    showToast('Playing on Spotify app...');
  },

  async playReminderTone() {
    if (!this.reminderTrack || !this.isConnected()) return;
    await this.playTrackOnce(this.reminderTrack);
    showToast(`♫ ${this.reminderTrack.name}`);
  },
};

// Make globally accessible
window.Spotify = Spotify;
