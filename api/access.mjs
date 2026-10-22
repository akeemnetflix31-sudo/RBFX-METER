import handler from '../server/functions/access.mjs';
import { vercelHandler } from './_shared.mjs';

export const config = { api: { bodyParser: false } };
export default vercelHandler(handler);
