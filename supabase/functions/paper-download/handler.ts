interface DownloadConfig {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function createPaperDownloadHandler(config: DownloadConfig) {
  const request = config.fetch ?? fetch;
  const base = config.supabaseUrl.replace(/\/$/, '');
  const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return fail(405, 'Method not allowed');
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return fail(401, 'Authentication required');
    try {
      const { paperId } = await req.json();
      if (typeof paperId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(paperId)) {
        return fail(400, 'Invalid paper ID');
      }
      const userHeaders = { Authorization: authorization, apikey: config.anonKey };
      const user = await request(`${base}/auth/v1/user`, { headers: userHeaders });
      if (!user.ok) return fail(401, 'Authentication required');

      // Check permissions using the caller's JWT before any privileged request.
      const permitted = await request(`${base}/rest/v1/rpc/read_papers?id=eq.${paperId}&select=id,file_url`, {
        method: 'POST', headers: { ...userHeaders, 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!permitted.ok) return fail(403, 'Paper unavailable');
      const visible = await permitted.json();
      if (!Array.isArray(visible) || visible.length !== 1 || visible[0].file_url !== `blind:${paperId}`) {
        return fail(403, 'Paper unavailable');
      }

      const serviceHeaders = { Authorization: `Bearer ${config.serviceRoleKey}`, apikey: config.serviceRoleKey };
      const paperResponse = await request(`${base}/rest/v1/papers?id=eq.${paperId}&select=file_url`, { headers: serviceHeaders });
      if (!paperResponse.ok) return fail(404, 'File unavailable');
      const papers = await paperResponse.json();
      let path = papers[0]?.file_url;
      if (typeof path !== 'string' || !path) return fail(404, 'File unavailable');
      if (/^https?:\/\//i.test(path)) {
        const legacyPrefix = `${base}/storage/v1/object/public/paper-files/`;
        if (!path.startsWith(legacyPrefix)) return fail(422, 'Anonymous review requires a PDF uploaded to this application');
        path = decodeURIComponent(path.slice(legacyPrefix.length));
      }
      if (path.split('/').some((segment: string) => !segment || segment === '.' || segment === '..')) {
        return fail(404, 'File unavailable');
      }
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      const file = await request(`${base}/storage/v1/object/authenticated/paper-files/${encodedPath}`, {
        headers: serviceHeaders, redirect: 'error',
      });
      if (!file.ok) return fail(404, 'File unavailable');
      // Do not forward storage headers, redirects, object names, or signed URLs.
      return new Response(file.body, {
        headers: {
          ...cors, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
          'Content-Disposition': 'inline; filename="review-paper.pdf"',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return fail(400, 'Unable to download paper');
    }
  };
}
