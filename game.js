// --- CONFIGURACIÓN Y ESTADO GLOBAL ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const imgPlataforma = new Image();

// Esto nos avisará en la consola si funciona o si falla
imgPlataforma.onload = () => console.log
imgPlataforma.onerror = () => console.error

imgPlataforma.src = 'sprites/plataformapequeña.png'; 

const state = {
    room: 0, essence: 0, secrets: 0, isPlaying: false, isPaused: false,
    upgrades: { hp: 5, dmg: 1, dashLevel: 1, speed: 1, doubleJump: false },
    costs: { hp: 50, dmg: 50, dash: 100, speed: 40, doubleJump: 125 },
    doubleJumpActive: false
};

const keys = {}, mouse = { x: 0, y: 0, down: false };
let camera = { x: 0, y: 0, shakeTime: 0, shakeMagnitude: 0 };
let lastTime = 0, hitstop = 0;

// Referencias a UI
const ui = {
    hpBar: document.getElementById('hp-bar'), essence: document.getElementById('essence-display'),
    room: document.getElementById('room-display'), hud: document.getElementById('hud'),
    bossContainer: document.getElementById('boss-hp-container'), bossHp: document.getElementById('boss-hp-bar'),
    bossName: document.getElementById('boss-name'), secretDisplay: document.getElementById('secret-display')
};

// --- AUDIO PROCEDURAL (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    
    switch(type) {
        case 'jump': osc.type = 'sine'; osc.frequency.setValueAtTime(300, now); osc.frequency.exponentialRampToValueAtTime(600, now + 0.1); gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1); osc.start(now); osc.stop(now + 0.1); break;
        case 'dash': osc.type = 'triangle'; osc.frequency.setValueAtTime(200, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.2); gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2); osc.start(now); osc.stop(now + 0.2); break;
        case 'hit': osc.type = 'square'; osc.frequency.setValueAtTime(100, now); osc.frequency.exponentialRampToValueAtTime(20, now + 0.1); gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1); osc.start(now); osc.stop(now + 0.1); break;
        case 'shoot': osc.type = 'sawtooth'; osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(200, now + 0.1); gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1); osc.start(now); osc.stop(now + 0.1); break;
        case 'coin': osc.type = 'sine'; osc.frequency.setValueAtTime(800, now); osc.frequency.setValueAtTime(1200, now + 0.05); gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3); osc.start(now); osc.stop(now + 0.3); break;
    }
}

// --- UTILIDADES ---
const rectIntersect = (r1, r2) => !(r2.left >= r1.right || r2.right <= r1.left || r2.top >= r1.bottom || r2.bottom <= r1.top);
function screenShake(mag, time) { camera.shakeMagnitude = mag; camera.shakeTime = time; }
function doHitstop(time) { hitstop = time; }

// --- ENTIDADES Y SISTEMAS ---
let player, platforms = [], enemies = [], projectiles = [], particles = [], interactables = [];

class Particle {
    constructor(x, y, vx, vy, life, color, size) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.life = life; this.maxLife = life; this.color = color; this.size = size;
    }
    update(dt) { this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt; }
    draw(ctx) {
        ctx.fillStyle = this.color; ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.fillRect(this.x, this.y, this.size, this.size); ctx.globalAlpha = 1;
    }
}

function spawnParticles(x, y, color, count) {
    for(let i=0; i<count; i++) {
        let ang = Math.random() * Math.PI * 2;
        let speed = Math.random() * 200 + 50;
        particles.push(new Particle(x, y, Math.cos(ang)*speed, Math.sin(ang)*speed, 0.3 + Math.random()*0.3, color, 4));
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
            // Validación por si biomeColors falla
            ctx.fillStyle = biomeColors ? biomeColors.plat : '#333'; 
            ctx.fillRect(this.x, this.y, this.w, this.h);
        } else {
            // Validación anti-crasheos: Verifica que la imagen exista y haya cargado
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
    constructor(x, y, vx, vy, isEnemy, color, size, lifetime = 3) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.isEnemy = isEnemy; this.color = color; this.size = size; this.life = lifetime;
    }
    update(dt) {
        this.x += this.vx * dt; this.y += this.vy * dt; this.life -= dt;
        particles.push(new Particle(this.x, this.y, -this.vx*0.1, -this.vy*0.1, 0.2, this.color, this.size/2));
    }
    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI*2); ctx.fill();
    }
}

