import { LatencyTracker } from './LatencyTracker.js';

const PROTOCOL_VERSION = 5;
const RECONNECT_DELAYS = [350, 700, 1200, 2000, 3200, 5000];
const PING_INTERVAL_MS = 1000;
const PING_TIMEOUT_MS = 5000;
const MAX_REALTIME_BUFFERED_BYTES = 8192;
const PENDING_LEAVE_KEY = 'larp-pending-leave';

function websocketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

function shouldDropRealtimeMessage(message, bufferedAmount) {
  return (
    (message?.type === 'state' || message?.type === 'war_state') &&
    Number(bufferedAmount) > MAX_REALTIME_BUFFERED_BYTES
  );
}

export function welcomeInvalidatesResume(message, resumeRequested) {
  return Boolean(resumeRequested && message?.activeMatch === false);
}

export class NetworkClient extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.status = 'offline';
    this.token = localStorage.getItem('larp-session') || '';
    this.name = localStorage.getItem('larp-name') || '';
    this.resumeRequested =
      localStorage.getItem('larp-active-match') === '1';
    this.pendingLeave = localStorage.getItem(PENDING_LEAVE_KEY) === '1';
    this.closeAfterLeave = this.pendingLeave;
    this.rtt = 0;
    this.latencyTracker = new LatencyTracker();
    this.clockOffset = 0;
    this.reconnectAttempt = 0;
    this.reconnectTimer = 0;
    this.pingTimer = 0;
    this.pingSequence = 0;
    this.pendingPing = null;
    this.droppedRealtimeMessages = 0;
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

  clearActiveMatch() {
    this.inMatch = false;
    this.resumeRequested = false;
    localStorage.removeItem('larp-active-match');
  }

  connect(name = this.name) {
    const cleanName = String(name ?? '').trim().slice(0, 18);
    if (cleanName) {
      this.name = cleanName;
      localStorage.setItem('larp-name', cleanName);
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
    let closeAfterMessage = false;
    if (message.type === 'welcome') {
      const resumeUnavailable = welcomeInvalidatesResume(
        message,
        this.resumeRequested,
      );
      this.token = message.token;
      this.name = message.name;
      localStorage.setItem('larp-session', this.token);
      localStorage.setItem('larp-name', this.name);
      this.reconnectAttempt = 0;
      this.setStatus('online', { online: message.online });
      this.startPing();
      this.resolveConnect?.(this);
      this.connectPromise = null;
      this.resolveConnect = null;
      this.rejectConnect = null;
      if (resumeUnavailable) {
        this.clearActiveMatch();
        this.emit('resume_unavailable', { reason: 'not_found' });
      }
      if (this.pendingLeave) this.send({ type: 'leave' });
    } else if (message.type === 'pong') {
      const sequence = Number(message.sequence);
      if (!this.pendingPing || sequence !== this.pendingPing.sequence) return;
      const now = performance.now();
      const sample = Math.max(0, now - this.pendingPing.sentAt);
      this.pendingPing = null;
      clearTimeout(this.pingTimer);
      this.pingTimer = 0;
      const latency = this.latencyTracker.add(sample);
      this.rtt = latency.rtt;
      this.clockOffset =
        Number(message.serverTime || Date.now()) - Date.now() + this.rtt * 0.5;
      this.emit('latency', latency);
      this.schedulePing(PING_INTERVAL_MS);
    } else if (message.type === 'match_found' || message.type === 'war_found') {
      if (this.pendingLeave) return;
      this.inMatch = true;
      this.resumeRequested = true;
      localStorage.setItem('larp-active-match', '1');
    } else if (
      message.type === 'resume_status' &&
      message.active === false &&
      this.resumeRequested
    ) {
      this.clearActiveMatch();
      this.emit('resume_unavailable', { reason: 'not_found' });
    } else if (message.type === 'left_match') {
      closeAfterMessage = this.closeAfterLeave;
      this.closeAfterLeave = false;
      this.pendingLeave = false;
      localStorage.removeItem(PENDING_LEAVE_KEY);
      this.clearActiveMatch();
    }
    this.emit(message.type, message);
    this.emit('message', message);
    if (closeAfterMessage) this.close();
  }

  handleClose(socket, event) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.stopPing();
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
    this.stopPing();
    this.latencyTracker.reset();
    this.rtt = 0;
    this.schedulePing(0);
  }

  schedulePing(delay) {
    clearTimeout(this.pingTimer);
    this.pingTimer = window.setTimeout(() => this.sendPing(), delay);
  }

  sendPing() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const sequence = ++this.pingSequence;
    const sentAt = performance.now();
    this.pendingPing = { sequence, sentAt };
    if (!this.send({ type: 'ping', sequence, sentAt })) {
      this.pendingPing = null;
      return;
    }
    this.pingTimer = window.setTimeout(() => {
      this.pendingPing = null;
      this.schedulePing(0);
    }, PING_TIMEOUT_MS);
  }

  stopPing() {
    clearTimeout(this.pingTimer);
    this.pingTimer = 0;
    this.pendingPing = null;
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    if (shouldDropRealtimeMessage(message, this.socket.bufferedAmount)) {
      this.droppedRealtimeMessages += 1;
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  quickPlay() {
    this.closeAfterLeave = false;
    return this.send({ type: 'quick_play' });
  }

  warPlay(classId) {
    this.closeAfterLeave = false;
    return this.send({ type: 'war_play', classId });
  }

  createPrivate() {
    this.closeAfterLeave = false;
    return this.send({ type: 'create_private' });
  }

  joinPrivate(code) {
    this.closeAfterLeave = false;
    return this.send({ type: 'join_private', code });
  }

  cancelQueue() {
    const sent = this.send({ type: 'cancel_queue' });
    // The server also removes queues and private lobbies on disconnect. Close
    // the now-idle title socket so abandoned lobby tabs cannot consume the
    // finite realtime connection pool indefinitely.
    this.close();
    return sent;
  }

  leave() {
    this.pendingLeave = true;
    this.closeAfterLeave = true;
    localStorage.setItem(PENDING_LEAVE_KEY, '1');
    this.clearActiveMatch();
    return this.send({ type: 'leave' });
  }

  close() {
    this.keepAlive = false;
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.reconnectTimer = 0;
    this.socket?.close(1000, 'CLIENT_CLOSE');
    this.socket = null;
    this.setStatus('offline');
  }
}

export {
  MAX_REALTIME_BUFFERED_BYTES,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  PENDING_LEAVE_KEY,
  PROTOCOL_VERSION,
  shouldDropRealtimeMessage,
};
