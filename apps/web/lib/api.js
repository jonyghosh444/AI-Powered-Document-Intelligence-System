export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function api(path, options) {
  const response = await fetch(`${API_URL}${path}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error || `Request failed (${response.status})`;
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }
  return body;
}
