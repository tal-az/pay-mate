import type { PayMateApi } from '../shared/api';
import { browserApi } from './web/browserApi';
import { demoApi } from './demo';

/**
 * Three ways to run: inside the installed desktop app the preload script provides the API (SQLite); on the website
 * the browser stores everything in IndexedDB; with ?demo the screens show synthetic data and save nothing.
 */
const wantsDemo = new URLSearchParams(window.location.search).has('demo');

export const api: PayMateApi = window.paymate ?? (wantsDemo ? demoApi : browserApi);
export const isDemo = !window.paymate && wantsDemo;
export const isDesktop = !!window.paymate?.desktop;
