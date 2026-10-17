/// <reference types="vite/client" />
// ADDED a new interface to define the type for our custom environment variables
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

// ADDED a declaration for ImportMeta to use the new interface
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
