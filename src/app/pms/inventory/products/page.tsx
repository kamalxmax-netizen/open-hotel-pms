"use client";
import { redirect } from "next/navigation";

export default function ProductsRedirect() {
  redirect("/pms/inventory/settings?tab=products");
}
