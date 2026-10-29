'use strict';
// Loading config reads .env before selecting the database.
require('./config');
if (process.env.REQUIRE_CLOUD_DATABASE === '1' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for cloud deployment. Local database fallback is disabled.');
}
module.exports = process.env.DATABASE_URL ? require('./postgres') : require('./sqlite');