class Player {
    constructor(x, y) {
        this.x = x; this.y = y; this.w = 20; this.h = 40;
        this.vx = 0; this.vy = 0;
        this.hp = state.upgrades.hp; this.maxHp = state.upgrades.hp;
        
        // Físicas
        this.speed = 300 * state.upgrades.speed;
        this.jumpForce = 500; this.gravity = 1400; this.friction = 0.8;
        
        // Estado
        this.grounded = false; this.wallDir = 0; // -1 izq, 1 der
        this.coyoteTimer = 0; this.jumpBuffer = 0;
        
        // Combate, Dash, Stamina y Saltos
        this.maxDashes = 3 + (state.upgrades.dashLevel - 1); 
        this.stamina = this.maxDashes;
        this.maxStamina = this.maxDashes;
        this.dashCooldown = 0; 

        this.isDashing = false; this.dashTimer = 0; this.dashDir = {x:0, y:0};
        this.attackTimer = 0; this.invulTimer = 0;
        this.hitboxes = [];
        this.facing = 1; 
        this.jumpsLeft = 0;
    }

    update(dt) {
        if(this.invulTimer > 0) this.invulTimer -= dt;
        if(this.attackTimer > 0) this.attackTimer -= dt;
        if(this.jumpBuffer > 0) this.jumpBuffer -= dt;
        
        if (this.dashCooldown > 0) this.dashCooldown -= dt;
        
        if (this.stamina < this.maxStamina) {
            let regenRate = this.grounded ? 2.5 : 1.0;
            this.stamina = Math.min(this.maxStamina, this.stamina + dt * regenRate);
        }
        updateHUD();

        if(this.isDashing) {
            this.dashTimer -= dt;
            this.vx = this.dashDir.x * 800;
            this.vy = this.dashDir.y * 800;
            particles.push(new Particle(this.x+this.w/2, this.y+this.h/2, 0, 0, 0.3, '#00ffff', 10));
            if(this.dashTimer <= 0) { this.isDashing = false; this.vy = 0; }
        } else {
            let move = 0;
            if (keys['a'] || keys['ArrowLeft']) { move = -1; this.facing = -1; }
            if (keys['d'] || keys['ArrowRight']) { move = 1; this.facing = 1; }
            
            this.vx += move * this.speed * 10 * dt;
            this.vx *= Math.pow(this.friction, dt * 60);

            if(this.wallDir !== 0 && this.vy > 0 && move === this.wallDir) {
                this.vy = 100; 
                particles.push(new Particle(this.wallDir===1?this.x+this.w:this.x, this.y+20, 0, -20, 0.2, '#fff', 3));
            } else {
                this.vy += this.gravity * dt;
            }

            if (keys[' ']) { this.jumpBuffer = 0.15; keys[' ']=false; } 
            
            let maxAirJumps = state.upgrades.dashLevel === 3 ? 2 : (state.doubleJumpActive ? 1 : 0);

            if (this.jumpBuffer > 0) {
                if (this.coyoteTimer > 0) { 
                    this.vy = -this.jumpForce;
                    this.jumpBuffer = 0; this.coyoteTimer = 0;
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
                    spawnParticles(this.x + this.w/2, this.y + this.h, '#fff', 15);
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
            let maxAirJumps = state.upgrades.dashLevel === 3 ? 2 : (state.doubleJumpActive ? 1 : 0);
            this.jumpsLeft = maxAirJumps; 
        } else {
            this.coyoteTimer -= dt;
        }

        this.handleCombat(dt);
    }

    handleCollisions(horizontal) {
        let r1 = {left: this.x, right: this.x+this.w, top: this.y, bottom: this.y+this.h};
        for (let p of platforms) {
            let r2 = {left: p.x, right: p.x+p.w, top: p.y, bottom: p.y+p.h};
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
                r1 = {left: this.x, right: this.x+this.w, top: this.y, bottom: this.y+this.h};
            }
        }
    }

    handleCombat(dt) {
        if (keys['Shift'] && this.stamina >= 1 && this.dashCooldown <= 0 && !this.isDashing) {
            keys['Shift'] = false; 
            this.isDashing = true; 
            this.dashTimer = 0.2; 
            this.dashCooldown = 0.25; 
            this.stamina -= 1; 
            this.invulTimer = 0.25;
            playSound('dash');
            
            let dx = 0, dy = 0;
            if(keys['a'] || keys['ArrowLeft']) dx = -1; 
            if(keys['d'] || keys['ArrowRight']) dx = 1;
            if(keys['w'] || keys['ArrowUp']) dy = -1; 
            if(keys['s'] || keys['ArrowDown']) dy = 1;
            if(dx===0 && dy===0) dx = this.facing;
            
            let mag = Math.sqrt(dx*dx + dy*dy);
            this.dashDir = {x: dx/mag, y: dy/mag};
        }

        if (mouse.down && this.attackTimer <= 0) {
            mouse.down = false; this.attackTimer = 0.4;
            playSound('shoot');
            let isPogo = keys['s'] || keys['ArrowDown'];
            let isUp = keys['w'] || keys['ArrowUp']; 
            let cx = this.x + this.w/2, cy = this.y + this.h/2;
            
            if (isPogo && !this.grounded) {
                this.hitboxes.push({x: this.x - 30, y: this.y + this.h, w: this.w + 60, h: 60, life: 0.15, isPogo: true});
            } else if (isUp) {
                let hitW = 60; let hitH = 110; 
                let hx = cx - (hitW / 2); let hy = this.y - hitH;
                this.hitboxes.push({x: hx, y: hy, w: hitW, h: hitH, life: 0.15, isPogo: false});
            } else {
                let hitW = 120; let hitH = 45;  
                let hx = this.facing === 1 ? cx + 10 : cx - hitW - 10;
                let hy = cy - (hitH / 2);
                this.hitboxes.push({x: hx, y: hy, w: hitW, h: hitH, life: 0.15, isPogo: false});
            }
        }

        for (let i = this.hitboxes.length - 1; i >= 0; i--) {
            let hb = this.hitboxes[i];
            hb.life -= dt;
            
            let hr = {left: hb.x, right: hb.x+hb.w, top: hb.y, bottom: hb.y+hb.h};
            for (let e of enemies) {
                let er = {left: e.x, right: e.x+e.w, top: e.y, bottom: e.y+e.h};
                if (rectIntersect(hr, er) && e.invul <= 0) {
                    e.takeDamage(state.upgrades.dmg);
                    spawnParticles(e.x+e.w/2, e.y+e.h/2, '#fff', 10);
                    doHitstop(0.05); screenShake(5, 0.1);
                    // Rebote del Pogo devuelve la estamina también
                    if (hb.isPogo) { this.vy = -this.jumpForce * 1.2; this.stamina = this.maxStamina; this.dashes = this.maxDashes; } 
                }
            }
            if (hb.life <= 0) this.hitboxes.splice(i, 1);
        }
    }

    takeDamage(dmg) {
        if (this.invulTimer > 0) return;
        this.hp -= dmg;
        this.invulTimer = 1.0;
        playSound('hit'); screenShake(15, 0.2); doHitstop(0.1);
        updateHUD();
        if(this.hp <= 0) gameOver();
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
        
        let dif = 1 + (state.room * 0.15);
        this.maxHp = Math.floor((type === 8 ? 50 : type === 9 ? 200 : type * 5) * dif);
        this.hp = this.maxHp;
        
        // Ajuste de velocidades ( jugador = 300)
        if (type <= 2) this.speed = 240* dif; 
        else if (type <= 4) this.speed = 100 * dif; 
        else if (type <= 7) this.speed = 50 * dif;  
        else this.speed = 50 * dif; 
        
        this.timer = 0; this.phase = 1;
    }

    update(dt) {
        if (this.invul > 0) this.invul -= dt;
        
        let cx = this.x + this.w/2, cy = this.y + this.h/2;
        let px = player.x + player.w/2, py = player.y + player.h/2;
        
        // --- ANTI-CRASH ---
        if (isNaN(cx) || isNaN(cy) || isNaN(px) || isNaN(py)) return;

        let dist = Math.hypot(px - cx, py - cy);
        let angle = Math.atan2(py - cy, px - cx);
        this.timer += dt;

        let dx = 0;
        let dy = 0;

        // --- IA BÁSICA SEGÚN TIPO ---
        if (this.type <= 2) { 
            if (dist < 500) { 
                dx = Math.cos(angle) * this.speed * dt;
                dy = Math.sin(angle) * this.speed * dt;
            }
        } 
        else if (this.type <= 4) { 
            if (dist > 250 && dist < 600) { 
                dx = Math.cos(angle) * this.speed * dt;
                dy = Math.sin(angle) * this.speed * dt;
            }
            if (this.timer > 2 && dist < 600) {
                this.timer = 0; playSound('shoot');
                projectiles.push(new Projectile(cx, cy, Math.cos(angle)*300, Math.sin(angle)*300, true, '#ff00ff', 6));
            }
        }
        else if (this.type <= 7) { 
            if (dist < 600) { 
                dx = Math.cos(angle) * this.speed * dt; 
                dy = Math.sin(angle) * this.speed * dt; // CORRECCIÓN: Faltaba el dy
                if (this.timer > 2.5) {
                    this.timer = 0; playSound('shoot');
                    for(let i=0; i<8; i++) {
                        let a = (Math.PI*2/8)*i;
                        projectiles.push(new Projectile(cx, cy, Math.cos(a)*150, Math.sin(a)*150, true, '#ffaa00', 5));
                    }
                }
            }
        }
        else if (this.type === 8) { 
            if (dist > 30) {
                this.x += Math.cos(angle) * (this.speed * 0.5) * dt;
                this.y += Math.sin(angle) * (this.speed * 0.5) * dt;
            }
            this.x = Math.max(0, Math.min(2300, this.x));
            this.y = Math.max(-400, Math.min(500, this.y));

            if (this.timer > 2.8) {
                this.timer = 0; playSound('shoot');
                for(let i = 0; i < 12; i++) {
                    let a = (Math.PI * 2 / 12) * i + Math.random();
                    projectiles.push(new Projectile(cx, cy, Math.cos(a) * 120, Math.sin(a) * 120, true, '#ff3300', 8));
                }
            }
            if (ui.bossHp) ui.bossHp.style.width = Math.max(0, Math.min(100, (this.hp / this.maxHp) * 100)) + '%';
        }
        else if (this.type === 9) { 
            if(this.hp < this.maxHp*0.6 && this.phase === 1) { this.phase = 2; screenShake(20, 1); }
            if(this.hp < this.maxHp*0.3 && this.phase === 2) { this.phase = 3; screenShake(30, 1); }
            
            let rate = this.phase === 1 ? 3 : this.phase === 2 ? 1.8 : 0.9;
            if (this.timer > rate) {
                this.timer = 0; playSound('shoot');
                if(this.phase === 1) { 
                    for(let i = -2; i <= 2; i++) projectiles.push(new Projectile(cx, cy, Math.cos(angle+i*0.2)*160, Math.sin(angle+i*0.2)*160, true, '#ff0000', 10));
                } else if(this.phase === 2) { 
                    for(let i = 0; i < 20; i++) projectiles.push(new Projectile(cx, cy, Math.cos(angle+i*0.3)*120, Math.sin(angle+i*0.3)*120, true, '#ff0055', 8));
                    this.y = player.y - 180; this.x += Math.sign(px - cx) * (this.speed * 0.6) * dt; 
                } else { 
                    for(let i = 0; i < 30; i++) projectiles.push(new Projectile(cx, cy, Math.cos((Math.PI*2/30)*i)*200, Math.sin((Math.PI*2/30)*i)*200, true, '#ffffff', 12));
                    this.x += Math.cos(angle) * (this.speed * 1.0) * dt; this.y += Math.sin(angle) * (this.speed * 1.0) * dt;
                }
            }
            this.x += Math.cos(angle) * (this.speed * 0.3) * dt;
            this.y += Math.sin(angle) * (this.speed * 0.3) * dt;
            this.x = Math.max(0, Math.min(2300, this.x));
            this.y = Math.max(-400, Math.min(500, this.y));
            if (ui.bossHp) ui.bossHp.style.width = Math.max(0, Math.min(100, (this.hp / this.maxHp) * 100)) + '%';
        }

        // --- SISTEMA ANTI-AGLOMERACIÓN ---
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
        }

        // --- COLISIONES CON PLATAFORMAS (Seguras) ---
        if (this.type <= 7) {
            if (dx !== 0) {
                this.x += dx;
                let r1 = {left: this.x, right: this.x + this.w, top: this.y, bottom: this.y + this.h};
                for (let p of platforms) {
                    if (p.type === 'hazard') continue; 
                    let r2 = {left: p.x, right: p.x + p.w, top: p.y, bottom: p.y + p.h};
                    if (rectIntersect(r1, r2)) {
                        if (dx > 0) this.x = p.x - this.w; 
                        else if (dx < 0) this.x = p.x + p.w; 
                        r1.left = this.x; r1.right = this.x + this.w; 
                    }
                }
            }

            if (dy !== 0) {
                this.y += dy;
                let r1Y = {left: this.x, right: this.x + this.w, top: this.y, bottom: this.y + this.h};
                for (let p of platforms) {
                    if (p.type === 'hazard') continue;
                    let r2 = {left: p.x, right: p.x + p.w, top: p.y, bottom: p.y + p.h};
                    if (rectIntersect(r1Y, r2)) {
                        if (dy > 0) this.y = p.y - this.h; 
                        else if (dy < 0) this.y = p.y + p.h; 
                        r1Y.top = this.y; r1Y.bottom = this.y + this.h;
                    }
                }
            }
            
            // Límite extra de seguridad para que no se escapen del mapa infinito
            this.x = Math.max(-100, Math.min(2500, this.x));
            this.y = Math.max(-600, Math.min(700, this.y));
        }

        // --- COLISIÓN CON EL JUGADOR ---
        let er = {left: this.x, right: this.x+this.w, top: this.y, bottom: this.y+this.h};
        let pr = {left: player.x, right: player.x+player.w, top: player.y, bottom: player.y+player.h};
        if (rectIntersect(er, pr)) player.takeDamage(1);
    }

