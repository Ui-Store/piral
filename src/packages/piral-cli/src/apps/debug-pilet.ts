import * as Bundler from 'parcel-bundler';
import chalk from 'chalk';
import { join, dirname, resolve } from 'path';
import { readKrasConfig, krasrc, buildKrasWithCli, defaultConfig } from 'kras';
import {
  retrievePiletData,
  clearCache,
  setStandardEnvs,
  extendConfig,
  extendBundlerWithPlugins,
  liveIcon,
  settingsIcon,
  extendBundlerForPilet,
  modifyBundlerForPilet,
  postProcess,
  debugPiletApi,
  openBrowser,
  findEntryModule,
} from '../common';

export interface DebugPiletOptions {
  logLevel?: 1 | 2 | 3;
  cacheDir?: string;
  entry?: string;
  app?: string;
  fresh?: boolean;
  open?: boolean;
  port?: number;
  scopeHoist?: boolean;
  hmr?: boolean;
  autoInstall?: boolean;
}

export const debugPiletDefaults = {
  logLevel: 3 as const,
  cacheDir: '.cache',
  entry: './src/index',
  fresh: false,
  open: false,
  port: 1234,
  scopeHoist: false,
  hmr: true,
  autoInstall: true,
};

const injectorName = resolve(__dirname, '../injectors/pilet.js');

export async function debugPilet(baseDir = process.cwd(), options: DebugPiletOptions = {}) {
  const {
    entry = debugPiletDefaults.entry,
    port = debugPiletDefaults.port,
    cacheDir = debugPiletDefaults.cacheDir,
    open = debugPiletDefaults.open,
    scopeHoist = debugPiletDefaults.scopeHoist,
    hmr = debugPiletDefaults.hmr,
    autoInstall = debugPiletDefaults.autoInstall,
    logLevel = debugPiletDefaults.logLevel,
    fresh = debugPiletDefaults.fresh,
    app,
  } = options;
  const entryFile = join(baseDir, entry);
  const targetDir = dirname(entryFile);
  const entryModule = await findEntryModule(entryFile, targetDir);
  const { peerDependencies, root, appPackage, appFile } = await retrievePiletData(targetDir, app);
  const externals = Object.keys(peerDependencies);
  const krasConfig = readKrasConfig({ port }, krasrc);

  if (krasConfig.directory === undefined) {
    krasConfig.directory = join(targetDir, 'mocks');
  }

  if (krasConfig.ssl === undefined) {
    krasConfig.ssl = undefined;
  }

  if (krasConfig.map === undefined) {
    krasConfig.map = {};
  }

  if (krasConfig.api === undefined) {
    krasConfig.api = '/manage-mock-server';
  }

  if (krasConfig.injectors === undefined) {
    krasConfig.injectors = defaultConfig.injectors;
  }

  if (fresh) {
    await clearCache(root, cacheDir);
  }

  await setStandardEnvs({
    target: targetDir,
    piral: appPackage.name,
    dependencies: externals,
  });

  modifyBundlerForPilet(Bundler.prototype, externals, targetDir);

  const bundler = new Bundler(
    entryModule,
    extendConfig({
      logLevel,
      hmr: false,
      minify: true,
      scopeHoist,
      publicUrl: './',
      cacheDir,
      autoInstall,
    }),
  );

  const api = debugPiletApi;
  const injectorConfig = {
    active: true,
    bundler,
    port,
    root,
    app: dirname(appFile),
    handle: ['/', api],
    api,
  };

  extendBundlerForPilet(bundler);
  extendBundlerWithPlugins(bundler);

  bundler.on('bundled', async bundle => {
    await postProcess(bundle);

    if (hmr) {
      (bundler as any).emit('bundle-ready');
    }
  });

  krasConfig.map['/'] = '';
  krasConfig.map[api] = '';

  krasConfig.injectors = {
    script: krasConfig.injectors.script || {
      active: true,
    },
    [injectorName]: injectorConfig,
    ...krasConfig.injectors,
  };

  const krasServer = buildKrasWithCli(krasConfig);
  krasServer.removeAllListeners('open');

  krasServer.on('open', svc => {
    const address = `${svc.protocol}://localhost:${chalk.green(svc.port)}`;
    console.log(`${liveIcon}  Running at ${chalk.bold(address)}.`);
    console.log(`${settingsIcon}  Manage via ${chalk.bold(address + krasConfig.api)}.`);
    bundler.bundle();
  });

  await krasServer.start();
  openBrowser(open, port);
  await new Promise(resolve => krasServer.on('close', resolve));
}
