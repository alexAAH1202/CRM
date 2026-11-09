declare global {
  interface Window {
    __emulatorSignIn?: (email: string, displayName?: string) => Promise<void>;
  }
}
export {};
