"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
    ShoppingCartIcon, PlusIcon, MinusIcon, Trash2Icon,
    RefreshCwIcon, CreditCardIcon, BanknoteIcon,
    ArrowRightLeftIcon, UserIcon, XIcon, CheckIcon
} from "lucide-react";
import { Product, PosOrder } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/* ── Helpers ── */

type ApiResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
    success?: boolean;
    error?: string;
} & T;

async function readJsonSafe<T extends Record<string, unknown>>(response: Response): Promise<ApiResponse<T>> {
    try {
        return (await response.json()) as ApiResponse<T>;
    } catch {
        return {} as ApiResponse<T>;
    }
}

interface CartItem {
    product_id: string;
    product_name: string;
    unit_price: number;
    quantity: number;
    unit: string;
}

interface InHouseReservation {
    id: string;
    guest_name: string;
    room_number: string;
    room_label?: string;
    check_in: string;
    check_out: string;
    status: string;
    deposit_amount?: number;
}

interface PosCreateOrderResult {
    order_id?: string;
    order_number?: string;
    subtotal?: number | string;
    total?: number | string;
    deposit_used_amount?: number | string;
    remaining_paid_amount?: number | string;
    room_number?: string | null;
}

interface CompletedSaleSummary {
    order: PosOrder;
    items: Array<CartItem & { line_total: number }>;
    room_number: string | null;
    payment_summary: string;
}

/* ── Component ── */

