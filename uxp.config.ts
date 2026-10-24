import type { UXP_Config } from "vite-uxp-plugin";
import { version } from "./package.json";

const config: UXP_Config = {
  manifest: {
    id: "com.pritimoy.supremesaucer",
    name: "Supreme Saucer",
    version,
    main: "index.html",
    manifestVersion: 6,
    host: [
      {
        app: "premierePro",
        minVersion: "26.0",
      },
    ],
    entrypoints: [
      {
        type: "panel",
        id: "com.pritimoy.supremesaucer.panel",
        label: {
          default: "Supreme Saucer",
        },
        minimumSize: { width: 300, height: 400 },
        preferredDockedSize: { width: 600, height: 650 },
        preferredFloatingSize: { width: 600, height: 650 },
      },
    ],
    requiredPermissions: {
      localFileSystem: "fullAccess",
      network: {
        domains: [
          "http://127.0.0.1",
          "https://fonts.googleapis.com",
          "https://fonts.gstatic.com",
        ],
      },
      launchProcess: {
        schemes: [],
        extensions: [],
      },
      clipboard: "readAndWrite",
      webview: {
        allow: "yes",
        domains: ["http://127.0.0.1"],
      },
    },
  },
};

export default config;
