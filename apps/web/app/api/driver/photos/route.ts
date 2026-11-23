import { addPhoto } from '@snow/server';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Multipart: clientUuid, stopId, photo (file). Idempotent by clientUuid. */
export const POST = api(['driver'], async (user, req) => {
  const form = await req.formData();
  const file = form.get('photo');
  if (!(file instanceof Blob)) throw new Error('Photo file is missing');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return addPhoto(user, { clientUuid: String(form.get('clientUuid')), stopId: String(form.get('stopId')), contentType: file.type || 'image/jpeg' }, bytes);
});
