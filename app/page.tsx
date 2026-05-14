"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // On mount: check for magic link tokens in URL hash and redirect to callback
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('access_token') || hash.includes('type=invite') || hash.includes('type=recovery')) {
      // Preserve the hash and redirect to callback handler
      router.push(`/auth/callback${hash}`)
    }
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      router.push("/dashboard");
    }
    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    setError(null);

    const emailToReset = resetEmail || email;
    if (!emailToReset) {
      setError('Please enter your email address');
      setResetLoading(false);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(emailToReset, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });

    if (error) {
      setError(error.message);
      setResetLoading(false);
    } else {
      setResetSent(true);
      setResetLoading(false);
    }
  };

  // Show forgot password modal
  if (showForgotPassword) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-sm">
          <h1 className="text-white text-xl font-bold mb-1 text-center">Reset Password</h1>
          <p className="text-gray-400 text-sm text-center mb-6">
            Enter your email and we'll send you a reset link
          </p>

          {resetSent ? (
            <div className="space-y-4">
              <div className="bg-green-950 border border-green-800 rounded-lg p-4">
                <p className="text-green-400 text-sm text-center">
                  If an account exists for that email, you'll receive a reset link shortly.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowForgotPassword(false);
                  setResetSent(false);
                  setResetEmail('');
                }}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded font-medium text-sm transition-colors"
              >
                Back to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
              <div>
                <label className="text-gray-400 text-sm block mb-1">Email</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder={email || 'your@email.com'}
                  required
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              {error && <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded px-3 py-2">{error}</p>}

              <button
                type="submit"
                disabled={resetLoading}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3 rounded font-medium text-sm transition-colors"
              >
                {resetLoading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setError(null);
                }}
                className="text-gray-400 hover:text-white text-sm transition-colors"
              >
                Back to Login
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-white text-2xl font-bold mb-1 text-center">DealerIQ</h1>
        <p className="text-gray-400 text-sm text-center mb-6">Dealer Intelligence Platform</p>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="text-gray-400 text-sm block mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-gray-400 text-sm block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowForgotPassword(true)}
              className="text-blue-400 hover:text-blue-300 text-xs mt-1 transition-colors"
            >
              Forgot password?
            </button>
          </div>
          {error && <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded px-3 py-2">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3 rounded font-medium text-sm transition-colors"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
