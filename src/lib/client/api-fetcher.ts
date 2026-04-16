type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

export async function apiDataFetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | T | null;

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && payload.error
      ? String(payload.error)
      : "Failed to fetch";
    throw new Error(message);
  }

  if (payload && typeof payload === "object" && "success" in payload) {
    if (payload.success === false) {
      throw new Error(payload.error ?? "Request failed");
    }
    return payload.data as T;
  }

  return payload as T;
}
