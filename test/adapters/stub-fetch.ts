/** A fetch that records each request and answers with `respond`. */
export function stubFetch(respond: (request: Request) => Response) {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request.clone());
  };
  return { fetch, requests };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
