// The DOM layer: top bar (timer, score pips, alive counts), vitals, gun and
// money readouts, killfeed, banners, the plant/defuse channel bar and the
// buy menu. Game logic lives in main.js; this file only paints state.

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.timer = $('timer');
    this.scoreJ = $('score-j');
    this.scoreW = $('score-w');
    this.aliveJ = $('alive-j');
    this.aliveW = $('alive-w');
    this.hpNum = $('hp-num');
    this.hpFill = $('hp-fill');
    this.armorNum = $('armor-num');
    this.armorLabel = $('armor-label');
    this.gunName = $('gun-name');
    this.ammoBox = $('ammo');
    this.ammoMag = $('ammo-mag');
    this.ammoReserve = document.querySelector('#ammo .reserve');
    this.money = $('money');
    this.feed = $('killfeed');
    this.hitEl = $('hitmarker');
    this.bannerEl = $('banner');
    this.promptEl = $('prompt');
    this.channelEl = $('channel');
    this.channelFill = $('channel-fill');
    this.channelCap = $('channel-cap');
    this.damageEl = $('damage');
    this.hitTimer = 0;
    for (const [id, n] of [['pips-j', 6], ['pips-w', 6]]) {
      const box = $(id);
      for (let i = 0; i < n; i++) box.appendChild(document.createElement('i'));
    }
  }
  show() { this.root.hidden = false; }
  hide() { this.root.hidden = true; }
  setTimer(seconds, mode = 'live') {
    const s = Math.max(0, Math.ceil(seconds));
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.className = mode === 'planted' ? 'planted' : (s <= 15 && mode === 'live' ? 'low' : '');
    if (mode === 'buy') this.timer.textContent = `BUY ${s}`;
  }
  setScore(j, w) {
    this.scoreJ.textContent = j;
    this.scoreW.textContent = w;
    const paint = (id, n) => {
      const kids = $(id).children;
      for (let i = 0; i < kids.length; i++) kids[i].className = i < n ? 'on' : '';
    };
    paint('pips-j', j);
    paint('pips-w', w);
  }
  setAlive(j, w) {
    this.aliveJ.textContent = `${j} alive`;
    this.aliveW.textContent = `${w} alive`;
  }
  setVitals(hp, armor) {
    const v = Math.max(0, Math.ceil(hp));
    this.hpNum.textContent = v;
    this.hpFill.style.width = `${v}%`;
    this.hpFill.className = v <= 35 ? 'hurt' : '';
    this.armorNum.textContent = armor ? '▣' : '';
    this.armorLabel.textContent = armor ? 'PLATED' : '';
  }
  setGun(name, mag, reserve, money, reloading) {
    this.gunName.textContent = reloading ? `${name} — RELOADING` : name;
    this.ammoMag.textContent = mag;
    this.ammoReserve.textContent = `/ ${reserve}`;
    this.ammoBox.className = mag === 0 ? 'out' : (mag <= 3 ? 'low' : '');
    this.money.textContent = money;
  }
  hitmarker(kill) {
    this.hitEl.className = kill ? 'on kill' : 'on';
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => { this.hitEl.className = ''; }, 130);
  }
  damageFlash() {
    this.damageEl.style.opacity = 1;
    setTimeout(() => { this.damageEl.style.opacity = 0; }, 160);
  }
  killfeed(killer, victim, gunName) {
    const row = document.createElement('div');
    const kc = killer.team === 'atk' ? 'j' : 'w';
    const vc = victim.team === 'atk' ? 'j' : 'w';
    row.innerHTML = `<span class="${kc}">${killer.name}</span><span class="gun">${gunName}</span><span class="${vc}">${victim.name}</span>`;
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => row.remove(), 4200);
  }
  banner(big, sub, cls = '') {
    this.bannerEl.hidden = false;
    this.bannerEl.className = cls;
    this.bannerEl.querySelector('.big').textContent = big;
    this.bannerEl.querySelector('.sub').textContent = sub ?? '';
  }
  hideBanner() { this.bannerEl.hidden = true; }
  prompt(html) {
    if (html) { this.promptEl.innerHTML = html; this.promptEl.hidden = false; }
    else this.promptEl.hidden = true;
  }
  channel(frac, caption) {
    if (frac === null || frac === undefined) { this.channelEl.hidden = true; return; }
    this.channelEl.hidden = false;
    this.channelFill.style.width = `${Math.round(frac * 100)}%`;
    this.channelCap.textContent = caption;
  }
}

export function renderBuyMenu(items, money, onBuy) {
  $('buy-money').textContent = `$${money}`;
  const grid = $('buy-grid');
  grid.innerHTML = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'buy-item';
    btn.disabled = !item.afford || item.owned;
    btn.innerHTML =
      `<span class="key">[${item.key}]</span><span class="nm">${item.name}</span>` +
      `<span class="ds">${item.desc}</span>` +
      (item.owned ? `<span class="owned">OWNED</span>` : `<span class="pr">$${item.price}</span>`);
    btn.addEventListener('click', () => onBuy(item.id));
    grid.appendChild(btn);
  }
}
