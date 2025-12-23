import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { User } from '@/types'
import { Eye, EyeOff } from 'lucide-react'

interface AuthProps {
  onLogin: (user: User) => void
}

export default function Auth({ onLogin }: AuthProps) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const supabase = createClient()

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (isSignUp) {
        const { data, error } = await supabase
          .from('users')
          .insert({
            username,
            password, // In production, hash this!
            nickname,
            role: 'user',
            avatar: `https://ui-avatars.com/api/?name=${nickname || username}`
          })
          .select()
          .single()

        if (error) throw error
        alert('Account created! Please log in.')
        setIsSignUp(false)
      } else {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('username', username)
          .eq('password', password) // In production, verify hash!
          .single()

        if (error || !data) throw new Error('Invalid credentials')
        onLogin(data as User)
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white">
      <h1 className="text-4xl font-bold mb-8 text-center">SYLAW CHATAPP</h1>
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-lg shadow-xl">
        <h2 className="text-2xl font-bold mb-6 text-center">{isSignUp ? 'Register' : 'Login'}</h2>
        <form onSubmit={handleAuth} className="space-y-4">
          <input
            className="w-full p-3 rounded bg-slate-700 border border-slate-600"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              className="w-full p-3 rounded bg-slate-700 border border-slate-600 pr-10"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              {showPassword ? (
                <EyeOff className="h-5 w-5 text-gray-400 cursor-pointer" onClick={() => setShowPassword(false)} />
              ) : (
                <Eye className="h-5 w-5 text-gray-400 cursor-pointer" onClick={() => setShowPassword(true)} />
              )}
            </div>
          </div>
          {isSignUp && (
            <input
              className="w-full p-3 rounded bg-slate-700 border border-slate-600"
              placeholder="Nickname"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
            />
          )}
          <button disabled={loading} className="w-full bg-blue-600 py-3 rounded hover:bg-blue-500 font-bold">
            {loading ? 'Processing...' : isSignUp ? 'Sign Up' : 'Log In'}
          </button>
        </form>
        <p className="mt-4 text-center text-gray-400 cursor-pointer hover:text-white" onClick={() => setIsSignUp(!isSignUp)}>
          {isSignUp ? 'Already have an account? Log In' : 'Need an account? Register'}
        </p>
      </div>
    </div>
  )
}

