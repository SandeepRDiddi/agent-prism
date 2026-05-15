import http from 'http';
import Anthropic from '@anthropic-ai/sdk';

const srv = http.createServer((req, res) => {
  console.log("RECEIVED URL:", req.url);
  res.writeHead(200);
  res.end("{}");
  srv.close();
});
srv.listen(3001, async () => {
  const anthropic = new Anthropic({ apiKey: "test", baseURL: "http://127.0.0.1:3001/v1" });
  await anthropic.messages.create({ model: "test", messages: [{role:"user", content:"hi"}] }).catch(e=>e);
});
