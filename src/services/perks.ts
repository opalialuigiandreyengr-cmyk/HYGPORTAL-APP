import { supabase } from '../lib/supabase';
import { env } from '../lib/env';

export type PerkFormType = 'discount' | 'charge';

export type PerkProductInput = {
  name: string;
  quantity: number;
  price: number;
};

export type StartPerkRequestInput = {
  formType: PerkFormType;
  transactionDate: string;
  products: PerkProductInput[];
  email?: string;
};

export type StartedPerkRequest = {
  requestId: string;
  email: string;
  requestLabel: string;
};

export type VerifiedPerkRequest = {
  requestId: string;
  email: string;
  requestLabel: string;
  productName: string;
  transactionDate: string;
  amount: number;
  finalAmount: number;
};

export type PerkUsage = {
  cashAmountUsed: number;
  cashAmountLimit: number;
  cashTransactionsUsed: number;
  cashTransactionsLimit: number;
  creditAmountUsed: number;
  creditAmountLimit: number;
  creditFirstDiscountUsed: boolean;
  creditTransactionsUsed: number;
};

export async function loadPerkUsage() {
  const { data, error } = await supabase.rpc('get_my_perk_usage');

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    cashAmountUsed: Number(row?.cash_amount_used ?? 0),
    cashAmountLimit: Number(row?.cash_amount_limit ?? 3000),
    cashTransactionsUsed: Number(row?.cash_transactions_used ?? 0),
    cashTransactionsLimit: Number(row?.cash_transactions_limit ?? 6),
    creditAmountUsed: Number(row?.credit_amount_used ?? 0),
    creditAmountLimit: Number(row?.credit_amount_limit ?? 3000),
    creditFirstDiscountUsed: Boolean(row?.credit_first_discount_used),
    creditTransactionsUsed: Number(row?.credit_transactions_used ?? 0),
  } satisfies PerkUsage;
}

export async function startPerkRequest(input: StartPerkRequestInput) {
  const data = await invokePerkEmail({
    action: 'start',
    formType: input.formType,
    transactionDate: input.transactionDate,
    products: input.products,
    email: input.email?.trim() || undefined,
  });

  return {
    requestId: String(data.requestId),
    email: String(data.email),
    requestLabel: String(data.requestLabel),
  } satisfies StartedPerkRequest;
}

export async function verifyPerkRequest(requestId: string, approvalCode: string) {
  const data = await invokePerkEmail({
    action: 'verify',
    requestId,
    approvalCode,
  });

  return {
    requestId: String(data.requestId),
    email: String(data.email),
    requestLabel: String(data.requestLabel),
    productName: String(data.productName),
    transactionDate: String(data.transactionDate),
    amount: Number(data.amount ?? 0),
    finalAmount: Number(data.finalAmount ?? 0),
  } satisfies VerifiedPerkRequest;
}

async function invokePerkEmail(body: Record<string, unknown>) {
  const { data: sessionResult } = await supabase.auth.getSession();
  const accessToken = sessionResult.session?.access_token;
  if (!accessToken) {
    throw new Error('Login session expired. Please sign in again.');
  }

  const functionUrl = `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1/perk-email`;
  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: env.supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Cannot reach perk-email Edge Function. Check deployment and connection: ${functionUrl}`);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const message = (payload as { error?: unknown })?.error;
  if (!response.ok || message) {
    throw new Error(typeof message === 'string' && message.trim()
      ? message
      : `Edge Function returned HTTP ${response.status}.`);
  }

  return payload as Record<string, unknown>;
}
