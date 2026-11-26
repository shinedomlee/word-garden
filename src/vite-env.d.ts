/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'hyphen/en-us/index.js' {
  const hyphen: {
    hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string
  }
  export default hyphen
}
