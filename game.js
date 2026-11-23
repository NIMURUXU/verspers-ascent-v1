// --- CONFIGURACIÓN Y ESTADO GLOBAL ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.imageSmoothingEnabled = false;

const imgPlataforma = new Image();
imgPlataforma.onload = () => console.log("Sprite de plataforma cargado:", imgPlataforma.src);
imgPlataforma.onerror = () => console.error("Error cargando sprite de plataforma:", imgPlataforma.src);
imgPlataforma.src = 'sprites/plataformapequeña.png';

const state = {
    room: 0,
    targetRoom: 1,
    essence: 0,
    secrets: 0,
    isPlaying: false,
    isPaused: false,
    mana: 100,
    maxMana: 100,
    manaRegen: 5,
    upgrades: { hp: 5, dmg: 1, dashLevel: 1, speed: 1, doubleJump: false, maxManaLevel: 1, spellLevel: 1, bowLevel: 1 },
    costs: { hp: 50, dmg: 50, dash: 100, speed: 40, doubleJump: 125, mana: 45, spell: 60, bow: 55 },
    doubleJumpActive: false
};

const keys = {};
const justPressed = {};
let camera = { x: 0, y: 0, shakeTime: 0, shakeDuration: 0, shakeMagnitude: 0 };
let lastTime = 0, hitstop = 0;
let transition = { active: false, alpha: 0, speed: 3.0, phase: 'none', callback: null };

function startRoomTransition(onMiddleCallback) {
    if (transition.active) return;
    transition.active = true;
    transition.alpha = 0;
    transition.phase = 'out';
    transition.callback = onMiddleCallback;
}

// Controles: Flechas para moverse/apuntar, Z saltar, X atacar, C dash, E interactuar
const CONTROLS = {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    jump: ['KeyZ'],
    attack: ['KeyX'],
    dash: ['KeyC'],
    interact: ['KeyE'],
    spell: ['KeyA'],
    bow: ['KeyS']
};

function isActionHeld(action) {
    return CONTROLS[action].some(code => Boolean(keys[code]));
}

function isActionJustPressed(action) {
    return CONTROLS[action].some(code => Boolean(justPressed[code]));
}

function clearJustPressed() {
    for (const code in justPressed) {
        justPressed[code] = false;
    }
}

// Cámara estática centrada en la sala de 1400px de ancho (y centrada entre techo -260 y suelo 600)
function getStaticCamera() {
    const roomCenterX = 700;
    const roomCenterY = 180;
    return {
        x: Math.round(roomCenterX - canvas.width / 2),
        y: Math.round(roomCenterY - canvas.height / 2)
    };
}

// Referencias a UI
const ui = {
    hpBar: document.getElementById('hp-bar'),
    essence: document.getElementById('essence-display'),
    room: document.getElementById('room-display'),
    hud: document.getElementById('hud'),
    bossContainer: document.getElementById('boss-hp-container'),
    bossHp: document.getElementById('boss-hp-bar'),
    bossName: document.getElementById('boss-name'),
    secretDisplay: document.getElementById('secret-display'),
    manaBar: document.getElementById('mana-bar'),
    manaText: document.getElementById('mana-display')
};

// --- AUDIO PROCEDURAL (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    switch (type) {
        case 'jump':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
            break;
        case 'dash':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);
            break;
        case 'hit':
            osc.type = 'square';
            osc.frequency.setValueAtTime(100, now);
            osc.frequency.exponentialRampToValueAtTime(20, now + 0.1);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
            break;
        case 'shoot':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
            break;
        case 'coin':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.setValueAtTime(1200, now + 0.05);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now); osc.stop(now + 0.3);
            break;
    }
}

// --- UTILIDADES ---
const rectIntersect = (r1, r2) => !(r2.left >= r1.right || r2.right <= r1.left || r2.top >= r1.bottom || r2.bottom <= r1.top);
function screenShake(mag, time) {
    camera.shakeMagnitude = mag;
    camera.shakeTime = time;
    camera.shakeDuration = time;
}
function doHitstop(time) { hitstop = time; }

// --- ENTIDADES Y SISTEMAS ---
let player, platforms = [], enemies = [], projectiles = [], particles = [], interactables = [];

class Particle {
    constructor(x, y, vx, vy, life, color, size) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.life = life; this.maxLife = life; this.color = color; this.size = size;
    }
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
    }
    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.globalAlpha = 1;
    }
}

function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        let ang = Math.random() * Math.PI * 2;
        let speed = Math.random() * 200 + 50;
        particles.push(new Particle(x, y, Math.cos(ang) * speed, Math.sin(ang) * speed, 0.3 + Math.random() * 0.3, color, 4));
    }
}

class Platform {
    constructor(x, y, w, h, type = 'solid') {
        this.x = x; this.y = y; this.w = w; this.h = h; this.type = type;
    }

    draw(ctx, biomeColors) {
        if (this.type === 'hazard') {
            ctx.fillStyle = '#cc0000';
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.fillStyle = '#ff4444';
            ctx.fillRect(this.x, this.y, this.w, 4);
        } else if (this.type === 'boundary') {
            ctx.fillStyle = biomeColors ? biomeColors.plat : '#333';
            ctx.fillRect(this.x, this.y, this.w, this.h);
        } else {
            if (typeof imgPlataforma !== 'undefined' && imgPlataforma.complete && imgPlataforma.naturalWidth !== 0) {
                ctx.drawImage(imgPlataforma, this.x, this.y, this.w, this.h);
            } else {
                ctx.fillStyle = biomeColors ? biomeColors.plat : '#333';
                ctx.fillRect(this.x, this.y, this.w, this.h);
            }
        }
    }
}

