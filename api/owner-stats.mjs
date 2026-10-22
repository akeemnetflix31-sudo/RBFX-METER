import handler from '../server/functions/owner-stats.mjs';
import { vercelHandler } from './_shared.mjs';

export const config = { api: { bodyParser: false } };
export default vercelHandler(handler);
