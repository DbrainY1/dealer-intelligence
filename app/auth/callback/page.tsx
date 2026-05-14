'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type AuthType = 'invite' | 'recovery' | null

export default function AuthCallbackPage() {
  const router = useRouter()
  
  const [loading, setLoading] = useState(true)
  const [authType, setAuthType] = useState<AuthType>(null)
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Parse tokens from URL hash on mount
  useEffect(() => {
    async function handleAuthCallback() {
      try {
        // Parse hash fragment for Supabase auth tokens
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        const type = hashParams.get('type') as AuthType

        if (!accessToken || !refreshToken) {
          setError('Invalid or expired link. Please request a new invite or password reset.')
          setLoading(false)
          return
        }

        // Set session from magic link tokens
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (sessionError) {
          console.error('Session error:', sessionError)
          setError('This link has expired. Ask your admin to send a new invite.')
          setLoading(false)
          return
        }

        // Get user email from session
        const userEmail = sessionData.session?.user?.email
        if (!userEmail) {
          setError('Could not retrieve user information. Please try again.')
          setLoading(false)
          return
        }

        setEmail(userEmail)
        setAuthType(type)
        setLoading(false)
      } catch (err) {
        console.error('Auth callback error:', err)
        setError('An unexpected error occurred. Please try again.')
        setLoading(false)
      }
    }

    handleAuthCallback()
  }, [])

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      // Validation
      if (password.length < 8) {
        setError('Password must be at least 8 characters')
        setSubmitting(false)
        return
      }

      if (password === email) {
        setError('Password cannot be the same as your email')
        setSubmitting(false)
        return
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match')
        setSubmitting(false)
        return
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateError) {
        console.error('Password update error:', updateError)
        setError(updateError.message || 'Failed to set password. Please try again.')
        setSubmitting(false)
        return
      }

      // For invite flow only: create user_roles entry
      if (authType === 'invite') {
        const { data: { user } } = await supabase.auth.getUser()
        
        if (user) {
          // Get role from user_metadata, default to 'viewer' if missing/invalid
          const metadataRole = user.user_metadata?.role
          const validRoles = ['developer', 'dealer_principal', 'viewer']
          let role = 'viewer' // default
          
          if (metadataRole && validRoles.includes(metadataRole)) {
            role = metadataRole
          } else {
            console.warn(`Invalid or missing role in user_metadata: ${metadataRole}. Defaulting to 'viewer'.`)
          }

          // Upsert into user_roles (idempotent)
          const { error: roleError } = await supabase
            .from('user_roles')
            .upsert(
              { user_id: user.id, role: role },
              { onConflict: 'user_id' }
            )

          if (roleError) {
            console.error('Failed to create user_roles entry:', roleError)
            // Don't block login for this — log warning but continue
            console.warn('User can login but may lack proper role assignment. Admin should verify.')
          }
        }
      }

      // Success — redirect to dashboard
      router.push('/dashboard')
    } catch (err) {
      console.error('Submit error:', err)
      setError('An unexpected error occurred. Please try again.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-white text-lg mb-2">Verifying your link...</div>
          <div className="text-gray-400 text-sm">Please wait</div>
        </div>
      </div>
    )
  }

  if (error && !email) {
    // Fatal error — can't proceed
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-red-800 rounded-xl p-8 w-full max-w-md">
          <div className="text-red-400 text-4xl mb-4 text-center">⚠️</div>
          <h1 className="text-white text-xl font-bold mb-2 text-center">Link Invalid or Expired</h1>
          <p className="text-gray-400 text-sm text-center mb-6">{error}</p>
          <a
            href="/"
            className="block w-full text-center bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg font-medium text-sm transition-colors"
          >
            Back to Login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
        <h1 className="text-white text-2xl font-bold mb-1 text-center">
          {authType === 'invite' ? 'Welcome to DealerIQ' : 'Reset Your Password'}
        </h1>
        <p className="text-gray-400 text-sm text-center mb-6">
          {authType === 'invite' 
            ? 'Create a password to complete your account setup'
            : 'Choose a new password for your account'}
        </p>

        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-gray-400 text-sm block mb-1">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-500 text-sm cursor-not-allowed"
            />
          </div>

          <div>
            <label className="text-gray-400 text-sm block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Minimum 8 characters"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="text-gray-400 text-sm block mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Re-enter password"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3 rounded font-medium text-sm transition-colors"
          >
            {submitting ? 'Setting password...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
