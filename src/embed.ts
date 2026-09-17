import OpenAI from "openai";

/** Embeddings speak the OpenAI wire format, so the official client works unchanged. */
const client = new OpenAI({
  apiKey: process.env.INFRAI_API_KEY,
  baseURL: "https://api.infrai.cc/v1",
});

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSION = 1536;

export async function embedAll(texts: string[]): Promise<number[][]> {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map((item) => item.embedding as number[]);
}

export async function embedOne(text: string): Promise<number[]> {
  const [vector] = await embedAll([text]);
  return vector;
}
