'use strict';
const path = require('node:path');
const fs = require('node:fs');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const cliValue = flag => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const CONFIG = {
  PORT: +(cliValue('--port') || process.env.PORT) || 3000,
  HOST: cliValue('--host') || process.env.HOST || '127.0.0.1',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'paddy.db'),
  ADMIN_ID: process.env.ADMIN_ID || 'admin',      // TODO: change before going live
  ADMIN_PASS: process.env.ADMIN_PASS || '',    // TODO: change before going live
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1', // set to 1 when served over HTTPS
  YIELD_KG_PER_HECTARE: 6000,
  CONTAINER_KG: 2500,
  USER_SESSION_DAYS: 30,
  ADMIN_SESSION_HOURS: 8,
  MAX_PHOTO_BYTES: 3 * 1024 * 1024
};
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend');
const SQFT_TO_HA = 9.290304e-6;
const UNITS = { hectare: 107639.1, acre: 43560, veli: 288000, maa: 14400, kuli: 144, cent: 435.6, sqm: 10.7639, sqft: 1 };


module.exports = {CONFIG, PUBLIC_DIR, SQFT_TO_HA, UNITS};
