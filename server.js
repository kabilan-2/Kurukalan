
'use strict';
const [major,minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('Kurukalan requires Node.js 22.13 or newer. Installed version: ' + process.version);
  console.error('Install a current Node.js LTS version, reopen VS Code, then run npm ci and npm start.');
  process.exit(1);
}
try { require('./backend/server'); }
catch(error) {
  console.error('Kurukalan could not start. Run npm ci in the folder containing package.json.');
  console.error('Error code: ' + (error.code || error.name));
  process.exit(1);
}
