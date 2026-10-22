import handler from '../server/functions/mt5-feed.mjs';
import { vercelHandler } from './_shared.mjs';

export const config = { api: { bodyParser: false } };
export default vercelHandler(handler);
