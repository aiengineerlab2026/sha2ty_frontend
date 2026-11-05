import { useSyncExternalStore } from "react";

/** The Sha2ty mobile app's browser view (mobile/src/app/edit-model.tsx), when this page runs inside it. */
export const appView = () => (typeof window === "undefined" ? undefined : (window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }).ReactNativeWebView);

const noSubscribe = () => () => undefined;
/** True inside the mobile app (false while rendering on the server, so the first render matches). */
export const useInApp = () => useSyncExternalStore(noSubscribe, () => Boolean(appView()), () => false);
