/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the map's tiles come from, as an `{z}/{x}/{y}` template.
   *
   * Unset, the map falls back to OpenStreetMap's own servers, which are run on
   * donated hardware and whose policy does not permit application traffic at
   * scale. Anyone running Imadeo for more than themselves should point this at
   * their own tile server or a provider.
   */
  readonly VITE_MAP_TILES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
