'use strict';

const http = require('node:http');
const path = require('node:path');
const { createApplicationRuntime } = require('./runtime.cjs');
const { createStaticHandler } = require('./static.cjs');

const { api, pool } = createApplicationRuntime({ logger: {
  info(message, metadata) { process.stdout.write(`${message} ${JSON.stringify(metadata)}\n`); },
  error(message, metadata) { process.stderr.write(`${message} ${metadata ? JSON.stringify(metadata) : ''}\n`); }
} });
const serveStatic = createStaticHandler({ directory: path.resolve(__dirname, '..', 'dist') });
const staticServer = http.createServer((req, res) => req.url.startsWith('/api/') ? api(req, res) : serveStatic(req, res));
const port = Number(process.env.PORT || 8080);

// Local development is intentionally restricted to this machine until authentication is added.
staticServer.listen(port, '127.0.0.1', () => process.stdout.write(`FranchiseOS listening at http://127.0.0.1:${port}\n`));
process.on('SIGINT', async () => { staticServer.close(); await pool.end(); process.exit(0); });
