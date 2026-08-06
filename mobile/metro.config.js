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

// Without this Metro walks up the tree on its own and can pick a second copy
// of react or react-native, which fails at runtime rather than at build time.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
