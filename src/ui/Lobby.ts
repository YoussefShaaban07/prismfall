import type { Net } from '../net/Net';
import { MAX_GUESTS } from '../net/Net';
import { t } from './i18n';

/**
 * Co-op lobby: name, host or join, then the crew list with the room code to share.
 * Lives in its own modal so the main menu stays as it was.
 */
export class Lobby {
  onHost: (name: string) => Promise<void> = async () => {};
  onJoin: (code: string, name: string) => Promise<void> = async () => {};
  onLaunch: () => void = () => {};
  onLeave: () => void = () => {};
  onBack: () => void = () => {};
  defaultName = 'Pilot';
  private el: HTMLDivElement;
  private busy = false;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'lobby';
    this.el.className = 'screen modal hidden';
    this.el.innerHTML = `
<div class="panel lobbypanel">
  <h2>${t('CO-OP')}</h2>
  <p class="lsub">${t('Up to 5 pilots. One hosts, everyone else joins with the room code.')}</p>
  <div class="lstep" data-s="start">
    <label class="lfield"><span>${t('PILOT NAME')}</span><input id="lName" maxlength="14" autocomplete="off" spellcheck="false"></label>
    <button id="lHost" class="btn primary wide">${t('HOST A ROOM')}</button>
    <div class="lor">${t('or join one')}</div>
    <div class="ljoin"><input id="lCode" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false"><button id="lJoin" class="btn">${t('JOIN')}</button></div>
  </div>
  <div class="lstep hidden" data-s="room">
    <div class="lcode"><small>${t('ROOM CODE')}</small><b id="lCodeOut"></b><button id="lCopy" class="btn ghost small">${t('COPY INVITE LINK')}</button></div>
    <ul id="lCrew" class="lcrew"></ul>
    <div id="lWait" class="lwait"></div>
    <button id="lLaunch" class="btn primary wide">${t('LAUNCH MISSION')}</button>
  </div>
  <div id="lErr" class="lerr"></div>
  <button id="lBack" class="btn ghost">${t('BACK')}</button>
</div>`;
    root.appendChild(this.el);
    const $ = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    const name = () => ($('#lName') as HTMLInputElement).value.trim() || this.defaultName;
    $('#lHost').addEventListener('click', () => this.run(() => this.onHost(name()), 'Opening a room...'));
    const join = () => {
      const code = ($('#lCode') as HTMLInputElement).value.trim().toUpperCase();
      if (code.length < 5) { this.error(t('Enter the 5-letter room code.')); return; }
      this.run(() => this.onJoin(code, name()), 'Connecting...');
    };
    $('#lJoin').addEventListener('click', join);
    $('#lCode').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') join(); });
    $('#lCode').addEventListener('input', (e) => {
      const i = e.target as HTMLInputElement;
      i.value = i.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    $('#lLaunch').addEventListener('click', () => this.onLaunch());
    $('#lCopy').addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}?room=${$('#lCodeOut').textContent}`;
      navigator.clipboard?.writeText(url).then(() => { $('#lCopy').textContent = t('COPIED'); setTimeout(() => ($('#lCopy').textContent = t('COPY INVITE LINK')), 1500); }, () => {});
    });
    $('#lBack').addEventListener('click', () => {
      this.onLeave();
      this.close();
      this.onBack();
    });
    // keys typed in the lobby must never steer the ship behind it
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get open() { return !this.el.classList.contains('hidden'); }

  show(code = '') {
    this.el.classList.remove('hidden');
    const n = this.el.querySelector('#lName') as HTMLInputElement;
    if (!n.value) n.value = this.defaultName;
    (this.el.querySelector('#lCode') as HTMLInputElement).value = code;
    (this.el.querySelector('#lBack') as HTMLElement).textContent = t('BACK');
    this.error('');
    this.step('start');
  }

  close() {
    this.el.classList.add('hidden');
  }

  private step(s: 'start' | 'room') {
    this.el.querySelectorAll<HTMLElement>('.lstep').forEach((e) => e.classList.toggle('hidden', e.dataset.s !== s));
  }

  private error(msg: string) {
    (this.el.querySelector('#lErr') as HTMLElement).textContent = msg;
  }

  private async run(fn: () => Promise<void>, wait: string) {
    if (this.busy) return;
    this.busy = true;
    this.error(t(wait));
    try {
      await fn();
      this.error('');
    } catch (e) {
      this.error(t(e instanceof Error ? e.message : String(e)));
    } finally {
      this.busy = false;
    }
  }

  render(net: Net) {
    if (!net.active) { this.step('start'); return; }
    this.step('room');
    (this.el.querySelector('#lCodeOut') as HTMLElement).textContent = net.code;
    const crew = this.el.querySelector('#lCrew') as HTMLElement;
    const slots: string[] = [];
    for (let i = 0; i < MAX_GUESTS + 1; i++) {
      const p = net.lobby[i];
      if (p) slots.push(`<li class="${p.id === net.myId ? 'me' : ''}"><i>${i === 0 ? '★' : i + 1}</i><b>${esc(p.name)}</b><span>${i === 0 ? t('HOST') : p.id === net.myId ? t('YOU') : ''}</span></li>`);
      else slots.push(`<li class="empty"><i>${i + 1}</i><b>${t('open slot')}</b></li>`);
    }
    crew.innerHTML = slots.join('');
    const host = net.role === 'host';
    (this.el.querySelector('#lLaunch') as HTMLElement).classList.toggle('hidden', !host);
    (this.el.querySelector('#lWait') as HTMLElement).textContent = host
      ? t(net.lobby.length > 1 ? 'Keep this tab in front while you play: your browser runs the mission for everyone.' : 'Share the code. You can also launch solo and let friends drop in.')
      : t('Waiting for the host to launch...');
    (this.el.querySelector('#lBack') as HTMLElement).textContent = t('LEAVE ROOM');
  }
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
