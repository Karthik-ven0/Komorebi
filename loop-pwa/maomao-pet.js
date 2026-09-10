/**
 * Maomao Pet — Mobile Touch & Desktop Interactive Companion
 * Spritesheet: 1536×2288px, 8 cols × 11 rows (192×208px per frame)
 * 
 * Codex v2 Spec:
 *   - Rows 0–8: Standard states (0:Idle, 1:Walk-R, 2:Grabbed/Walk-L, 3:Wave, 4:Jump, 5:Failed, 6:Waiting, 7:Run, 8:Review)
 *   - Rows 9–10: 16 clockwise look directions (22.5° intervals, 000° = Up/12 o'clock, Row 9 col 0 = Image 1)
 * 
 * Mobile Touch Workarounds:
 *   - "Corner Companion": Cozily stays in your chosen corner, smoothly turns head/face to look at every screen tap/touch
 *   - "Touch to Drag": Touch & hold Maomao with your finger to pick her up and place her anywhere on screen
 *   - "Follow Touch": Gently moves towards your touch points on mobile with mobile-proportional distance (~90px)
 *   - Ambient Life: Does not stay frozen when no fingers are touching—looks around, rests in Waiting pose (Image 2)
 *   - Full Pet Settings in app settings (Enable/Disable, Mobile Mode, Dragging, Size, Reset Position)
 */

