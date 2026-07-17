// Test if megajs browser ESM works in a Worker-like environment
import Mega from './node_modules/megajs/dist/main.browser-es.mjs';

// Polyfill missing APIs
globalThis.window = globalThis;
globalThis.document = { all: null };
const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k],
  setItem: (k, v) => store[k] = v,
  removeItem: (k) => delete store[k]
};
globalThis.navigator = { userAgent: 'Cloudflare-Worker' };
globalThis.WebSocket = class WebSocket { constructor() { this.readyState = 3; } };

console.log('Mega imported:', typeof Mega);
console.log('Keys:', Object.keys(Mega).slice(0, 10));
