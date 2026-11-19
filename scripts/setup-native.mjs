#!/usr/bin/env node
// Generates the native iOS / Android projects with Capacitor and applies Quillpad's
// icons, splash screens and permissions. Safe to run repeatedly.
//
//   node scripts/setup-native.mjs            -> android + ios
//   node scripts/setup-native.mjs android    -> android only
//   node scripts/setup-native.mjs ios        -> ios only
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'resources');
const want = process.argv.slice(2);
const platforms = want.length ? want : ['android', 'ios'];

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

for (const p of platforms) {
  if (!existsSync(join(root, p))) {
    console.log(`\n> Creating the ${p} project`);
    run(`npx cap add ${p}`);
  }
}

// resources are named  <platform>__<folder>__<file>.png
for (const f of readdirSync(res)) {
  const [plat, folder, file] = f.split('__');
  if (!platforms.includes(plat) || !file) continue;
  const dest = plat === 'android'
    ? join(root, 'android/app/src/main/res', folder, file)
    : join(root, 'ios/App/App/Assets.xcassets', folder, file);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(res, f), dest);
}

if (platforms.includes('android')) {
  const bg = join(root, 'android/app/src/main/res/values/ic_launcher_background.xml');
  if (existsSync(bg)) writeFileSync(bg, readFileSync(bg, 'utf8').replace(/#[0-9A-Fa-f]{6}/, '#1B1D44'));
}

if (platforms.includes('ios')) {
  const plist = join(root, 'ios/App/App/Info.plist');
  if (existsSync(plist)) {
    let s = readFileSync(plist, 'utf8');
    const keys = {
      NSPhotoLibraryUsageDescription: 'Quillpad lets you insert photos from your library into your artwork.',
      NSPhotoLibraryAddUsageDescription: 'Quillpad saves your exported artwork and time-lapse videos to your photo library.',
      NSCameraUsageDescription: 'Quillpad can take a photo to use as a reference or layer in your artwork.',
    };
    let add = '';
    for (const [k, v] of Object.entries(keys)) if (!s.includes(`<key>${k}</key>`)) add += `\t<key>${k}</key>\n\t<string>${v}</string>\n`;
    if (!s.includes('<key>UIFileSharingEnabled</key>')) add += '\t<key>UIFileSharingEnabled</key>\n\t<true/>\n\t<key>LSSupportsOpeningDocumentsInPlace</key>\n\t<true/>\n';
    if (add) {
      s = s.replace('\t<key>UILaunchStoryboardName</key>', add + '\t<key>UILaunchStoryboardName</key>');
      writeFileSync(plist, s);
    }
  }
}

console.log('\n> Copying the web app into the native projects');
run(`npx cap sync ${platforms.length === 1 ? platforms[0] : ''}`.trim());
console.log('\nDone. Open with:  npx cap open android   or   npx cap open ios (on a Mac)');
