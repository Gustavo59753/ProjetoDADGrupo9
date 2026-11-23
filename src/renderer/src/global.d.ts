import type { OficinaApi } from '../../preload';

declare global {
  interface Window {
    oficina: OficinaApi;
  }
}

export {};
