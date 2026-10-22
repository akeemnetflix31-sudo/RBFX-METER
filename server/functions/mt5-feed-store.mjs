import { getStore } from './vercel-blob-store.mjs';

export const MT5_FEED_STORE = 'rbfxmeter-market-feed';

export function getMt5FeedStore() {
  return getStore(MT5_FEED_STORE);
}

export async function readLatestMt5Feed() {
  const store = getMt5FeedStore();
  return store.get('latest', { type: 'json' });
}
