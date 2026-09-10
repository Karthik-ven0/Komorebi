LOOP — PWA PACKAGE
===================

What's in this folder:
  index.html              the app
  manifest.json           tells the phone this is installable, with name/icon/colors
  service-worker.js        caches the app so it works offline after first load
  icons/                  app icons (192, 512, maskable, favicon)

This folder needs to be hosted over HTTPS for installing and offline
mode to actually work — opening index.html directly from your files
will run the app fine, but skips the "install as app" part.


STEP 1 — Host it (pick one, both are free, no coding)
-------------------------------------------------------
Option A — Netlify Drop (fastest, good for testing)
  1. Go to https://app.netlify.com/drop
  2. Drag this whole "loop-pwa" folder onto the page
  3. You'll get a live https:// URL in seconds

Option B — GitHub Pages (better if you want a stable, permanent link)
  1. Create a new GitHub repo
  2. Upload everything in this folder, keeping the icons/ folder as-is
  3. Repo Settings → Pages → Deploy from branch → main → / (root) → Save
  4. Your URL will be something like https://yourname.github.io/repo-name/


STEP 2 — Install it on your phone
-------------------------------------------------------
Open your hosted URL in Chrome on Android → tap the menu (⋮) →
"Install app" (or "Add to Home Screen"). You'll get a real app icon
that opens full-screen, no browser bar.

iPhone: open the URL in Safari → Share → "Add to Home Screen."
(iOS ignores most of the manifest, but the icon and full-screen
behavior still work.)


STEP 3 — Get an actual installable .apk (optional)
-------------------------------------------------------
  1. Go to https://www.pwabuilder.com
  2. Paste your hosted HTTPS URL
  3. Let it scan — it should pick up the manifest, service worker,
     and icons automatically
  4. Choose "Android" → download the package (APK or AAB)
  5. Transfer the APK to your phone and install it (you'll need to
     allow "install from unknown sources" if sideloading, since it
     isn't from the Play Store)


NOTES
-------------------------------------------------------
- All data (tasks, settings) is stored on-device via localStorage —
  nothing is sent to a server.
- If you edit index.html later, bump CACHE_NAME in service-worker.js
  (e.g. 'loop-v2') so phones pick up the new version instead of a
  cached copy.
