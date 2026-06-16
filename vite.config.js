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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), syncPlugin()],
})
