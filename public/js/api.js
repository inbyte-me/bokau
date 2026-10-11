// Thin fetch wrappers for the local server.

async function req(method, url, body, opts = {}) {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
  const r = await fetch(url, { method, headers: { ...(body && !isRaw ? { 'content-type': 'application/json' } : {}), ...opts.headers }, body: body ? (isRaw ? body : JSON.stringify(body)) : undefined, signal: opts.signal });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) { const e = new Error(data?.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b, o) => req('POST', u, b ?? {}, o),
  put: (u, b) => req('PUT', u, b),
  del: (u) => req('DELETE', u),
  raw: (u, blob, headers) => req('POST', u, blob, { headers }),

  system: () => api.get('/api/system'),
  projects: () => api.get('/api/projects'),
  project: (id) => api.get(`/api/projects/${id}`),
  createProject: (name, mode) => api.post('/api/projects', { name, mode }),
  savedProject: (id, p) => api.put(`/api/projects/${id}`, p),
  deleteProject: (id) => api.del(`/api/projects/${id}`),
  media: (id, name) => `/media/${id}/${name}`,

  /** Upload a source video with progress; resolves with the ingest job id. */
  uploadSource(id, file, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/projects/${id}/source`);
      x.setRequestHeader('x-filename', encodeURIComponent(file.name).replace(/%/g, ''));
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => { try { const d = JSON.parse(x.responseText); x.status < 300 ? resolve(d.job) : reject(new Error(d.error || x.status)); } catch (e) { reject(e); } };
      x.onerror = () => reject(new Error('upload failed'));
      x.send(file);
    });
  },
  async waitJob(jobId, onProgress, { intervalMs = 400 } = {}) {
    for (;;) {
      const j = await api.get(`/api/jobs/${jobId}`);
      onProgress?.(j);
      if (j.status === 'done') return j.result;
      if (j.status === 'error') throw new Error(j.error || 'job failed');
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  },
};
