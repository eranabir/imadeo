// Metro assumes an app owns its own node_modules. In a Yarn workspace almost
// everything is hoisted to the repo root instead, so without this it resolves
// the entry point from the wrong directory and fails on `./index`.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Source lives under the repo root, so Metro has to watch beyond this package.
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/*
 * Hierarchical lookup stays on.
 *
 * It was disabled here to stop Metro walking up the tree and picking a second
 * copy of react or react-native. With `main` pointing at `expo-router/entry`,
 * turning it off instead stopped Metro finding the entry at all: the router is
 * hoisted to the workspace root, and the explicit `nodeModulesPaths` above are
 * what keep a duplicate react from being picked up anyway.
 */

module.exports = config;