    takeDamage(dmg) {
        this.hp -= dmg; this.invul = 0.1;
        if(this.hp <= 0) {
            spawnParticles(this.x+this.w/2, this.y+this.h/2, '#ffaa00', 30);
            playSound('coin');
            state.essence += (this.type >= 8 ? 50 : this.type * 2);
            updateHUD();
            if (this.type >= 8) {
                if (ui.bossContainer) ui.bossContainer.classList.add('hidden');
                interactables.push({x: 2200, y: 500, w: 60, h: 100, type: 'door', text: 'Volver al Hub (E)', doorTimer: 1.0});
                if (this.type === 9) gameWin();
            }
        }
    }

    draw(ctx) {
        if(this.invul > 0) ctx.fillStyle = '#fff';
        else ctx.fillStyle = this.type >= 8 ? '#ff0000' : '#aa00ff';
        
        if (this.type === 9) { 
            this.w = 80; this.h = 80;
            ctx.beginPath(); ctx.arc(this.x+this.w/2, this.y+this.h/2, this.w/2, 0, Math.PI*2); ctx.fill();
        } else {
            ctx.fillRect(this.x, this.y, this.w, this.h);
        }
    }
}

// --- GENERACIÓN PROCEDURAL ---
function generateRoom(roomNum) {
    platforms = []; 
    enemies = []; 
    projectiles = [];
    particles = [];
    interactables = [];
    player.x = 100;
    player.y = 500;
    
    // Ocultamos el jefe de entrada para evitar bugs gráficos
    if (ui.bossContainer) ui.bossContainer.classList.add('hidden');
    
    // El 'boundary' evita que los bordes estiren tu sprite
    platforms.push(new Platform(-50, 600, 2500, 100, 'boundary')); // Suelo
    platforms.push(new Platform(-50, -500, 50, 1200, 'boundary')); // Pared izq
    platforms.push(new Platform(2400, -500, 50, 1200, 'boundary')); // Pared der

    if (roomNum === 0) { // HUB
        interactables.push({x: 300, y: 520, w: 40, h: 80, type: 'shop', text: 'Tienda (E)'});
        interactables.push({x: 600, y: 500, w: 60, h: 100, type: 'door', text: 'Siguiente Sala (E)', doorTimer: 1.0});
        if(state.secrets >= 3 && ui.secretDisplay) {
            ui.secretDisplay.style.display = 'inline';
            ui.secretDisplay.innerText = "Ruta Abierta";
        }
        return;
    }



    const platformModels = [
        { w: 120, h: 40 } // (o las medidas exactas de tu sprite)
    ];


    let attempts = 0;
    let platformsPlaced = 0;
    
    // El bucle que genera las plataformas
    while (platformsPlaced < 25 && attempts < 150) {
        attempts++;
        
        let model = platformModels[Math.floor(Math.random() * platformModels.length)];
        let w = model.w;
        let h = model.h;

    let platformsPlaced = 0;
    
    while (platformsPlaced < 25 && attempts < 150) {
        attempts++;
        
        let model = platformModels[Math.floor(Math.random() * platformModels.length)];
        let w = model.w;
        let h = model.h;
        
        let px = 150 + Math.random() * 1900; 
        let py = -350 + Math.random() * 800;  
        
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
            
            // Los hazards se adaptan al nuevo ancho y restan márgenes de seguridad
            if (roomNum >= 4 && Math.random() < 0.3) {
                platforms.push(new Platform(px + 12, py - 10, w - 24, 10, 'hazard'));
            }

            if (roomNum !== 16 && roomNum % 4 !== 0 && Math.random() < 0.5 + (roomNum*0.02)) {
                let type = Math.floor(Math.random() * Math.min(7, 2 + roomNum/2)) + 1;
                enemies.push(new Enemy(px + (w/2) - 15, py - 50, type));
            }
            
            platformsPlaced++;
        }
    }

    // Secreto oculto: se asegura de buscar sobre una plataforma generada
    if (Math.random() < 0.2 && state.secrets < 3 && roomNum !== 16 && platforms.length > 3) {
        let randomPlatIndex = Math.floor(Math.random() * (platforms.length - 3)) + 3;
        let plat = platforms[randomPlatIndex];
        let secretW = 30;
        let secretH = 30;
        let sx = plat.x + Math.random() * (plat.w - secretW);
        let sy = plat.y - secretH;
        interactables.push({x: sx, y: sy, w: secretW, h: secretH, type: 'secret', text: 'Investigar (E)'});
    }
}
    // Generación de puertas y jefes
    let endX = 2200;
    if (roomNum === 16) { 
        enemies.push(new Enemy(1200, 300, 9));
        if (ui.bossContainer) ui.bossContainer.classList.remove('hidden');
        if (ui.bossName) ui.bossName.innerText = "El Arquitecto de la Caída";
    } else if (roomNum % 4 === 0) { 
        enemies.push(new Enemy(1800, 400, 8));
        if (ui.bossContainer) ui.bossContainer.classList.remove('hidden');
        if (ui.bossName) ui.bossName.innerText = "Guardián de Ceniza";
    } else { 
        interactables.push({x: endX, y: 500, w: 60, h: 100, type: 'door', text: 'Avanzar (E)', doorTimer: 1.0});
    }
}

