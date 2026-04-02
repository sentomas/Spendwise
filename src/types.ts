import { Timestamp } from "firebase/firestore";

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: 'admin' | 'user';
  plan?: 'free' | 'pro';
  subscriptionStatus?: 'active' | 'inactive';
  subscriptionId?: string;
  subscriptionEndDate?: Timestamp;
  billingCycle?: 'monthly' | 'yearly';
  trialStartedAt?: Timestamp;
}

export interface Category {
  id: string;
  uid: string;
  name: string;
  color: string;
}

export interface Expense {
  id: string;
  uid: string;
  amount: number;
  categoryId: string;
  description?: string;
  date: Timestamp;
}

export interface Income {
  id: string;
  uid: string;
  amount: number;
  description?: string;
  date: Timestamp;
}

export interface CategoryWithStats extends Category {
  total: number;
  count: number;
}