class Projectile {
    constructor(x, y, vx, vy, isEnemy, color, size, lifetime = 3, opts = {}) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.isEnemy = isEnemy; this.color = color; this.size = size; this.life = lifetime;
        this.dmg = opts.dmg || 1;
        this.gravity = opts.gravity || 0;
        this.pierce = Boolean(opts.pierce);
        this.hitIds = new Set();
        this.shape = opts.shape || 'circle';
        this.width = opts.width || size * 2;
        this.height = opts.height || size * 2;
    }
    update(dt) {
        if (this.gravity) {
            this.vy += this.gravity * dt;
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        particles.push(new Particle(this.x, this.y, -this.vx * 0.1, -this.vy * 0.1, 0.2, this.color, this.size / 2));
    }
    draw(ctx) {
        ctx.fillStyle = this.color;
        if (this.shape === 'rect') {
            ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

class Player {
    constructor(x, y) {
        this.x = x; this.y = y; this.w = 20; this.h = 40;
        this.vx = 0; this.vy = 0;
        this.hp = state.upgrades.hp;
        this.maxHp = state.upgrades.hp;

        // Físicas ágiles
        this.speed = 390 * state.upgrades.speed;
        this.jumpForce = 500;
        this.gravity = 1400;
        this.friction = 0.8;

        // Estado
        this.grounded = false;
        this.wallDir = 0;
        this.coyoteTimer = 0;
        this.jumpBuffer = 0;

        // Combate, Dash, Stamina y Saltos
        this.maxDashes = 3 + (state.upgrades.dashLevel - 1);
        this.stamina = this.maxDashes;
        this.maxStamina = this.maxDashes;
        this.dashCooldown = 0;

        this.isDashing = false;
        this.dashTimer = 0;
        this.dashDir = { x: 0, y: 0 };
        this.attackTimer = 0;
        this.spellTimer = 0;
        this.bowTimer = 0;
        this.invulTimer = 0;
        this.hitboxes = [];
        this.facing = 1;
        this.jumpsLeft = 0;
    }

    getMaxAirJumps() {
        return state.upgrades.dashLevel === 3 ? 2 : (state.doubleJumpActive ? 1 : 0);
    }

    update(dt) {
        if (this.invulTimer > 0) this.invulTimer -= dt;
        if (this.attackTimer > 0) this.attackTimer -= dt;
        if (this.spellTimer > 0) this.spellTimer -= dt;
        if (this.bowTimer > 0) this.bowTimer -= dt;
        if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
        if (this.dashCooldown > 0) this.dashCooldown -= dt;

        if (state.mana < state.maxMana) {
            state.mana = Math.min(state.maxMana, state.mana + state.manaRegen * dt);
        }

        if (this.stamina < this.maxStamina) {
            let regenRate = this.grounded ? 2.5 : 1.0;
            this.stamina = Math.min(this.maxStamina, this.stamina + dt * regenRate);
        }
        updateHUD();

        let move = 0;
        if (isActionHeld('left')) { move -= 1; this.facing = -1; }
        if (isActionHeld('right')) { move += 1; this.facing = 1; }

        if (this.isDashing) {
            this.dashTimer -= dt;
            this.vx = this.dashDir.x * 800;
            this.vy = this.dashDir.y * 800;
            particles.push(new Particle(this.x + this.w / 2, this.y + this.h / 2, 0, 0, 0.3, '#00ffff', 10));
            if (this.dashTimer <= 0) {
                this.isDashing = false;
                this.vy = 0;
            }
        } else {
            this.vx += move * this.speed * 13 * dt;
            this.vx *= Math.pow(this.friction, dt * 60);

            if (this.wallDir !== 0 && this.vy > 0 && move === this.wallDir) {
                this.vy = 100;
                particles.push(new Particle(this.wallDir === 1 ? this.x + this.w : this.x, this.y + 20, 0, -20, 0.2, '#fff', 3));
            } else {
                this.vy += this.gravity * dt;
            }

            // Salto con Z
            if (isActionJustPressed('jump')) {
                this.jumpBuffer = 0.15;
            }

            let maxAirJumps = this.getMaxAirJumps();

            if (this.jumpBuffer > 0) {
                if (this.coyoteTimer > 0) {
                    this.vy = -this.jumpForce;
                    this.jumpBuffer = 0;
                    this.coyoteTimer = 0;
                    playSound('jump');
                } else if (this.wallDir !== 0) {
                    this.vy = -this.jumpForce * 0.9;
                    this.vx = -this.wallDir * this.speed * 1.5;
                    this.jumpBuffer = 0;
                    this.jumpsLeft = maxAirJumps;
                    playSound('jump');
                } else if (this.jumpsLeft > 0) {
                    this.vy = -this.jumpForce * 0.9;
                    this.jumpBuffer = 0;
                    this.jumpsLeft--;
                    spawnParticles(this.x + this.w / 2, this.y + this.h, '#fff', 15);
                    playSound('jump');
                }
            }
        }

        this.x += this.vx * dt;
        this.wallDir = 0;
        this.handleCollisions(true);

        this.y += this.vy * dt;
        this.grounded = false;
        this.handleCollisions(false);

        if (this.grounded) {
            this.coyoteTimer = 0.15;
            this.jumpsLeft = this.getMaxAirJumps();
        } else {
            this.coyoteTimer -= dt;
        }

        this.handleCombat(dt);
    }

    handleCollisions(horizontal) {
        let r1 = { left: this.x, right: this.x + this.w, top: this.y, bottom: this.y + this.h };
        for (let p of platforms) {
            let r2 = { left: p.x, right: p.x + p.w, top: p.y, bottom: p.y + p.h };
            if (rectIntersect(r1, r2)) {
                if (p.type === 'hazard') { this.takeDamage(1); continue; }
                if (horizontal) {
                    if (this.vx > 0) { this.x = p.x - this.w; this.wallDir = 1; }
                    else if (this.vx < 0) { this.x = p.x + p.w; this.wallDir = -1; }
                    this.vx = 0;
                } else {
                    if (this.vy > 0) { this.y = p.y - this.h; this.grounded = true; }
                    else if (this.vy < 0) { this.y = p.y + p.h; }
                    this.vy = 0;
                }
                r1 = { left: this.x, right: this.x + this.w, top: this.y, bottom: this.y + this.h };
            }
        }
    }

    handleCombat(dt) {
        // Dash con C
        if (isActionJustPressed('dash') && this.stamina >= 1 && this.dashCooldown <= 0 && !this.isDashing) {
            this.isDashing = true;
            this.dashTimer = 0.2;
            this.dashCooldown = 0.25;
            this.stamina -= 1;
            this.invulTimer = 0.25;
            playSound('dash');

            let dx = 0, dy = 0;
            if (isActionHeld('left')) dx -= 1;
            if (isActionHeld('right')) dx += 1;
            if (isActionHeld('up')) dy -= 1;
            if (isActionHeld('down')) dy += 1;
            if (dx === 0 && dy === 0) dx = this.facing;

            let mag = Math.sqrt(dx * dx + dy * dy);
            this.dashDir = { x: dx / mag, y: dy / mag };
        }

        // Ataque con X (horizontal, arriba, diagonal y pogo en el aire)
        if (isActionJustPressed('attack') && this.attackTimer <= 0) {
            this.attackTimer = 0.22;
            playSound('shoot');

            let dirX = 0;
            if (isActionHeld('left')) dirX -= 1;
            if (isActionHeld('right')) dirX += 1;

            let dirY = 0;
            if (isActionHeld('up')) dirY -= 1;
            if (isActionHeld('down')) dirY += 1;

            let cx = this.x + this.w / 2;
            let cy = this.y + this.h / 2;
            let isPogo = (dirX === 0 && dirY === 1 && !this.grounded);

            if (isPogo) {
                this.hitboxes.push({
                    x: this.x - 30,
                    y: this.y + this.h,
                    w: this.w + 60,
                    h: 60,
                    life: 0.1,
                    isPogo: true
                });
            } else if (dirX !== 0 && dirY !== 0) {
                // Ataque en diagonal
                let diagW = 85;
                let diagH = 85;
                let hx = dirX === 1 ? cx + 8 : cx - diagW - 8;
                let hy = dirY === -1 ? cy - diagH - 8 : cy + 8;
                this.hitboxes.push({
                    x: hx,
                    y: hy,
                    w: diagW,
                    h: diagH,
                    life: 0.1,
                    isPogo: true
                });
            } else if (dirY === -1) {
                // Ataque hacia arriba
                let hitW = 60, hitH = 110;
                let hx = cx - (hitW / 2), hy = this.y - hitH;
                this.hitboxes.push({ x: hx, y: hy, w: hitW, h: hitH, life: 0.1, isPogo: false });
            } else {
                // Ataque horizontal
                let aimX = dirX !== 0 ? dirX : this.facing;
                let hitW = 120, hitH = 45;
                let hx = aimX === 1 ? cx + 10 : cx - hitW - 10;
                let hy = cy - (hitH / 2);
                this.hitboxes.push({ x: hx, y: hy, w: hitW, h: hitH, life: 0.1, isPogo: false });
            }
        }

        for (let i = this.hitboxes.length - 1; i >= 0; i--) {
            let hb = this.hitboxes[i];
            hb.life -= dt;

            let hr = { left: hb.x, right: hb.x + hb.w, top: hb.y, bottom: hb.y + hb.h };
            for (let e of enemies) {
                let er = { left: e.x, right: e.x + e.w, top: e.y, bottom: e.y + e.h };
                if (rectIntersect(hr, er) && e.invul <= 0) {
                    e.takeDamage(state.upgrades.dmg);
                    spawnParticles(e.x + e.w / 2, e.y + e.h / 2, '#fff', 10);
                    doHitstop(0.012);
                    screenShake(5, 0.1);
                    if (hb.isPogo) {
                        this.vy = -this.jumpForce * 1.2;
                        this.stamina = this.maxStamina;
                        this.jumpsLeft = this.getMaxAirJumps();
                    }
                }
            }
            if (hb.life <= 0) this.hitboxes.splice(i, 1);
        }

        // Disparo recto estilo Hollow Knight (KeyA)
        const spellCost = 45;
        if (isActionJustPressed('spell') && this.spellTimer <= 0 && state.mana >= spellCost) {
            state.mana -= spellCost;
            this.spellTimer = 0.35;
            playSound('shoot');

            let aimX = 0;
            if (isActionHeld('left')) aimX -= 1;
            if (isActionHeld('right')) aimX += 1;
            if (aimX === 0) aimX = this.facing;

            const cx = this.x + this.w / 2;
            const cy = this.y + this.h / 2;
            const spellDmg = 2 + (state.upgrades.spellLevel - 1) * 2;
            const spellWidth = 34 + (state.upgrades.spellLevel - 1) * 6;
            const spellHeight = 20 + (state.upgrades.spellLevel - 1) * 4;

            projectiles.push(new Projectile(
                cx + aimX * 18,
                cy,
                aimX * 720,
                0,
                false,
                '#7dd3fc',
                12,
                0.75,
                {
                    dmg: spellDmg,
                    pierce: true,
                    shape: 'rect',
                    width: spellWidth,
                    height: spellHeight
                }
            ));
            spawnParticles(cx + aimX * 14, cy, '#bae6fd', 8);
            updateHUD();
        }

        // Disparo con arco (KeyS)
        const bowCost = 30;
        if (isActionJustPressed('bow') && this.bowTimer <= 0 && state.mana >= bowCost) {
            state.mana -= bowCost;
            this.bowTimer = 0.24;
            playSound('shoot');

            let dx = 0, dy = 0;
            if (isActionHeld('left')) dx -= 1;
            if (isActionHeld('right')) dx += 1;
            if (isActionHeld('up')) dy -= 1;
            if (isActionHeld('down')) dy += 1;
            if (dx === 0 && dy === 0) dx = this.facing;

            const mag = Math.hypot(dx, dy) || 1;
            const nx = dx / mag;
            const ny = dy / mag;
            const cx = this.x + this.w / 2;
            const cy = this.y + this.h / 2;
            const bowSpeed = 820 + (state.upgrades.bowLevel - 1) * 80;
            const bowDmg = 1 + state.upgrades.bowLevel;
            const arrowGravity = (dy === 0) ? 260 : 420;

            projectiles.push(new Projectile(
                cx + nx * 16,
                cy + ny * 16,
                nx * bowSpeed,
                ny * bowSpeed - (dy === 0 ? 45 : 0),
                false,
                '#facc15',
                6,
                1.1,
                {
                    dmg: bowDmg,
                    gravity: arrowGravity,
                    pierce: false
                }
            ));
            spawnParticles(cx + nx * 12, cy + ny * 12, '#fef08a', 6);
            updateHUD();
        }
    }

    takeDamage(dmg) {
        if (this.invulTimer > 0) return;
        this.hp -= dmg;
        this.invulTimer = 1.0;
        playSound('hit');
        screenShake(24, 0.28); // <-- AQUÍ SE MODIFICA LA FUERZA Y DURACIÓN DEL SHAKE AL RECIBIR DAÑO
        doHitstop(0.1);
        updateHUD();
        if (this.hp <= 0) gameOver();
    }

    draw(ctx) {
        if (this.invulTimer > 0 && Math.floor(Date.now() / 50) % 2 === 0) return;
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(this.x, this.y, this.w, this.h);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        for (let hb of this.hitboxes) ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
    }
}

class Enemy {
    constructor(x, y, type) {
        this.x = x; this.y = y; this.w = 30; this.h = 30;
        this.type = type;
        this.invul = 0;

        let dif = 1 + (state.room * 0.09);
        this.maxHp = Math.floor((type === 8 ? 34 : type === 9 ? 150 : Math.max(3, type * 3)) * dif);
        this.hp = this.maxHp;

        if (type <= 2) this.speed = 190 * dif;
        else if (type <= 4) this.speed = 80 * dif;
        else this.speed = 45 * dif;

        this.swordHitbox = null;
        this.swordCooldown = 0;
        this.facing = 1;

        this.timer = 0;
        this.phase = 1;
    }

    update(dt) {
        if (this.invul > 0) this.invul -= dt;

        let cx = this.x + this.w / 2, cy = this.y + this.h / 2;
        let px = player.x + player.w / 2, py = player.y + player.h / 2;
        if (isNaN(cx) || isNaN(cy) || isNaN(px) || isNaN(py)) return;

        let dist = Math.hypot(px - cx, py - cy);
        let angle = Math.atan2(py - cy, px - cx);
        this.timer += dt;

        let dx = 0, dy = 0;

        if (this.swordCooldown > 0) this.swordCooldown -= dt;

        // Actualizar y comprobar colisión de la espada dirigida del enemigo
        if (this.swordHitbox) {
            this.swordHitbox.life -= dt;

            let hitPlayer = false;
            const steps = 4;
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const hx = cx + Math.cos(this.swordHitbox.angle) * (this.swordHitbox.reach * t);
                const hy = cy + Math.sin(this.swordHitbox.angle) * (this.swordHitbox.reach * t);
                const hitBoxRect = {
                    left: hx - this.swordHitbox.halfThick,
                    right: hx + this.swordHitbox.halfThick,
                    top: hy - this.swordHitbox.halfThick,
                    bottom: hy + this.swordHitbox.halfThick
                };
                const pr = { left: player.x, right: player.x + player.w, top: player.y, bottom: player.y + player.h };
                if (rectIntersect(hitBoxRect, pr)) {
                    hitPlayer = true;
                    break;
                }
            }

            if (hitPlayer && player.invulTimer <= 0) {
                player.takeDamage(1);
            }

            if (this.swordHitbox.life <= 0) {
                this.swordHitbox = null;
            }
        }

        if (this.type <= 2) {
            if (dist < 500) {
                this.facing = (px >= cx) ? 1 : -1;

                // Distancia reducida: tienen que acercarse mucho para atacar
                if (dist <= 52 && this.swordCooldown <= 0) {
                    const aimAngle = Math.atan2(py - cy, px - cx);
                    if (Number.isFinite(aimAngle)) {
                        this.swordCooldown = 1.1;
                        const reach = 35;      // Tajo corto cuerpo a cuerpo
                        const halfThick = 14;  // Grosor del tajo

                        this.swordHitbox = {
                            angle: aimAngle,
                            reach: reach,
                            halfThick: halfThick,
                            life: 0.14
                        };
                    }
                } else if (dist > 34) {
                    // Siguen acercándose hasta quedar pegados al rango de espada
                    dx = Math.cos(angle) * this.speed * dt;
                    dy = Math.sin(angle) * this.speed * dt;
                }
            }
        } else if (this.type <= 4) {
            if (dist > 250 && dist < 600) {
                dx = Math.cos(angle) * this.speed * dt;
                dy = Math.sin(angle) * this.speed * dt;
            }
            if (this.timer > 2 && dist < 600) {
                this.timer = 0; playSound('shoot');
                projectiles.push(new Projectile(cx, cy, Math.cos(angle) * 300, Math.sin(angle) * 300, true, '#ff00ff', 6));
            }
        } else if (this.type <= 7) {
            if (dist < 600) {
                dx = Math.cos(angle) * this.speed * dt;
                dy = Math.sin(angle) * this.speed * dt;
                if (this.timer > 2.5) {
                    this.timer = 0; playSound('shoot');
                    for (let i = 0; i < 8; i++) {
                        let a = (Math.PI * 2 / 8) * i;
                        projectiles.push(new Projectile(cx, cy, Math.cos(a) * 150, Math.sin(a) * 150, true, '#ffaa00', 5));
                    }
                }
            }
        } else if (this.type === 8) {
            if (dist > 30) {
                this.x += Math.cos(angle) * (this.speed * 0.5) * dt;
                this.y += Math.sin(angle) * (this.speed * 0.5) * dt;
            }
            this.x = Math.max(40, Math.min(1300, this.x));
            this.y = Math.max(-180, Math.min(520, this.y));

            if (this.timer > 2.8) {
                this.timer = 0; playSound('shoot');
                for (let i = 0; i < 12; i++) {
                    let a = (Math.PI * 2 / 12) * i + Math.random();
                    projectiles.push(new Projectile(cx, cy, Math.cos(a) * 120, Math.sin(a) * 120, true, '#ff3300', 8));
                }
            }
            if (ui.bossHp) ui.bossHp.style.width = Math.max(0, Math.min(100, (this.hp / this.maxHp) * 100)) + '%';
        } else if (this.type === 9) {
            if (this.hp < this.maxHp * 0.6 && this.phase === 1) { this.phase = 2; screenShake(20, 1); }
            if (this.hp < this.maxHp * 0.3 && this.phase === 2) { this.phase = 3; screenShake(30, 1); }

            let rate = this.phase === 1 ? 3 : this.phase === 2 ? 1.8 : 0.9;
            if (this.timer > rate) {
                this.timer = 0; playSound('shoot');
                if (this.phase === 1) {
                    for (let i = -2; i <= 2; i++) projectiles.push(new Projectile(cx, cy, Math.cos(angle + i * 0.2) * 160, Math.sin(angle + i * 0.2) * 160, true, '#ff0000', 10));
                } else if (this.phase === 2) {
                    for (let i = 0; i < 20; i++) projectiles.push(new Projectile(cx, cy, Math.cos(angle + i * 0.3) * 120, Math.sin(angle + i * 0.3) * 120, true, '#ff0055', 8));
                    this.y = player.y - 180;
                    this.x += Math.sign(px - cx) * (this.speed * 0.6) * dt;
                } else {
                    for (let i = 0; i < 30; i++) projectiles.push(new Projectile(cx, cy, Math.cos((Math.PI * 2 / 30) * i) * 200, Math.sin((Math.PI * 2 / 30) * i) * 200, true, '#ffffff', 12));
                    this.x += Math.cos(angle) * (this.speed * 1.0) * dt;
                    this.y += Math.sin(angle) * (this.speed * 1.0) * dt;
                }
            }
            this.x += Math.cos(angle) * (this.speed * 0.3) * dt;
            this.y += Math.sin(angle) * (this.speed * 0.3) * dt;
            this.x = Math.max(40, Math.min(1300, this.x));
            this.y = Math.max(-180, Math.min(520, this.y));
            if (ui.bossHp) ui.bossHp.style.width = Math.max(0, Math.min(100, (this.hp / this.maxHp) * 100)) + '%';
        }

        if (this.type <= 7) {
            let pushX = 0, pushY = 0;
            for (let other of enemies) {
                if (other === this) continue;
                let distToOther = Math.hypot(this.x - other.x, this.y - other.y);
                if (distToOther < 35 && distToOther > 0) {
                    pushX += (this.x - other.x) * 3 * dt;
                    pushY += (this.y - other.y) * 3 * dt;
                }
            }
            dx += pushX;
            dy += pushY;

            if (dx !== 0) {
                this.x += dx;
                let r1 = { left: this.x, right: this.x + this.w, top: this.y, bottom: this.y + this.h };
                for (let p of platforms) {
                    if (p.type === 'hazard') continue;
                    let r2 = { left: p.x, right: p.x + p.w, top: p.y, bottom: p.y + p.h };
                    if (rectIntersect(r1, r2)) {
                        if (dx > 0) this.x = p.x - this.w;
                        else if (dx < 0) this.x = p.x + p.w;
                        r1.left = this.x; r1.right = this.x + this.w;
                    }
                }
            }

            if (dy !== 0) {
                this.y += dy;
                let r1Y = { left: this.x, right: this.x + this.w, top: this.y, bottom: this.y + this.h };
                for (let p of platforms) {
                    if (p.type === 'hazard') continue;
                    let r2 = { left: p.x, right: p.x + p.w, top: p.y, bottom: p.y + p.h };
                    if (rectIntersect(r1Y, r2)) {
                        if (dy > 0) this.y = p.y - this.h;
                        else if (dy < 0) this.y = p.y + p.h;
                        r1Y.top = this.y; r1Y.bottom = this.y + this.h;
                    }
                }
            }

            this.x = Math.max(20, Math.min(1350, this.x));
            this.y = Math.max(-200, Math.min(560, this.y));
        }

        // Daño por contacto solo para enemigos que no usan espada (type > 2)
        if (this.type > 2) {
            let er = { left: this.x, right: this.x + this.w, top: this.y, bottom: this.y + this.h };
            let pr = { left: player.x, right: player.x + player.w, top: player.y, bottom: player.y + player.h };
            if (rectIntersect(er, pr)) player.takeDamage(1);
        }
    }

    takeDamage(dmg) {
        this.hp -= dmg;
        this.invul = 0.1;
        if (this.hp <= 0) {
            spawnParticles(this.x + this.w / 2, this.y + this.h / 2, '#ffaa00', 30);
            playSound('coin');
            state.essence += (this.type >= 8 ? 50 : this.type * 2);
            const manaGain = this.type >= 8 ? 45 : 14 + this.type * 2;
            state.mana = Math.min(state.maxMana, state.mana + manaGain);
            updateHUD();
            if (this.type >= 8) {
                if (ui.bossContainer) ui.bossContainer.classList.add('hidden');
                interactables.push({ x: 1260, y: 500, w: 60, h: 100, type: 'door', text: 'Volver al Hub (E)', doorTimer: 1.0 });
                if (this.type === 9) gameWin();
            }
        }
    }

    draw(ctx) {
        if (this.invul > 0) ctx.fillStyle = '#fff';
        else ctx.fillStyle = this.type >= 8 ? '#ff0000' : '#aa00ff';

        if (this.type === 9) {
            this.w = 80; this.h = 80;
            ctx.beginPath();
            ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(this.x, this.y, this.w, this.h);
        }

        // Dibujar tajo de espada dirigido hacia el jugador
        if (this.swordHitbox) {
            const startX = this.x + this.w / 2;
            const startY = this.y + this.h / 2;

            ctx.save();
            ctx.translate(startX, startY);
            ctx.rotate(this.swordHitbox.angle);
            ctx.fillStyle = 'rgba(255, 90, 120, 0.85)';
            ctx.fillRect(0, -this.swordHitbox.halfThick, this.swordHitbox.reach, this.swordHitbox.halfThick * 2);
            ctx.restore();
        }
    }
}

// --- GENERACIÓN PROCEDURAL (1400px de ancho + techo) ---
function generateRoom(roomNum) {
    platforms = [];
    enemies = [];
    projectiles = [];
    particles = [];
    interactables = [];
    player.x = 120;
    player.y = 500;
    player.vx = 0;
    player.vy = 0;

    if (ui.bossContainer) ui.bossContainer.classList.add('hidden');

    // Suelo, paredes y techo
    platforms.push(new Platform(0, 600, 1400, 100, 'boundary'));    // Suelo
    platforms.push(new Platform(-40, -220, 40, 820, 'boundary'));  // Pared izq
    platforms.push(new Platform(1400, -220, 40, 820, 'boundary')); // Pared der
    platforms.push(new Platform(0, -260, 1400, 40, 'boundary'));   // Techo

    if (roomNum === 0) {
        interactables.push({ x: 280, y: 520, w: 40, h: 80, type: 'shop', text: 'Tienda (E)' });
        interactables.push({ x: 520, y: 500, w: 60, h: 100, type: 'door', text: 'Siguiente Sala (E)', doorTimer: 1.0 });
        if (state.secrets >= 3 && ui.secretDisplay) {
            ui.secretDisplay.style.display = 'inline';
            ui.secretDisplay.innerText = "Ruta Abierta";
        }
        return;
    }

    const platformModels = [
        { w: 120, h: 40 }
    ];

    let attempts = 0;
    let platformsPlaced = 0;

    while (platformsPlaced < 14 && attempts < 150) {
        attempts++;
        let model = platformModels[Math.floor(Math.random() * platformModels.length)];
        let w = model.w;
        let h = model.h;
        let px = 140 + Math.random() * 1060;
        let py = -120 + Math.random() * 560;

        let overlaps = false;
        for (let p of platforms) {
            if (px < p.x + p.w + 40 && px + w + 40 > p.x &&
                py < p.y + p.h + 40 && py + h + 40 > p.y) {
                overlaps = true;
                break;
            }
        }

        if (!overlaps) {
            platforms.push(new Platform(px, py, w, h));

            if (roomNum >= 4 && Math.random() < 0.3) {
                platforms.push(new Platform(px + 12, py - 10, w - 24, 10, 'hazard'));
            }

            if (roomNum !== 16 && roomNum % 4 !== 0 && Math.random() < 0.5 + (roomNum * 0.02)) {
                let type = Math.floor(Math.random() * Math.min(7, 2 + roomNum / 2)) + 1;
                enemies.push(new Enemy(px + (w / 2) - 15, py - 50, type));
            }

            platformsPlaced++;
        }
    }

    if (Math.random() < 0.2 && state.secrets < 3 && roomNum !== 16 && platforms.length > 4) {
        let randomPlatIndex = Math.floor(Math.random() * (platforms.length - 4)) + 4;
        let plat = platforms[randomPlatIndex];
        let secretW = 30, secretH = 30;
        let sx = plat.x + Math.random() * (plat.w - secretW);
        let sy = plat.y - secretH;
        interactables.push({ x: sx, y: sy, w: secretW, h: secretH, type: 'secret', text: 'Investigar (E)' });
    }

    let endX = 1260;
    if (roomNum === 16) {
        enemies.push(new Enemy(700, 350, 9));
        if (ui.bossContainer) ui.bossContainer.classList.remove('hidden');
        if (ui.bossName) ui.bossName.innerText = "El Arquitecto de la Caída";
    } else if (roomNum % 4 === 0) {
        enemies.push(new Enemy(950, 420, 8));
        if (ui.bossContainer) ui.bossContainer.classList.remove('hidden');
        if (ui.bossName) ui.bossName.innerText = "Guardián de Ceniza";
    } else {
        interactables.push({ x: endX, y: 500, w: 60, h: 100, type: 'door', text: 'Avanzar (E)', doorTimer: 1.0 });
    }
}

function getBiome(room) {
    if (room === 0) return { bg: '#11131a', plat: '#2a2d36', top: '#00ffff' };

    const palettes = [
        { bg: '#0f172a', plat: '#1e293b', top: '#38bdf8' },
        { bg: '#2a1215', plat: '#3f1619', top: '#f87171' },
        { bg: '#064e3b', plat: '#065f46', top: '#34d399' },
        { bg: '#2e1065', plat: '#4c1d95', top: '#a78bfa' },
        { bg: '#3f2c00', plat: '#713f12', top: '#facc15' },
        { bg: '#171717', plat: '#262626', top: '#a3e635' }
    ];

    let index = (room - 1) % palettes.length;
    return palettes[index];
}

// --- BUCLE PRINCIPAL (ENGINE) ---
function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.1) dt = 0.1;

    if (state.isPlaying && !state.isPaused) {
        if (hitstop > 0) {
            hitstop -= dt;
        } else {
            update(dt);
        }
    }

    draw();
    clearJustPressed();
    requestAnimationFrame(gameLoop);
}

