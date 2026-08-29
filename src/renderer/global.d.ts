import type { RoostApi } from '../preload';

declare global {
    interface Window {
        roost: RoostApi;
    }
}

export {};
