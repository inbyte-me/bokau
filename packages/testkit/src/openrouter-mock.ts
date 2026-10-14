import http from 'node:http';

/** A fake OpenRouter for tests: records every request and answers with `handler`. Tests cost nothing. */
export type MockReq = { headers: http.IncomingHttpHeaders; body: any; url?: string };
export async function mockOpenRouter(handler: (body: any, n: number) => { status?: number; json: unknown }) {
  const reqs: MockReq[] = [];
  const srv = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    reqs.push({ headers: req.headers, body, url: req.url });
    let out: { status?: number; json: unknown };
    try {
      out = handler(body, reqs.length);
    } catch (e) {
      out = { status: 500, json: { error: { message: `mock handler failed: ${e instanceof Error ? e.message : String(e)}` } } };
    }
    res.writeHead(out.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.json));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return {
    reqs,
    url: `http://127.0.0.1:${(srv.address() as import('node:net').AddressInfo).port}`,
    close: () =>
      new Promise((r) => {
        srv.closeAllConnections();
        srv.close(r);
      }),
  };
}
