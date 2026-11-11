export const EXCHANGE = 'shop.events';

/** Subsets of the shoplab-contracts event schemas that this service reads. */
export interface UserRegistered { userId: string; email: string; fullName: string }

export interface OrderPlaced {
  orderId: string;
  userId: string;
  total: number;
  currency: string;
  lines: { productId: string; quantity: number; unitPrice?: number | null }[];
  placedAt: string;
}

export interface PaymentFailed { paymentId: string; orderId: string; reason?: string; failedAt: string }

/** Published by inventory when available stock falls to the reorder threshold. */
export interface StockLow { productId: string; available: number; threshold: number; at: string }

/** `price` is the new price in minor units, as text. */
export interface ProductUpdated { productId: string; price: string; currency: string; updatedAt: string }

export type Channel = 'email' | 'push';