function update(dt) {
    // Manejo del fundido entre salas
    if (transition.active) {
        if (transition.phase === 'out') {
            transition.alpha += transition.speed * dt;
            if (transition.alpha >= 1) {
                transition.alpha = 1;
                if (transition.callback) {
                    transition.callback();
                    transition.callback = null;
                }
                transition.phase = 'in';
            }
            return;
        } else if (transition.phase === 'in') {
            transition.alpha -= transition.speed * dt;
            if (transition.alpha <= 0) {
                transition.alpha = 0;
                transition.phase = 'none';
                transition.active = false;
            }
        }
    }

    player.update(dt);

    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i]; p.update(dt);
        if (p.life <= 0) { projectiles.splice(i, 1); continue; }

        let pr = { left: player.x, right: player.x + player.w, top: player.y, bottom: player.y + player.h };
        let halfW = p.shape === 'rect' ? p.width / 2 : p.size;
        let halfH = p.shape === 'rect' ? p.height / 2 : p.size;
        let pRect = { left: p.x - halfW, right: p.x + halfW, top: p.y - halfH, bottom: p.y + halfH };

        if (p.isEnemy && rectIntersect(pr, pRect) && player.invulTimer <= 0) {
            player.takeDamage(1);
            projectiles.splice(i, 1);
            continue;
        }

        if (!p.isEnemy) {
            let removeProj = false;
            for (let eIdx = 0; eIdx < enemies.length; eIdx++) {
                const e = enemies[eIdx];
                if (e.hp <= 0 || p.hitIds.has(eIdx)) continue;
                const er = { left: e.x, right: e.x + e.w, top: e.y, bottom: e.y + e.h };
                if (rectIntersect(pRect, er)) {
                    p.hitIds.add(eIdx);
                    e.takeDamage(p.dmg);
                    spawnParticles(e.x + e.w / 2, e.y + e.h / 2, p.color, 10);
                    doHitstop(0.015);
                    if (!p.pierce) {
                        removeProj = true;
                        break;
                    }
                }
            }
            if (removeProj) {
                projectiles.splice(i, 1);
            }
        }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
        enemies[i].update(dt);
        if (enemies[i].hp <= 0) enemies.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(dt);
        if (particles[i].life <= 0) particles.splice(i, 1);
    }

    let pr = { left: player.x, right: player.x + player.w, top: player.y, bottom: player.y + player.h };
    for (let i = interactables.length - 1; i >= 0; i--) {
        let int = interactables[i];
        if (int.doorTimer && int.doorTimer > 0) {
            int.doorTimer -= dt;
        }

        let ir = { left: int.x, right: int.x + int.w, top: int.y, bottom: int.y + int.h };
        if (rectIntersect(pr, ir) && isActionJustPressed('interact') && (!int.doorTimer || int.doorTimer <= 0)) {
            if (int.type === 'door') {
                startRoomTransition(() => {
                    projectiles = [];
                    particles = [];

                    if (state.room === 0) {
                        state.room = state.targetRoom || 1;
                    } else {
                        state.targetRoom = state.room + 1;
                        state.room = 0;
                    }

                    generateRoom(state.room);
                    updateHUD();
                });
                break;
            } else if (int.type === 'shop') {
                openShop();
            } else if (int.type === 'secret') {
                state.secrets++;
                playSound('coin');
                interactables.splice(i, 1);
                updateHUD();
            }
        }
    }

    // Cámara estática centrada en la sala (con seguimiento suave solo si la ventana es más pequeña que la sala)
    const baseCam = getStaticCamera();
    if (canvas.width < 1480) {
        const minX = -40;
        const maxX = 1440 - canvas.width;
        const targetX = Math.max(minX, Math.min(maxX, (player.x + player.w / 2) - canvas.width / 2));
        camera.x += (targetX - camera.x) * 8 * dt;
    } else {
        camera.x = baseCam.x;
    }

    if (canvas.height < 960) {
        const minY = -260;
        const maxY = 700 - canvas.height;
        const targetY = Math.max(minY, Math.min(maxY, (player.y + player.h / 2) - canvas.height / 2));
        camera.y += (targetY - camera.y) * 8 * dt;
    } else {
        camera.y = baseCam.y;
    }

    // Temblor progresivo de cámara (shake)
    if (camera.shakeTime > 0) {
        camera.shakeTime -= dt;
        const ratio = camera.shakeDuration > 0 ? Math.max(0, camera.shakeTime / camera.shakeDuration) : 1;
        const currentMag = camera.shakeMagnitude * ratio;
        camera.x += (Math.random() - 0.5) * 2 * currentMag;
        camera.y += (Math.random() - 0.5) * 2 * currentMag;
    }
}

