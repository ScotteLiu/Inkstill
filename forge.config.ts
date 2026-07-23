import type { ForgeConfig } from '@electron-forge/shared-types';
import { existsSync } from 'node:fs';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const windowsSign = process.env.WINDOWS_CERTIFICATE_FILE && process.env.WINDOWS_CERTIFICATE_PASSWORD
  ? {
      certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
      certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
    }
  : undefined;
const projectLegalFiles = ['LICENSE', 'EULA.md', 'EULA.txt'].filter((file) => existsSync(file));

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'assets/icon.ico',
    extraResource: [
      'release/sbom.cdx.json',
      'release/THIRD_PARTY_LICENSES.md',
      'release/build-manifest.json',
      ...projectLegalFiles,
    ],
    ...(windowsSign ? { windowsSign } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: 'assets/icon.ico',
      ...(windowsSign ? { windowsSign } : {}),
    }),
    new MakerZIP({}, ['win32', 'darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      strictlyRequireAllFuses: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      [FuseV1Options.WasmTrapHandlers]: true,
    }),
  ],
};

export default config;
