import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import path from 'path'

function syncPlugin() {
  return {
    name: 'sync-api',
    configureServer(server) {
      server.middlewares.use('/api/sync', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'POST only' }));
          return;
        }

        res.setHeader('Content-Type', 'application/json');

        try {
          // Step 1: Invoke the Lambda
          const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
          const lambda = new LambdaClient({ region: 'ap-southeast-2' });

          console.log('[sync] Invoking Lambda...');
          const invokeResp = await lambda.send(new InvokeCommand({
            FunctionName: 'arn:aws:lambda:ap-southeast-2:598945436007:function:update-runs-geojson',
            InvocationType: 'RequestResponse',
            Payload: Buffer.from('{}'),
          }));

          const payload = invokeResp.Payload
            ? JSON.parse(Buffer.from(invokeResp.Payload).toString())
            : null;

          if (invokeResp.FunctionError) {
            console.error('[sync] Lambda error:', payload);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Lambda failed', detail: payload }));
            return;
          }

          console.log('[sync] Lambda complete. Syncing files...');

          // Step 2: Run sync.sh
          const syncPath = path.resolve('sync.sh');
          const output = execSync(`bash "${syncPath}"`, {
            cwd: path.resolve('.'),
            encoding: 'utf-8',
            timeout: 60000,
            env: { ...process.env },
          });

          console.log('[sync] Sync complete.');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, lambda: payload, sync: output }));
        } catch (err) {
          console.error('[sync] Error:', err.message);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

function shoeOverridePlugin() {
  return {
    name: 'shoe-override-api',
    configureServer(server) {
      server.middlewares.use('/api/shoe-override', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');

        try {
          const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
          const lambda = new LambdaClient({ region: 'ap-southeast-2' });

          // Build the Lambda event from the incoming request
          let body = '';
          if (req.method === 'POST') {
            body = await new Promise((resolve, reject) => {
              let data = '';
              req.on('data', chunk => data += chunk);
              req.on('end', () => resolve(data));
              req.on('error', reject);
            });
          }

          // Parse query string for GET requests
          const url = new URL(req.url, 'http://localhost');
          const queryParams = Object.fromEntries(url.searchParams);

          const event = {
            httpMethod: req.method,
            queryStringParameters: Object.keys(queryParams).length > 0 ? queryParams : null,
            body: body || null,
            headers: { 'Content-Type': 'application/json' },
          };

          const invokeResp = await lambda.send(new InvokeCommand({
            FunctionName: 'arn:aws:lambda:ap-southeast-2:598945436007:function:shoe-update',
            InvocationType: 'RequestResponse',
            Payload: Buffer.from(JSON.stringify(event)),
          }));

          const payload = invokeResp.Payload
            ? JSON.parse(Buffer.from(invokeResp.Payload).toString())
            : null;

          if (invokeResp.FunctionError) {
            console.error('[shoe-override] Lambda error:', payload);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Lambda failed', detail: payload }));
            return;
          }

          // The Lambda returns { statusCode, headers, body }
          res.statusCode = payload.statusCode || 200;
          res.end(payload.body || JSON.stringify(payload));
        } catch (err) {
          console.error('[shoe-override] Error:', err.message);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

function workoutNotesPlugin() {
  return {
    name: 'workout-notes-api',
    configureServer(server) {
      server.middlewares.use('/api/workout-notes', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');

        try {
          const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
          const lambda = new LambdaClient({ region: 'ap-southeast-2' });

          let body = '';
          if (req.method === 'POST') {
            body = await new Promise((resolve, reject) => {
              let data = '';
              req.on('data', chunk => data += chunk);
              req.on('end', () => resolve(data));
              req.on('error', reject);
            });
          }

          const url = new URL(req.url, 'http://localhost');
          const queryParams = Object.fromEntries(url.searchParams);

          const event = {
            httpMethod: req.method,
            queryStringParameters: Object.keys(queryParams).length > 0 ? queryParams : null,
            body: body || null,
            headers: { 'Content-Type': 'application/json' },
          };

          const invokeResp = await lambda.send(new InvokeCommand({
            FunctionName: 'arn:aws:lambda:ap-southeast-2:598945436007:function:workout-update',
            InvocationType: 'RequestResponse',
            Payload: Buffer.from(JSON.stringify(event)),
          }));

          const payload = invokeResp.Payload
            ? JSON.parse(Buffer.from(invokeResp.Payload).toString())
            : null;

          if (invokeResp.FunctionError) {
            console.error('[workout-notes] Lambda error:', payload);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Lambda failed', detail: payload }));
            return;
          }

          res.statusCode = payload.statusCode || 200;
          res.end(payload.body || JSON.stringify(payload));
        } catch (err) {
          console.error('[workout-notes] Error:', err.message);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), syncPlugin(), shoeOverridePlugin(), workoutNotesPlugin()],
})
