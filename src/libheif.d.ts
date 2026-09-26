// libheif-js ships its ES-module wasm bundle without a declaration of its own;
// `shared/media/wasm-still.ts` types the few members it touches.
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: () => unknown;
  export default factory;
}
