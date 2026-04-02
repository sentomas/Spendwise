import React, { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  Timestamp, 
  setDoc,
  getDoc,
  getDocs,
  orderBy,
  limit
} from 'firebase/firestore';
import { 
  Plus, 
  Trash2, 
  LogOut, 
  PieChart, 
  TrendingUp, 
  DollarSign, 
  Calendar, 
  Tag, 
  PlusCircle, 
  X, 
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Filter,
  Users,
  ShieldCheck,
  Settings,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart as RePieChart,
  Pie
} from 'recharts';
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";

import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { UserProfile, Category, Expense, Income, CategoryWithStats } from './types';
import { cn } from './lib/utils';

// --- Razorpay Helper ---
const loadRazorpay = () => {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

// --- Contexts ---

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

// --- Error Boundary ---

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) message = parsed.error;
      } catch {
        message = this.state.error?.message || message;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center border border-red-100">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Application Error</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Components ---

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      // Clean up previous profile listener
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (u) {
        try {
          const userDocRef = doc(db, 'users', u.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (!userDoc.exists()) {
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || '',
              role: 'user',
              plan: 'free',
              subscriptionStatus: 'inactive',
              trialStartedAt: Timestamp.now()
            };
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          }

          // Always listen for profile changes if user exists
          unsubProfile = onSnapshot(userDocRef, (snap) => {
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
            }
          }, (err) => {
            console.error("Profile listener error:", err);
          });
        } catch (err) {
          console.error("Error fetching profile:", err);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function Pricing({ onBack }: { onBack: () => void }) {
  const { user, profile } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then(res => res.json())
      .then(data => setCountry(data.country_code))
      .catch(err => console.error("Error fetching country:", err));
  }, []);

  const isIndia = country === 'IN';
  const currency = isIndia ? 'INR' : 'USD';
  const monthlyPrice = isIndia ? 50 : 4.99;
  const yearlyPrice = isIndia ? 40 : 3.99; // Roughly 20% off
  const yearlyTotal = isIndia ? 480 : 47.88;

  const handleRazorpay = async () => {
    if (!user) return;
    setIsProcessing(true);
    const res = await loadRazorpay();
    if (!res) {
      alert("Razorpay SDK failed to load. Are you online?");
      setIsProcessing(false);
      return;
    }

    try {
      const amount = billingCycle === 'monthly' ? monthlyPrice : yearlyPrice * 12;
      const orderRes = await fetch("/api/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          amount: amount * 100,
          currency: currency, 
          receipt: `receipt_${user.uid}` 
        }),
      });
      const orderData = await orderRes.json();

      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "SpendWise Pro",
        description: `${billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1)} Subscription`,
        order_id: orderData.id,
        handler: async (response: any) => {
          const verifyRes = await fetch("/api/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response),
          });
          const verifyData = await verifyRes.json();
          if (verifyData.status === "ok") {
            const endDate = new Date();
            if (billingCycle === 'monthly') endDate.setDate(endDate.getDate() + 30);
            else endDate.setDate(endDate.getDate() + 365);

            await updateDoc(doc(db, "users", user.uid), {
              plan: "pro",
              subscriptionStatus: "active",
              subscriptionId: response.razorpay_payment_id,
              subscriptionEndDate: Timestamp.fromDate(endDate),
              billingCycle: billingCycle
            });
            alert(`Payment successful! You are now a Pro user until ${format(endDate, 'MMM dd, yyyy')}.`);
            onBack();
          } else {
            alert("Payment verification failed.");
          }
        },
        prefill: {
          name: user.displayName,
          email: user.email,
        },
        theme: { color: "#3b82f6" },
      };

      const rzp1 = new (window as any).Razorpay(options);
      rzp1.open();
    } catch (error) {
      console.error("Razorpay error:", error);
      alert("Something went wrong with the payment.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-12">
        <h2 className="text-4xl font-extrabold text-slate-900 mb-4">Choose Your Plan</h2>
        <p className="text-slate-500 text-lg">Unlock the full power of professional expense tracking.</p>
        
        {/* Toggle */}
        <div className="mt-8 flex items-center justify-center gap-4">
          <span className={cn("text-sm font-medium", billingCycle === 'monthly' ? "text-slate-900" : "text-slate-400")}>Monthly</span>
          <button 
            onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
            className="w-12 h-6 bg-slate-200 rounded-full relative transition-colors"
          >
            <motion.div 
              animate={{ x: billingCycle === 'monthly' ? 2 : 26 }}
              className="absolute top-1 w-4 h-4 bg-blue-600 rounded-full shadow-sm"
            />
          </button>
          <span className={cn("text-sm font-medium", billingCycle === 'yearly' ? "text-slate-900" : "text-slate-400")}>
            Yearly <span className="text-emerald-500 text-xs font-bold ml-1">SAVE 20%</span>
          </span>
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8"
      >
        {/* Free Plan */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
          <h3 className="text-xl font-bold text-slate-900 mb-2">Free Trial</h3>
          <div className="text-4xl font-bold text-slate-900 mb-6">{isIndia ? '₹' : '$'}0<span className="text-lg text-slate-400 font-normal">/mo</span></div>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-slate-600">
              <PlusCircle className="w-5 h-5 text-emerald-500" /> 7-day full trial
            </li>
            <li className="flex items-center gap-3 text-slate-600">
              <PlusCircle className="w-5 h-5 text-emerald-500" /> Basic expense tracking
            </li>
            <li className="flex items-center gap-3 text-slate-600">
              <PlusCircle className="w-5 h-5 text-emerald-500" /> Up to 5 categories
            </li>
          </ul>
          <button 
            onClick={onBack}
            className="w-full py-3 border border-slate-200 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors"
          >
            {profile?.plan === 'free' ? 'Current Plan' : 'Go Back'}
          </button>
        </div>

        {/* Pro Plan */}
        <div className="bg-white p-8 rounded-2xl shadow-xl border-2 border-blue-600 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-blue-600 text-white px-4 py-1 text-xs font-bold rounded-bl-xl">POPULAR</div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">Pro</h3>
          <div className="text-4xl font-bold text-slate-900 mb-6">
            {isIndia ? '₹' : '$'}{billingCycle === 'monthly' ? monthlyPrice : yearlyPrice}
            <span className="text-lg text-slate-400 font-normal">/mo</span>
          </div>
          <p className="text-xs text-slate-400 mb-6">
            {billingCycle === 'monthly' ? `Billed monthly` : `Billed annually (${isIndia ? '₹' : '$'}${yearlyTotal}/yr)`}
          </p>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-slate-600">
              <PlusCircle className="w-5 h-5 text-emerald-500" /> Unlimited categories
            </li>
            <li className="flex items-center gap-3 text-slate-600">
              <PlusCircle className="w-5 h-5 text-emerald-500" /> Advanced analytics
            </li>
            <li className="flex items-center gap-3 text-slate-600">
              <PlusCircle className="w-5 h-5 text-emerald-500" /> Priority support
            </li>
            <li className="flex items-center gap-3 text-slate-600">
              <PlusCircle className="w-5 h-5 text-emerald-500" /> CSV Export (Coming soon)
            </li>
          </ul>
          
          <div className="space-y-4">
            <button 
              onClick={handleRazorpay}
              disabled={isProcessing || (profile?.plan === 'pro' && profile?.billingCycle === billingCycle)}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
            >
              {isProcessing ? 'Processing...' : (profile?.plan === 'pro' && profile?.billingCycle === billingCycle) ? 'Active' : `Upgrade ${billingCycle}`}
            </button>

            {!isIndia && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400">Or pay with PayPal</span></div>
                </div>

                <PayPalScriptProvider options={{ clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID || "test" }}>
                  <PayPalButtons 
                    style={{ layout: "horizontal", height: 48 }}
                    createOrder={(data, actions) => {
                      const amount = billingCycle === 'monthly' ? "4.99" : "47.88";
                      return actions.order.create({
                        intent: "CAPTURE",
                        purchase_units: [{ amount: { value: amount, currency_code: "USD" } }]
                      });
                    }}
                    onApprove={async (data, actions) => {
                      if (actions.order) {
                        const details = await actions.order.capture();
                        if (user) {
                          const endDate = new Date();
                          if (billingCycle === 'monthly') endDate.setDate(endDate.getDate() + 30);
                          else endDate.setDate(endDate.getDate() + 365);

                          await updateDoc(doc(db, "users", user.uid), {
                            plan: "pro",
                            subscriptionStatus: "active",
                            subscriptionId: details.id,
                            subscriptionEndDate: Timestamp.fromDate(endDate),
                            billingCycle: billingCycle
                          });
                          alert(`Payment successful! You are now a Pro user until ${format(endDate, 'MMM dd, yyyy')}.`);
                          onBack();
                        }
                      }
                    }}
                  />
                </PayPalScriptProvider>
              </>
            )}
          </div>
        </div>
      </motion.div>
      <button onClick={onBack} className="mt-8 text-slate-400 hover:text-slate-600 flex items-center gap-2">
        <X className="w-4 h-4" /> Cancel and return to dashboard
      </button>

      <p className="mt-12 text-slate-400 text-xs">
        Designed and developed by <a href="mailto:serin.thomas@outlook.com" className="text-blue-600 hover:underline">serin.thomas@outlook.com</a>
      </p>
    </div>
  );
}

