interface ImportMetaEnv {
  readonly VITE_API_ENV?: "dev" | "local";
  readonly VITE_API_BASE_URL_DEV?: string;
  readonly VITE_API_BASE_URL_LOCAL?: string;
  /**
   * Override invoice PDF stream path. Use `{id}` placeholder, e.g.
   * `/api/v1/invoices/{id}/download` when the API has no `/pdf` route.
   */
  readonly VITE_INVOICE_PDF_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
