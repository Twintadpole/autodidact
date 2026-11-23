// Runs once, when a tenant's database is first created (mongo image's init step, as root).
// The app gets its own user with access to its own database ("pool") only.
const fs = require('fs');
const pw = fs.readFileSync('/run/gpf/mongo_app_password', 'utf8').trim();
db.getSiblingDB('pool').createUser({ user: 'app', pwd: pw, roles: [{ role: 'readWrite', db: 'pool' }] });
print('GPF: created the app user for database pool');
