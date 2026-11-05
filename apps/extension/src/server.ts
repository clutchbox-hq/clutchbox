import { serverOriginOf } from './origin.ts';

export const serverOrigin = serverOriginOf(import.meta.env.WXT_SERVER_ORIGIN as string | undefined);
