import Peer, { type DataConnection, type PeerOptions } from 'peerjs';

/**
 * Peer-to-peer transport for co-op. The host's browser is the server: it opens a PeerJS peer named
 * after a short room code, and up to MAX_GUESTS friends connect straight to it over WebRTC data
 * channels (PeerJS's public broker only introduces them; its TURN relay covers strict NATs).
 * Everything is a star: guests only ever talk to the host, and the host relays.
 */
export type Role = 'solo' | 'host' | 'client';
export interface LobbyPeer { id: string; name: string; ship: string; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { t: string; [k: string]: any };

export const MAX_GUESTS = 4;
const PREFIX = 'prismfall-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function peerOpts(): PeerOptions {
  // ?peerhost=localhost:9000 points at a private broker (used by the automated tests)
  const ph = new URLSearchParams(location.search).get('peerhost');
  if (!ph) return { debug: 0 };
  const [host, port] = ph.split(':');
  return { host, port: Number(port || 9000), path: '/', secure: false, debug: 0, config: { iceServers: [] } };
}

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export class Net {
  role: Role = 'solo';
  code = '';
  myId = 'solo';
  name = 'Pilot';
  ship = 'comet';
  lobby: LobbyPeer[] = [];
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  /** host: a run is in progress (late joiners are dropped straight into it) */
  inRun = false;

  onMsg: (from: string, m: Msg) => void = () => {};
  onLobby: () => void = () => {};
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  onClosed: (why: string) => void = () => {};

  get active() { return this.role !== 'solo'; }
  get peers() { return this.conns.size; }

  /** Open a room. Resolves with the room code once the broker has registered it. */
  host(name: string, ship: string): Promise<string> {
    this.leave();
    this.name = name;
    this.ship = ship;
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        const code = makeCode();
        const peer = new Peer(PREFIX + code, peerOpts());
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.peer = peer;
          this.role = 'host';
          this.code = code;
          this.myId = 'host';
          this.lobby = [{ id: 'host', name, ship }];
          this.onLobby();
          resolve(code);
        });
        peer.on('error', (err: { type?: string; message?: string }) => {
          if (!opened && err.type === 'unavailable-id' && tries++ < 5) { peer.destroy(); attempt(); return; }
          if (!opened) { peer.destroy(); reject(new Error(this.explain(err))); return; }
          console.warn('[net]', err);
        });
        peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) peer.reconnect(); });
        peer.on('connection', (c) => this.acceptGuest(c));
      };
      attempt();
    });
  }

  private acceptGuest(c: DataConnection) {
    const id = c.peer;
    c.on('data', (raw) => {
      const m = raw as Msg;
      if (m.t === 'hello') {
        if (this.conns.size >= MAX_GUESTS) { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); return; }
        this.conns.set(id, c);
        this.lobby = this.lobby.filter((p) => p.id !== id);
        this.lobby.push({ id, name: String(m.name || 'Pilot').slice(0, 16), ship: String(m.ship || 'comet') });
        c.send({ t: 'welcome', id, code: this.code });
        this.broadcast({ t: 'lobby', lobby: this.lobby });
        this.onLobby();
        this.onJoin(id);
        return;
      }
      if (this.conns.has(id)) this.onMsg(id, m);
    });
    const gone = () => {
      if (!this.conns.has(id)) return;
      this.conns.delete(id);
      this.lobby = this.lobby.filter((p) => p.id !== id);
      this.broadcast({ t: 'lobby', lobby: this.lobby });
      this.onLobby();
      this.onLeave(id);
    };
    c.on('close', gone);
    c.on('error', gone);
  }

  /** Join a room by its code. */
  join(code: string, name: string, ship: string): Promise<void> {
    this.leave();
    this.name = name;
    this.ship = ship;
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerOpts());
      let done = false;
      const fail = (why: string) => { if (done) return; done = true; peer.destroy(); this.role = 'solo'; reject(new Error(why)); };
      const timer = setTimeout(() => fail('Could not reach that room. Check the code and try again.'), 25000);
      peer.on('error', (err: { type?: string; message?: string }) => {
        if (!done) { clearTimeout(timer); fail(this.explain(err)); return; }
        console.warn('[net]', err);
      });
      peer.on('open', () => {
        const c = peer.connect(PREFIX + code, { reliable: true });
        c.on('open', () => c.send({ t: 'hello', name, ship }));
        c.on('data', (raw) => {
          const m = raw as Msg;
          if (m.t === 'full') { clearTimeout(timer); fail('That room is full (5 pilots max).'); return; }
          if (m.t === 'welcome') {
            clearTimeout(timer);
            done = true;
            this.peer = peer;
            this.role = 'client';
            this.code = code;
            this.myId = String(m.id);
            this.conns.set('host', c);
            resolve();
            return;
          }
          if (m.t === 'lobby') { this.lobby = m.lobby as LobbyPeer[]; this.onLobby(); return; }
          this.onMsg('host', m);
        });
        const gone = () => {
          if (!done) { clearTimeout(timer); fail('Connection to the room failed.'); return; }
          if (this.role !== 'client') return;
          this.leave();
          this.onClosed('The host closed the room.');
        };
        c.on('close', gone);
        c.on('error', gone);
      });
    });
  }

  private explain(err: { type?: string; message?: string }) {
    switch (err.type) {
      case 'peer-unavailable': return 'No room with that code.';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed': return 'Could not reach the matchmaking server. Check your connection.';
      case 'browser-incompatible': return 'This browser does not support online play.';
      default: return err.message || 'Connection failed.';
    }
  }

  send(to: string, m: Msg) {
    const c = this.conns.get(to);
    if (c && c.open) c.send(m);
  }

  broadcast(m: Msg, except?: string) {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(m);
  }

  /** bytes waiting in a guest's send buffer: the host skips a snapshot rather than queueing behind a slow link */
  backlog(to: string) {
    const c = this.conns.get(to) as (DataConnection & { dataChannel?: RTCDataChannel }) | undefined;
    return c?.dataChannel?.bufferedAmount ?? 0;
  }

  guestIds() { return [...this.conns.keys()]; }

  nameOf(id: string) { return this.lobby.find((p) => p.id === id)?.name ?? 'Pilot'; }

  leave() {
    for (const c of this.conns.values()) try { c.close(); } catch { /* already gone */ }
    this.conns.clear();
    if (this.peer) try { this.peer.destroy(); } catch { /* already gone */ }
    this.peer = null;
    this.role = 'solo';
    this.code = '';
    this.myId = 'solo';
    this.lobby = [];
    this.inRun = false;
  }
}