function Login() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    try {
      await signIn();
    } catch (err: any) {
      console.error('Sign in error:', err);
      if (err.code === 'auth/unauthorized-domain') {
        setError('This domain is not authorized in Firebase. Please add "spendwise-unjj.onrender.com" to your Authorized Domains in the Firebase Console.');
      } else {
        setError(err.message || 'An unexpected error occurred during sign in.');
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
            <DollarSign className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">SpendWise</h1>
          <p className="text-slate-500 mt-2">Smart expense tracking for a better financial future.</p>
        </div>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-sm text-red-600">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        <button 
          onClick={handleSignIn}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all shadow-sm font-medium text-slate-700"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
          Continue with Google
        </button>
        
        <p className="text-center text-xs text-slate-400 mt-8">
          Designed and developed by <a href="mailto:serin.thomas@outlook.com" className="text-blue-600 hover:underline">serin.thomas@outlook.com</a>
        </p>
      </motion.div>
    </div>
  );
}

function Dashboard({ onShowPricing, onShowAdmin }: { onShowPricing: () => void, onShowAdmin: () => void }) {
  const { user, profile, logout } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [isAddingIncome, setIsAddingIncome] = useState(false);
  const [isManagingCategories, setIsManagingCategories] = useState(false);

  const daysLeft = useMemo(() => {
    if (!profile?.subscriptionEndDate) return null;
    const end = profile.subscriptionEndDate.toDate();
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [profile]);

  // --- Data Fetching ---
  // ... (rest of the component)

  useEffect(() => {
    if (!user) return;

    const qCategories = query(collection(db, 'categories'), where('uid', '==', user.uid));
    const unsubCategories = onSnapshot(qCategories, (snapshot) => {
      setCategories(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Category)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'categories'));

    const qExpenses = query(collection(db, 'expenses'), where('uid', '==', user.uid));
    const unsubExpenses = onSnapshot(qExpenses, (snapshot) => {
      setExpenses(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Expense)).sort((a, b) => b.date.toMillis() - a.date.toMillis()));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'expenses'));

    const qIncomes = query(collection(db, 'incomes'), where('uid', '==', user.uid));
    const unsubIncomes = onSnapshot(qIncomes, (snapshot) => {
      setIncomes(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Income)).sort((a, b) => b.date.toMillis() - a.date.toMillis()));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'incomes'));

    return () => {
      unsubCategories();
      unsubExpenses();
      unsubIncomes();
    };
  }, [user]);

  // --- Stats ---

  const stats = useMemo(() => {
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
    const expenseRatio = totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : 0;

    const byCategory = categories.map(cat => {
      const catExpenses = expenses.filter(e => e.categoryId === cat.id);
      return {
        ...cat,
        total: catExpenses.reduce((sum, e) => sum + e.amount, 0),
        count: catExpenses.length
      } as CategoryWithStats;
    }).sort((a, b) => b.total - a.total);

    return { totalExpenses, totalIncome, expenseRatio, byCategory };
  }, [expenses, categories, incomes]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900 hidden sm:block">SpendWise</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={cn(
                "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold",
                profile?.plan === 'pro' ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-amber-50 text-amber-700 border-amber-100"
              )}>
                <Tag className="w-3.5 h-3.5" /> 
                {profile?.plan === 'pro' ? 'PRO PLAN' : 'FREE TRIAL'}
                {profile?.plan === 'free' && ` (${daysLeft} days left)`}
                {profile?.plan === 'pro' && daysLeft !== null && ` (${daysLeft} days left)`}
              </div>
              {profile?.plan === 'free' ? (
                <button 
                  onClick={onShowPricing}
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-bold shadow-sm"
                >
                  <TrendingUp className="w-3.5 h-3.5" /> Upgrade
                </button>
              ) : (
                <button 
                  onClick={onShowPricing}
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-xs font-bold border border-blue-200"
                >
                  Renew
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 mr-2">
              <img 
                src={user?.photoURL || ''} 
                className="w-8 h-8 rounded-full border border-slate-200" 
                alt={user?.displayName || ''} 
                referrerPolicy="no-referrer"
              />
              <div className="flex flex-col items-start">
                <span className="text-sm font-bold text-slate-700 hidden md:block leading-none">
                  {user?.displayName}
                </span>
                {(profile?.role === 'admin' || profile?.email === 'serinit21@gmail.com') && (
                  <button 
                    onClick={onShowAdmin}
                    className="text-[10px] text-blue-600 font-bold hover:underline leading-none mt-1"
                  >
                    ADMIN PANEL
                  </button>
                )}
              </div>
            </div>
            <button 
              onClick={logout}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Summary Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <motion.div 
            whileHover={{ y: -2 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-red-50 text-red-600 rounded-lg">
                <TrendingUp className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Expenses</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">${stats.totalExpenses.toLocaleString()}</div>
            <div className="text-sm text-slate-500 mt-1">Across {expenses.length} transactions</div>
          </motion.div>

          <motion.div 
            whileHover={{ y: -2 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <PlusCircle className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Income</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">${stats.totalIncome.toLocaleString()}</div>
            <div className="text-sm text-slate-500 mt-1">Across {incomes.length} records</div>
          </motion.div>

          <motion.div 
            whileHover={{ y: -2 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <PieChart className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Expense Ratio</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">{stats.expenseRatio.toFixed(1)}%</div>
            <div className="text-sm text-slate-500 mt-1">Expenses vs Income</div>
          </motion.div>

          <motion.div 
            whileHover={{ y: -2 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                <Tag className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Top Category</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">
              {stats.byCategory[0]?.name || 'None'}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              ${stats.byCategory[0]?.total.toLocaleString() || 0} spent
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Charts */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-slate-900">Spending by Category</h2>
                <PieChart className="w-5 h-5 text-slate-400" />
              </div>
              <div className="h-64">
                {stats.byCategory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.byCategory}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                        {stats.byCategory.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 italic">
                    No data to display
                  </div>
                )}
              </div>
            </div>

            {/* Expense List */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Recent Expenses</h2>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setIsAddingIncome(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" /> Add Income
                  </button>
                  <button 
                    onClick={() => setIsAddingExpense(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" /> Add Expense
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Date</th>
                      <th className="px-6 py-4 font-semibold">Category</th>
                      <th className="px-6 py-4 font-semibold">Description</th>
                      <th className="px-6 py-4 font-semibold text-right">Amount</th>
                      <th className="px-6 py-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence mode='popLayout'>
                      {expenses.length > 0 ? expenses.map(expense => {
                        const category = categories.find(c => c.id === expense.categoryId);
                        return (
                          <motion.tr 
                            key={expense.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="hover:bg-slate-50 transition-colors"
                          >
                            <td className="px-6 py-4 text-sm text-slate-600">
                              {format(expense.date.toDate(), 'MMM dd, yyyy')}
                            </td>
                            <td className="px-6 py-4">
                              <span 
                                className="px-2 py-1 rounded-full text-xs font-medium"
                                style={{ backgroundColor: `${category?.color}20`, color: category?.color }}
                              >
                                {category?.name || 'Uncategorized'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-900 font-medium">
                              {expense.description || '-'}
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-900 font-bold text-right">
                              ${expense.amount.toLocaleString()}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={async () => {
                                  try {
                                    await deleteDoc(doc(db, 'expenses', expense.id));
                                  } catch (err) {
                                    handleFirestoreError(err, OperationType.DELETE, `expenses/${expense.id}`);
                                  }
                                }}
                                className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </motion.tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                            No expenses recorded yet.
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Income List */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Recent Income</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Date</th>
                      <th className="px-6 py-4 font-semibold">Description</th>
                      <th className="px-6 py-4 font-semibold text-right">Amount</th>
                      <th className="px-6 py-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence mode='popLayout'>
                      {incomes.length > 0 ? incomes.map(income => (
                        <motion.tr 
                          key={income.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {format(income.date.toDate(), 'MMM dd, yyyy')}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-900 font-medium">
                            {income.description || '-'}
                          </td>
                          <td className="px-6 py-4 text-sm text-emerald-600 font-bold text-right">
                            +${income.amount.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={async () => {
                                try {
                                  await deleteDoc(doc(db, 'incomes', income.id));
                                } catch (err) {
                                  handleFirestoreError(err, OperationType.DELETE, `incomes/${income.id}`);
                                }
                              }}
                              className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </motion.tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                            No income records yet.
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-8">
            {/* Category Manager */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-slate-900">Categories</h2>
                <button 
                  onClick={() => setIsManagingCategories(!isManagingCategories)}
                  className="text-blue-600 text-sm font-medium hover:underline"
                >
                  {isManagingCategories ? 'Done' : 'Manage'}
                </button>
              </div>
              
              <div className="space-y-3">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                      <span className="text-sm text-slate-700 font-medium">{cat.name}</span>
                    </div>
                    {isManagingCategories && (
                      <button 
                        onClick={async () => {
                          try {
                            await deleteDoc(doc(db, 'categories', cat.id));
                          } catch (err) {
                            handleFirestoreError(err, OperationType.DELETE, `categories/${cat.id}`);
                          }
                        }}
                        className="text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                
                {isManagingCategories && <AddCategoryForm user={user!} count={categories.length} onShowPricing={onShowPricing} />}
              </div>
            </div>

            {/* Quick Tips */}
            <div className="bg-blue-600 p-6 rounded-2xl shadow-lg shadow-blue-200 text-white">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5" />
                <h3 className="font-bold">Pro Tip</h3>
              </div>
              <p className="text-blue-100 text-sm leading-relaxed">
                Categorizing your expenses accurately helps SpendWise generate better predictive analysis for your future spending habits.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-6 h-6 bg-slate-200 rounded flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-slate-600" />
            </div>
            <span className="text-sm font-bold text-slate-900">SpendWise</span>
          </div>
          <p className="text-slate-500 text-sm">
            Designed and developed by <a href="mailto:serin.thomas@outlook.com" className="text-blue-600 hover:underline">serin.thomas@outlook.com</a>
          </p>
          <p className="text-slate-400 text-xs mt-2">
            © {new Date().getFullYear()} SpendWise. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Modals */}
      <AnimatePresence>
        {isAddingExpense && (
          <ExpenseModal 
            onClose={() => setIsAddingExpense(false)} 
            categories={categories}
            user={user!}
          />
        )}
        {isAddingIncome && (
          <IncomeModal 
            onClose={() => setIsAddingIncome(false)} 
            user={user!}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function AddCategoryForm({ user, count, onShowPricing }: { user: User, count: number, onShowPricing: () => void }) {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    
    if (profile?.plan === 'free' && count >= 5) {
      alert("Free plan is limited to 5 categories. Please upgrade to Pro for unlimited categories.");
      onShowPricing();
      return;
    }

    try {
      await addDoc(collection(db, 'categories'), {
        uid: user.uid,
        name,
        color
      });
      setName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'categories');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="pt-4 border-t border-slate-100 mt-4">
      <div className="flex gap-2">
        <input 
          type="text" 
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New category..."
          className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <input 
          type="color" 
          value={color}
          onChange={e => setColor(e.target.value)}
          className="w-8 h-8 rounded border-none p-0 cursor-pointer"
        />
        <button type="submit" className="p-1.5 bg-blue-600 text-white rounded-lg">
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
}

function ExpenseModal({ onClose, categories, user }: { onClose: () => void, categories: Category[], user: User }) {
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !categoryId || !date) return;
    
    try {
      await addDoc(collection(db, 'expenses'), {
        uid: user.uid,
        amount: parseFloat(amount),
        categoryId,
        description,
        date: Timestamp.fromDate(new Date(date))
      });
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">Add New Expense</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="number" 
                step="0.01"
                required
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
            <select 
              required
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="">Select a category</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="date" 
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
            <textarea 
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              rows={3}
              placeholder="What was this for?"
            />
          </div>

          <div className="pt-4 flex gap-3">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-lg shadow-blue-200"
            >
              Save Expense
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function IncomeModal({ onClose, user }: { onClose: () => void, user: User }) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !date) return;
    
    try {
      await addDoc(collection(db, 'incomes'), {
        uid: user.uid,
        amount: parseFloat(amount),
        description,
        date: Timestamp.fromDate(new Date(date))
      });
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'incomes');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-emerald-50">
          <h2 className="text-xl font-bold text-emerald-900">Add Income</h2>
          <button onClick={onClose} className="p-2 hover:bg-emerald-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-emerald-600" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount ($)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="number" 
                  step="0.01"
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="date" 
                  required
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
            <textarea 
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
              rows={3}
              placeholder="Source of income..."
            />
          </div>

          <div className="pt-4 flex gap-3">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-medium shadow-lg shadow-emerald-200"
            >
              Save Income
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function AdminDashboard({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const q = query(collection(db, 'users'), orderBy('email'));
        const snap = await getDocs(q);
        setUsers(snap.docs.map(d => d.data() as UserProfile));
      } catch (err) {
        console.error("Error fetching users:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.displayName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = useMemo(() => {
    const total = users.length;
    const pro = users.filter(u => u.plan === 'pro').length;
    const active = users.filter(u => u.subscriptionStatus === 'active').length;
    return { total, pro, active };
  }, [users]);

  const handleUpdatePlan = async (userId: string, plan: 'free' | 'pro') => {
    try {
      await updateDoc(doc(db, 'users', userId), { 
        plan,
        subscriptionStatus: plan === 'pro' ? 'active' : 'inactive'
      });
      setUsers(prev => prev.map(u => u.uid === userId ? { ...u, plan, subscriptionStatus: plan === 'pro' ? 'active' : 'inactive' } : u));
    } catch (err) {
      alert("Failed to update plan");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-blue-600" />
              <h1 className="text-xl font-bold text-slate-900">Admin Panel</h1>
            </div>
          </div>
          <div className="text-sm text-slate-500 font-medium">
            Manage Subscribers & Users
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Admin Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <span className="text-sm font-medium text-slate-500">Total Users</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{stats.total}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-emerald-50 rounded-lg">
                <Tag className="w-5 h-5 text-emerald-600" />
              </div>
              <span className="text-sm font-medium text-slate-500">Pro Subscribers</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{stats.pro}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-amber-50 rounded-lg">
                <TrendingUp className="w-5 h-5 text-amber-600" />
              </div>
              <span className="text-sm font-medium text-slate-500">Active Subscriptions</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{stats.active}</div>
          </div>
        </div>

        {/* User Management Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-slate-900">User Directory</h2>
            <div className="relative max-w-xs w-full">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search users..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Plan</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Expiry</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : filteredUsers.length > 0 ? filteredUsers.map(u => (
                  <tr key={u.uid} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-900">{u.displayName || 'No Name'}</span>
                        <span className="text-xs text-slate-500">{u.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                        u.plan === 'pro' ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                      )}>
                        {u.plan || 'free'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "flex items-center gap-1.5 text-xs font-medium",
                        u.subscriptionStatus === 'active' ? "text-emerald-600" : "text-slate-400"
                      )}>
                        <div className={cn("w-1.5 h-1.5 rounded-full", u.subscriptionStatus === 'active' ? "bg-emerald-600" : "bg-slate-400")} />
                        {u.subscriptionStatus || 'inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {u.subscriptionEndDate ? format(u.subscriptionEndDate.toDate(), 'MMM dd, yyyy') : 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleUpdatePlan(u.uid, u.plan === 'pro' ? 'free' : 'pro')}
                          className="p-2 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
                          title={u.plan === 'pro' ? 'Downgrade to Free' : 'Upgrade to Pro'}
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                      No users found matching your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-slate-500 text-sm">
            SpendWise Admin Console
          </p>
          <p className="text-slate-400 text-xs mt-2">
            Designed and developed by <a href="mailto:serin.thomas@outlook.com" className="text-blue-600 hover:underline">serin.thomas@outlook.com</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function AppContent() {
  const { user, profile, loading } = useAuth();
  const [view, setView] = useState<'dashboard' | 'pricing' | 'admin'>('dashboard');

  const isAdmin = useMemo(() => {
    return profile?.role === 'admin' || profile?.email === 'serinit21@gmail.com';
  }, [profile]);

  const isTrialExpired = useMemo(() => {
    if (!profile?.trialStartedAt || profile?.plan === 'pro' || isAdmin) return false;
    const start = profile.trialStartedAt.toDate();
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    return days > 7;
  }, [profile, isAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Login />;

  if (isTrialExpired && view !== 'pricing' && view !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl text-center border border-slate-100"
        >
          <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Trial Expired</h2>
          <p className="text-slate-500 mb-8">Your 7-day free trial has ended. Please upgrade to Pro to continue tracking your expenses and managing your finances.</p>
          <button 
            onClick={() => setView('pricing')}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
          >
            View Pricing Plans
          </button>
        </motion.div>
      </div>
    );
  }

  if (view === 'admin') return <AdminDashboard onBack={() => setView('dashboard')} />;

  return view === 'pricing' ? (
    <Pricing onBack={() => setView('dashboard')} />
  ) : (
    <Dashboard onShowPricing={() => setView('pricing')} onShowAdmin={() => setView('admin')} />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
