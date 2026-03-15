import * as React from "react";

type ToastVariant = "default" | "destructive";

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

export function useToast() {
  const toast = React.useCallback((options: ToastOptions) => {
    const title = options.title ?? "";
    const description = options.description ?? "";
    const message = [title, description].filter(Boolean).join(" - ");

    if (options.variant === "destructive") {
      console.error(`[toast:error] ${message}`);
    } else {
      console.info(`[toast] ${message}`);
    }
  }, []);

  return { toast };
}
