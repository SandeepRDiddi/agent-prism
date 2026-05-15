import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: "test", baseURL: "http://127.0.0.1:3000/v1" });
console.log(anthropic.buildRequest({ path: "/messages", method: "post" }).url);
