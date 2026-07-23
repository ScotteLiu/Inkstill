import type { ForgeConfig } from '@electron-forge/shared-types';
import { existsSync } from 'node:fs';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
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
const platformIcon = process.platform === 'darwin'
  ? 'assets/icon.icns'
  : process.platform === 'linux'
    ? 'assets/icon.png'
    : 'assets/icon.ico';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: platformIcon,
    appBundleId: 'io.github.scotteliu.inkstill',
    appCategoryType: 'public.app-category.productivity',
    executableName: 'Inkstill',
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Markdown document',
          CFBundleTypeExtensions: ['md', 'markdown'],
          CFBundleTypeRole: 'Editor',
        },
        {
          CFBundleTypeName: 'Plain text document',
          CFBundleTypeExtensions: ['txt'],
          CFBundleTypeRole: 'Editor',
        },
      ],
    },
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
    new MakerDMG({
      format: 'ULFO',
    }),
    new MakerDeb({
      options: {
        maintainer: 'Scotte Liu',
        homepage: 'https://github.com/ScotteLiu/Inkstill',
        icon: 'assets/icon.png',
      },
    }),
    new MakerRpm({
      options: {
        homepage: 'https://github.com/ScotteLiu/Inkstill',
        icon: 'assets/icon.png',
      },
    }),
    new MakerZIP({}, ['win32', 'darwin', 'linux']),
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
