'use client'
import { MessageCircle, Navigation, UtensilsCrossed, LogOut, AlertTriangle } from 'lucide-react'
import { User } from '@/types'

interface AppLauncherProps {
  currentUser: User
  onSelectApp: (app: 'chat' | 'navigation' | 'restaurant' | 'sos') => void
  onLogout: () => void
}

export default function AppLauncher({ currentUser, onSelectApp, onLogout }: AppLauncherProps) {
  const apps = [
    {
      id: 'chat' as const,
      name: 'Chat App',
      icon: MessageCircle,
      color: 'bg-blue-500',
      hoverColor: 'hover:bg-blue-600',
      description: 'Connect with friends and groups'
    },
    {
      id: 'navigation' as const,
      name: 'Navigation',
      icon: Navigation,
      color: 'bg-green-500',
      hoverColor: 'hover:bg-green-600',
      description: 'GPS navigation and directions'
    },
    {
      id: 'restaurant' as const,
      name: 'Restaurant Search',
      icon: UtensilsCrossed,
      color: 'bg-orange-500',
      hoverColor: 'hover:bg-orange-600',
      description: 'Find restaurants near you'
    },
    {
      id: 'sos' as const,
      name: 'SOS Emergency',
      icon: AlertTriangle,
      color: 'bg-red-500',
      hoverColor: 'hover:bg-red-600',
      description: 'Send emergency alert with location'
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      {/* Header */}
      <div className="w-full p-4 md:p-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg md:text-xl">
            {currentUser.nickname?.[0]?.toUpperCase() || currentUser.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div>
            <h1 className="text-white font-bold text-lg md:text-xl">
              Welcome, {currentUser.nickname || currentUser.username}
            </h1>
            <p className="text-gray-400 text-xs md:text-sm">Select an app to get started</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="p-2 md:p-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors"
          title="Logout"
        >
          <LogOut size={20} className="md:w-6 md:h-6" />
        </button>
      </div>

      {/* App Grid */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-4xl">
          <h2 className="text-white text-2xl md:text-3xl font-bold mb-6 md:mb-8 text-center">
            Applications
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {apps.map((app) => {
              const IconComponent = app.icon
              return (
                <button
                  key={app.id}
                  onClick={() => onSelectApp(app.id)}
                  className={`
                    ${app.color} ${app.hoverColor}
                    rounded-2xl p-6 md:p-8
                    text-white
                    transition-all duration-300
                    transform hover:scale-105 hover:shadow-2xl
                    active:scale-95
                    flex flex-col items-center justify-center
                    gap-4
                    min-h-[200px] md:min-h-[240px]
                    shadow-lg
                  `}
                >
                  <div className="bg-white/20 rounded-full p-4 md:p-5 backdrop-blur-sm">
                    <IconComponent size={48} className="md:w-16 md:h-16" />
                  </div>
                  <div className="text-center">
                    <h3 className="font-bold text-xl md:text-2xl mb-2">{app.name}</h3>
                    <p className="text-white/80 text-sm md:text-base">{app.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full p-4 text-center text-gray-400 text-xs md:text-sm">
        <p>SYLAW Application Suite</p>
      </div>
    </div>
  )
}

