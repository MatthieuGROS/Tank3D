// Connexion WebSocket au serveur : messages JSON { type, ... }.
export class Net {
  constructor() {
    this.handlers = {};
    this.ws = null;
    this.rtt = 0; // aller-retour mesuré, en ms
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  // Ouvre la connexion (une seule fois : en cas de mauvais mot de passe on réessaie sur la même).
  connect() {
    if (this.ws?.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      ws.onopen = () => {
        this.pingTimer = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 1000);
        resolve();
      };
      ws.onerror = () => reject(new Error('connexion impossible'));
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        this.handlers.close?.();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'pong') {
          const rtt = performance.now() - msg.t;
          this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
        } else {
          this.handlers[msg.type]?.(msg);
        }
      };
    });
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}
