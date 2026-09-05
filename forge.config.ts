import type { ForgeConfig } from '@electron-forge/shared-types';
import { execFileSync } from 'node:child_process';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Roost',
    asar: true,
    icon: 'assets/Roost',
    extraResource: ['assets', '.pty-dist/node-pty'],
    extendInfo: {
      // Project commands run inside Roost, so Roost is the app macOS asks about
      // when one of them sends an Apple Event. Without this key macOS denies the
      // event and never shows the prompt. `expo start` hits this when it checks
      // whether the iOS Simulator is running.
      NSAppleEventsUsageDescription:
        'Roost runs your project commands. Some of them control other apps, such as the iOS Simulator.',
    },
  },
  rebuildConfig: {},
  hooks: {
    // Packager always writes the icon as electron.icns. macOS caches an app's
    // icon against that path, so a rebuilt electron.icns can keep showing the
    // previous artwork in the Dock. A name of our own gives it a fresh key.
    postPackage: async (_config, result) => {
      if (result.platform !== 'darwin') {
        return;
      }

      for (const output of result.outputPaths) {
        const contents = join(output, 'Roost.app', 'Contents');

        renameSync(join(contents, 'Resources', 'electron.icns'), join(contents, 'Resources', 'Roost.icns'));
        execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIconFile Roost', join(contents, 'Info.plist')]);

        // Prebuilt Electron signs itself as com.github.Electron, and editing
        // Info.plist above invalidates that signature anyway. macOS records a
        // permission grant against the signing identifier, so an unstable one
        // loses the Automation grant on every rebuild.
        execFileSync('/usr/bin/codesign', [
          '--force',
          '--deep',
          '--sign',
          '-',
          '--identifier',
          'com.electron.roost',
          join(output, 'Roost.app'),
        ]);
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
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
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
