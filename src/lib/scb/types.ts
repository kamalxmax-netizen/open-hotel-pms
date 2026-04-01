export type ScbPaymentTargetType = "reservation" | "pos_order";
export type ScbPaymentChannel = "booking_folio" | "mobile_checkin" | "pos";
export type ScbPaymentMode = "outstanding" | "custom";
export type ScbRequestStatus = "pending" | "paid" | "expired" | "cancelled" | "failed" | "unmatched";
export type ScbTransactionStatus = "pending" | "success" | "failed" | "expired";
export type ScbMatchStatus = "matched" | "unmatched" | "ignored" | "duplicate" | "matching";
export type ScbInboxTab = "matched" | "unmatched" | "expired_failed" | "recheck_history";

export type ScbCreateRequestInput = {
  targetType: ScbPaymentTargetType;
  targetId: string;
  channel: ScbPaymentChannel;
  mode: ScbPaymentMode;
  roomAmount: number;
  depositAmount: number;
  expiresMinutes?: number;
  createdBy?: string | null;
  partnerMetaData?: Record<string, unknown>;
};

export type ScbStoredRequest = {
  id: string;
  target_type: ScbPaymentTargetType;
  target_id: string;
  channel: ScbPaymentChannel;
  mode: ScbPaymentMode;
  request_amount_total: number;
  room_amount: number;
  deposit_amount: number;
  status: ScbRequestStatus;
  partner_reference_no: string;
  scb_order_id: string | null;
  wallet_id: string | null;
  scb_ref_1: string | null;
  scb_ref_2: string | null;
  scb_ref_3: string | null;
  qr_payload: string | null;
  qr_image_base64: string | null;
  request_payload: Record<string, unknown> | null;
  provider_raw_response: Record<string, unknown> | null;
  error_message: string | null;
  expires_at: string;
  auto_inquiry_after_expiry_at: string;
  paid_transaction_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ScbCreateQrResult = {
  orderId: string;
  partnerReferenceNo: string;
  walletId: string;
  amount: number;
  qrPayload: string | null;
  qrImageBase64: string | null;
  qrImageUrl: string | null;
  ref1: string | null;
  ref2: string | null;
  ref3: string | null;
  rawResponse: Record<string, unknown>;
};

export type ScbReferenceBundle = {
  ref1: string;
  ref2: string;
  ref3: string;
  partnerReferenceNo: string;
};

export type ScbNormalizedTransaction = {
  transactionId: string;
  orderId: string | null;
  partnerReferenceNo: string | null;
  amount: number;
  currency: string;
  payerName: string | null;
  payerAccount: string | null;
  paymentChannel: string | null;
  status: ScbTransactionStatus;
  paidAt: string | null;
  rawPayload: Record<string, unknown>;
};

export type ScbCallbackIdentifiers = {
  transactionId: string | null;
  orderId: string | null;
  partnerReferenceNo: string | null;
  ref1: string | null;
  ref2: string | null;
  ref3: string | null;
};

export type ScbTargetLookupRow = {
  target_id: string;
  target_code: string;
  guest_name: string | null;
  outstanding_amount?: number;
  total_amount?: number;
  has_pending_request: boolean;
};