function getBiome(room) {
    if (room === 0) return { bg: '#11131a', plat: '#2a2d36', top: '#00ffff' }; // Hub: Gris espacial con luz Cyan
    
    const palettes = [
        { bg: '#0f172a', plat: '#1e293b', top: '#38bdf8' }, // 1. Frío/Neón (Azules radiantes)
        { bg: '#2a1215', plat: '#3f1619', top: '#f87171' }, // 2. Magma (Rojos carmesí)
        { bg: '#064e3b', plat: '#065f46', top: '#34d399' }, // 3. Templo (Verde esmeralda)
        { bg: '#2e1065', plat: '#4c1d95', top: '#a78bfa' }, // 4. Vacío (Púrpura intenso)
        { bg: '#3f2c00', plat: '#713f12', top: '#facc15' }, // 5. Ruinas (Ámbar y amarillo)
        { bg: '#171717', plat: '#262626', top: '#a3e635' }  // 6. Matriz (Negro con luces Lima)
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
    requestAnimationFrame(gameLoop);
}

function update(dt) {
    player.update(dt);
    
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i]; p.update(dt);
        if(p.life <= 0) { projectiles.splice(i, 1); continue; }
        
        let pr = {left: player.x, right: player.x+player.w, top: player.y, bottom: player.y+player.h};
        let pRect = {left: p.x-p.size, right: p.x+p.size, top: p.y-p.size, bottom: p.y+p.size};
        if (p.isEnemy && rectIntersect(pr, pRect) && player.invulTimer <= 0) {
            player.takeDamage(1); projectiles.splice(i, 1);
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

    // Interactables: BLOQUEADO CONTRA ERRORES DE LECTURA (TILDES)
    let pr = {left: player.x, right: player.x+player.w, top: player.y, bottom: player.y+player.h};
    for (let i = interactables.length - 1; i >= 0; i--) {
        let int = interactables[i];
        
        // Reducimos el temporizador de la puerta
        if (int.doorTimer && int.doorTimer > 0) {
            int.doorTimer -= dt;
        }
        
        let ir = {left: int.x, right: int.x+int.w, top: int.y, bottom: int.y+int.h};
        
        // Si tocamos la puerta y el temporizador se ha enfriado:
        if (rectIntersect(pr, ir) && keys['e'] && (!int.doorTimer || int.doorTimer <= 0)) {
            keys['e'] = false; // Consumir input instantáneamente
            
            if (int.type === 'door') {
                projectiles = []; // Limpieza de memoria
                particles = [];
                
                if (state.room === 0) {
                    state.room = state.targetRoom || 1; 
                } else {
                    state.targetRoom = state.room + 1; 
                    state.room = 0; 
                }
                
                generateRoom(state.room);
                updateHUD();
                break;

            } else if (int.type === 'shop') {
                openShop();
            } else if (int.type === 'secret') {
                state.secrets++; playSound('coin');
                interactables.splice(i, 1); updateHUD();
            }
        }
    }

    let targetX = player.x - canvas.width / 2;
    let targetY = player.y - canvas.height / 2;
    camera.x += (targetX - camera.x) * 5 * dt;
    camera.y += (targetY - camera.y) * 5 * dt;
    
    if (camera.shakeTime > 0) {
        camera.shakeTime -= dt;
        camera.x += (Math.random() - 0.5) * camera.shakeMagnitude;
        camera.y += (Math.random() - 0.5) * camera.shakeMagnitude;
    }
}

function draw() {
    let biomeColors = getBiome(state.room);
    
    // Dibujar fondo atmosférico
    ctx.fillStyle = biomeColors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Parallax (estrellas cuadradas ligeramente más visibles)
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for(let i=0; i<50; i++) {
        let px = (i * 123 + camera.x * 0.5) % 3000 - 500;
        let py = (i * 321 + camera.y * 0.5) % 2000 - 500;
        ctx.fillRect(px, py, 3, 3);
    }

    // Dibujar plataformas enviándoles el objeto completo
    for(let p of platforms) p.draw(ctx, biomeColors);
    
    // Entidades
    for(let int of interactables) {
        ctx.fillStyle = int.type==='door' ? '#aaa' : int.type==='shop' ? '#ffaa00' : '#00ffff';
        ctx.fillRect(int.x, int.y, int.w, int.h);
        
        let pr = {left: player.x, right: player.x+player.w, top: player.y, bottom: player.y+player.h};
        let ir = {left: int.x, right: int.x+int.w, top: int.y, bottom: int.y+int.h};
        if (rectIntersect(pr, ir)) {
            ctx.fillStyle = '#fff'; ctx.font = '12px "Press Start 2P"';
            ctx.fillText(int.text, int.x - 20, int.y - 10);
        }
    }
    for(let e of enemies) e.draw(ctx);
    for(let p of particles) p.draw(ctx);
    for(let p of projectiles) p.draw(ctx);
    player.draw(ctx);
    
    ctx.restore();
    
    // Viñeta para centrar la atención
    let grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, canvas.height/3, canvas.width/2, canvas.height/2, canvas.width);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,canvas.width,canvas.height);
}

