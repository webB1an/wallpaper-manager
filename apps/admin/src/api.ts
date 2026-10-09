export const API = import.meta.env.VITE_API_BASE_URL || "";

export function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("wm_token");
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.code !== 200) throw new Error(body.message || body.error || "请求失败");
    return body.data as T;
  });
}
