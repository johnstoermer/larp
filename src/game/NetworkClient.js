const PROTOCOL_VERSION = 2;
const RECONNECT_DELAYS = [350, 700, 1200, 2000, 3200, 5000];

function websocketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export class NetworkClient extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.status = 'offline';
    this.token = localStorage.getItem('cookout2-session') || '';
    this.name = localStorage.getItem('cookout2-name') || '';
    this.resumeRequested =
      localStorage.getItem('cookout2-active-match') === '1';
    this.rtt = 0;
    this.clockOffset = 0;
    this.reconnectAttempt = 0;
    this.reconnectTimer = 0;
    this.pingTimer = 0;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    this.intentionalClose = false;
    this.keepAlive = false;
    this.inMatch = false;
    this.lastMessageAt = 0;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setStatus(status, detail = {}) {
    if (this.status === status && !Object.keys(detail).length) return;
    this.status = status;
    this.emit('status', { status, rtt: this.rtt, ...detail });
  }

  connect(name = this.name) {
    const cleanName = String(name ?? '').trim().slice(0, 18);
    if (cleanName) {
      this.name = cleanName;
      localStorage.setItem('cookout2-name', cleanName);
    }
    this.keepAlive = true;
    this.intentionalClose = false;
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this);
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    this.openSocket();
    return this.connectPromise;
  }

  openSocket() {
    clearTimeout(this.reconnectTimer);
    this.setStatus(this.reconnectAttempt ? 'reconnecting' : 'connecting', {
      attempt: this.reconnectAttempt,
    });
    const socket = new WebSocket(websocketUrl());
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'hello',
          version: PROTOCOL_VERSION,
          token: this.token,
          name: this.name,
        }),
      );
    });
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
    socket.addEventListener('close', (event) => this.handleClose(socket, event));
    socket.addEventListener('error', () => {
      if (socket.readyState === WebSocket.CONNECTING) socket.close();
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    this.lastMessageAt = performance.now();
    if (message.type === 'welcome') {
      this.token = message.token;
      this.name = message.name;
      localStorage.setItem('cookout2-session', this.token);
      localStorage.setItem('cookout2-name', this.name);
      this.reconnectAttempt = 0;
      this.setStatus('online', { online: message.online });
      this.startPing();
      this.resolveConnect?.(this);
      this.connectPromise = null;
      this.resolveConnect = null;
      this.rejectConnect = null;
    } else if (message.type === 'pong') {
      const now = performance.now();
      const sample = Math.max(0, now - Number(message.sentAt || now));
      this.rtt = this.rtt ? this.rtt * 0.78 + sample * 0.22 : sample;
      this.clockOffset =
        Number(message.serverTime || Date.now()) - Date.now() + this.rtt * 0.5;
      this.emit('latency', { rtt: this.rtt });
    } else if (message.type === 'match_found') {
      this.inMatch = true;
      this.resumeRequested = true;
      localStorage.setItem('cookout2-active-match', '1');
    } else if (message.type === 'left_match') {
      this.inMatch = false;
      this.resumeRequested = false;
      localStorage.removeItem('cookout2-active-match');
    }
    this.emit(message.type, message);
    this.emit('message', message);
  }

  handleClose(socket, event) {
    if (this.socket !== socket) return;
    this.socket = null;
    clearInterval(this.pingTimer);
    this.pingTimer = 0;
    if (this.intentionalClose || !this.keepAlive) {
      this.setStatus('offline', { code: event.code });
      this.rejectConnect?.(new Error('Connection closed.'));
      this.connectPromise = null;
      this.resolveConnect = null;
      this.rejectConnect = null;
      return;
    }
    this.scheduleReconnect(event.code);
  }

  scheduleReconnect(code) {
    const delay =
      RECONNECT_DELAYS[
        Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)
      ];
    this.reconnectAttempt += 1;
    this.setStatus('reconnecting', {
      attempt: this.reconnectAttempt,
      retryIn: delay,
      code,
    });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
  }

  startPing() {
    clearInterval(this.pingTimer);
    const ping = () => this.send({ type: 'ping', sentAt: performance.now() });
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  quickPlay() {
    return this.send({ type: 'quick_play' });
  }

  createPrivate() {
    return this.send({ type: 'create_private' });
  }

  joinPrivate(code) {
    return this.send({ type: 'join_private', code });
  }

  cancelQueue() {
    return this.send({ type: 'cancel_queue' });
  }

  leave() {
    this.inMatch = false;
    return this.send({ type: 'leave' });
  }

  close() {
    this.keepAlive = false;
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.reconnectTimer = 0;
    this.pingTimer = 0;
    this.socket?.close(1000, 'CLIENT_CLOSE');
    this.socket = null;
    this.setStatus('offline');
  }
}

export { PROTOCOL_VERSION };
