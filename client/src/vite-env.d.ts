/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_PASSWORD?: string;
  readonly VITE_DEMO_SUPER_ADMIN_EMAIL?: string;
  readonly VITE_DEMO_SUPER_ADMIN_PASSWORD?: string;
  readonly VITE_SHOW_DEMO_LOGINS?: string;
  readonly VITE_INTRO_MODE?: string;
  readonly VITE_SHOW_PARTNER_ORG_NAME?: string;
}