(function () {
  'use strict';

  const SPRITE_COLS = 8;
  const SPRITE_ROWS = 11;
  const IMG_W       = 1536;
  const IMG_H       = 2288;
  const FRAME_W     = IMG_W / SPRITE_COLS; // 192px
  const FRAME_H     = IMG_H / SPRITE_ROWS; // ~208px

  // Scale presets
  const SIZES = {
    compact : 66,
    normal  : 82,
    large   : 98,
  };

  // Codex v2 Row mappings
  const ROWS = {
    IDLE    : 0,
    WALK_R  : 1, // Walk/Run right
    GRABBED : 2, // Grabbed / Airborne (when dragging with finger)
    WAVE    : 3, // Wave / Hello
    JUMP    : 4, // Jump / Joy
    FAILED  : 5, // Failed
    WAITING : 6, // Waiting state (matches Image 2 reference)
    RUN     : 7, // Running fast
    REVIEW  : 8, // Reading herbs/scroll
    LOOK_R  : 9, // 16 Clockwise directions 000° to 157.5° (col 0 = Up, Image 1)
    LOOK_L  : 10 // 16 Clockwise directions 180° to 337.5° (col 0 = Down)
  };

  const BUBBLES = {
    idle     : ["Hi! How are you? 🌸","Focus time! 🌿","Need anything? 🌸","Herbs ready~ ✨","What's next? 🎯","Stay focused! 💪","Drink some water! 🍵","Ready to focus! 🌿"],
    scribble : ["Woah! 🌀","So fast! ⚡","What are you drawing? 📝","Dizzy dizzy~ 💫"],
    greet    : ["Hi! How are you? 🌸","Hello there! 👋","Nice to meet you! 🌸","Maomao here! 🌿","How are you doing today? 🍵"],
    drag     : ["Wheee! 🎈","Up we go! ✨","Moving around~ 🐾"],
    tap      : ["Hi! How are you? 🌸","Looking right here! 👀","Noticed! ✨","I see you! 🌸"],
  };

  class MaomaoPet {
    constructor() {
      this.canvas = null;
      this.ctx    = null;
      this.img    = new Image();

      // Load settings from localStorage / DB
      this.settings = this._loadSettings();

      // Device detection
      this.isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.innerWidth < 640;

      // Base dimensions
      this.dispW = SIZES[this.settings.size] || SIZES.normal;
      this.dispH = Math.round(this.dispW * FRAME_H / FRAME_W);

      // Distance parameters (dynamically scaled for mobile vs desktop)
      this._updateDistances();

      // Saved pinned position or default bottom-right (above dock)
      const savedPos = this._loadPinnedPos();
      this.x = savedPos ? savedPos.x : Math.max(20, window.innerWidth - this.dispW - 24);
      this.y = savedPos ? savedPos.y : Math.max(20, window.innerHeight - this.dispH - 95);
      this.pinnedX = this.x;
      this.pinnedY = this.y;

      // Touch / Cursor tracking
      this.cursorX = this.x - this.comfortDist;
      this.cursorY = this.y;
      this.lastInputTime = Date.now();
      this.hasInputMoved = false;

      // Target position for walking
      this.targetX = this.x;
      this.targetY = this.y;

      // Motion
      this.isMoving = false;
      this.speed = this.isTouch ? 3.2 : 3.8;
      this.facingRight = false;

      // Touch Dragging State
      this.isDragging = false;
      this.dragStartX = 0;
      this.dragStartY = 0;
      this.dragOffsetX = 0;
      this.dragOffsetY = 0;
      this.dragDistance = 0;

      // Animation & state
      this.row = ROWS.WAITING; // default initial pose (Image 2)
      this.frame = 0;
      this.frameDelay = 8;
      this.animTick = 0;

      // Codex v2 look direction state
      this.isLooking = false;
      this.lookRow = ROWS.LOOK_R;
      this.lookCol = 0; // 000° Up (Image 1)

      // Attention reaction timer
      this.reactTimer = 0;
      this.reactTargetX = 0;
      this.reactTargetY = 0;

      // Ambient wander & glance timer for mobile
      this.ambientTimer = 0;
      this.ambientGlance = null;

      // Scribble detection
      this.mouseHistory = [];
      this.isScribbling = false;
      this.scribbleTimer = 0;
      this.lastScribbleBubble = 0;

      // DOM elements
      this.badgeEl  = null; // "Waiting" status badge (Image 2)
      this.bubbleEl = null; // Speech bubble

      this._init();
    }

    _loadSettings() {
      try {
        const raw = localStorage.getItem('loop_db_pet_settings');
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return {
        enabled    : true,
        mobileMode : 'corner', // 'corner' | 'follow' | 'wander'
        draggable  : true,
        size       : 'normal',
      };
    }

    _loadPinnedPos() {
      try {
        const raw = localStorage.getItem('loop_db_pet_pinned_pos');
        if (raw) {
          const p = JSON.parse(raw);
          // verify still in screen
          if (p.x < window.innerWidth && p.y < window.innerHeight) return p;
        }
      } catch (e) {}
      return null;
    }

    _updateDistances() {
      this.isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.innerWidth < 640;
      if (this.isTouch) {
        // Mobile screen is narrow (360-430px), comfort distance is compact
        this.comfortDist = 95;  // ~1 inch on mobile
        this.minDist     = 65;
        this.maxDist     = 180;
      } else {
        // Desktop screen has room, "at least a few inches apart"
        this.comfortDist = 230; // ~2.4 inches
        this.minDist     = 160;
        this.maxDist     = 300;
      }
    }

    _init() {
      // 1. Create Canvas
      this.canvas = document.createElement('canvas');
      this.canvas.width  = this.dispW;
      this.canvas.height = this.dispH;
      Object.assign(this.canvas.style, {
        position      : 'fixed',
        left          : Math.round(this.x) + 'px',
        top           : Math.round(this.y) + 'px',
        width         : this.dispW + 'px',
        height        : this.dispH + 'px',
        zIndex        : '190',
        pointerEvents : 'auto', // Allows touch dragging on the pet itself
        touchAction   : 'none', // Prevents page scrolling when touching Maomao
        imageRendering: 'pixelated',
        filter        : 'drop-shadow(0 4px 10px rgba(0,0,0,0.22))',
        userSelect    : 'none',
        cursor        : 'grab',
        display       : this.settings.enabled !== false ? 'block' : 'none',
      });
      document.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      // 2. Create "Waiting" status badge (matching Image 2)
      this.badgeEl = document.createElement('div');
      Object.assign(this.badgeEl.style, {
        position      : 'fixed',
        background    : 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(8px)',
        border        : '1px solid rgba(0,0,0,0.08)',
        borderRadius  : '8px',
        padding       : '3px 9px',
        fontSize      : '11px',
        fontFamily    : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontWeight    : '600',
        color         : '#4B5563',
        boxShadow     : '0 2px 8px rgba(0,0,0,0.06)',
        zIndex        : '191',
        pointerEvents : 'none',
        whiteSpace    : 'nowrap',
        letterSpacing : '0.02em',
        transition    : 'opacity 0.25s ease, transform 0.25s ease',
        opacity       : '1',
        display       : this.settings.enabled !== false ? 'block' : 'none',
      });
      this.badgeEl.textContent = 'Waiting';
      document.body.appendChild(this.badgeEl);

      // 3. Create Speech Bubble
      this.bubbleEl = document.createElement('div');
      Object.assign(this.bubbleEl.style, {
        position     : 'fixed',
        background   : '#ffffff',
        borderRadius : '12px 12px 4px 12px',
        padding      : '6px 12px',
        fontSize     : '12px',
        fontFamily   : 'Plus Jakarta Sans, sans-serif',
        fontWeight   : '700',
        boxShadow    : '0 4px 14px rgba(0,0,0,0.18)',
        whiteSpace   : 'nowrap',
        zIndex       : '192',
        opacity      : '0',
        transform    : 'scale(0.85) translateY(4px)',
        transition   : 'opacity 0.25s ease, transform 0.25s ease',
        pointerEvents: 'none',
        color        : '#11141D',
      });
      document.body.appendChild(this.bubbleEl);

      // 4. Load Sprite
      const startLoop = () => {
        if (!this._loopStarted) {
          this._loopStarted = true;
          this._clampPosition();
          this._updateOverlayPositions();
          this._loop();
        }
      };
      this.img.onload = startLoop;
      this.img.onerror = () => console.error('Failed to load maomao.webp');
      this.img.src = 'maomao.webp';
      if (this.img.complete && this.img.naturalWidth > 0) {
        startLoop();
      }

      // 5. Attach Unified Pointer & Touch Listeners
      this._attachInputListeners();

      // 6. Handle Window Resizes
      window.addEventListener('resize', () => {
        this._updateDistances();
        this._clampPosition();
        this._updateOverlayPositions();
      });

      // 7. Periodic dialog bubbles
      setInterval(() => {
        if (!this.isMoving && !this.isDragging && Math.random() < 0.35) {
          this._showBubble('idle');
        }
      }, 45000);

      // Initial friendly greeting shortly after loading
      setTimeout(() => {
        if (!this.isDragging) {
          this._showBubble('greet');
        }
      }, 1600);
    }

    _attachInputListeners() {
      // Touch/Pointer down directly on Maomao (Drag to Reposition on Mobile)
      this.canvas.addEventListener('pointerdown', (e) => {
        if (this.settings.draggable !== false) {
          this.isDragging = true;
          this.dragStartX = e.clientX;
          this.dragStartY = e.clientY;
          this.dragOffsetX = e.clientX - this.x;
          this.dragOffsetY = e.clientY - this.y;
          this.dragDistance = 0;
          this.row = ROWS.GRABBED; // cute held/airborne pose
          this.frame = 0;
          this.isLooking = false;
          this.canvas.style.cursor = 'grabbing';
          this._updateBadge('Carried 🐾');
          try { this.canvas.setPointerCapture(e.pointerId); } catch(err) {}
          e.preventDefault();
        }
      });

      // Pointer move on Maomao while dragging
      window.addEventListener('pointermove', (e) => {
        if (this.isDragging) {
          this.dragDistance += Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY);
          this.x = e.clientX - this.dragOffsetX;
          this.y = e.clientY - this.dragOffsetY;
          this._clampPosition();
          this.canvas.style.left = Math.round(this.x) + 'px';
          this.canvas.style.top  = Math.round(this.y) + 'px';
          this._updateOverlayPositions();
          return;
        }

        // Standard desktop cursor tracking
        if (!this.isTouch || e.pointerType === 'mouse') {
          this._handlePointerMove(e.clientX, e.clientY);
        }
      }, { passive: true });

      // Pointer up (Release drag or Tap)
      window.addEventListener('pointerup', (e) => {
        if (this.isDragging) {
          this.isDragging = false;
          this.canvas.style.cursor = 'grab';

          if (this.dragDistance < 10) {
            // Short tap on Maomao -> Wave & talk!
            this._onPetClicked();
          } else {
            // Dropped onto surface -> Save pinned position & land
            this.pinnedX = this.x;
            this.pinnedY = this.y;
            try {
              localStorage.setItem('loop_db_pet_pinned_pos', JSON.stringify({ x: this.x, y: this.y }));
            } catch(err) {}

            this.row = ROWS.JUMP; // Little landing hop
            this.frame = 0;
            setTimeout(() => {
              this.row = ROWS.WAITING;
              this._updateBadge('Waiting');
            }, 500);
          }
        }
      });

      // Global touch/click anywhere on screen (Outside Maomao)
      window.addEventListener('pointerdown', (e) => {
        if (this.isDragging) return;

        const petCenterX = this.x + this.dispW / 2;
        const petCenterY = this.y + this.dispH / 2;
        const dist = Math.hypot(e.clientX - petCenterX, e.clientY - petCenterY);

        if (dist < this.dispW * 0.7) {
          // Handled by canvas pointerdown
          return;
        }

        // Tap on screen -> Face turns immediately to look at the tap location!
        this._handleScreenTap(e.clientX, e.clientY);
      }, { passive: true });

      // Mobile Touch Move (Swiping/gestures on screen)
      window.addEventListener('touchmove', (e) => {
        if (this.isDragging) return;
        if (e.touches[0]) {
          this._handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: true });
    }

    _handlePointerMove(x, y) {
      this.hasInputMoved = true;
      this.lastInputTime = Date.now();
      const prevX = this.cursorX;
      this.cursorX = x;
      this.cursorY = y;

      // Scribble / rapid shake detection
      const now = performance.now();
      this.mouseHistory.push({ x, y, time: now });
      this.mouseHistory = this.mouseHistory.filter(pt => now - pt.time < 280);

      if (this.mouseHistory.length >= 4) {
        let reversals = 0;
        let prevDx = 0;
        let totalTravel = 0;

        for (let i = 1; i < this.mouseHistory.length; i++) {
          const dx = this.mouseHistory[i].x - this.mouseHistory[i - 1].x;
          const dy = this.mouseHistory[i].y - this.mouseHistory[i - 1].y;
          totalTravel += Math.abs(dx) + Math.abs(dy);
          if (prevDx !== 0 && dx !== 0 && (dx > 0 !== prevDx > 0)) {
            reversals++;
          }
          if (dx !== 0) prevDx = dx;
        }

        if (reversals >= 2 && totalTravel > 65) {
          this.isScribbling = true;
          this.scribbleTimer = 25;
          this.reactTimer = 35;
          this.reactTargetX = x;
          this.reactTargetY = y;

          const tNow = Date.now();
          if (tNow - this.lastScribbleBubble > 8000) {
            this.lastScribbleBubble = tNow;
            this._showBubble('scribble');
          }
        }
      }
    }

    _handleScreenTap(clickX, clickY) {
      this.hasInputMoved = true;
      this.lastInputTime = Date.now();
      this.reactTimer   = 45; // Hold look target for ~750ms
      this.reactTargetX = clickX;
      this.reactTargetY = clickY;

      // On mobile follow mode, also update destination
      if (this.isTouch && this.settings.mobileMode === 'follow') {
        this.cursorX = clickX;
        this.cursorY = clickY;
      }
    }

    _onPetClicked() {
      this.row = ROWS.WAVE;
      this.frame = 0;
      this.isLooking = false;
      this._showBubble('greet');
      this._updateBadge('Hi! 🌸');

      setTimeout(() => {
        if (!this.isDragging) {
          this.row = ROWS.WAITING;
          this._updateBadge('Waiting');
        }
      }, 2200);
    }

    /**
     * Compute Codex v2 16 clockwise look direction (Rows 9 & 10)
     * 000° is Up (12 o'clock, Row 9 col 0 - matching Image 1)
     */
    _getLookDirection(fromX, fromY, toX, toY) {
      const dx = toX - fromX;
      const dy = toY - fromY;

      let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      if (angleDeg < 0) angleDeg += 360;

      const dirIndex = Math.round(angleDeg / 22.5) % 16;
      if (dirIndex < 8) {
        return { row: ROWS.LOOK_R, col: dirIndex };
      } else {
        return { row: ROWS.LOOK_L, col: dirIndex - 8 };
      }
    }

    _clampPosition() {
      const margin = 16;
      const maxBottom = window.innerHeight - this.dispH - 78;
      this.x = Math.max(margin, Math.min(window.innerWidth - this.dispW - margin, this.x));
      this.y = Math.max(margin, Math.min(maxBottom, this.y));
    }

    _updateOverlayPositions() {
      if (this.badgeEl) {
        const badgeX = Math.round(this.x + this.dispW / 2 - 32);
        const badgeY = Math.round(this.y + this.dispH + 3);
        this.badgeEl.style.left = Math.max(8, Math.min(window.innerWidth - 80, badgeX)) + 'px';
        this.badgeEl.style.top  = Math.min(window.innerHeight - 30, badgeY) + 'px';
      }
      if (this.bubbleEl) {
        const bX = Math.max(10, Math.min(window.innerWidth - 170, this.x + this.dispW / 2 - 20));
        const bY = Math.max(10, this.y - 42);
        this.bubbleEl.style.left = Math.round(bX) + 'px';
        this.bubbleEl.style.top  = Math.round(bY) + 'px';
      }
    }

    _update() {
      if (this.isDragging) return; // Managed by drag listener
      this.animTick++;

      const petCenterX = this.x + this.dispW / 2;
      const petCenterY = this.y + this.dispH / 2;

      // Check Mobile Mode
      const isMobileCornerMode = this.isTouch && (this.settings.mobileMode === 'corner');
      const isMobileWanderMode = this.isTouch && (this.settings.mobileMode === 'wander');

      if (isMobileCornerMode) {
        // --- MOBILE CORNER COMPANION WORKAROUND ---
        // Stays cozy in pinned corner. Face smoothly turns to look at any tap/touch!
        this.isMoving = false;

        if (this.reactTimer > 0) {
          this.reactTimer--;
          const look = this._getLookDirection(petCenterX, petCenterY, this.reactTargetX, this.reactTargetY);
          this.row = look.row;
          this.frame = look.col;
          this.isLooking = true;
          this._updateBadge(this.isScribbling ? 'Watching 🌀' : 'Noticed 👀');
        } else {
          // Ambient living behavior when screen is idle
          this._handleAmbientGlance();
        }

      } else if (isMobileWanderMode) {
        // --- MOBILE WANDER MODE ---
        this._handleWanderMode(petCenterX, petCenterY);

      } else {
        // --- DESKTOP OR MOBILE FOLLOW MODE ---
        const dxToCursor = petCenterX - this.cursorX;
        const dyToCursor = petCenterY - this.cursorY;
        const distToCursor = Math.hypot(dxToCursor, dyToCursor) || 1;

        let offsetX = (dxToCursor / distToCursor) * this.comfortDist;
        let offsetY = (dyToCursor / distToCursor) * this.comfortDist;
        if (Math.abs(offsetY) < 30) offsetY = 40;

        let targetX = this.cursorX + offsetX - this.dispW / 2;
        let targetY = this.cursorY + offsetY - this.dispH / 2;

        const margin = 16;
        const maxBottom = window.innerHeight - this.dispH - 78;
        targetX = Math.max(margin, Math.min(window.innerWidth - this.dispW - margin, targetX));
        targetY = Math.max(margin, Math.min(maxBottom, targetY));

        this.targetX = targetX;
        this.targetY = targetY;

        const moveDx = this.targetX - this.x;
        const moveDy = this.targetY - this.y;
        const distToTarget = Math.hypot(moveDx, moveDy);

        const needsWalking = this.hasInputMoved && (distToCursor > this.maxDist || distToCursor < this.minDist);

        if (needsWalking && distToTarget > 20) {
          this.isMoving = true;
          const spd = Math.min(this.speed, Math.max(2.0, distToTarget * 0.08));
          this.x += (moveDx / distToTarget) * spd;
          this.y += (moveDy / distToTarget) * spd;

          this.facingRight = moveDx > 0;
          this.row = this.facingRight ? ROWS.WALK_R : ROWS.WALK_L;
          this.isLooking = false;
          this.frameDelay = 6;
          this._updateBadge('Walking 🌿');
        } else {
          this.isMoving = false;
          const timeSinceInput = Date.now() - this.lastInputTime;

          if (this.reactTimer > 0) {
            this.reactTimer--;
            const look = this._getLookDirection(petCenterX, petCenterY, this.reactTargetX, this.reactTargetY);
            this.row = look.row;
            this.frame = look.col;
            this.isLooking = true;
            this._updateBadge(this.isScribbling ? 'Watching 🌀' : 'Noticed 👀');
          } else if (timeSinceInput < 2400 && this.hasInputMoved) {
            // Track cursor/touch with 16 look directions (Row 9 col 0 = Image 1 when looking up)
            const look = this._getLookDirection(petCenterX, petCenterY, this.cursorX, this.cursorY);
            this.row = look.row;
            this.frame = look.col;
            this.isLooking = true;
            this._updateBadge('Looking ✨');
          } else {
            this.row = ROWS.WAITING; // Waiting pose (Image 2)
            this.isLooking = false;
            this.frameDelay = 12;
            this._updateBadge('Waiting');
          }
        }
      }

      // Scribble decay
      if (this.scribbleTimer > 0) {
        this.scribbleTimer--;
        if (this.scribbleTimer === 0) this.isScribbling = false;
      }

      this._clampPosition();

      // Advance frames for multi-frame animations (walk, waiting, wave)
      if (!this.isLooking && this.animTick % this.frameDelay === 0) {
        this.frame = (this.frame + 1) % 8;
      }

      this.canvas.style.left = Math.round(this.x) + 'px';
      this.canvas.style.top  = Math.round(this.y) + 'px';
      this._updateOverlayPositions();
    }

    /**
     * Ambient Glance for Mobile when idle:
     * Cycles through natural look directions (looking up at timer, looking left at tasks, Waiting pose)
     */
    _handleAmbientGlance() {
      this.ambientTimer++;
      if (this.ambientTimer > 180) { // Every ~3-4 seconds
        this.ambientTimer = 0;
        const roll = Math.random();
        if (roll < 0.35) {
          // Look UP at timer (000° Up, Row 9 col 0 - Image 1!)
          this.ambientGlance = { row: ROWS.LOOK_R, col: 0 };
        } else if (roll < 0.65) {
          // Look left / upper-left towards tasks (Row 10 col 6)
          this.ambientGlance = { row: ROWS.LOOK_L, col: 6 };
        } else {
          // Waiting pose (Row 6 - Image 2)
          this.ambientGlance = null;
        }
      }

      if (this.ambientGlance) {
        this.row = this.ambientGlance.row;
        this.frame = this.ambientGlance.col;
        this.isLooking = true;
        this._updateBadge('Observing 🌿');
      } else {
        this.row = ROWS.WAITING;
        this.isLooking = false;
        this.frameDelay = 12;
        this._updateBadge('Waiting');
      }
    }

    _handleWanderMode(petCenterX, petCenterY) {
      if (this.reactTimer > 0) {
        this.reactTimer--;
        const look = this._getLookDirection(petCenterX, petCenterY, this.reactTargetX, this.reactTargetY);
        this.row = look.row;
        this.frame = look.col;
        this.isLooking = true;
        this._updateBadge('Noticed 👀');
        return;
      }

      this.ambientTimer++;
      if (this.ambientTimer > 300) { // Every ~5 seconds pick new destination
        this.ambientTimer = 0;
        const margin = 20;
        const maxBottom = window.innerHeight - this.dispH - 85;
        this.targetX = margin + Math.random() * (window.innerWidth - this.dispW - margin * 2);
        this.targetY = maxBottom - Math.random() * 80;
      }

      const moveDx = this.targetX - this.x;
      const moveDy = this.targetY - this.y;
      const dist = Math.hypot(moveDx, moveDy);

      if (dist > 15) {
        this.isMoving = true;
        this.x += (moveDx / dist) * 1.8;
        this.y += (moveDy / dist) * 1.8;
        this.facingRight = moveDx > 0;
        this.row = this.facingRight ? ROWS.WALK_R : ROWS.WALK_L;
        this.isLooking = false;
        this.frameDelay = 7;
        this._updateBadge('Strolling 🌿');
      } else {
        this.isMoving = false;
        this.row = ROWS.WAITING;
        this.isLooking = false;
        this._updateBadge('Waiting');
      }
    }

    _draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.dispW, this.dispH);

      const sx = this.frame * FRAME_W;
      const sy = this.row   * FRAME_H;

      ctx.save();
      ctx.drawImage(this.img, sx, sy, FRAME_W, FRAME_H, 0, 0, this.dispW, this.dispH);
      ctx.restore();
    }

    _loop() {
      this._update();
      this._draw();
      requestAnimationFrame(() => this._loop());
    }

    _updateBadge(text) {
      if (!this.badgeEl) return;
      this.badgeEl.textContent = text;
      if (text === 'Waiting') {
        this.badgeEl.style.color = '#4B5563';
        this.badgeEl.style.borderColor = 'rgba(0,0,0,0.08)';
      } else {
        this.badgeEl.style.color = '#10B981';
        this.badgeEl.style.borderColor = 'rgba(16,185,129,0.25)';
      }
    }

    _showBubble(type) {
      const msgs = BUBBLES[type] || BUBBLES.idle;
      const msg  = msgs[Math.floor(Math.random() * msgs.length)];
      this.bubbleEl.textContent = msg;
      this.bubbleEl.style.opacity = '1';
      this.bubbleEl.style.transform = 'scale(1) translateY(0)';
      clearTimeout(this._bubbleTimeout);
      this._bubbleTimeout = setTimeout(() => {
        this.bubbleEl.style.opacity = '0';
        this.bubbleEl.style.transform = 'scale(0.85) translateY(4px)';
      }, 3000);
    }

    /* Public API for App Settings */
    applySettings(s) {
      this.settings = Object.assign(this.settings, s);
      const isEnabled = this.settings.enabled !== false;
      this.canvas.style.display = isEnabled ? 'block' : 'none';
      if (this.badgeEl) this.badgeEl.style.display = isEnabled ? 'block' : 'none';

      // Update scale
      const targetSize = SIZES[this.settings.size] || SIZES.normal;
      if (targetSize !== this.dispW) {
        this.dispW = targetSize;
        this.dispH = Math.round(this.dispW * FRAME_H / FRAME_W);
        this.canvas.width = this.dispW;
        this.canvas.height = this.dispH;
        this.canvas.style.width = this.dispW + 'px';
        this.canvas.style.height = this.dispH + 'px';
      }

      this._updateDistances();
      this._clampPosition();
      this._updateOverlayPositions();
    }

    resetToCorner() {
      this.x = Math.max(20, window.innerWidth - this.dispW - 30);
      this.y = Math.max(20, window.innerHeight - this.dispH - 85);
      this.pinnedX = this.x;
      this.pinnedY = this.y;
      try {
        localStorage.setItem('loop_db_pet_pinned_pos', JSON.stringify({ x: this.x, y: this.y }));
      } catch(e) {}
      this._clampPosition();
      this.canvas.style.left = Math.round(this.x) + 'px';
      this.canvas.style.top  = Math.round(this.y) + 'px';
      this._updateOverlayPositions();
      this.row = ROWS.WAITING;
      this._updateBadge('Waiting');
    }
  }

  function boot() {
    setTimeout(() => {
      window._maomao = new MaomaoPet();
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
