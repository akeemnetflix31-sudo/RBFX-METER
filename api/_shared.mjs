import { Buffer } from 'node:buffer';

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body !== undefined && req.body !== null) return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function vercelHandler(handler) {
  return async function route(req, res) {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const host = req.headers?.host || 'localhost';
      const protocol = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const url = new URL(req.url || '/', `${protocol}://${host}`);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers || {})) {
        if (Array.isArray(value)) value.forEach(item => headers.append(name, String(item)));
        else if (value !== undefined) headers.set(name, String(value));
      }
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
      const request = new Request(url, { method, headers, body });
      const response = await handler(request, { deploy: { context: process.env.VERCEL_ENV || 'production' } });
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      if (method === 'HEAD' || response.status === 204 || response.status === 304) return res.end();
      return res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      // Some Vercel runtimes parse application/json while exposing req.body.
      // A malformed client body must be a 400, never an INTERNAL_ERROR 500.
      const isJson = /^application\/(?:[\w.-]+\+)?json\b/i.test(String(req.headers?.['content-type'] || ''));
      // Vercel's body parser can throw a non-SyntaxError for malformed JSON.
      // Any exception while processing a JSON POST is handled as a bad request;
      // never let the adapter turn a client payload into an HTTP 500.
      const badJsonRequest = isJson && String(req.method || '').toUpperCase() === 'POST';
      if (!badJsonRequest) console.error('RBFX API adapter failed:', error);
      res.statusCode = badJsonRequest ? 400 : 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ ok: false, error: badJsonRequest ? 'INVALID_JSON_OR_REQUEST' : 'INTERNAL_ERROR' }));
    }
  };
}
