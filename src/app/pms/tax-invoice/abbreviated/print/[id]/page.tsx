import { redirect } from "next/navigation";

export default function PrintInvoicePage({ params }: { params: { id: string } }) {
  // Agent A wrapper: redirect to the HTML print route
  redirect(`/api/tax-invoice/abbreviated/${params.id}/print`);
}