export default function PosTerminalPage() {
    const { toast } = useToast();

    // Products
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [productSearch, setProductSearch] = useState("");

    // Cart
    const [cart, setCart] = useState<CartItem[]>([]);
    const [orderType, setOrderType] = useState<"walkin" | "guest_charge">("walkin");
    const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "credit_card">("cash");
    const [orderNote, setOrderNote] = useState("");

    // Guest charge
    const [guestSearch, setGuestSearch] = useState("");
    const [reservations, setReservations] = useState<InHouseReservation[]>([]);
    const [selectedReservation, setSelectedReservation] = useState<InHouseReservation | null>(null);
    const [isSearchingGuests, setIsSearchingGuests] = useState(false);

    // Completion
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [completedSale, setCompletedSale] = useState<CompletedSaleSummary | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // ── Fetch products ──
    const fetchProducts = useCallback(async () => {
        try {
            setIsLoading(true);
            const res = await fetch("/api/products?for_sale=true&is_active=true");
            const data = await readJsonSafe<{ products?: Product[] }>(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to load products");
            }
            setProducts(Array.isArray(data.products) ? data.products : []);
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to load products",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchProducts(); }, [fetchProducts]);

    // ── Search reservations ──
    const searchReservations = useCallback(async (query: string) => {
        if (query.length < 1) {
            setReservations([]);
            return;
        }
        try {
            setIsSearchingGuests(true);
            const res = await fetch(`/api/pos/reservations?q=${encodeURIComponent(query)}`);
            const data = await readJsonSafe<{ reservations?: InHouseReservation[] }>(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to search reservations");
            }
            setReservations(Array.isArray(data.reservations) ? data.reservations : []);
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to search",
                variant: "destructive",
            });
        } finally {
            setIsSearchingGuests(false);
        }
    }, [toast]);

    // Debounced guest search
    useEffect(() => {
        if (orderType !== "guest_charge") return;
        const timer = setTimeout(() => {
            if (guestSearch.trim().length >= 1) {
                searchReservations(guestSearch.trim());
            } else {
                setReservations([]);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [guestSearch, orderType, searchReservations]);

    // ── Cart operations ──
    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(i => i.product_id === product.id);
            if (existing) {
                return prev.map(i =>
                    i.product_id === product.id
                        ? { ...i, quantity: i.quantity + 1 }
                        : i
                );
            }
            return [...prev, {
                product_id: product.id,
                product_name: product.name,
                unit_price: product.sale_price ?? 0,
                quantity: 1,
                unit: product.unit,
            }];
        });
    };

    const updateQuantity = (productId: string, delta: number) => {
        setCart(prev => prev
            .map(i => i.product_id === productId
                ? { ...i, quantity: Math.max(0, i.quantity + delta) }
                : i
            )
            .filter(i => i.quantity > 0)
        );
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(i => i.product_id !== productId));
    };

    const clearCart = () => {
        setCart([]);
        setOrderNote("");
        setSelectedReservation(null);
        setGuestSearch("");
        setReservations([]);
        setSubmitError(null);
    };

    const resetForNextSale = (clearSummary = true) => {
        setCart([]);
        setOrderType("walkin");
        setPaymentMethod("cash");
        setOrderNote("");
        setSelectedReservation(null);
        setGuestSearch("");
        setReservations([]);
        setProductSearch("");
        setSubmitError(null);
        if (clearSummary) {
            setCompletedSale(null);
        }
    };

    // ── Derived ──
    const subtotal = useMemo(() => cart.reduce((sum, i) => sum + i.unit_price * i.quantity, 0), [cart]);
    const total = subtotal; // No tax/discount for now
    const depositHeld = Number(selectedReservation?.deposit_amount ?? 0);
    const depositApplied = orderType === "guest_charge"
        ? Math.min(total, Math.max(0, depositHeld))
        : 0;
    const remainingAfterDeposit = Math.max(0, total - depositApplied);

    const filteredProducts = useMemo(() => {
        if (!productSearch.trim()) return products;
        const q = productSearch.toLowerCase();
        return products.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.sku && p.sku.toLowerCase().includes(q))
        );
    }, [products, productSearch]);

    const canSubmit = cart.length > 0 && !isSubmitting;

    const roomDepositHint = orderType !== "guest_charge"
        ? null
        : !selectedReservation
          ? "Select a room first."
          : depositHeld <= 0
            ? "No deposit available for this room."
            : remainingAfterDeposit > 0
              ? `Deposit will cover ${depositApplied.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB and the remaining ${remainingAfterDeposit.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB will be paid by ${paymentMethod === "credit_card" ? "card" : paymentMethod}.`
              : `Deposit will cover the full ${depositApplied.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB.`;

    // ── Submit order ──
    const handleSubmit = async () => {
        if (!canSubmit) return;
        try {
            setSubmitError(null);
            const submittedCart = cart.map((item) => ({ ...item }));
            const submittedOrderType = orderType;
            const submittedPaymentMethod = paymentMethod;
            const submittedReservation = selectedReservation;
            const submittedNote = orderNote.trim();
            const submittedSubtotal = submittedCart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

            setIsSubmitting(true);
            const payload: Record<string, unknown> = {
                order_type: submittedOrderType,
                items: submittedCart.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
                created_by: "Front Desk",
                note: submittedNote || undefined,
            };

            if (submittedOrderType === "walkin") {
                payload.payment_method = submittedPaymentMethod;
            } else if (submittedOrderType === "guest_charge") {
                if (!submittedReservation) {
                    throw new Error("Select a room before using Paid by Deposit.");
                }
                const availableDeposit = Math.max(0, Number(submittedReservation.deposit_amount ?? 0));
                if (availableDeposit <= 0) {
                    throw new Error("No deposit available for the selected room.");
                }
                payload.reservation_id = submittedReservation.id;
                payload.deposit_amount = Math.min(
                    submittedSubtotal,
                    availableDeposit
                );
                const remainder = Math.max(
                    0,
                    submittedSubtotal - Math.min(submittedSubtotal, availableDeposit)
                );
                if (remainder > 0) {
                    payload.payment_method = submittedPaymentMethod;
                }
            }

            const res = await fetch("/api/pos/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await readJsonSafe<{ order?: PosOrder; result?: PosCreateOrderResult }>(res);

            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to create order");
            }

            const result = (typeof data.result === "object" && data.result !== null)
                ? (data.result as PosCreateOrderResult)
                : null;
            const fallbackOrderId = typeof result?.order_id === "string" ? result.order_id : "";
            const fallbackOrderNumber = typeof result?.order_number === "string" ? result.order_number : "";
            const fallbackSubtotal = Number(result?.subtotal ?? submittedSubtotal);
            const fallbackTotal = Number(result?.total ?? submittedSubtotal);
            const depositUsedAmount = Number(result?.deposit_used_amount ?? 0);
            const remainingPaidAmount = Number(result?.remaining_paid_amount ?? submittedSubtotal);
            const nowIso = new Date().toISOString();
            const fallbackOrderDate = nowIso.slice(0, 10);

            const order: PosOrder | null = data.order ?? (
                fallbackOrderId && fallbackOrderNumber
                    ? {
                        id: fallbackOrderId,
                        order_number: fallbackOrderNumber,
                        order_type: submittedOrderType,
                        reservation_id: submittedOrderType === "guest_charge" ? submittedReservation?.id ?? null : null,
                        guest_name: submittedOrderType === "guest_charge" ? submittedReservation?.guest_name ?? null : null,
                        status: "completed",
                        subtotal: Number.isFinite(fallbackSubtotal) ? fallbackSubtotal : submittedSubtotal,
                        total: Number.isFinite(fallbackTotal) ? fallbackTotal : submittedSubtotal,
                        payment_method: submittedOrderType === "walkin" ? submittedPaymentMethod : null,
                        note: submittedNote || null,
                        created_by: "Front Desk",
                        order_date: fallbackOrderDate,
                        created_at: nowIso,
                        updated_at: nowIso,
                    }
                    : null
            );

            if (!order) {
                throw new Error("Order created but response payload is missing order details.");
            }

            const summaryItems = submittedCart.map((item) => ({
                ...item,
                line_total: item.unit_price * item.quantity,
            }));

            resetForNextSale(false);
            const paymentSummary = submittedOrderType === "walkin"
                ? submittedPaymentMethod === "credit_card"
                    ? "Card"
                    : submittedPaymentMethod === "transfer"
                      ? "Transfer"
                      : "Cash"
                : remainingPaidAmount > 0
                  ? `Paid by Deposit + ${submittedPaymentMethod === "credit_card" ? "Card" : submittedPaymentMethod === "transfer" ? "Transfer" : "Cash"}`
                  : depositUsedAmount > 0
                    ? "Paid by Deposit"
                    : "Room Settlement";
            setCompletedSale({
                order,
                items: summaryItems,
                room_number: submittedOrderType === "guest_charge" ? submittedReservation?.room_number ?? null : null,
                payment_summary: paymentSummary,
            });

            toast({ title: "Sale Completed!", description: `Order ${order.order_number} created successfully.` });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to create order";
            setSubmitError(message);
            toast({
                title: "Error",
                description: message,
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Success dialog ──
    if (completedSale) {
        return (
            <div className="p-6 max-w-2xl mx-auto mt-8">
                <div className="card py-8 px-6">
                    <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                        <CheckIcon className="w-8 h-8 text-emerald-600" />
                    </div>
                    <h2 className="text-2xl font-extrabold text-[var(--text-primary)] mb-1 text-center">Sale Complete!</h2>
                    <p className="text-sm text-[var(--text-secondary)] mb-4 text-center">Order #{completedSale.order.order_number}</p>
                    <div className="bg-[var(--bg-body)] rounded-xl p-4 mb-4">
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-[var(--text-secondary)]">Type</span>
                            <Badge variant={completedSale.order.order_type === "walkin" ? "default" : "secondary"}>
                                {completedSale.order.order_type === "walkin" ? "Walk-in" : "Room Deposit"}
                            </Badge>
                        </div>
                        {completedSale.order.guest_name && (
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-[var(--text-secondary)]">Guest</span>
                                <span className="font-medium">{completedSale.order.guest_name}</span>
                            </div>
                        )}
                        {completedSale.room_number && (
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-[var(--text-secondary)]">Room</span>
                                <span className="font-medium">{completedSale.room_number}</span>
                            </div>
                        )}
                        {completedSale.payment_summary && (
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-[var(--text-secondary)]">Payment</span>
                                <span className="font-medium">{completedSale.payment_summary}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-[var(--text-secondary)]">Subtotal</span>
                            <span className="font-semibold">{completedSale.order.subtotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-[var(--text-secondary)]">Total</span>
                            <span className="text-lg font-extrabold text-brand-600">{completedSale.order.total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB</span>
                        </div>
                    </div>

                    <div className="border border-[var(--border-default)] rounded-xl overflow-hidden mb-4">
                        <div className="bg-[var(--bg-body)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                            Sold Items
                        </div>
                        <div className="divide-y divide-slate-100">
                            {completedSale.items.map((item) => (
                                <div key={item.product_id} className="px-4 py-3 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{item.product_name}</p>
                                        <p className="text-xs text-[var(--text-secondary)]">
                                            {item.quantity} x {item.unit_price.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB
                                        </p>
                                    </div>
                                    <p className="text-sm font-bold text-slate-800">
                                        {item.line_total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {completedSale.order.note && (
                        <p className="text-sm text-[var(--text-secondary)] mb-4">
                            <span className="font-semibold text-[var(--text-table-cell)]">Note:</span> {completedSale.order.note}
                        </p>
                    )}

                    <Button onClick={() => resetForNextSale()} className="w-full bg-brand-600 hover:bg-brand-700 text-white">
                        New Sale
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">Point of Sale</p>
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">New Sale</h1>
                    <Button variant="outline" size="sm" onClick={fetchProducts} disabled={isLoading}>
                        <RefreshCwIcon className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Order Type Toggle */}
            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => { setOrderType("walkin"); setSelectedReservation(null); setGuestSearch(""); }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
                        orderType === "walkin"
                            ? "border-brand-600 bg-brand-50 text-brand-700"
                            : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                    }`}
                >
                    <BanknoteIcon className="w-4 h-4 inline mr-1.5" />
                    Walk-in Sale
                </button>
                <button
                    onClick={() => setOrderType("guest_charge")}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
                        orderType === "guest_charge"
                            ? "border-brand-600 bg-brand-50 text-brand-700"
                            : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                    }`}
                >
                    <UserIcon className="w-4 h-4 inline mr-1.5" />
                    Room Deposit
                </button>
            </div>

            {/* Main Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Product Grid — Left */}
                <div className="lg:col-span-3">
                    <div className="card p-4">
                        {/* Search */}
                        <div className="relative mb-4">
                            <Input
                                placeholder="Search products..."
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                            />
                        </div>

                        {/* Product Cards */}
                        {isLoading ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {Array.from({ length: 8 }).map((_, i) => (
                                    <div key={i} className="animate-pulse rounded-xl bg-[var(--bg-muted)] h-28" />
                                ))}
                            </div>
                        ) : filteredProducts.length === 0 ? (
                            <div className="text-center py-12 text-[var(--text-muted)]">
                                <ShoppingCartIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No products found</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {filteredProducts.map((product) => {
                                    const inCart = cart.find(c => c.product_id === product.id);
                                    return (
                                        <button
                                            key={product.id}
                                            onClick={() => addToCart(product)}
                                            className={`relative text-left rounded-xl border-2 p-3 transition-all hover:shadow-md ${
                                                inCart
                                                    ? "border-brand-500 bg-brand-50"
                                                    : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-brand-300"
                                            }`}
                                        >
                                            {inCart && (
                                                <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
                                                    {inCart.quantity}
                                                </span>
                                            )}
                                            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{product.name}</p>
                                            {product.sku && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{product.sku}</p>}
                                            <p className="text-lg font-extrabold text-brand-600 mt-2">
                                                {(product.sale_price ?? 0).toLocaleString("th-TH")}
                                                <span className="text-xs font-normal text-[var(--text-muted)] ml-0.5">THB</span>
                                            </p>
                                            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">per {product.unit}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Cart — Right */}
                <div className="lg:col-span-2">
                    <div className="card p-4 lg:sticky lg:top-4">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                                <ShoppingCartIcon className="w-5 h-5" />
                                Cart
                                {cart.length > 0 && (
                                    <Badge variant="secondary" className="text-xs">{cart.length}</Badge>
                                )}
                            </h2>
                            {cart.length > 0 && (
                                <Button variant="ghost" size="sm" onClick={clearCart} className="text-[var(--text-muted)] hover:text-red-500">
                                    <Trash2Icon className="w-4 h-4" />
                                </Button>
                            )}
                        </div>

                        {/* Cart Items */}
                        {cart.length === 0 ? (
                            <div className="text-center py-8 text-[var(--text-muted)]">
                                <ShoppingCartIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">Add products to cart</p>
                            </div>
                        ) : (
                            <div className="space-y-2 mb-4 max-h-[40vh] overflow-y-auto">
                                {cart.map((item) => (
                                    <div key={item.product_id} className="flex items-center justify-between bg-[var(--bg-body)] rounded-lg p-2.5">
                                        <div className="flex-1 min-w-0 mr-2">
                                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{item.product_name}</p>
                                            <p className="text-xs text-[var(--text-muted)]">
                                                {item.unit_price.toLocaleString("th-TH")} x {item.quantity} = {(item.unit_price * item.quantity).toLocaleString("th-TH")}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => updateQuantity(item.product_id, -1)}
                                                className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
                                            >
                                                <MinusIcon className="w-3.5 h-3.5" />
                                            </button>
                                            <span className="w-7 text-center text-sm font-semibold">{item.quantity}</span>
                                            <button
                                                onClick={() => updateQuantity(item.product_id, 1)}
                                                className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
                                            >
                                                <PlusIcon className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => removeFromCart(item.product_id)}
                                                className="w-7 h-7 flex items-center justify-center rounded-md text-red-400 hover:bg-red-50 ml-1"
                                            >
                                                <XIcon className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Totals */}
                        {cart.length > 0 && (
                            <div className="border-t border-[var(--border-default)] pt-3 mb-4">
                                <div className="flex justify-between text-sm text-[var(--text-secondary)] mb-1">
                                    <span>Subtotal</span>
                                    <span>{subtotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between text-lg font-extrabold text-[var(--text-primary)]">
                                    <span>Total</span>
                                    <span className="text-brand-600">{total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB</span>
                                </div>
                            </div>
                        )}

                        {/* Note */}
                        {cart.length > 0 && (
                            <Input
                                placeholder="Note (optional)"
                                value={orderNote}
                                onChange={(e) => setOrderNote(e.target.value)}
                                className="mb-4 text-sm"
                            />
                        )}

                        {/* Payment Method (Walk-in) */}
                        {orderType === "walkin" && cart.length > 0 && (
                            <div className="mb-4">
                                <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-2">Payment Method</p>
                                <div className="grid grid-cols-3 gap-2">
                                    {([
                                        { value: "cash", label: "Cash", icon: BanknoteIcon },
                                        { value: "transfer", label: "Transfer", icon: ArrowRightLeftIcon },
                                        { value: "credit_card", label: "Card", icon: CreditCardIcon },
                                    ] as const).map(({ value, label, icon: Icon }) => (
                                        <button
                                            key={value}
                                            onClick={() => setPaymentMethod(value)}
                                            className={`py-2 px-2 rounded-lg text-xs font-semibold border-2 transition-colors flex items-center justify-center gap-1 ${
                                                paymentMethod === value
                                                    ? "border-brand-600 bg-brand-50 text-brand-700"
                                                    : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                                            }`}
                                        >
                                            <Icon className="w-3.5 h-3.5" />
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Guest Search (Guest Charge) */}
                        {orderType === "guest_charge" && cart.length > 0 && (
                            <div className="mb-4">
                                <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-2">Paid by Deposit</p>
                                {selectedReservation ? (
                                    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-semibold text-emerald-900">
                                                    Room {selectedReservation.room_label || selectedReservation.room_number} — {selectedReservation.guest_name}
                                                </p>
                                                <p className="text-xs text-emerald-600">
                                                    {selectedReservation.check_in} → {selectedReservation.check_out}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => { setSelectedReservation(null); setGuestSearch(""); }}
                                                className="text-emerald-400 hover:text-red-500"
                                            >
                                                <XIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="rounded-lg border border-emerald-200 bg-white/90 px-3 py-2">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="font-semibold text-emerald-900">Deposit Held</span>
                                                <span className="font-bold text-emerald-700">
                                                    {depositHeld.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB
                                                </span>
                                            </div>
                                        </div>
                                        {depositHeld <= 0 ? (
                                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                                No deposit available for this room.
                                            </div>
                                        ) : remainingAfterDeposit > 0 ? (
                                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                                                <p className="text-xs font-semibold uppercase tracking-widest text-amber-700 mb-2">
                                                    Payment Split
                                                </p>
                                                <div className="space-y-1 text-sm text-amber-900">
                                                    <div className="flex items-center justify-between">
                                                        <span>From Deposit</span>
                                                        <span className="font-semibold">
                                                            {depositApplied.toLocaleString("th-TH", { minimumFractionDigits: 2 })} / {depositHeld.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span>Remaining</span>
                                                        <span className="font-semibold">
                                                            {remainingAfterDeposit.toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="mt-3">
                                                    <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-2">Pay Remaining With</p>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {([
                                                            { value: "cash", label: "Cash", icon: BanknoteIcon },
                                                            { value: "transfer", label: "Transfer", icon: ArrowRightLeftIcon },
                                                            { value: "credit_card", label: "Card", icon: CreditCardIcon },
                                                        ] as const).map(({ value, label, icon: Icon }) => (
                                                            <button
                                                                key={value}
                                                                onClick={() => setPaymentMethod(value)}
                                                                className={`py-2 px-2 rounded-lg text-xs font-semibold border-2 transition-colors flex items-center justify-center gap-1 ${
                                                                    paymentMethod === value
                                                                        ? "border-brand-600 bg-brand-50 text-brand-700"
                                                                        : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                                                                }`}
                                                            >
                                                                <Icon className="w-3.5 h-3.5" />
                                                                {label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : (
                                    <>
                                        <div className="relative">
                                            <Input
                                                placeholder="Search guest name, booking, or room number..."
                                                value={guestSearch}
                                                onChange={(e) => setGuestSearch(e.target.value)}
                                            />
                                            {isSearchingGuests && (
                                                <RefreshCwIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] animate-spin" />
                                            )}
                                        </div>
                                        {reservations.length > 0 && (
                                            <div className="mt-2 border border-[var(--border-default)] rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                                                {reservations.map((r) => (
                                                    <button
                                                        key={r.id}
                                                        onClick={() => { setSelectedReservation(r); setReservations([]); }}
                                                        className="w-full text-left px-3 py-2 hover:bg-brand-50 transition-colors"
                                                    >
                                                        <p className="text-sm font-medium text-[var(--text-primary)]">
                                                            Room {r.room_label || r.room_number} — {r.guest_name}
                                                        </p>
                                                        <p className="text-xs text-[var(--text-muted)]">
                                                            {r.check_in} → {r.check_out}
                                                        </p>
                                                        <p className="text-xs font-medium text-emerald-700 mt-1">
                                                            Deposit Held: {Number(r.deposit_amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })} THB
                                                        </p>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {guestSearch.length >= 1 && !isSearchingGuests && reservations.length === 0 && (
                                            <p className="text-xs text-[var(--text-muted)] mt-2 text-center">No in-house guests found</p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {/* Submit Button */}
                        {cart.length > 0 && (
                            <>
                                <Button
                                    onClick={handleSubmit}
                                    disabled={!canSubmit}
                                    className="w-full h-12 bg-brand-600 hover:bg-brand-700 text-white font-bold text-base"
                                >
                                    {isSubmitting ? (
                                        <RefreshCwIcon className="w-5 h-5 animate-spin" />
                                    ) : orderType === "walkin" ? (
                                        <>
                                            <CheckIcon className="w-5 h-5 mr-2" />
                                            Complete Sale — {total.toLocaleString("th-TH")} THB
                                        </>
                                    ) : (
                                        <>
                                            <UserIcon className="w-5 h-5 mr-2" />
                                            Paid by Deposit — {total.toLocaleString("th-TH")} THB
                                        </>
                                    )}
                                </Button>
                                {orderType === "guest_charge" && roomDepositHint && (
                                    <p className={`mt-2 text-xs ${depositHeld > 0 ? "text-[var(--text-secondary)]" : "text-amber-700"}`}>
                                        {roomDepositHint}
                                    </p>
                                )}
                                {submitError && (
                                    <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                        {submitError}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
