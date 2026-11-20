const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const standaloneDir = path.join(rootDir, '.next', 'standalone');
const nextStaticSrc = path.join(rootDir, '.next', 'static');
const nextStaticDest = path.join(standaloneDir, '.next', 'static');
const publicSrc = path.join(rootDir, 'public');
const publicDest = path.join(standaloneDir, 'public');

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    const stat = fs.lstatSync(path.join(from, element));
    if (stat.isFile()) {
      fs.copyFileSync(path.join(from, element), path.join(to, element));
    } else if (stat.isDirectory()) {
      copyFolderSync(path.join(from, element), path.join(to, element));
    }
  });
}

console.log('[prepare-standalone] Preparing standalone bundle...');

if (!fs.existsSync(standaloneDir)) {
  console.error('[prepare-standalone] Error: .next/standalone does not exist. Run "next build" first.');
  process.exit(1);
}

// 1. Copy .next/static into .next/standalone/.next/static
if (fs.existsSync(nextStaticSrc)) {
  console.log('[prepare-standalone] Copying .next/static -> .next/standalone/.next/static...');
  copyFolderSync(nextStaticSrc, nextStaticDest);
}

// 2. Copy public into .next/standalone/public
if (fs.existsSync(publicSrc)) {
  console.log('[prepare-standalone] Copying public -> .next/standalone/public...');
  copyFolderSync(publicSrc, publicDest);
}

console.log('[prepare-standalone] Standalone bundle ready for Electron embedding!');