function draw() {
    let biomeColors = getBiome(state.room);

    ctx.fillStyle = biomeColors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 50; i++) {
        let px = (i * 123 + camera.x * 0.5) % 3000 - 500;
        let py = (i * 321 + camera.y * 0.5) % 2000 - 500;
        ctx.fillRect(px, py, 3, 3);
    }

    for (let p of platforms) p.draw(ctx, biomeColors);

    for (let int of interactables) {
        ctx.fillStyle = int.type === 'door' ? '#aaa' : int.type === 'shop' ? '#ffaa00' : '#00ffff';
        ctx.fillRect(int.x, int.y, int.w, int.h);

        let pr = { left: player.x, right: player.x + player.w, top: player.y, bottom: player.y + player.h };
        let ir = { left: int.x, right: int.x + int.w, top: int.y, bottom: int.y + int.h };
        if (rectIntersect(pr, ir)) {
            ctx.fillStyle = '#fff';
            ctx.font = '12px "Press Start 2P"';
            ctx.fillText(int.text, int.x - 20, int.y - 10);
        }
    }

    for (let e of enemies) e.draw(ctx);
    for (let p of particles) p.draw(ctx);
    for (let p of projectiles) p.draw(ctx);
    if (player) player.draw(ctx);

    ctx.restore();

    // Viñeta ambiental o viñeta roja pulsante cuando el jugador está a 1 golpe
    let grad = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height / 4, canvas.width / 2, canvas.height / 2, canvas.width * 0.8);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');

    if (player && player.hp === 1) {
        const pulse = 0.55 + Math.sin(Date.now() * 0.008) * 0.2;
        grad.addColorStop(0.65, `rgba(200, 0, 0, ${pulse * 0.55})`);
        grad.addColorStop(1, `rgba(240, 0, 0, ${pulse})`);
    } else {
        grad.addColorStop(1, 'rgba(0,0,0,0.92)');
    }

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Si el HTML aún no tiene #mana-bar, dibujar una barra compacta de maná en esquina superior izquierda
    if (state.isPlaying && player && !document.getElementById('mana-bar')) {
        const bx = 20, by = 50, bw = 180, bh = 12;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(bx, by, bw, bh);
        const ratio = Math.max(0, Math.min(1, state.mana / state.maxMana));
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(bx, by, bw * ratio, bh);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = '#e0f2fe';
        ctx.font = '10px monospace';
        ctx.fillText(`MANÁ ${Math.floor(state.mana)}/${state.maxMana} [A: Onda | S: Arco]`, bx, by + bh + 12);
    }

    // Dibujar fundido suave al cambiar de sala
    if (transition.alpha > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${transition.alpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// --- GESTIÓN DE ESTADO Y UI ---
function updateHUD() {
    if (!player) return;
    ui.hpBar.style.width = (player.hp / player.maxHp) * 100 + '%';
    let staminaBar = document.getElementById('stamina-bar');
    if (staminaBar) {
        staminaBar.style.width = (player.stamina / player.maxStamina) * 100 + '%';
    }
    let manaBar = ui.manaBar || document.getElementById('mana-bar');
    if (manaBar) {
        manaBar.style.width = Math.max(0, Math.min(100, (state.mana / state.maxMana) * 100)) + '%';
    }
    let manaText = ui.manaText || document.getElementById('mana-display');
    if (manaText) {
        manaText.innerText = `Maná: ${Math.floor(state.mana)}/${state.maxMana}`;
    }
    ui.essence.innerText = `Esencia: ${state.essence}`;
    ui.room.innerText = `Sala: ${state.room === 0 ? 'Hub' : state.room}`;
    if (ui.secretDisplay) ui.secretDisplay.innerText = `Secretos: ${state.secrets}/3`;
}

function startGame() {
    document.getElementById('screen-start').classList.add('hidden');
    state.isPlaying = true;
    state.isPaused = false;
    player = new Player(120, 500);
    state.room = 0;
    generateRoom(0);
    const cam = getStaticCamera();
    camera.x = cam.x;
    camera.y = cam.y;
    updateHUD();
    ui.hud.classList.remove('hidden');
    requestAnimationFrame(gameLoop);
}

function returnToHub() {
    startRoomTransition(() => {
        document.getElementById('screen-death').classList.add('hidden');
        document.getElementById('screen-win').classList.add('hidden');
        if (ui.bossContainer) ui.bossContainer.classList.add('hidden');
        state.isPaused = false;
        state.room = 0;
        player.hp = player.maxHp;
        generateRoom(0);
        updateHUD();
    });
}

function gameOver() {
    document.getElementById('screen-death').classList.remove('hidden');
    document.getElementById('death-stats').innerText = `Llegaste a la sala ${state.room}. Recolectaste ${state.essence} de esencia.`;
}

function gameWin() {
    document.getElementById('screen-win').classList.remove('hidden');
    document.getElementById('win-stats').innerText = state.secrets >= 3 ? "Has descubierto la Verdad oculta." : "Pero aún quedan misterios...";
}

function togglePause() {
    if (!state.isPlaying) return;
    state.isPaused = !state.isPaused;
    if (state.isPaused) document.getElementById('screen-pause').classList.remove('hidden');
    else document.getElementById('screen-pause').classList.add('hidden');
}

function ensureShopPowerButtons(shopScreen) {
    if (!shopScreen || document.getElementById('mana-shop-controls')) return;
    const container = document.createElement('div');
    container.id = 'mana-shop-controls';
    container.style.cssText = 'margin-top: 12px; display: flex; flex-direction: column; gap: 8px; align-items: center;';

    const makeBtn = (id, label, onClick) => {
        const b = document.createElement('button');
        b.id = id;
        b.innerText = label;
        b.style.cssText = 'padding: 8px 12px; background: #1e293b; color: #f8fafc; border: 1px solid #38bdf8; cursor: pointer; font-family: inherit; font-size: 11px;';
        b.onclick = onClick;
        return b;
    };

    container.appendChild(makeBtn('btn-upgrade-mana', '', () => buyUpgrade('mana')));
    container.appendChild(makeBtn('btn-upgrade-spell', '', () => buyUpgrade('spell')));
    container.appendChild(makeBtn('btn-upgrade-bow', '', () => buyUpgrade('bow')));

    const closeBtn = shopScreen.querySelector('button[onclick*="closeShop"]');
    if (closeBtn && closeBtn.parentElement) {
        closeBtn.parentElement.insertBefore(container, closeBtn);
    } else {
        shopScreen.appendChild(container);
    }
}

function openShop() {
    const shopScreen = document.getElementById('screen-shop');
    const wasClosed = shopScreen.classList.contains('hidden');
    state.isPaused = true;
    ensureShopPowerButtons(shopScreen);

    if (wasClosed) {
        shopScreen.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        shopScreen.style.opacity = '0';
        shopScreen.style.transform = 'scale(0.96)';
        shopScreen.classList.remove('hidden');
        requestAnimationFrame(() => {
            shopScreen.style.opacity = '1';
            shopScreen.style.transform = 'scale(1)';
        });
    }

    document.getElementById('shop-essence').innerText = state.essence;
    document.getElementById('cost-hp').innerText = state.costs.hp;
    document.getElementById('cost-dmg').innerText = state.costs.dmg;
    document.getElementById('cost-speed').innerText = state.costs.speed;

    const btnMana = document.getElementById('btn-upgrade-mana');
    if (btnMana) {
        btnMana.innerText = `Maná Máx. y Regen (Nv.${state.upgrades.maxManaLevel}) - Coste: ${state.costs.mana}`;
    }
    const btnSpell = document.getElementById('btn-upgrade-spell');
    if (btnSpell) {
        btnSpell.innerText = `Disparo Onda [A] (Nv.${state.upgrades.spellLevel}) - Coste: ${state.costs.spell}`;
    }
    const btnBow = document.getElementById('btn-upgrade-bow');
    if (btnBow) {
        btnBow.innerText = `Arco [S] (Nv.${state.upgrades.bowLevel}) - Coste: ${state.costs.bow}`;
    }

    let btnDash = document.getElementById('btn-dash');
    let lvlDash = document.getElementById('lvl-dash');
    let costDash = document.getElementById('cost-dash');

    if (lvlDash) lvlDash.innerText = state.upgrades.dashLevel;
    if (state.upgrades.dashLevel >= 3) {
        if (btnDash) {
            btnDash.innerText = "+1 Dash Extra (MÁXIMO)";
            btnDash.style.backgroundColor = "#22aa22";
        }
        if (costDash) costDash.innerText = "---";
    } else {
        if (costDash) costDash.innerText = state.costs.dash;
    }

    let btnDj = document.getElementById('btn-dj');
    if (btnDj) {
        if (state.upgrades.doubleJump) {
            btnDj.innerText = state.doubleJumpActive ? "DOBLE SALTO: ACTIVO" : "DOBLE SALTO: INACTIVO";
            btnDj.style.backgroundColor = state.doubleJumpActive ? "#22aa22" : "#aa2222";
        } else {
            btnDj.innerText = `Doble Salto (Coste: ${state.costs.doubleJump})`;
            btnDj.style.backgroundColor = "#222";
        }
    }
}

function closeShop() {
    const shopScreen = document.getElementById('screen-shop');
    shopScreen.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    shopScreen.style.opacity = '0';
    shopScreen.style.transform = 'scale(0.96)';

    setTimeout(() => {
        shopScreen.classList.add('hidden');
        shopScreen.style.opacity = '';
        shopScreen.style.transform = '';
        state.isPaused = false;
    }, 200);
}

function buyDoubleJump() {
    if (!state.upgrades.doubleJump) {
        if (state.essence >= state.costs.doubleJump) {
            state.essence -= state.costs.doubleJump;
            state.upgrades.doubleJump = true;
            state.doubleJumpActive = true;
            playSound('coin');
            openShop();
            updateHUD();
        }
    } else {
        state.doubleJumpActive = !state.doubleJumpActive;
        openShop();
    }
}

function buyUpgrade(type) {
    let cost = state.costs[type];
    if (state.essence >= cost) {
        if (type === 'dash') {
            if (state.upgrades.dashLevel < 3) {
                state.essence -= cost;
                state.upgrades.dashLevel++;
                playSound('coin');
                if (state.upgrades.dashLevel === 2) state.costs.dash = 125;
                if (state.upgrades.dashLevel === 3) state.costs.dash = 150;
                if (player) {
                    player.maxDashes = state.upgrades.dashLevel === 3 ? 6 : 3 + (state.upgrades.dashLevel - 1);
                    player.maxStamina = player.maxDashes;
                    player.stamina = player.maxStamina;
                }
            }
        } else {
            state.essence -= cost;
            playSound('coin');
            if (type === 'hp') { state.upgrades.hp += 1; player.maxHp = state.upgrades.hp; player.hp = player.maxHp; }
            if (type === 'dmg') state.upgrades.dmg += 1;
            if (type === 'speed') state.upgrades.speed += 0.1;
            if (type === 'mana') {
                state.upgrades.maxManaLevel += 1;
                state.maxMana += 25;
                state.manaRegen += 3;
                state.mana = state.maxMana;
            }
            if (type === 'spell') {
                state.upgrades.spellLevel += 1;
            }
            if (type === 'bow') {
                state.upgrades.bowLevel += 1;
            }
            state.costs[type] = Math.floor(cost * 1.5);
        }
        openShop();
        updateHUD();
    }
}

// --- LISTENERS DE INPUT ---
window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
    }
    if (!keys[e.code]) {
        justPressed[e.code] = true;
    }
    keys[e.code] = true;
    if (e.code === 'Escape') togglePause();
});

window.addEventListener('keyup', e => {
    keys[e.code] = false;
});

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.imageSmoothingEnabled = false;
});