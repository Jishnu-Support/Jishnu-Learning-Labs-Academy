import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

export type PaymentResult = {
  orderId: string;
  paymentId: string | null;
  status: 'PAID' | 'FAILED' | 'CREATED';
};

export interface PaymentProvider {
  readonly kind: 'MOCK' | 'RAZORPAY';
  createOrder(input: { amountMinor: number; currency: string; receipt: string }): Promise<string>;
  completeOrder(input: { orderId: string; pin?: string }): Promise<PaymentResult>;
}

export function assertPaymentProviderAllowed(
  providerKind: 'MOCK' | 'RAZORPAY' = env.PAYMENT_PROVIDER,
  nodeEnvironment: string = env.NODE_ENV,
) {
  if (providerKind === 'MOCK' && nodeEnvironment === 'production') {
    throw new Error('The MOCK payment provider cannot be used in production');
  }
  if (providerKind === 'RAZORPAY' && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=RAZORPAY');
  }
}

export class MockPaymentProvider implements PaymentProvider {
  readonly kind = 'MOCK' as const;

  constructor(nodeEnvironment: string = env.NODE_ENV) {
    if (nodeEnvironment === 'production') throw new Error('The MOCK payment provider cannot be used in production');
  }

  async createOrder() {
    return `mock_${randomUUID()}`;
  }

  async completeOrder(input: { orderId: string; pin?: string }): Promise<PaymentResult> {
    if (input.pin !== '123456' && input.pin !== '000000') {
      throw new HttpError(400, 'Use the sample demo PIN shown on the checkout screen');
    }
    return {
      orderId: input.orderId,
      paymentId: `mock_payment_${randomUUID()}`,
      status: input.pin === '123456' ? 'PAID' : 'FAILED',
    };
  }
}

export class RazorpayPaymentProvider implements PaymentProvider {
  readonly kind = 'RAZORPAY' as const;

  async createOrder(input: { amountMinor: number; currency: string; receipt: string }) {
    assertPaymentProviderAllowed(this.kind);
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: input.amountMinor, currency: input.currency, receipt: input.receipt }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new HttpError(502, 'The Razorpay test order could not be created');
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') {
      throw new HttpError(502, 'Razorpay returned an invalid test order');
    }
    return result.id;
  }

  async completeOrder(input: { orderId: string }): Promise<PaymentResult> {
    assertPaymentProviderAllowed(this.kind);
    return { orderId: input.orderId, paymentId: null, status: 'CREATED' };
  }
}

export function createPaymentProvider(): PaymentProvider {
  assertPaymentProviderAllowed();
  return env.PAYMENT_PROVIDER === 'MOCK' ? new MockPaymentProvider() : new RazorpayPaymentProvider();
}
