import { get, list, put } from '@vercel/blob';

/** Minimal JSON-object adapter backed by one private Vercel Blob store. */
export function getStore(name) {
  const prefix = `${String(name).replace(/^\/+|\/+$/g, '')}/`;
  const pathname = key => `${prefix}${String(key).replace(/^\/+/, '')}`;

  return {
    async get(key, options = {}) {
      const result = await get(pathname(key), { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const text = await new Response(result.stream).text();
      return options.type === 'json' ? JSON.parse(text) : text;
    },

    async getWithMetadata(key, options = {}) {
      const result = await get(pathname(key), { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const text = await new Response(result.stream).text();
      return {
        data: options.type === 'json' ? JSON.parse(text) : text,
        etag: result.blob.etag,
        pathname: result.blob.pathname
      };
    },

    async setJSON(key, value, conditions = {}) {
      // Vercel Blob has no atomic conditional PUT. Check the observed revision before
      // writing; callers use this for best-effort anonymous analytics, never feed integrity.
      if (conditions.onlyIfMatch || conditions.onlyIfNew) {
        const current = await this.getWithMetadata(key, { type: 'json' });
        if (conditions.onlyIfNew && current) return { modified: false, etag: current.etag };
        if (conditions.onlyIfMatch && current?.etag !== conditions.onlyIfMatch) return { modified: false, etag: current?.etag };
      }
      const blob = await put(pathname(key), JSON.stringify(value), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json; charset=utf-8'
      });
      return { modified: true, etag: blob.etag };
    },

    async list({ prefix: keyPrefix = '' } = {}) {
      const blobs = [];
      let cursor;
      do {
        const page = await list({ prefix: pathname(keyPrefix), limit: 250, cursor });
        for (const blob of page.blobs || []) {
          blobs.push({ key: blob.pathname.slice(prefix.length), etag: blob.etag, uploadedAt: blob.uploadedAt });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return { blobs };
    }
  };
}