// --- GESTIÓN DE ESTADO Y UI ---
function updateHUD() {
    ui.hpBar.style.width = (player.hp / player.maxHp) * 100 + '%';
    let staminaBar = document.getElementById('stamina-bar');
    if (staminaBar && player) {
        staminaBar.style.width = (player.stamina / player.maxStamina) * 100 + '%';
    }
    ui.essence.innerText = `Esencia: ${state.essence}`;
    ui.room.innerText = `Sala: ${state.room === 0 ? 'Hub' : state.room}`;
    if (ui.secretDisplay) ui.secretDisplay.innerText = `Secretos: ${state.secrets}/3`;
}

function startGame() {
    document.getElementById('screen-start').classList.add('hidden');
    state.isPlaying = true; player = new Player(100, 500);
    state.room = 0; generateRoom(0); updateHUD();
    ui.hud.classList.remove('hidden');
    requestAnimationFrame(gameLoop);
}

function returnToHub() {
    document.getElementById('screen-death').classList.add('hidden');
    document.getElementById('screen-win').classList.add('hidden');
    if (ui.bossContainer) ui.bossContainer.classList.add('hidden');
    state.room = 0; player.hp = player.maxHp;
    generateRoom(0); updateHUD();
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

function openShop() {
    state.isPaused = true;
    document.getElementById('screen-shop').classList.remove('hidden');
    document.getElementById('shop-essence').innerText = state.essence;
    document.getElementById('cost-hp').innerText = state.costs.hp;
    document.getElementById('cost-dmg').innerText = state.costs.dmg;
    document.getElementById('cost-speed').innerText = state.costs.speed;
    
    let btnDash = document.getElementById('btn-dash');
    let lvlDash = document.getElementById('lvl-dash');
    let costDash = document.getElementById('cost-dash');
    
    if(lvlDash) lvlDash.innerText = state.upgrades.dashLevel;
    if (state.upgrades.dashLevel >= 3) {
        if(btnDash) btnDash.innerText = "+1 Dash Extra (MÁXIMO)";
        if(costDash) costDash.innerText = "---";
        if(btnDash) btnDash.style.backgroundColor = "#22aa22";
    } else {
        if(costDash) costDash.innerText = state.costs.dash;
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
    state.isPaused = false;
    document.getElementById('screen-shop').classList.add('hidden');
}

function buyDoubleJump() {
    if (!state.upgrades.doubleJump) {
        if (state.essence >= state.costs.doubleJump) {
            state.essence -= state.costs.doubleJump;
            state.upgrades.doubleJump = true;
            state.doubleJumpActive = true;
            playSound('coin');
            openShop(); updateHUD();
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
                    player.dashes = player.maxDashes;
                    player.stamina = player.maxStamina;
                }
            }
        } else {
            state.essence -= cost;
            playSound('coin');
            if (type === 'hp') { state.upgrades.hp += 1; player.maxHp = state.upgrades.hp; player.hp = player.maxHp; }
            if (type === 'dmg') state.upgrades.dmg += 1;
            if (type === 'speed') state.upgrades.speed += 0.1;
            state.costs[type] = Math.floor(cost * 1.5);
        }
        openShop(); updateHUD();
    }
}

// --- LISTENERS DE INPUT ---
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if(e.key === 'Shift') keys['Shift'] = true; if(e.key === 'Escape') togglePause(); });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if(e.key === 'Shift') keys['Shift'] = false; });
window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', e => mouse.down = true);
window.addEventListener('mouseup', e => mouse.down = false);
window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });