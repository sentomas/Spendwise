import { Timestamp } from "firebase/firestore";

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: 'admin' | 'user';
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

export interface CategoryWithStats extends Category {
  total: number;
  count: number;
}
