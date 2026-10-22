import * as NodeHttp from "node:http";

export async function startInference() {
  const requests: Array<{
    url: string;
    headers: NodeHttp.IncomingHttpHeaders;
    body: Record<string, unknown>;
  }> = [];
  let status = 200;
  const server = NodeHttp.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url!, headers: request.headers, body: JSON.parse(body) });
    response.writeHead(status, {
      "content-type": "text/event-stream",
      "x-credential": request.headers.authorization,
    });
    const token = request.headers.authorization ?? request.headers["x-api-key"] ?? "";
    const text = JSON.stringify({ text: "inference completed", echo: token });
    const split = text.length - 8;
    response.write(`data: ${text.slice(0, split)}`);
    response.end(`${text.slice(split)}\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing inference endpoint");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    reject() {
      status = 401;
    },
    async [Symbol.asyncDispose]() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
