const fs = require('fs');
fs.mkdirSync('dist-electron/electron/db', { recursive: true });
fs.copyFileSync('electron/db/schema.sql', 'dist-electron/electron/db/schema.sql');
