// The engine is a classic script that hangs itself on window.GK; workers and Node have no window.
globalThis.window = globalThis.window || globalThis;
