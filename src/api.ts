import type { PayMateApi } from '../shared/api';
import { demoApi } from './demo';

/** Inside the installed app the preload script provides the real API; in a plain browser we use synthetic demo data. */
export const api: PayMateApi = window.paymate ?? demoApi;
export const isDemo = !window.paymate;
