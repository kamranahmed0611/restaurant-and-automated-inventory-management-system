const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  const appOutDir = context.appOutDir;
  const projectDir = context.packager.projectDir;
  
  const appServerNodeModules = path.join(appOutDir, 'resources', 'app-server', 'node_modules');
  const standaloneNodeModules = path.join(projectDir, '.next', 'standalone', 'node_modules');

  console.log('[afterPack] Checking standalone node_modules bundling...');
  if (!fs.existsSync(appServerNodeModules) && fs.existsSync(standaloneNodeModules)) {
    console.log(`[afterPack] Copying standalone node_modules to ${appServerNodeModules}...`);
    fs.cpSync(standaloneNodeModules, appServerNodeModules, { recursive: true });
    console.log('[afterPack] Standalone node_modules successfully bundled into app-server!');
  } else if (fs.existsSync(appServerNodeModules)) {
    console.log('[afterPack] Standalone node_modules already present in app-server.');
  } else {
    console.warn('[afterPack] Warning: standalone node_modules not found at', standaloneNodeModules);
  }
};

